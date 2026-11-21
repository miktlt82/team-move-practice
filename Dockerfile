FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json openapi.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=8080 DB_PATH=/app/data/team-move.sqlite
EXPOSE 8080
CMD ["node", "server/index.js"]
