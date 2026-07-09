# GitHub Issue #2322: Support Webflow's current remote MCP OAuth endpoint without mcp-remote workaround

**Repository:** llxprt-code
**State:** open
**Labels:** Model Support

## Body

## Summary

LLxprt Code cannot connect directly to Webflow's current remote MCP endpoint/auth flow. Webflow's previously documented SSE endpoint now rejects clients, and the working setup requires wrapping Webflow's Streamable HTTP MCP endpoint with `mcp-remote`.

This makes Webflow MCP setup fragile and non-obvious in llxprt-code. The workaround works, but it depends on an external bridge and browser OAuth cache rather than first-class llxprt remote MCP support.

## Observed behavior

A Webflow MCP server configured against the old SSE endpoint fails because Webflow no longer supports it:

```text
https://mcp.webflow.com/sse
```

Webflow returns an error equivalent to:

```text
SSE is no longer supported. use https://mcp.webflow.com/mcp
```

The working configuration for this project is:

```json
{
  "mcpServers": {
    "webflow": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.webflow.com/mcp"],
      "type": "stdio",
      "trust": true,
      "description": "Webflow MCP via mcp-remote bridge (OAuth SSE to stdio). Authorizes via browser OAuth on first connect; cache in ~/.mcp-auth."
    }
  }
}
```

This works because `mcp-remote` handles Webflow's remote MCP/OAuth flow and exposes it back to llxprt as stdio.

## Expected behavior

llxprt-code should support Webflow's current remote MCP endpoint directly, or at least make this setup first-class/documented.

A user should be able to configure something like:

```json
{
  "mcpServers": {
    "webflow": {
      "url": "https://mcp.webflow.com/mcp",
      "type": "streamable-http",
      "trust": true
    }
  }
}
```

and have llxprt-code handle:

- Remote Streamable HTTP MCP transport
- Browser OAuth authorization
- Token caching/refresh
- Reconnects without requiring an external `mcp-remote` wrapper

## Why this matters

Webflow's official MCP endpoint is now:

```text
https://mcp.webflow.com/mcp
```

not:

```text
https://mcp.webflow.com/sse
```

Without first-class support, users hit confusing auth/transport failures and have to discover the `mcp-remote` workaround independently.

This also complicates support/debugging because the actual auth tokens are cached by `mcp-remote` in `~/.mcp-auth`, and direct Webflow API calls using those cached tokens returned 401 in our testing. They appear scoped for the MCP proxy flow, not general Webflow Data API use.

## Reproduction

1. Configure Webflow MCP using the legacy SSE endpoint:

   ```text
   https://mcp.webflow.com/sse
   ```

2. Start llxprt-code and attempt to use Webflow MCP tools.
3. Connection/auth fails with Webflow's message that SSE is no longer supported and the `/mcp` endpoint should be used.
4. Configure Webflow using `/mcp` through `mcp-remote`:

   ```json
   {
     "command": "npx",
     "args": ["-y", "mcp-remote", "https://mcp.webflow.com/mcp"],
     "type": "stdio"
   }
   ```

5. Browser OAuth flow succeeds and Webflow MCP tools become usable.

## Workaround

Use `mcp-remote` as a stdio bridge:

```json
{
  "mcpServers": {
    "webflow": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.webflow.com/mcp"],
      "type": "stdio",
      "trust": true
    }
  }
}
```

## Requested fix

Add first-class support and/or docs for remote Streamable HTTP MCP servers that require browser OAuth, specifically Webflow's current endpoint:

```text
https://mcp.webflow.com/mcp
```

If direct support is not planned, llxprt-code should document the `mcp-remote` workaround in its MCP setup docs and preferably surface a helpful error when a user configures the deprecated Webflow SSE endpoint.

