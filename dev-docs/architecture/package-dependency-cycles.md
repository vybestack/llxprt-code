# Declared package dependency cycles

This page records dependency cycles between workspace packages that exist on
purpose. A cycle listed here is declared in both directions in `package.json`,
so the dependency graph you can read from the manifests matches the graph that
exists at runtime.

An undeclared cycle is worse than a declared one. It breaks published packages
for external consumers, and it makes any audit that reads `package.json` files
conclude the workspace is acyclic when it is not.

## `@vybestack/llxprt-code-core` ↔ `@vybestack/llxprt-code-mcp`

Both directions are declared in `dependencies`.

### core → mcp

`core` consumes the MCP client surface directly:

| Source                                                      | Imported value                                        |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `packages/core/src/config/config.ts`                        | `McpClientManager`                                    |
| `packages/core/src/code_assist/oauth-credential-storage.ts` | `KeychainTokenStorage`, `MCPOAuthToken`               |
| `packages/core/src/config/lspIntegration.ts`                | `DiscoveredMCPTool`                                   |
| `packages/core/src/index.ts`                                | re-exports of the MCP client, tool, and OAuth surface |

### mcp → core

`mcp` consumes leaf utilities and configuration types that live in `core`:

| Imported value        | Module                                                         |
| --------------------- | -------------------------------------------------------------- |
| `getErrorMessage`     | `@vybestack/llxprt-code-core/utils/errors.js`                  |
| `debugLogger`         | `@vybestack/llxprt-code-core/utils/debugLogger.js`             |
| `DebugLogger`         | `@vybestack/llxprt-code-core/debug/index.js`                   |
| `coreEvents`          | `@vybestack/llxprt-code-core/utils/events.js`                  |
| `openBrowserSecurely` | `@vybestack/llxprt-code-core/utils/secure-browser-launcher.js` |
| `safeJsonStringify`   | `@vybestack/llxprt-code-core/utils/safeJsonStringify.js`       |
| `AuthProviderType`    | `@vybestack/llxprt-code-core/config/configTypes.js`            |

Type-only imports from `core` (`Config`, `MCPServerConfig`, `PromptRegistry`,
`ResourceRegistry`, `WorkspaceContext`, `MessageBus`) use `import type` and are
erased at compile time, so they do not contribute to the runtime graph.

### Why the cycle is declared rather than removed

`mcp` declared `core` in `devDependencies` until issue #3305. Because
`scripts/bind-release-deps.ts` rewrites `file:` specifiers in every dependency
section, the published manifest carried `core` in `devDependencies` — a section
`npm install` never installs for a consumer. The shipped `dist/mcp/**` still
emitted bare `@vybestack/llxprt-code-core/...` specifiers, so
`npm i @vybestack/llxprt-code-mcp` produced a package that could not resolve its
own imports.

Two fixes were available: declare the cycle, or break it by moving the shared
leaf utilities into a lower-level package that both `core` and `mcp` depend on.
The second is the better end state but is a cross-package refactor touching
`core`, `mcp`, and every consumer of those utilities. #3305 chose the first so
that the published package stops being broken, and left the extraction for
separate work.

npm resolves this cycle without complaint: `npm install --package-lock-only`
succeeds, and the standalone-install contract is pinned by
`scripts/tests/mcp-standalone-consumer.test.ts`.

### What would remove it

Move `getErrorMessage`, `DebugLogger` / `debugLogger`, `coreEvents`,
`openBrowserSecurely`, `safeJsonStringify`, and `AuthProviderType` into a
package below both `core` and `mcp`, then drop `@vybestack/llxprt-code-core`
from `packages/mcp/package.json`. Several of these are already leaf concerns;
`AuthProviderType` and the configuration types are the ones that need a home
decision.

## Enforcement

`scripts/check-runtime-dependency-declarations.ts` (`npm run lint:runtime-deps`)
fails if any published workspace package imports, at runtime, a package it does
not declare in `dependencies`, `peerDependencies`, or `optionalDependencies`. A
package declared only in `devDependencies` is a failure, because that is exactly
the shape that shipped the broken `mcp` tarball.

Adding a cycle therefore requires declaring it, and declaring it means it shows
up in the graph and belongs on this page.
