FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
RUN npm ci && npm run prisma:generate && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    DATABASE_URL=file:/data/quiz.db \
    CLIENT_ORIGIN=http://localhost:4000
WORKDIR /app/server
COPY --from=server-deps --chown=node:node /app/server/node_modules ./node_modules
COPY --chown=node:node server/package.json ./package.json
COPY --chown=node:node server/prisma ./prisma
COPY --chown=node:node server/src ./src
COPY --chown=node:node server/docker-entrypoint.sh ./docker-entrypoint.sh
COPY --from=client-build --chown=node:node /app/client/dist /app/client/dist
RUN mkdir -p /data /app/server/uploads && \
    chown -R node:node /data /app/server/uploads && \
    chmod +x ./docker-entrypoint.sh
USER node
EXPOSE 4000
VOLUME ["/data", "/app/server/uploads"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health/ready >/dev/null || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
