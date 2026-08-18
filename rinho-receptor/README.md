# rinho-receptor

Receptor y parser propio del reporte EQ del protocolo Rinho Spider IoT, por UDP. Ver el
contrato completo en
[`../specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md`](../specs/001-ingesta-adaptacion-telemetria/contracts/rinho-eq-frame.md).

## Relación con `rinho-udp-server`

Este servicio nace como evolución "productiva" del prototipo
[`fernandorvs/rinho-udp-server`](https://github.com/fernandorvs/rinho-udp-server)
(research.md D-01, D-02). Reutilizado y NO reutilizado, explícitamente:

**Reutilizado** (conceptos validados contra hardware real, reimplementados aquí con la
misma lógica):

- El **envelope** del protocolo: `>BODY;#msgNum;ID=deviceId;*checksum<`.
- El **algoritmo de checksum** XOR byte a byte, 2 dígitos hex mayúsculas.
- La **guarda de fecha/hora en ceros** antes de construir un objeto `Date`: alimentar un
  constructor de fecha con `000000/000000` produce `1999-11-30` por normalización de
  mes/día en base cero, lo que rompería el particionamiento de la hypertable.

**NO reutilizado** (incompatible o fuera de alcance):

- `canJsonTransform` — parsea la variante **ER / J1939** (vehículo pesado), cuyos IDs CAN
  son de **4 dígitos** (`2010`, `4201`…). El reporte **EQ** que usa este servicio tiene IDs
  de **1-2 caracteres hex** y semántica distinta: son formatos incompatibles, no una
  variación menor (ver `research.md` D-02).
- `parserCQ` / `parserER` — parsers de otros tipos de reporte, no usados en EQ.
- Cualquier lógica de **downlink de comandos** al dispositivo: fuera de alcance de esta
  feature (solo se implementa el ACK a nivel de protocolo).
- La conversión de velocidad **× 1.852** (nudos → km/h): era específica del modelo interno
  de Traccar. La trama EQ ya reporta velocidad en km/h; aplicar esa conversión acá infla
  toda velocidad un 85% (ver `contracts/rinho-eq-frame.md` §3, "trampa histórica").

## Desarrollo local

```bash
nvm use 22   # o cualquier Node.js >= 22
npm install
npm test
```

Los tests de `test/lecturaTardia.test.js` y `test/*IntegrationTest` equivalentes se
saltan automáticamente si no hay variables de conexión a base (`UDP_PORT`, `DB_HOST`,
etc. — ver `deploy/.env.example`). Corren de punta a punta contra el stack real de
`docker compose`.
