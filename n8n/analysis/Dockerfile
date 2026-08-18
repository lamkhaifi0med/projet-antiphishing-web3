FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY ai ./ai
COPY n8n/analysis ./n8n/analysis
USER node
EXPOSE 8789
CMD ["node", "n8n/analysis/server.js"]
