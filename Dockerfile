# mcp-webhook-relay — stdio MCP server.
# The MCP client spawns one container per session, talks to it via stdin/stdout
# (MCP JSON-RPC), and reaps it via --rm when stdin closes. No exposed ports.

FROM node:lts-alpine

WORKDIR /app

# Install deps in a separate layer so they cache across source-only changes.
# Uses `npm install` so the build works whether or not a lockfile is present;
# commit a package-lock.json to your fork for pinned, reproducible installs.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Server source.
COPY server.js ./

# Run as non-root for good hygiene.
USER node

ENTRYPOINT ["node", "/app/server.js"]
