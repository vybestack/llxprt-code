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

```json
{
  "mcpServers": {
    "httpServer": {
      "httpUrl": "http://localhost:3000/mcp",
      "timeout": 5000
    }
  }
}
```

#### HTTP-based MCP Server with Custom Headers

```json
{
  "mcpServers": {
    "httpServerWithAuth": {
      "httpUrl": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer your-api-token",
        "X-Custom-Header": "custom-value",
        "Content-Type": "application/json"
      },
      "timeout": 5000
    }
  }
}
```

#### MCP Server with Tool Filtering

```json
{
  "mcpServers": {
    "filteredServer": {
      "command": "python",
      "args": ["-m", "my_mcp_server"],
      "includeTools": ["safe_tool", "file_reader", "data_processor"],
      // "excludeTools": ["dangerous_tool", "file_deleter"],
      "timeout": 30000
    }
  }
}
```

### SSE MCP Server with SA Impersonation

```json
{
  "mcpServers": {
    "myIapProtectedServer": {
      "url": "https://my-iap-service.run.app/sse",
      "authProviderType": "service_account_impersonation",
      "targetAudience": "YOUR_IAP_CLIENT_ID.apps.googleusercontent.com",
      "targetServiceAccount": "your-sa@your-project.iam.gserviceaccount.com"
    }
  }
}
```

## Discovery Process Deep Dive

When the LLxprt Code starts, it performs MCP server discovery through the following detailed process:

### 1. Server Iteration and Connection

For each configured server in `mcpServers`:

1. **Status tracking begins:** Server status is set to `CONNECTING`
2. **Transport selection:** Based on configuration properties:
   - `httpUrl` → `StreamableHTTPClientTransport`
   - `url` → `SSEClientTransport`
   - `command` → `StdioClientTransport`
3. **Connection establishment:** The MCP client attempts to connect with the configured timeout
4. **Error handling:** Connection failures are logged and the server status is set to `DISCONNECTED`

### 2. Tool Discovery

Upon successful connection:

1. **Tool listing:** The client calls the MCP server's tool listing endpoint
2. **Schema validation:** Each tool's function declaration is validated
3. **Tool filtering:** Tools are filtered based on `includeTools` and `excludeTools` configuration
4. **Name sanitization:** Tool names are cleaned to meet Gemini API requirements:
   - Invalid characters (non-alphanumeric, underscore, dot, hyphen) are replaced with underscores
   - Names longer than 63 characters are truncated with middle replacement (`___`)

### 3. Conflict Resolution

When multiple servers expose tools with the same name:

1. **First registration wins:** The first server to register a tool name gets the unprefixed name
2. **Automatic prefixing:** Subsequent servers get prefixed names: `serverName__toolName`
3. **Registry tracking:** The tool registry maintains mappings between server names and their tools

### 4. Schema Processing

Tool parameter schemas undergo sanitization for Gemini API compatibility:

- **`$schema` properties** are removed
- **`additionalProperties`** are stripped
- **`anyOf` with `default`** have their default values removed (Vertex AI compatibility)
- **Recursive processing** applies to nested schemas

### 5. Connection Management

After discovery:

- **Persistent connections:** Servers that successfully register tools maintain their connections
- **Cleanup:** Servers that provide no usable tools have their connections closed
- **Status updates:** Final server statuses are set to `CONNECTED` or `DISCONNECTED`

## Tool Execution Flow

When the Gemini model decides to use an MCP tool, the following execution flow occurs:

### 1. Tool Invocation

The model generates a `FunctionCall` with:

- **Tool name:** The registered name (potentially prefixed)
- **Arguments:** JSON object matching the tool's parameter schema

### 2. Confirmation Process

Each `DiscoveredMCPTool` implements sophisticated confirmation logic:

#### Trust-based Bypass

```typescript
if (this.trust) {
  return false; // No confirmation needed
}
```

#### Dynamic Allow-listing

The system maintains internal allow-lists for:

- **Server-level:** `serverName` → All tools from this server are trusted
- **Tool-level:** `serverName.toolName` → This specific tool is trusted

#### User Choice Handling

When confirmation is required, users can choose:

- **Proceed once:** Execute this time only
- **Always allow this tool:** Add to tool-level allow-list
- **Always allow this server:** Add to server-level allow-list
- **Cancel:** Abort execution

### 3. Execution

Upon confirmation (or trust bypass):

1. **Parameter preparation:** Arguments are validated against the tool's schema
2. **MCP call:** The underlying `CallableTool` invokes the server with:

   ```typescript
   const functionCalls = [
     {
       name: this.serverToolName, // Original server tool name
       args: params,
     },
   ];
   ```

3. **Response processing:** Results are formatted for both LLM context and user display

### 4. Response Handling

The execution result contains:

- **`llmContent`:** Raw response parts for the language model's context
- **`returnDisplay`:** Formatted output for user display (often JSON in markdown code blocks)

## How to interact with your MCP server

### Using the `/mcp` Command

The `/mcp` command provides comprehensive information about your MCP server setup:

```bash
/mcp
```

This displays:

- **Server list:** All configured MCP servers
- **Connection status:** `CONNECTED`, `CONNECTING`, or `DISCONNECTED`
- **Server details:** Configuration summary (excluding sensitive data)
- **Available tools:** List of tools from each server with descriptions
- **Discovery state:** Overall discovery process status

### Example `/mcp` Output

```
MCP Servers Status:

📡 pythonTools (CONNECTED)
  Command: python -m my_mcp_server --port 8080
  Working Directory: ./mcp-servers/python
  Timeout: 15000ms
  Tools: calculate_sum, file_analyzer, data_processor

🔌 nodeServer (DISCONNECTED)
  Command: node dist/server.js --verbose
  Error: Connection refused

🐳 dockerizedServer (CONNECTED)
  Command: docker run -i --rm -e API_KEY my-mcp-server:latest
  Tools: docker__deploy, docker__status

Discovery State: COMPLETED
```

### Tool Usage

Once discovered, MCP tools are available to the Gemini model like built-in tools. The model will automatically:

1. **Select appropriate tools** based on your requests
2. **Present confirmation dialogs** (unless the server is trusted)
3. **Execute tools** with proper parameters
4. **Display results** in a user-friendly format

## Status Monitoring and Troubleshooting

### Connection States

The MCP integration tracks several states:

#### Server Status (`MCPServerStatus`)

- **`DISCONNECTED`:** Server is not connected or has errors
- **`CONNECTING`:** Connection attempt in progress
- **`CONNECTED`:** Server is connected and ready

#### Discovery State (`MCPDiscoveryState`)

- **`NOT_STARTED`:** Discovery hasn't begun
- **`IN_PROGRESS`:** Currently discovering servers
- **`COMPLETED`:** Discovery finished (with or without errors)

### Common Issues and Solutions

#### Server Won't Connect

**Symptoms:** Server shows `DISCONNECTED` status

**Troubleshooting:**

1. **Check configuration:** Verify `command`, `args`, and `cwd` are correct
2. **Test manually:** Run the server command directly to ensure it works
3. **Check dependencies:** Ensure all required packages are installed
4. **Review logs:** Look for error messages in the CLI output
5. **Verify permissions:** Ensure the CLI can execute the server command

#### No Tools Discovered

**Symptoms:** Server connects but no tools are available

**Troubleshooting:**

1. **Verify tool registration:** Ensure your server actually registers tools
2. **Check MCP protocol:** Confirm your server implements the MCP tool listing correctly
3. **Review server logs:** Check stderr output for server-side errors
4. **Test tool listing:** Manually test your server's tool discovery endpoint

#### Tools Not Executing

**Symptoms:** Tools are discovered but fail during execution

**Troubleshooting:**

1. **Parameter validation:** Ensure your tool accepts the expected parameters
2. **Schema compatibility:** Verify your input schemas are valid JSON Schema
3. **Error handling:** Check if your tool is throwing unhandled exceptions
4. **Timeout issues:** Consider increasing the `timeout` setting

#### Sandbox Compatibility

**Symptoms:** MCP servers fail when sandboxing is enabled

**Solutions:**

1. **Docker-based servers:** Use Docker containers that include all dependencies
2. **Path accessibility:** Ensure server executables are available in the sandbox
3. **Network access:** Configure sandbox to allow necessary network connections
4. **Environment variables:** Verify required environment variables are passed through

### Debugging Tips

1. **Enable debug mode:** Run the CLI with `--debug` for verbose output
2. **Check stderr:** MCP server stderr is captured and logged (INFO messages filtered)
3. **Test isolation:** Test your MCP server independently before integrating
4. **Incremental setup:** Start with simple tools before adding complex functionality
5. **Use `/mcp` frequently:** Monitor server status during development

## MCP Resources in LLxprt Code

The LLxprt Code supports MCP resources in three user-facing ways:

1. **Resource-aware `@` attachments in chat input**
2. **Resource suggestions in `@` completion**
3. **Resource visibility in `/mcp` status output**

### Referencing a resource in chat input

You can reference an MCP resource directly by using the format:

```
@serverName:resourceUri
```

For example:

```
@docs:file:///workspace/README.md
```

When this pattern matches a discovered MCP resource, LLxprt Code reads that resource via MCP (`resources/read`) and injects the resulting content into the request context.

### Binary resource behavior

If a resource contains binary content, LLxprt Code adds a safe placeholder summary (mime type and size) rather than raw binary text.

### `@` completion behavior

When typing `@`, completion suggestions include:

- file path suggestions (existing behavior)
- MCP resource suggestions in `serverName:resourceUri` format

File suggestions are preserved and resources are added to the same suggestion stream.

### `/mcp` status output

The `/mcp` command includes resource information per server:

- resource counts in per-server status summaries
- a `Resources:` section listing discovered resource names and URIs

This is implemented in this branch's text-based `/mcp` rendering path (the local architecture does not use the upstream MCP status view component).

## Important Notes

### Security Considerations

- **Trust settings:** The `trust` option bypasses all confirmation dialogs. Use cautiously and only for servers you completely control
- **Access tokens:** Be security-aware when configuring environment variables containing API keys or tokens
- **Sandbox compatibility:** When using sandboxing, ensure MCP servers are available within the sandbox environment
- **Private data:** Using broadly scoped personal access tokens can lead to information leakage between repositories

### Performance and Resource Management

- **Connection persistence:** The CLI maintains persistent connections to servers that successfully register tools
- **Automatic cleanup:** Connections to servers providing no tools are automatically closed
- **Timeout management:** Configure appropriate timeouts based on your server's response characteristics
- **Resource monitoring:** MCP servers run as separate processes and consume system resources

### Schema Compatibility

- **Property stripping:** The system automatically removes certain schema properties (`$schema`, `additionalProperties`) for Gemini API compatibility
- **Name sanitization:** Tool names are automatically sanitized to meet API requirements
- **Conflict resolution:** Tool name conflicts between servers are resolved through automatic prefixing

This comprehensive integration makes MCP servers a powerful way to extend the LLxprt Code's capabilities while maintaining security, reliability, and ease of use.

## Returning Rich Content from Tools

MCP tools are not limited to returning simple text. You can return rich, multi-part content, including text, images, audio, and other binary data in a single tool response. This allows you to build powerful tools that can provide diverse information to the model in a single turn.

All data returned from the tool is processed and sent to the model as context for its next generation, enabling it to reason about or summarize the provided information.

### How It Works

To return rich content, your tool's response must adhere to the MCP specification for a [`CallToolResult`](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-result). The `content` field of the result should be an array of `ContentBlock` objects. LLxprt Code will correctly process this array, separating text from binary data and packaging it for the model.

You can mix and match different content block types in the `content` array. The supported block types include:

- `text`
- `image`
- `audio`
- `resource` (embedded content)
- `resource_link`

### Example: Returning Text and an Image

Here is an example of a valid JSON response from an MCP tool that returns both a text description and an image:

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

When LLxprt Code receives this response, it will:

1.  Extract all the text and combine it into a single `functionResponse` part for the model.
2.  Present the image data as a separate `inlineData` part.
3.  Provide a clean, user-friendly summary in the CLI, indicating that both text and an image were received.

This enables you to build sophisticated tools that can provide rich, multi-modal context to the Gemini model.

## MCP Prompts as Slash Commands

In addition to tools, MCP servers can expose predefined prompts that can be executed as slash commands within the LLxprt Code. This allows you to create shortcuts for common or complex queries that can be easily invoked by name.

### Defining Prompts on the Server

Here's a small example of a stdio MCP server that defines prompts:

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
          text: `Write a haiku${mood ? ` with the mood ${mood}` : ''} called ${title}. Note that a haiku is 5 syllables followed by 7 syllables followed by 5 syllables `,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

This can be included in `settings.json` under `mcpServers` with:

```json
"nodeServer": {
  "command": "node",
  "args": ["filename.ts"],
}
```

### Invoking Prompts

Once a prompt is discovered, you can invoke it using its name as a slash command. The CLI will automatically handle parsing arguments.

```bash
/poem-writer --title="LLxprt Code" --mood="reverent"
```

or, using positional arguments:

```bash
/poem-writer "LLxprt Code" reverent
```

When you run this command, the LLxprt Code executes the `prompts/get` method on the MCP server with the provided arguments. The server is responsible for substituting the arguments into the prompt template and returning the final prompt text. The CLI then sends this prompt to the model for execution. This provides a convenient way to automate and share common workflows.

## Managing MCP Servers with `llxprt mcp`

While you can always configure MCP servers by manually editing your `settings.json` file, the LLxprt Code provides a convenient set of commands to manage your server configurations programmatically. These commands streamline the process of adding, listing, and removing MCP servers without needing to directly edit JSON files.

### Adding a Server (`llxprt mcp add`)

The `add` command configures a new MCP server in your `settings.json`. Based on the scope (`-s, --scope`), it will be added to either the user config `~/.llxprt/settings.json` or the project config `.llxprt/settings.json` file.

**Command:**

```bash
llxprt mcp add [options] <name> <commandOrUrl> [args...]
```

- `<name>`: A unique name for the server.
- `<commandOrUrl>`: The command to execute (for `stdio`) or the URL (for `http`/`sse`).
- `[args...]`: Optional arguments for a `stdio` command.

**Options (Flags):**

- `-s, --scope`: Configuration scope (user or project). [default: "project"]
- `-t, --transport`: Transport type (stdio, sse, http). [default: "stdio"]
- `-e, --env`: Set environment variables (e.g. -e KEY=value).
- `-H, --header`: Set HTTP headers for SSE and HTTP transports (e.g. -H "X-Api-Key: abc123" -H "Authorization: Bearer abc123").
- `--timeout`: Set connection timeout in milliseconds.
- `--trust`: Trust the server (bypass all tool call confirmation prompts).
- `--description`: Set the description for the server.
- `--include-tools`: A comma-separated list of tools to include.
- `--exclude-tools`: A comma-separated list of tools to exclude.

#### Adding an stdio server

This is the default transport for running local servers.

```bash
# Basic syntax
llxprt mcp add [options] <name> <command> [args...]

# Example: Adding a local server with environment variables
llxprt mcp add -e API_KEY=123 -e DEBUG=true my-stdio-server /path/to/server arg1 arg2 arg3

# Example: Adding a local python server with server arguments
llxprt mcp add python-server python server.py -- --server-arg my-value
```

#### Adding an HTTP server

This transport is for servers that use the streamable HTTP transport.

```bash
# Basic syntax
llxprt mcp add --transport http <name> <url>

# Example: Adding an HTTP server
llxprt mcp add --transport http http-server https://api.example.com/mcp/

# Example: Adding an HTTP server with an authentication header
llxprt mcp add --transport http secure-http https://api.example.com/mcp/ --header "Authorization: Bearer abc123"
```

#### Adding an SSE server

This transport is for servers that use Server-Sent Events (SSE).

```bash
# Basic syntax
llxprt mcp add --transport sse <name> <url>

# Example: Adding an SSE server
llxprt mcp add --transport sse sse-server https://api.example.com/sse/

# Example: Adding an SSE server with an authentication header
llxprt mcp add --transport sse secure-sse https://api.example.com/sse/ --header "Authorization: Bearer abc123"
```

### Listing Servers (`llxprt mcp list`)

To view all MCP servers currently configured, use the `list` command. It displays each server's name, configuration details, and connection status. This command has no flags.

**Command:**

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
