FROM node:22-alpine
WORKDIR /app
COPY ai/lib ./ai/lib
COPY ai/tools/capture-pages/lib ./ai/tools/capture-pages/lib
COPY n8n/capture ./n8n/capture
USER node
EXPOSE 8788
CMD ["node", "n8n/capture/server.js"]
