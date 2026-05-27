# Multi-stage build: deps + build + runtime
# Total final image size: ~150 MB (alpine + node + production deps).

# ---- Production dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock

# ---- TypeScript compile ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund --no-package-lock
COPY src ./src
COPY data ./data
RUN npm run build

# ---- Runtime image ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Bundle production deps + compiled JS + reference CSV data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data
COPY package.json ./

# Run as the unprivileged "node" user that the base image provides.
RUN chown -R node:node /app
USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]
