// Envio del webhook Samsara a agrolink-ingesta (spec 015, FR-020). Nunca lanza: devuelve el
// resultado (aceptado / rechazado / sin respuesta) para que el emisor lo registre y siga.
export function crearWebhookClient({ url, timeoutMs = 3000, fetchImpl = globalThis.fetch }) {
  return {
    async enviar(payload) {
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const cuerpo = await res.text();
        return { resultado: res.ok ? 'aceptado' : 'rechazado', status: res.status, cuerpo };
      } catch (err) {
        return { resultado: 'sin_respuesta', error: err.message };
      }
    },
  };
}
