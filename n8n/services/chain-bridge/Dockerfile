FROM node:22.14.0-alpine3.21

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --chown=node:node scripts ./scripts
COPY --chown=node:node n8n/lib ./n8n/lib
COPY --chown=node:node n8n/services/chain-bridge ./n8n/services/chain-bridge
RUN mkdir -p /var/lib/chain-bridge \
	&& chown node:node /var/lib/chain-bridge \
	&& chmod 0700 /var/lib/chain-bridge

USER node
EXPOSE 3001

CMD ["node", "n8n/services/chain-bridge/server.js"]