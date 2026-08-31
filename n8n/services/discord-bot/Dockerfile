FROM node:22-alpine

WORKDIR /app

# Aucune dependance npm : fetch et WebSocket natifs de Node 22.
COPY n8n/services/discord-bot ./n8n/services/discord-bot

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 8790

CMD ["node", "n8n/services/discord-bot/bot.js"]
