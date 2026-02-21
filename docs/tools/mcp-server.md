# MCP Servers

MCP (Model Context Protocol) servers add third-party tools to LLxprt Code. They let you connect to external services, databases, APIs, or custom tooling that goes beyond the built-in tools.

## Adding an MCP Server

### Via CLI

```bash
llxprt mcp add my-server -- npx -y @example/mcp-server
```

This adds the server to your `~/.llxprt/settings.json` automatically.

### Via settings.json

Add entries under `mcpServers`:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {
        "API_KEY": "your-key"
      }
    }
  }
}
```

### Transport Types

**stdio** (default) — runs a local process:

```json
{
  "my-server": {
    "command": "npx",
    "args": ["-y", "@example/mcp-server"]
  }
}
```

**SSE** — connects to a remote HTTP server:

```json
{
  "my-remote": {
    "url": "https://mcp.example.com/sse"
  }
}
```

**Streamable HTTP** — modern HTTP transport:

```json
{
  "my-http": {
    "url": "https://mcp.example.com/mcp",
    "transport": "streamable-http"
  }
}
```

## Managing Servers

### List Configured Servers

```bash
llxprt mcp list
```

Or during a session:

```
/mcp
```

This shows all configured servers, their connection status, and the tools they provide.

### Remove a Server

```bash
llxprt mcp remove my-server
```

### Check Status

```
/mcp
```

Shows connection states: `connected`, `connecting`, `failed`, `not_started`.

## OAuth Authentication

Remote MCP servers that require OAuth are supported. When connecting, LLxprt Code handles the OAuth flow automatically:

1. Server responds with a `401` and OAuth metadata
2. LLxprt Code opens your browser for authentication
3. Token is stored and refreshed automatically

You can pre-configure OAuth:

```json
{
  "my-oauth-server": {
    "url": "https://mcp.example.com/sse",
    "oauthClientId": "your-client-id",
    "oauthAuthorizationUrl": "https://auth.example.com/authorize",
    "oauthTokenUrl": "https://auth.example.com/token",
    "oauthScopes": ["read", "write"]
  }
}
```

If `auth.noBrowser` is set, the flow falls back to a manual code-entry mode.

## MCP Prompts as Slash Commands

MCP servers can define **prompts** — reusable templates that appear as `/` commands in LLxprt Code:

```
/my-server:analyze-code --language typescript --focus performance
```

Use `/help` to see available MCP prompts alongside built-in commands.

## Sandboxing

When running in a [sandbox](../sandbox.md), MCP servers must be available **inside the container**. If your server uses `npx`, the npm package must be installable within the sandbox environment.

## Common Issues

**Server won't connect:**

- Check the command path exists and is executable
- For stdio servers, try running the command manually to see errors
- Check `LLXPRT_DEBUG=llxprt:mcp:*` for detailed connection logs

**Tools not appearing:**

- Run `/mcp` to check if the server is connected
- The server may need time to start — tools appear after connection is established
- If tool names conflict with built-in tools, the built-in tool takes precedence

**OAuth failures:**

- Ensure the OAuth URLs and client ID are correct
- Check if the server's OAuth flow requires specific scopes
- Try removing cached tokens: check the token storage in your OS-standard data directory

**Environment variables not reaching the server:**

- Variables in the `env` block are passed to the server process
- They don't inherit from your shell unless explicitly listed

## Related

- [Tools](./index.md) — all built-in tools
- [Sandboxing](../sandbox.md) — running in a container
- [Settings](../settings-and-profiles.md) — where MCP config lives
