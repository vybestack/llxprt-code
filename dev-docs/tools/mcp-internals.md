# MCP internals: discovery and tool execution

Internal design record for how LLxprt Code discovers MCP server capabilities
and executes MCP tool calls. For the user-facing guide, see
[docs/tools/mcp-server.md](../../docs/tools/mcp-server.md).

## Status and scope

- **Status:** Authoritative (current architecture).
- **Owner:** MCP/tools maintainers.
- **Audience:** Repository contributors modifying the MCP client, tool
  registry, or discovery pipeline.

## Context

LLxprt Code integrates MCP (Model Context Protocol) servers to extend the
model's available tools, prompts, and resources. The user-facing documentation
covers configuration and day-to-day use. This page records the internal
pipeline that turns a configured `mcpServers` entry into registered,
executable tools — the material a contributor needs when debugging discovery
failures, adding transport types, or modifying the confirmation flow.

Two subsystems are documented here:

1. **Discovery** — how configured servers become connected clients with
   registered tools, prompts, and resources.
2. **Tool execution** — how a model-generated function call reaches an MCP
   server and returns a result.

## Discovery

### Source and test locations

| Concern                                     | Source                                                                                               | Key tests                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Client lifecycle (connect/discover/refresh) | `packages/mcp/src/client/mcp-client.ts` (`McpClient`)                                                | `mcp-client.discovery.test.ts`, `mcp-client.lifecycle.test.ts`             |
| Multi-server manager                        | `packages/mcp/src/client/mcp-client-manager.ts` (`McpClientManager`)                                 | `mcp-client-manager.test.ts`, `mcp-client-manager.partial-failure.test.ts` |
| Tool/resource/prompt discovery              | `packages/mcp/src/client/mcp-discovery.ts` (`discoverTools`, `discoverResources`, `discoverPrompts`) | `mcp-client.tools.test.ts`, `mcp-client.resource-refresh.test.ts`          |
| Transport creation                          | `packages/mcp/src/client/mcp-transport.ts` (`createTransport`)                                       | `mcp-client.transport.test.ts`                                             |
| Tool name generation and confirmation       | `packages/mcp/src/client/mcp-tool.ts` (`DiscoveredMCPTool`, `generateMcpToolName`)                   | `mcp-client-manager.trust.test.ts`                                         |
| Tool filtering (include/exclude)            | `packages/mcp/src/client/mcp-discovery-helpers.ts` (`isEnabled`)                                     | `mcp-discovery-helpers` tests                                              |
| Status tracking                             | `packages/mcp/src/client/mcp-status.ts` (`MCPServerStatus`, `MCPDiscoveryState`)                     | `mcp-client-manager.status-failure.test.ts`                                |
| Lazy schema loading                         | `packages/tools/src/tools/tool-registry.ts`, `packages/core/src/config/mcp-lazy-tool-sync.ts`        | `tool-registry-mcp-lazy.test.ts`, `config.mcp-lazy.test.ts`                |

### Server iteration and connection

`McpClientManager` owns the set of `McpClient` instances, one per configured
server. On startup (or on `/mcp reload`/`/mcp refresh`), it iterates the merged
`mcpServers` configuration and starts each client.

Per-server connection (`McpClient.connect`):

1. Status transitions to `CONNECTING`.
2. `createTransport` selects a transport based on configuration:
   - `httpUrl` → `StreamableHTTPClientTransport` (deprecated field).
   - `url` + `type: "sse"` → `SSEClientTransport`.
   - `url` with any other `type` or no `type` → `StreamableHTTPClientTransport`.
   - `command` → `StdioClientTransport`.
3. The SDK `Client.connect()` call establishes the connection.
4. On success, status transitions to `CONNECTED` and notification handlers are
   registered (for `tools/listChanged` and `resources/listChanged`).
5. On failure, status transitions to `DISCONNECTED` and the error is logged.

The discovery settle timeout (`DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS`,
10 seconds) bounds how long `whenDiscoverySettled` waits before resolving. Any
server still pending is recorded as a discovery failure rather than hanging the
agent startup gate indefinitely.

### Tool discovery

After a successful connection, `McpClient.discover()` runs three discovery
passes in order: prompts, tools, resources. Each pass is guarded by an
authorization check (`createCapabilityAuthorization`) that verifies the
connection and capability generations are still current and the folder is
trusted — if authorization is revoked mid-discovery (e.g. trust revoked), the
client disconnects and discards partial results.

For tools (`discoverTools` in `mcp-discovery.ts`):

1. Check `getServerCapabilities()?.tools` — if the server advertises no tool
   capability, return an empty list.
2. Call `mcpClient.listTools()`.
3. For each tool definition, run `processToolDefinition`:
   - Apply `includeTools`/`excludeTools` filtering via `isEnabled`.
   - Wrap the tool in an `McpCallableTool` adapter.
   - Construct a `DiscoveredMCPTool` with the server name, original tool name,
     description, input schema, and trust flag.
4. Register each `DiscoveredMCPTool` in the `ToolRegistry`.
5. Call `toolRegistry.sortTools()`.

If all three passes return zero prompts, tools, and resources, discovery throws
`"No prompts, tools, or resources found on the server."` and the server is
disconnected.

### Name generation and conflict resolution

Every MCP tool is given a globally unique name via
`generateMcpToolName(serverName, toolName)`, which produces
`mcp__<serverName>__<toolName>`. The name then passes through
`generateValidName`, which:

- Replaces any character outside `[a-zA-Z0-9_.-]` with `_`.
- Truncates names longer than 63 characters by keeping the first 28 and last 32
  characters and joining them with `___` in the middle.

Because the server name is always part of the generated name, tools from
different servers cannot collide. There is no "first registration wins"
dynamic — every MCP tool carries its server prefix unconditionally.

### Schema processing

MCP tool input schemas are JSON Schema objects. Before they reach the model,
they are validated by the schema validator
(`packages/core/src/utils/schemaValidator.ts` /
`packages/tools/src/utils/schemaValidator.ts`) which dispatches by the schema's
declared `$schema` URI (draft-07 vs. draft-2020-12).

For Gemini providers specifically, `cleanGeminiSchema`
(`packages/providers/src/gemini/geminiSchemaHelpers.ts`) applies a whitelist of
supported properties (`SUPPORTED_SCHEMA_PROPERTIES`). Anything not on the
whitelist — including `$schema`, `additionalProperties`, and
`exclusiveMinimum` — is stripped. This cleaning is recursive (properties,
items, anyOf), cycle-safe via a path-based `WeakSet`, and non-mutating. This
happens at the Gemini provider boundary, not inside the MCP package.

### Resource and prompt discovery

- **Resources** (`discoverResources`): checks
  `getServerCapabilities()?.resources`, then calls `resources/list` with
  pagination (follows `nextCursor`). Resources are stored in the
  `ResourceRegistry` via `setResourcesForServer`.
- **Prompts** (`discoverPrompts` → `registerMcpPrompts`): checks
  `getServerCapabilities()?.prompts`, then calls `listPrompts`. Each prompt is
  registered in the `PromptRegistry` with an `invoke` callback that calls
  `getPrompt` on the server.

### Connection management after discovery

- Servers that successfully register at least one tool, prompt, or resource
  maintain their connection.
- Servers that fail discovery (no artifacts, authorization revoked, or error)
  are disconnected and their status set to `DISCONNECTED`.
- The client listens for `ToolListChanged` and `ResourceListChanged`
  notifications; when received, it re-runs the relevant discovery pass and
  updates the registries.

### Lazy schema loading

When `mcp.lazy` is `true`, the `ToolRegistry` defers MCP tool schema
publication to the model. Connection, discovery, and registration all happen
normally — only the model-facing declaration is withheld.

- `ToolRegistry.listDeferredMcpServers()` returns servers that are not in
  `mcp.eagerServers` and have not been activated this session.
- `syncActivateMcpServer` (`packages/core/src/config/mcp-lazy-tool-sync.ts`)
  registers an `ActivateMcpServerTool` when deferred servers exist.
- The `activate_mcp_server` tool's description lists each deferred server with
  its tool count and up to 12 tool names (`MAX_TOOL_NAMES_PER_SERVER`).
- When the model calls `activate_mcp_server` with a server name,
  `registry.activateMcpServer(name)` adds the server to the activated set,
  then `refreshMcpContext()` republishes tool declarations. Activation persists
  for the session.

See `packages/tools/src/tools/activate-mcp-server.ts` and
`packages/tools/src/tools/tool-registry.ts` (`shouldDeferMcpTool`,
`listDeferredMcpServers`, `activateMcpServer`).

## Tool execution flow

### Invocation

The model generates a function call referencing the tool by its registered name
(`mcp__<serverName>__<toolName>`). The scheduler resolves this to the
`DiscoveredMCPTool` and creates a `DiscoveredMCPToolInvocation` with the
model-supplied parameters.

### Confirmation

`DiscoveredMCPToolInvocation.shouldConfirmExecute` decides whether to prompt:

1. **Trust bypass** — if `cliConfig.isTrustedFolder() === true` and the tool's
   `trust` flag is `true`, no confirmation is needed (`return false`).
2. **Allow-list check** — a static `Set` tracks two key formats:
   - Server-level: `serverName` — all tools from this server are trusted.
   - Tool-level: `serverName.serverToolName` — this specific tool is trusted.
3. **Prompt** — if neither bypass applies, a `ToolMcpConfirmationDetails`
   object is returned with the server name, tool name, and display name. The
   `onConfirm` callback updates the allow-list based on the user's choice:
   - `ProceedAlwaysServer` → adds `serverName`.
   - `ProceedAlwaysTool` → adds `serverName.serverToolName`.
   - `ProceedAlwaysAndSave` → adds the tool key and publishes a policy update.

The composite policy key is `serverName__toolName`, which enables server-level
wildcards (e.g. `"my-server__*"`) in policy rules while still allowing
per-tool rules.

### Execution

`DiscoveredMCPToolInvocation.execute`:

1. Builds a single-element function-call array using the **original** server
   tool name (not the prefixed display name) and the parameters.
2. Calls `McpCallableTool.callTool`, which invokes
   `client.callTool({ name, arguments })` on the MCP SDK client with the
   configured timeout.
3. Races the call against the abort signal so cancellation is respected.

### Response handling

`McpCallableTool.callTool` wraps the raw SDK result in a `functionResponse`
part. `DiscoveredMCPToolInvocation.execute` then:

1. Checks `isMCPToolError` — if the response's `isError` flag is `true` (or a
   nested `error.isError` is `true`), returns an error `ToolResult` with type
   `MCP_TOOL_ERROR`.
2. Otherwise, runs `transformMcpContentToParts`, which maps the MCP `content`
   block array into model-facing `Part` objects:
   - `text` → `{ text }`.
   - `image`/`audio` → a text annotation plus an `inlineData` part.
   - `resource` with `text` → `{ text }`; with `blob` → annotation plus
     `inlineData`.
   - `resource_link` → a text link summary.
3. Produces a human-readable display string via
   `getStringifiedResultForDisplay`, which summarizes non-text content (e.g.
   `[Image: image/png]`) and presents text directly.

The final `ToolResult` carries `llmContent` (the transformed parts) and
`returnDisplay` (the display string).

## Tradeoffs

- **Unique names over dynamic prefixing.** Always prefixing with
  `mcp__<server>__` means no collision logic is needed, but tool names are
  verbose. This is accepted so policy rules and display logic can rely on a
  stable, predictable naming scheme.
- **Schema cleaning at the provider boundary, not in MCP.** Keeping Gemini
  schema sanitization in `geminiSchemaHelpers` means the MCP package stays
  provider-neutral. Non-Gemini providers do not incur the cleaning pass.
- **Lazy mode defers only publication.** Connection and discovery still happen
  eagerly so that prompts and resources (which are not deferred) work
  immediately. The tradeoff is that a deferred server consumes a connection
  even when its tools are never used.
- **Settle timeout bounds startup.** A 10-second settle timeout prevents a
  single misbehaving server from blocking the agent indefinitely, at the cost
  of recording that server as a discovery failure if it is merely slow.

## Follow-ups

- The `httpUrl` field is deprecated but still supported. Migration to `url` +
  `type: "http"` is ongoing; the transport layer emits deprecation warnings
  when `httpUrl` is used.
- `auth.noBrowser` is a general auth setting; MCP OAuth uses
  `openBrowserSecurely`, which may not fully honor `noBrowser` in all code
  paths. See `packages/mcp/src/auth/oauth-provider.ts`.

## Related

- [docs/tools/mcp-server.md](../../docs/tools/mcp-server.md) — user-facing MCP
  guide
- [Tool output format](./tool-output-format.md) — how tool results are
  formatted for the model
