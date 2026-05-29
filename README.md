# mcp-webhook-relay
A tiny MCP server that POSTs to webhook URLs on behalf of sandboxed MCP clients (Claude Desktop, Cowork). Bridges outbound HTTPS to endpoints like Slack incoming webhooks when the client's network can't reach them directly.
