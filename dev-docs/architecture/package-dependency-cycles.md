# Package dependency direction

Workspace manifests must describe the package graph that production code uses.
A published package must also install and load without relying on workspace
hoisting or TypeScript path aliases.

The runtime dependency guard checks declarations. Package-specific boundary
tests check architectural constraints that are stricter than declaration
correctness.

## Core and MCP are acyclic

The dependency direction is:

```text
application composition root
  ├── core
  └── mcp

core ──> mcp
mcp  ──> auth, settings, storage, telemetry, tools
```

`@vybestack/llxprt-code-core` consumes MCP clients, tools, and token storage.
`@vybestack/llxprt-code-mcp` does not import or declare core in any dependency
section. This applies to runtime imports, type-only imports, dynamic imports,
requires, re-exports, tests, and TypeScript path mappings.

### Contract ownership

MCP owns contracts that describe MCP data and the host capabilities it needs:

| Contract                                                  | Owner     | Reason                                                                      |
| --------------------------------------------------------- | --------- | --------------------------------------------------------------------------- |
| `MCPServerConfig`                                         | MCP       | It describes MCP server transports and authentication.                      |
| Trust, workspace, prompt, resource, and host-config ports | MCP       | MCP consumes narrow structural interfaces instead of concrete core classes. |
| Feedback and browser host services                        | MCP       | MCP declares the capabilities. Applications provide the implementations.    |
| `AuthProviderType`                                        | auth      | Authentication is used below both core and MCP.                             |
| Tool message bus                                          | tools     | MCP tools depend on the tools package contract, not core's concrete bus.    |
| Debug logging and JSON serialization                      | telemetry | These are telemetry concerns shared by higher-level packages.               |
| Error formatting                                          | tools     | MCP already depends on tools and uses its public error subpath.             |

Core can keep concrete `Config`, `WorkspaceContext`, `PromptRegistry`, and
`ResourceRegistry` implementations. TypeScript structural typing lets those
classes satisfy MCP's ports without moving them or adding an MCP-to-core edge.
Core re-exports the `MCPServerConfig` type for source compatibility.

### Host services

MCP exposes host registration only through
`@vybestack/llxprt-code-mcp/host/hostServices.js`. It is not re-exported from
the package root.

Each application composition root registers both required capabilities before
starting asynchronous application work:

```typescript
registerMcpHostServices({
  emitFeedback: (...args) => coreEvents.emitFeedback(...args),
  openBrowser: openBrowserSecurely,
});
```

The CLI, A2A server, and both public Agent API startup functions (`createAgent`
and `fromConfig`) perform this registration. MCP's standalone defaults remain
usable when no application host is present:
feedback goes to the debug logger, and browser opening rejects so the existing
manual OAuth URL flow can continue. The fallback rejection does not include the
URL because OAuth query parameters can contain sensitive values.

### Event compatibility

MCP owns the `mcp-client-update` event name because MCP emits it. Core retains
`CoreEvent.McpClientUpdate` because core listens for it. A composition-boundary
test asserts that both constants have the same wire value without adding a
package edge from MCP to core.

## Enforcement

`scripts/check-runtime-dependency-declarations.ts`, exposed as
`npm run lint:runtime-deps`, checks every published workspace. It follows
published entrypoints, parses imports with the TypeScript AST, and reports a
runtime package import that is absent from `dependencies`,
`peerDependencies`, or `optionalDependencies`.

`scripts/tests/runtime-dependency-declarations.repo.test.ts` adds the stricter
MCP boundary. It scans every TypeScript import form, checks all dependency
sections, and verifies that MCP's TypeScript configuration does not map or
include core.

`scripts/tests/mcp-standalone-consumer.test.ts` packs MCP and imports it from an
isolated consumer containing only declared dependencies. This catches package
exports and module-resolution failures that source checks cannot detect.
