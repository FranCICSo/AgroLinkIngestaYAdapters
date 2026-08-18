FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

RUN addgroup -S rinho && adduser -S rinho -G rinho
USER rinho

CMD ["node", "src/index.js"]
