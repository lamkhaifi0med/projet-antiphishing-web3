# Outil one-shot de capture (prototype RF-S8/RF-N5 bis). Pas un service
# permanent : conteneur lancé, exécute la capture, se termine.
FROM node:22-slim

WORKDIR /app
COPY . .

# Utilisateur non-root déjà fourni par l'image officielle node:22-slim
# (RF-N5 bis / RF-S8) — pas de useradd, un seul utilisateur à retenir.
USER node

# Aucune dépendance externe : uniquement les modules natifs de Node
# (node:http, node:https, node:dns, node:crypto). Rien à npm install.
ENTRYPOINT ["node", "capture.js"]
