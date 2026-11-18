FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
# AWS RDS CA bundle (ap-south-1) so PostgreSQL certificates are verified.
# App Runner sets DATABASE_SSL_CA_FILE=/app/certs/ap-south-1-rds-ca.pem.
COPY --chown=node:node ap-south-1-rds-ca.pem ./certs/ap-south-1-rds-ca.pem
COPY --chown=node:node assets ./assets
COPY --chown=node:node src ./src
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
