# ComputeX — single-image deployment.
#
# One container serves both the API and the built frontend, so the browser talks
# to /api on its own origin. The server is long-lived on purpose: the job store,
# the stage event bus and the NDJSON progress stream are all in-process, none of
# which survives a serverless invocation model.

# --- build the frontend -------------------------------------------------
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- install server dependencies ---------------------------------------
FROM node:22-slim AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

# --- runtime ------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/tsconfig.json ./server/tsconfig.json
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY --from=client-build /app/client/dist ./client/dist

# Hosts inject PORT; the payer proxy calls the API back on this same port.
ENV PORT=8080
EXPOSE 8080

# Do not run as root.
USER node

CMD ["npm", "--prefix", "server", "run", "start"]
