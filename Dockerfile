FROM node:22-bookworm-slim AS build
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
# A lockfile is used when one has been generated on an online machine.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY client ./client
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 STORAGE_DIR=/data/uploads
WORKDIR /app
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node docs ./docs
COPY --from=build --chown=node:node /app/client/dist ./client/dist
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
