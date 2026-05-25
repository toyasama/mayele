# Build stage: compile le client et le serveur
FROM node:20-alpine AS builder

WORKDIR /app

# Copier les fichiers packages
COPY package*.json ./
COPY client/package.json client/
COPY server/package.json server/

# Installer les dépendances
RUN npm install
RUN cd client && npm install
RUN cd server && npm install

# Copier les sources
COPY client client/
COPY server server/

# Lancer le build du client
RUN cd client && npm run build

# Runtime stage: servir l'app
FROM node:20-alpine

WORKDIR /app

# Copier les dépendances du serveur
COPY server/package.json server/
RUN cd server && npm install --omit=dev

# Copier le code du serveur et la build du client
COPY server/src server/src
COPY --from=builder /app/client/dist client/dist

# Créer le dossier data pour SQLite
RUN mkdir -p data

# Variable d'environnement
ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

# Démarrer le serveur
CMD ["node", "server/src/index.js"]
