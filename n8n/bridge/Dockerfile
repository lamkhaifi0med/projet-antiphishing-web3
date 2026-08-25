FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts ./scripts
COPY n8n/bridge ./n8n/bridge

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 8787

CMD ["node", "n8n/bridge/server.js"]
