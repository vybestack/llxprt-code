# Issue #3305: make `@vybestack/llxprt-code-mcp` standalone

## Problem

The published MCP package imported core at runtime while declaring core only as
a development dependency. Workspace hoisting and TypeScript path mappings hid
the defect in the repository. A standalone consumer could install the MCP
tarball and then fail to resolve its imports.

Declaring core as an MCP runtime dependency would make installation succeed, but
it would preserve a package cycle. Core already depends on MCP. The required
repair is an acyclic package graph in which MCP owns MCP contracts and receives
host capabilities from application composition roots.

## Accepted behavior

1. MCP has no reference to `@vybestack/llxprt-code-core` in production source,
   tests, manifests, TypeScript paths, or included files.
2. Core continues to depend on MCP and structurally satisfies MCP-owned ports.
3. `MCPServerConfig` is owned by MCP. Core may re-export the type for source
   compatibility.
4. MCP host registration is available only from the explicit
   `@vybestack/llxprt-code-mcp/host/hostServices.js` subpath.
5. The CLI, A2A server, and Agent API entrypoints (`createAgent` and
   `fromConfig`) register these implementations during startup:

   ```typescript
   {
     emitFeedback: (...args) => coreEvents.emitFeedback(...args),
     openBrowser: openBrowserSecurely,
   }
   ```

6. Registered feedback preserves caller argument count. A host feedback failure
   does not interrupt the MCP operation that reported it.
7. Without registration, feedback reaches the debug logger and browser opening
   rejects. The rejection does not expose an OAuth URL.
8. `MCP_CLIENT_UPDATE_EVENT` remains equal to
   `CoreEvent.McpClientUpdate` without an MCP-to-core import.
9. The packed package imports from an isolated consumer containing only its
   declared dependencies.
10. A repository guard continues to reject undeclared runtime dependencies in
    every published workspace.

## Design

### MCP-owned contracts

`packages/mcp/src/config/mcpServerConfig.ts` owns the server and extension
configuration shapes.

`packages/mcp/src/host/hostInterfaces.ts` owns narrow structural ports for:

- folder trust
- workspace directories and change notifications
- prompt registration and removal
- resource publication and removal
- the subset of host configuration used by `McpClientManager`

MCP uses `IToolMessageBus` from tools. Core's concrete classes satisfy the MCP
ports structurally.

### Leaf-package imports

Runtime utilities are imported from packages below MCP:

- telemetry supplies debug logging and safe JSON serialization
- tools supplies error formatting and the tool message-bus contract
- auth supplies `AuthProviderType`

This removes both runtime and type-only MCP imports from core.

### Host inversion

`packages/mcp/src/host/hostServices.ts` stores the registered feedback sink and
browser launcher. Application roots explicitly register core's implementations.
Registration replaces the current implementations and supports partial updates
for hosts that provide capabilities separately.

The MCP root barrel does not export host registration. Explicit subpaths make
the composition boundary visible in imports and prevent accidental expansion of
the package root API.

## Enforcement and tests

### Runtime declaration guard

`scripts/check-runtime-dependency-declarations.ts` uses TypeScript AST parsing
and published-entrypoint reachability. It checks runtime imports for every
published workspace and excludes type-only imports.

### Acyclic boundary test

`scripts/tests/runtime-dependency-declarations.repo.test.ts` checks all MCP
TypeScript files, including tests, for static imports, re-exports, dynamic
imports, `require`, import-equals declarations, and import types that reference
core. It also checks every manifest dependency section and MCP's TypeScript
configuration.

### Host behavior tests

`packages/mcp/src/host/hostServices.test.ts` covers exact argument forwarding,
partial registration, reset behavior, sink failures, browser delegation, and
sanitized standalone fallback errors.

`scripts/tests/mcp-host-wiring.test.ts` executes each application's wiring,
observes feedback through core events, verifies use of the secure browser
launcher, pins event-name compatibility, and checks that each startup function
calls the wiring before asynchronous startup work.

### Standalone consumer test

`scripts/tests/mcp-standalone-consumer.test.ts` packs MCP into an isolated
directory and imports it with only declared dependencies available. The test
must not depend on repository `node_modules` traversal to pass.

## Changed areas

- MCP configuration, host interfaces, host services, clients, authentication,
  tests, package exports, manifest, and TypeScript configuration
- Core configuration type ownership and compatibility re-export
- CLI, A2A, and Agent API composition-root wiring
- Auth and tools explicit subpath exports
- Repository dependency guards and package-boundary tests
- npm and Bun lockfiles
- Architecture documentation and PR evidence

## Verification gates

Before completion:

1. Format and lint all changed files.
2. Typecheck MCP, core, CLI, A2A, agents, scripts, and the full repository.
3. Run the complete MCP suite and focused host and boundary suites.
4. Run the packed standalone-consumer test.
5. Run the runtime-dependency and lockfile guards.
6. Build the full repository from the intended package order.
7. Run the full test suite and investigate any timeout or nondeterministic
   failure with repeatable evidence.
8. Smoke test the CLI and other application startup paths.
9. Run final code review, fix in-scope findings, push the candidate head, and
   require green CI before reporting merge readiness.
