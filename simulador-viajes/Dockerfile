# Build context = raiz del repo (ver deploy/compose.yaml): frameBuilder.js importa
# rinho-receptor/test/tools/buildFrame.js por ruta relativa entre proyectos (research.md
# D-01), asi que la imagen necesita preservar esa misma estructura de directorios en vez de
# empaquetar solo simulador-viajes/.
FROM node:22-alpine

WORKDIR /app

COPY simulador-viajes/package.json simulador-viajes/package-lock.json* ./simulador-viajes/
RUN cd simulador-viajes && npm install --omit=dev

COPY simulador-viajes/src ./simulador-viajes/src
# Solo lo que buildFrame.js necesita de rinho-receptor, no el proyecto completo.
COPY rinho-receptor/src/protocol/frame.js ./rinho-receptor/src/protocol/frame.js
COPY rinho-receptor/test/tools/buildFrame.js ./rinho-receptor/test/tools/buildFrame.js

# Feature 016-alerta-temperatura-motor (research.md D-05): curl para activar/desactivar el
# sobrecalentamiento de motor desde dentro del contenedor (docker compose exec ... curl). La
# imagen base alpine solo trae el wget de busybox.
RUN apk add --no-cache curl

RUN addgroup -S simulador && adduser -S simulador -G simulador
USER simulador

WORKDIR /app/simulador-viajes
CMD ["node", "src/index.js"]
