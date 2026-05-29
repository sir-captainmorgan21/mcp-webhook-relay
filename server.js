#!/usr/bin/env node
// mcp-webhook-relay — minimal MCP server that POSTs to webhook URLs.
//
// Purpose: bridges sandboxed MCP clients (Claude Desktop, Cowork, etc.) to
// webhook endpoints they can't reach directly — e.g. hooks.slack.com when
// blocked by a client-side network allowlist. This server runs on the host
// machine via stdio MCP transport, so it has the host's full outbound
// network access.
//
// Transport: stdio (the client spawns this process and talks to it via
// stdin/stdout JSON-RPC). Logs go to stderr so they don't interfere with the
// protocol stream.
//
// Optional env var: ALLOWED_URL_PREFIXES — comma-separated. When set, only
// URLs starting with one of these prefixes are accepted. Leave unset to
// allow any HTTPS URL (the relay refuses plain HTTP regardless).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const log = (...args) => console.error("[mcp-webhook-relay]", ...args);

const allowedPrefixes = (process.env.ALLOWED_URL_PREFIXES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (allowedPrefixes.length) {
  log("URL allowlist active:", allowedPrefixes);
} else {
  log("URL allowlist NOT set — any HTTPS URL is accepted.");
}

const server = new McpServer({
  name: "mcp-webhook-relay",
  version: "1.0.0",
});

server.tool(
  "post_webhook",
  "POST a JSON payload to a webhook URL from the host machine. Use this when calling URLs the MCP client's sandbox cannot reach directly (e.g. Slack incoming webhooks at https://hooks.slack.com/services/...). The payload may be a JSON object (will be stringified) or a raw string. Returns the HTTP status and response body.",
  {
    url: z
      .string()
      .url()
      .describe("Target URL. Must be HTTPS."),
    payload: z
      .union([z.string(), z.record(z.any())])
      .describe(
        "Body to POST. If an object, it's JSON-stringified and sent with Content-Type: application/json. If a string, sent as-is with the same Content-Type."
      ),
  },
  async ({ url, payload }) => {
    // Safety: HTTPS only.
    if (!url.startsWith("https://")) {
      return {
        content: [
          {
            type: "text",
            text: `Refused: only HTTPS URLs are accepted (got: ${url.slice(0, 40)}...).`,
          },
        ],
        isError: true,
      };
    }

    // Safety: optional allowlist.
    if (allowedPrefixes.length && !allowedPrefixes.some((p) => url.startsWith(p))) {
      return {
        content: [
          {
            type: "text",
            text: `Refused: URL does not match any allowed prefix. Configured prefixes: ${allowedPrefixes.join(", ")}`,
          },
        ],
        isError: true,
      };
    }

    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    log("POST", url, `(${body.length} bytes)`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const responseText = await res.text();
      const summary = `HTTP ${res.status} ${res.statusText}\n${responseText || "(empty body)"}`;
      log("→", `HTTP ${res.status}`);

      return {
        content: [{ type: "text", text: summary }],
        isError: !res.ok,
      };
    } catch (e) {
      const message = e?.name === "AbortError" ? "Request timed out after 15s" : (e?.message || String(e));
      log("ERROR:", message);
      return {
        content: [{ type: "text", text: `Network error: ${message}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
log("ready");
