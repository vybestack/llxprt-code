# MCP Servers

MCP (Model Context Protocol) servers add third-party tools to LLxprt Code. They
let you connect to external services, databases, APIs, or custom tooling that
goes beyond the built-in tools.

This page walks through the tasks you perform with MCP servers, in order: add a
server, authenticate to it, verify the connection, use what it exposes, restrict
how much you trust it, troubleshoot, and remove it.

## Add a server

You can add an MCP server two ways: with the `llxprt mcp add` command, or by
editing your `settings.json` directly. Both write to the same configuration.

### Via the CLI

```bash
llxprt mcp add my-server -- npx -y @example/mcp-server
```

This adds the server to your project configuration by default. To add it to your
user configuration (available in every project), pass `--scope user`.

The `add` command writes to either the user `settings.json` or the project
`.llxprt/settings.json` — see
[Application Directories](../reference/application-directories.md).

**Command:**

```bash
llxprt mcp add [options] <name> <commandOrUrl> [args...]
```

- `<name>` — a unique name for the server.
- `<commandOrUrl>` — the command to run (for `stdio`) or the URL (for `http`,
  `streamable-http`, or `sse`).
- `[args...]` — optional arguments for a `stdio` command. Use `--` to separate
  flags that belong to the server command itself.

**Options:**

| Flag              | Description                                                            | Default   |
| ----------------- | ---------------------------------------------------------------------- | --------- |
| `-s, --scope`     | Configuration scope: `user` or `project`.                              | `project` |
| `-t, --transport` | Transport type: `stdio`, `sse`, `http`, `streamable-http`.             | `stdio`   |
| `-e, --env`       | Environment variable, as `KEY=value`. Repeatable.                      | —         |
| `-H, --header`    | HTTP header, as `Key: Value`. For SSE and HTTP transports. Repeatable. | —         |
| `--timeout`       | Connection timeout in milliseconds.                                    | —         |
| `--trust`         | Trust the server (skip per-tool-call confirmation prompts).            | —         |
| `--description`   | Description for the server.                                            | —         |
| `--include-tools` | Comma-separated list of tools to include.                              | —         |
| `--exclude-tools` | Comma-separated list of tools to exclude.                              | —         |

#### Examples

```bash
# stdio server with environment variables
llxprt mcp add -e API_KEY=123 -e DEBUG=true my-stdio-server /path/to/server arg1 arg2

# stdio server, separating server-specific args with --
llxprt mcp add python-server python server.py -- --server-arg my-value

# HTTP (Streamable HTTP) server
llxprt mcp add --transport http http-server https://api.example.com/mcp/

# HTTP server with an authentication header
llxprt mcp add --transport http secure-http https://api.example.com/mcp/ --header "Authorization: Bearer abc123"

# SSE server
llxprt mcp add --transport sse sse-server https://api.example.com/sse/
```

### Via settings.json

Add entries under the `mcpServers` key:

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

### Transport types

**stdio** (default) — runs a local process:

```json
{
  "my-server": {
    "command": "npx",
    "args": ["-y", "@example/mcp-server"]
  }
}
```

**Streamable HTTP** — preferred transport for remote MCP servers. Set the `url`
and optionally `type`:

```json
{
  "my-http": {
    "url": "https://mcp.example.com/mcp",
    "type": "http"
  }
}
```

> `"type": "streamable-http"` is accepted as an alias for `"type": "http"` —
> both select the Streamable HTTP transport. If you omit `type` on a URL-based
> server, Streamable HTTP is used by default.

**SSE** — legacy remote transport for servers that have not migrated to
Streamable HTTP:

```json
{
  "my-remote": {
    "url": "https://mcp.example.com/sse",
    "type": "sse"
  }
}
```

> The `httpUrl` field is deprecated. Use `url` with `"type": "http"` instead.
> If both `httpUrl` and `url` are present, `httpUrl` is used and a deprecation
> warning is logged.

### Tool filtering

Limit which tools a server exposes with `includeTools` and `excludeTools`:

```json
{
  "filteredServer": {
    "command": "python",
    "args": ["-m", "my_mcp_server"],
    "includeTools": ["safe_tool", "file_reader", "data_processor"],
    "excludeTools": ["dangerous_tool"]
  }
}
```

`excludeTools` takes precedence over `includeTools`.

## Authenticate

Remote MCP servers may require authentication. LLxprt Code supports OAuth and
custom HTTP headers, and can impersonate a service account for
Google Cloud IAP-protected services.

### OAuth

Remote servers that require OAuth are supported with an automatic flow. On
first connect, LLxprt Code performs dynamic client registration (RFC 7591) with
PKCE and a loopback redirect, then opens your browser for authorization. Tokens
are stored and refreshed automatically — no `mcp-remote` bridge needed.

If `auth.noBrowser` is set, the flow falls back to a manual mode where you copy
and paste the authorization URL yourself.

You can pre-configure OAuth explicitly. All fields are optional — if omitted,
LLxprt Code discovers them automatically via
`/.well-known/oauth-authorization-server`:

```json
{
  "my-oauth-server": {
    "url": "https://mcp.example.com/mcp",
    "type": "http",
    "oauth": {
      "clientId": "your-client-id",
      "authorizationUrl": "https://auth.example.com/authorize",
      "tokenUrl": "https://auth.example.com/token",
      "scopes": ["read", "write"]
    }
  }
}
```

If a server's OAuth discovery or registration does not conform to the automatic
flow, fall back to the `mcp-remote` stdio bridge:

```json
{
  "mcpServers": {
    "webflow": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.webflow.com/mcp"],
      "type": "stdio"
    }
  }
}
```

To authenticate or re-authenticate a server during a session:

```text
/mcp auth <server-name>
```

Running `/mcp auth` with no argument lists servers that require OAuth.

### Custom headers

For servers that use static API keys or bearer tokens, pass headers directly:

```json
{
  "mcpServers": {
    "httpServerWithAuth": {
      "url": "http://localhost:3000/mcp",
      "type": "http",
      "headers": {
        "Authorization": "Bearer your-api-token",
        "X-Custom-Header": "custom-value"
      }
    }
  }
}
```

### Service-account impersonation

For Google Cloud IAP-protected services, you can impersonate a service account:

```json
{
  "mcpServers": {
    "myIapProtectedServer": {
      "url": "https://my-iap-service.run.app/sse",
      "type": "sse",
      "authProviderType": "service_account_impersonation",
      "targetAudience": "YOUR_IAP_CLIENT_ID.apps.googleusercontent.com",
      "targetServiceAccount": "your-sa@your-project.iam.gserviceaccount.com"
    }
  }
}
```

## Verify it worked

After adding a server, check that it connected successfully.

### With `/mcp`

```text
/mcp
```

This lists every configured server, its connection status, and a count of
tools, prompts, and resources it exposes. A server entry looks like:

```text
[READY] my-server - Ready (3 tools, 1 prompt, 2 resources)
```

Status indicators:

- **`[READY]`** — connected and available.
- **`[STARTING]`** — connecting; first startup may take longer.
- **`[DISCONNECTED]`** — not connected or failed.

You can show tool descriptions and parameter schemas:

```text
/mcp desc      # show server and tool descriptions
/mcp schema    # show tool parameter schemas (also shows descriptions)
/mcp nodesc    # hide descriptions
```

If no servers are configured, `/mcp` links you to this documentation.

### With `llxprt mcp list`

Outside a session, test whether each server is reachable:

```bash
llxprt mcp list
```

This attempts a live connection to each server and prints its name,
configuration, and whether the connection succeeded.

### Connection states

Each server tracks one of these states:

- **Disconnected** — not connected, or a connection error occurred.
- **Connecting** — a connection attempt is in progress.
- **Connected** — the server is connected and ready.

### Apply configuration changes

After editing `settings.json` or running `llxprt mcp add` or
`llxprt mcp remove` in another terminal, apply the persisted changes to the
current session:

```text
/mcp reload
```

Reloading adds newly configured servers, disconnects removed servers, and
reconnects servers whose configuration changed. Use `/mcp refresh` when you only
want to restart the servers already loaded, without rereading configuration.

> Changing OAuth settings may still require `/mcp auth <server>`. Installing or
> removing an extension still requires the extension reload flow or a new
> session.

## Use it

Once a server is connected, its tools, prompts, and resources become available.

### Tools

MCP tools work like built-in tools. The model selects them based on your
request, asks for confirmation before running each call (unless the server is
trusted — see [Restrict trust](#restrict-trust)), executes them, and displays
the results.

Tool names are namespaced as `mcp__<server-name>__<tool-name>` so tools from
different servers never collide.

### Prompts as slash commands

MCP servers can define **prompts** — reusable templates that appear as `/`
commands in LLxprt Code. Each prompt becomes a slash command you can invoke by
name.

```text
/poem-writer --title="LLxprt Code" --mood="reverent"
```

Or, using positional arguments:

```text
/poem-writer "LLxprt Code" reverent
```

When you invoke a prompt, LLxprt Code calls the `prompts/get` method on the MCP
server with the arguments you provide. The server substitutes the arguments
into the prompt template and returns the final text, which is sent to the
model.

Use `<prompt-name> help` to see the arguments a prompt accepts, or `/help` to
see all available commands.

#### Defining prompts on the server

Here is a minimal stdio MCP server that defines a prompt using the
`@modelcontextprotocol/sdk`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'prompt-server',
  version: '1.0.0',
});

server.registerPrompt(
  'poem-writer',
  {
    title: 'Poem Writer',
    description: 'Write a nice haiku',
    argsSchema: { title: z.string(), mood: z.string().optional() },
  },
  ({ title, mood }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Write a haiku${mood ? ` with the mood ${mood}` : ''} called ${title}. Note that a haiku is 5 syllables followed by 7 syllables followed by 5 syllables.`,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Resources

MCP servers can expose **resources** — readable content you can pull into your
conversation. You reference a resource with the `@` syntax:

```text
@serverName:resourceUri
```

For example:

```text
@docs:file:///workspace/README.md
```

When this pattern matches a discovered resource, LLxprt Code reads it via
`resources/read` and injects the content into the request. Binary resources are
shown as a safe placeholder summary (MIME type and size) rather than raw bytes.

Resources also appear in `/mcp` output, which lists each server's discovered
resource names and URIs.

### Rich content from tools

MCP tools can return rich, multi-part content in a single response — text,
images, audio, and embedded resources. To return rich content, your tool's
response must follow the MCP specification for a
[`CallToolResult`](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-result):
the `content` field is an array of content blocks.

Supported block types:

- `text`
- `image`
- `audio`
- `resource` (embedded content)
- `resource_link`

```json
{
  "content": [
    {
      "type": "text",
      "text": "Here is the logo you requested."
    },
    {
      "type": "image",
      "data": "BASE64_ENCODED_IMAGE_DATA_HERE",
      "mimeType": "image/png"
    },
    {
      "type": "text",
      "text": "The logo was created in 2025."
    }
  ]
}
```

LLxprt Code extracts text blocks and combines them into the model's context,
presents images and audio as separate parts, and shows a readable summary in
the CLI.

## Restrict trust

MCP servers run code and make network requests. Control how much trust each
server gets.

### Confirmation prompts

By default, every MCP tool call asks for confirmation before it runs. When
prompted, you can choose to:

- **Proceed once** — run this call only.
- **Always allow this tool** — skip confirmation for this specific tool going
  forward.
- **Always allow this server** — skip confirmation for every tool from this
  server.
- **Cancel** — abort the call.

### The `trust` option

The `trust` option bypasses all confirmation dialogs for a server. Use it only
for servers you completely control:

```json
{
  "my-server": {
    "command": "npx",
    "args": ["-y", "@example/mcp-server"],
    "trust": true
  }
}
```

You can also set trust when adding a server:

```bash
llxprt mcp add --trust my-server /path/to/server
```

> Trust bypasses confirmation only when the working directory is a trusted
> folder. In an untrusted folder, confirmation is still required.

### Security considerations

- **Access tokens.** Be careful when configuring environment variables or
  headers that contain API keys or tokens.
- **Personal access tokens.** Broadly scoped tokens can leak information between
  repositories or projects.
- **Sandboxing.** When running in a [sandbox](../sandbox.md), MCP servers must
  be available inside the container. If your server uses `npx`, the npm package
  must be installable within the sandbox environment.

### Lazy MCP schema loading

When you have many MCP servers with large tool schemas, every tool schema is
sent to the model on each request. The `mcp.lazy` setting defers those schemas
so only the servers you actually need are published.

- **Servers stay connected.** Discovery, connection, tool registration, prompts,
  and resources all work as before. Only model-facing schema publication is
  deferred.
- **The model gets an `activate_mcp_server` tool.** Its description lists each
  deferred server's name, tool count, and up to 12 tool names — never full
  parameter schemas. The model calls it with a server name to activate that
  server.
- **Activation is session-scoped.** Once activated, a server's full schemas are
  published for the rest of the session. There is no automatic deactivation; to
  restart, create a new session.
- **Eager exceptions.** Use `mcp.eagerServers` to keep specific servers
  always-eager even when lazy mode is on.

**Scope:** ephemeral (also persistable to a profile).
**Default:** `false` (eager). **Persistable:** yes.

Enable lazy mode:

```text
/set mcp.lazy true
```

Keep specific servers eager:

```text
/set mcp.eagerServers ["my-important-server","another-server"]
```

> `/set` updates ephemeral settings but does not republish tools in an
> already-initialized chat. To apply lazy mode, save and reload a named profile
> (`/profile save lazy-mcp`, then `/profile load lazy-mcp`) or start a new
> session with that profile.

#### Tradeoffs

Lazy mode reduces token overhead for sessions with large MCP tool sets, but the
model must spend a turn calling `activate_mcp_server` before it can use a
deferred server's tools. For sessions where you always use every MCP tool,
eager mode (the default) is better.

## Troubleshoot

### Server won't connect

- Verify the `command`, `args`, and `cwd` are correct in your configuration.
- For `stdio` servers, run the command manually to see startup errors.
- Check the server's dependencies are installed.
- Enable debug logging for detailed connection output:

  ```bash
  llxprt --debug llxprt:mcp:*
  ```

  You can also use `LLXPRT_DEBUG=llxprt:mcp:*`. Debug output is written to a
  JSONL file in your log directory and to stderr. Use **F12** to open the debug
  console in an interactive session.

### No tools discovered

- Run `/mcp` to confirm the server is connected.
- The server may need time to start — tools appear after the connection is
  established.
- If tool names conflict with built-in tools, the built-in tool takes
  precedence.
- Verify the server actually registers tools and implements the MCP tool-listing
  protocol correctly.

### Tools not executing

- Ensure your tool accepts the parameters the model sends.
- Verify your input schemas are valid JSON Schema.
- Check whether the tool is throwing unhandled exceptions (review server logs).
- If calls time out, increase the `timeout` setting.

### OAuth failures

- Ensure the OAuth URLs and client ID are correct.
- Check whether the server's OAuth flow requires specific scopes.
- Try re-authenticating: `/mcp auth <server>`.
- Remove cached tokens from your OS-standard data directory and reconnect.

### "SSE is no longer supported" error

Some MCP providers have deprecated their SSE endpoint in favor of Streamable
HTTP. Switch your configuration from the SSE endpoint to the Streamable HTTP
endpoint with `"type": "http"`:

```json
{
  "mcpServers": {
    "webflow": {
      "url": "https://mcp.webflow.com/mcp",
      "type": "http"
    }
  }
}
```

If the provider's OAuth flow does not work with the automatic mode, fall back to
the `mcp-remote` stdio bridge as shown in [Authenticate](#oauth).

### Environment variables not reaching the server

- Variables in the `env` block are passed to the server process.
- They do not inherit from your shell unless explicitly listed.

### Sandbox compatibility

When sandboxing is enabled, MCP servers must be available inside the container:

- Use Docker-based servers that include all dependencies.
- Ensure server executables are reachable from inside the sandbox.
- Configure the sandbox to allow any network connections the server needs.
- Verify required environment variables are passed through.

## Remove a server

```bash
llxprt mcp remove my-server
```

By default this removes the server from your project configuration. To remove it
from your user configuration, pass `--scope user`:

```bash
llxprt mcp remove --scope user my-server
```

If the server is not found in the specified scope, the command reports that and
makes no change.

You can also remove a server by deleting its entry from `mcpServers` in your
`settings.json`, then running `/mcp reload` to apply the change to a running
session.

## Related

- [Tools](./index.md) — all built-in tools
- [Sandboxing](../sandbox.md) — running in a container
- [Settings](../settings-and-profiles.md) — where MCP configuration lives
