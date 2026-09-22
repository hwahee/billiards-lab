# Multi-stage build: the final image contains ONLY the built artifacts —
# the server bundle (which embeds the built client) and the migration runner.

FROM oven/bun:1.4.0 AS build
WORKDIR /app

# Install with a frozen lockfile first, so source changes don't bust the layer.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .
RUN bun run build

FROM oven/bun:1.4.0-slim AS runtime
WORKDIR /app
ENV APP_ENV=production
ENV PORT=3000

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

EXPOSE 3000

# The bundled client assets are resolved relative to the working directory.
WORKDIR /app/dist

# Apply migrations with: docker compose run app bun migrate.js
CMD ["bun", "index.js"]
