# mcp-webhook-relay

A tiny [MCP](https://modelcontextprotocol.io) server that POSTs to webhook URLs on behalf of MCP clients that can't reach them directly. Runs as a stdio MCP server, shipped as a small Docker image.

## Why this exists

Sandboxed MCP clients — including [Claude Desktop](https://claude.ai/download) and Anthropic's Cowork — restrict outbound HTTP from inside their sandbox via an allowlist proxy. That allowlist often does **not** include endpoints like `hooks.slack.com`, which means scheduled tasks and agents running inside the sandbox can't fire Slack incoming webhooks (or other arbitrary webhook URLs).

**Origin story:** I built this because I wanted a Cowork scheduled task to ping me on Slack when one of my GitHub PRs had merge conflicts. The Slack MCP wouldn't work — sending DMs to yourself doesn't trigger push notifications — and a direct `curl` to a Slack incoming webhook hit `403 blocked-by-allowlist` at the sandbox proxy. The fix: relay the POST through this MCP server, which runs on the host (your laptop) and therefore has unrestricted outbound access.

The relay is **generic**: `post_webhook(url, payload)` accepts any HTTPS URL. Slack is just the most common use case.

## What it does

Exposes one MCP tool:

- **`post_webhook(url, payload)`** — POSTs `payload` to `url` with `Content-Type: application/json`. Returns the HTTP status and response body.
  - `url` must be HTTPS.
  - `payload` may be a JSON object (auto-stringified) or a raw string.
  - Optional `ALLOWED_URL_PREFIXES` env var (comma-separated) locks the relay to specific URL prefixes — e.g. `https://hooks.slack.com/` to ensure it's only used for Slack webhooks.

## Prerequisites

- macOS or Linux (Windows likely works but untested)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or any Docker-compatible runtime)
- An MCP client that supports stdio servers — [Claude Desktop](https://claude.ai/download), Cowork, [Claude Code](https://docs.claude.com/en/docs/agents-and-tools/claude-code/overview), etc.

## Quick start

### 1. Clone and build the image

```bash
git clone https://github.com/sir-captainmorgan21/mcp-webhook-relay.git
cd mcp-webhook-relay
docker build -t mcp-webhook-relay:latest .
```

First build takes about 30 seconds (pulls `node:lts-alpine`, installs deps). Subsequent rebuilds — only needed if you edit `server.js` — are near-instant thanks to layer caching.

### 2. Register with your MCP client

For **Claude Desktop** or **Cowork** on macOS, edit `~/Library/Application Support/Claude/claude_desktop_config.json` and add an entry inside `mcpServers`:

```json
{
  "mcpServers": {
    "webhook-relay": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "ALLOWED_URL_PREFIXES=https://hooks.slack.com/",
        "mcp-webhook-relay:latest"
      ]
    }
  }
}
```

Notes:
- The key (`"webhook-relay"`) is the local nickname for this MCP — pick whatever you want.
- The `ALLOWED_URL_PREFIXES` value should reflect your intended targets. **Omit** the `-e ALLOWED_URL_PREFIXES=...` flag to allow any HTTPS URL.
- `--rm` reaps the container after each session; `-i` keeps stdin open for the MCP JSON-RPC stream.

Fully quit your MCP client (Cmd-Q on Mac, verify in Activity Monitor) and relaunch.

### 3. Test it

From your MCP client, invoke the tool:

> Use the webhook-relay tool to POST `{"text": "hello from the relay"}` to `https://hooks.slack.com/services/...`

You should see `HTTP 200 OK` and `ok` in the response, plus a real Slack message in the destination channel.

## How it works

```
┌───────────────────────────────────────────────┐
│ MCP Client (Cowork / Claude Desktop)          │
│   sandboxed; outbound HTTPS is allowlisted    │
│                                               │
│   ⨯  hooks.slack.com → blocked at proxy       │
│                                               │
└─────────────────┬─────────────────────────────┘
                  │ MCP JSON-RPC over stdio
                  ▼
┌───────────────────────────────────────────────┐
│ docker run --rm -i mcp-webhook-relay          │
│   running on the host (your Mac)              │
│   full outbound network access                │
│                                               │
│   fetch("https://hooks.slack.com/...")        │
│                                               │
└─────────────────┬─────────────────────────────┘
                  │ HTTPS POST
                  ▼
            hooks.slack.com → 200 ok
```

The MCP client spawns one container per session — not per tool call. The container stays alive until the MCP session ends, then is reaped via `--rm`. All `post_webhook` calls within the session go through the same long-lived container's stdio JSON-RPC stream.

## Use cases

Webhook-agnostic. Anything that takes a JSON POST works:

- **Slack** incoming webhooks (push notifications that actually push, unlike user-token self-DMs)
- **Discord** webhooks
- **Microsoft Teams** incoming webhooks
- **PagerDuty** Events API v2
- Generic HTTP endpoints for personal automations

Set `ALLOWED_URL_PREFIXES` appropriately for each setup to bound the blast radius.

## Security

- **HTTPS only.** Plain HTTP URLs are refused.
- **Optional URL allowlist.** Set `ALLOWED_URL_PREFIXES` (comma-separated) to restrict acceptable URL prefixes. Recommended for production use.
- **No exposed ports.** stdio-only transport; the container has no listening sockets and isn't network-reachable from anywhere.
- **Non-root.** Container runs as the `node` user.
- **Local trust boundary.** The relay trusts its MCP client. Don't expose this server to remote callers.

If you're concerned about prompt injection causing the relay to POST to unexpected URLs, set `ALLOWED_URL_PREFIXES` tightly.

## Run without Docker (development)

```bash
npm install
node server.js
```

The server reads JSON-RPC on stdin and writes responses on stdout. Logs go to stderr. To register a non-Docker run with your MCP client:

```json
{
  "mcpServers": {
    "webhook-relay": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-webhook-relay/server.js"],
      "env": {
        "ALLOWED_URL_PREFIXES": "https://hooks.slack.com/"
      }
    }
  }
}
```

## Caveats

- Docker Desktop must be running when your MCP client tries to spawn the relay. If Docker is stopped, the relay is unavailable until Docker is restarted.
- The relay does not retry failed POSTs. Caller is responsible for retry logic.
- No `package-lock.json` is committed — the Dockerfile uses `npm install`. For pinned reproducible builds in your fork, run `npm install` once and commit the resulting lockfile, then change `npm install` to `npm ci` in the Dockerfile.

## Contributing

PRs welcome. Keep the surface area minimal — this is meant to be a small bridge, not a full HTTP client.

## License

[MIT](./LICENSE)
