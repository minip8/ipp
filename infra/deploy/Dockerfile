# One image definition, two targets: `api` (also used for migrations and seeding) and `web`.
# Build context is the repository root.
FROM node:26-bookworm-slim AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install -g --allow-scripts=pnpm pnpm@12.21.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && chown -R node:node /app

FROM base AS api
ENV NODE_ENV=production
USER node
EXPOSE 4000
CMD ["pnpm", "--filter", "@ipp/api", "start"]

FROM base AS web
# Both values are baked into the build: the rewrite target and the WebSocket origin (also in the CSP).
ARG API_INTERNAL_URL
ARG NEXT_PUBLIC_WS_URL
ENV NODE_ENV=production API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
USER node
RUN pnpm --filter @ipp/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@ipp/web", "start"]
