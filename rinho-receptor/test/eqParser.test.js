import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpsSection } from '../src/protocol/eqParser.js';
import { parseDatagram } from '../src/protocol/frame.js';

const VENDOR_FRAME =
  '>REQ00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117;1=,2=,3=,B=,14=,15=,2A=,2C=;ID=2326;*01<';
const REAL_FRAME =
  '>REQ00210918170359-2778100-064258570001517F000000000049D13010900001516;1=1M8GDM9A_KP042788,2=2200,3=45,B=66010,14=30000,15=75,2A=90,2C=340;ID=037883;*01<';

// contracts/rinho-eq-frame.md §5 — ejemplo oficial del fabricante, CAN vacio.
const VENDOR_GPS = '00000000000000-2780656-064296830000117F00000010836F1130112FFFF1117';

// contracts/rinho-eq-frame.md §5-bis — trama real, CAN poblado.
const REAL_GPS = '00210918170359-2778100-064258570001517F000000000049D13010900001516';

test('la seccion GPS mide exactamente 66 chars y el layout cierra sin sobrante (vendor)', () => {
  assert.equal(VENDOR_GPS.length, 66);
  const parsed = parseGpsSection(VENDOR_GPS);
  assert.ok(parsed);
});

test('la seccion GPS mide exactamente 66 chars y el layout cierra sin sobrante (real)', () => {
  assert.equal(REAL_GPS.length, 66);
  const parsed = parseGpsSection(REAL_GPS);
  assert.ok(parsed);
});

test('parseGpsSection falla explicitamente si la seccion no mide 66', () => {
  assert.throws(() => parseGpsSection(VENDOR_GPS.slice(0, 49)), /66/);
});

test('caso completo: trama del fabricante decodificada campo a campo', () => {
  const r = parseGpsSection(VENDOR_GPS);
  assert.equal(r.reporteId, '00');
  assert.equal(r.fechaHoraEnCeros, true);
  assert.equal(r.latitud, -27.80656);
  assert.equal(r.longitud, -64.29683);
  assert.equal(r.velocidadKmh, 0); // ya en km/h — NO convertir (ver test de regresion)
  assert.equal(r.rumboGrados, 11);
  assert.equal(r.ignicion, false); // 0x7F & 0x80 = 0
  assert.equal(r.tensionBateriaV, 0);
  assert.equal(r.odometroGpsM, 0x010836f1);
  assert.equal(r.fixMode, '3');
  assert.equal(r.satelites, 12);
  assert.equal(r.csq, 17);
});

test('caso completo: trama real decodificada campo a campo (contrato §5-bis)', () => {
  const r = parseGpsSection(REAL_GPS);
  assert.equal(r.fechaHoraEnCeros, false);
  assert.equal(r.anio, 2018);
  assert.equal(r.mes, 9);
  assert.equal(r.dia, 21);
  assert.equal(r.hora, 17);
  assert.equal(r.minuto, 3);
  assert.equal(r.segundo, 59);
  assert.equal(r.latitud, -27.781);
  assert.equal(r.longitud, -64.25857);
  assert.equal(r.velocidadKmh, 0);
  assert.equal(r.rumboGrados, 151);
  assert.equal(r.odometroGpsM, 0x49d);
  assert.equal(r.satelites, 9);
  assert.equal(r.csq, 16);
});

test('checksum recalculado coincide con el declarado en ambas tramas de referencia', () => {
  for (const full of [VENDOR_FRAME, REAL_FRAME]) {
    const [frame] = parseDatagram(full);
    assert.equal(frame.checksumValid, true);
  }
});
