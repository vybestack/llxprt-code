# Feature Specification: Extract `packages/ide-integration` (Issue #1593)

Plan ID: PLAN-20260610-ISSUE1593
Generated: 2026-06-10

## Purpose

Extract IDE integration and the LSP service client out of `packages/core`
into a dedicated, **zero-`@vybestack/llxprt-code-*`-dependency** package
`packages/ide-integration`, following the established extraction pattern used by
`packages/auth` (#1586), `packages/settings` (#1588), and
`packages/telemetry` (#1589).

## Architectural Decisions

- **Dependency direction:** `core → ide-integration`. Core internals
  (config, tools, IdeContextTracker, ide-trust) consume the IDE/LSP code, so
  core depends on the new package — never the reverse.
- **Zero-core dependency:** `ide-integration` must NOT import
  `@vybestack/llxprt-code-core`. This is what makes the extraction acyclic.
  - The only two core symbols the IDE code used are:
    - `isSubpath` — a pure function (deps: `os`, `path`). **Copied** into the
      package (`src/utils/paths.ts`).
    - `debugLogger` — actually re-exported by core from
      `@vybestack/llxprt-code-telemetry`. The package imports it **directly**
      from `@vybestack/llxprt-code-telemetry/utils/debugLogger.js`.
  - Result DAG: `core → ide-integration → telemetry` (acyclic).
- **External runtime deps:** `zod`, `@modelcontextprotocol/sdk`, `undici`,
  `vscode-jsonrpc`, `@vybestack/llxprt-code-telemetry`.
- **Backward compatibility:** `packages/core` re-exports all moved IDE symbols
  from `@vybestack/llxprt-code-ide-integration` so existing
  `@vybestack/llxprt-code-core` consumers continue to work unchanged.

## Scope

### In scope — moved to `packages/ide-integration`

IDE (`src/ide/`):
- `detect-ide.ts` (+ `detect-ide.test.ts`, `__tests__/detect-ide.antigravity.test.ts`)
- `constants.ts`
- `process-utils.ts` (+ `process-utils.test.ts`)
- `ideContext.ts` (+ `ideContext.test.ts`)
- `ide-client.ts` (+ `ide-client.test.ts`)
- `ide-installer.ts` (+ `ide-installer.test.ts`)

LSP client (`src/lsp/`):
- `types.ts`
- `lsp-service-client.ts`
- Unit tests: `lsp-service-client.test.ts`,
  `lsp-service-client-integration.test.ts`, `lsp-entry-path.test.ts`

Support:
- `src/utils/paths.ts` — copied pure `isSubpath`.

### Stays in `packages/core`

- `utils/ide-trust.ts` — depends on `ideContext` (now imported from the new
  package) but is itself coupled to core; remains in core.
- LSP integration tests that exercise core's `Config`
  (`lsp/__tests__/e2e-lsp.test.ts`, `lsp/__tests__/system-integration.test.ts`)
  and `config/config-lsp-integration.test.ts` — these test core wiring
  (`Config.getLspServiceClient()`), so they stay with core and import
  `LspServiceClient` from `@vybestack/llxprt-code-ide-integration`.

### Deferred to a follow-up issue (NOT in this PR)

- **Zed/ACP integration** (`packages/cli/src/zed-integration/`,
  `zedIntegration.ts` ≈ 62 KB). It depends on ~30 `@vybestack/llxprt-code-core`
  symbols (`Config`, tool types, `@google/genai`, MCP types) plus CLI internals
  (`runtimeSettings`, `cleanup`, `providerManagerInstance`). Moving it into a
  zero-core package would require introducing a `ZedRuntimeContext` DI layer and
  inverting ~30 core dependencies — a large refactor that would create a
  `ide-integration → core` edge if done naively (forbidden cycle). This mirrors
  #1586 deferring the heavily-coupled `OAuthManager`. Tracked as a follow-up.

## Integration Points

### Existing core internals that import the moved code (updated to package import)

IDE consumers: `config/config.ts`, `config/configBaseCore.ts`,
`config/configTypes.ts`, `core/IdeContextTracker.ts`, `utils/ide-trust.ts`,
`tools/{apply-patch,delete_line_range,edit,insert_at_line,tools,write-file}.ts`,
plus parity/integration tests.

LSP consumers: `config/configBase.ts`, `config/configTypes.ts`,
`config/lspIntegration.ts`, `tools/lsp-diagnostics-helper.ts`,
`tools/{apply-patch,write-file}.ts`, plus LSP integration tests.

### Public re-exports (backward compatibility)

`packages/core/src/index.ts` and `packages/core/index.ts` re-export the IDE
symbols from `@vybestack/llxprt-code-ide-integration`.

### VS Code companion

`packages/vscode-ide-companion` already imports `IDE_DEFINITIONS` etc. from
`@vybestack/llxprt-code-core` (kept working via re-export). Schema
consolidation (removing the duplicate `ide-schemas.ts`) is evaluated for risk;
done only if it does not bloat the extension bundle, otherwise deferred.

## Acceptance Criteria (from issue #1593)

- [x] Relevant IDE + LSP code lives in `packages/ide-integration`.
- [x] Clean public interface; no circular dependencies (`core → ide-integration → telemetry`).
- [x] All tests pass in the new package and across the workspace.
- [x] Existing imports updated to use the new package (core internals migrated;
  external consumers preserved via re-export).
- [ ] Zed integration extraction — deferred to follow-up (documented above).

## Verification

`npm run typecheck && npm run lint && npm run test && npm run build` plus the
smoke test `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`.

## Zed/ACP Integration: Deferral Decision

The Zed/ACP integration (`packages/cli/src/zed-integration/zedIntegration.ts`,
2,112 lines) is DEFERRED to a follow-up issue.

Rationale:
- It depends on 5 distinct CLI-internal modules: `runtime/runtimeSettings`,
  `utils/cleanup`, `providers/providerManagerInstance`,
  `providers/providerConfigUtils`, and `config/settings`.
- These are CLI runtime/provider singletons, not core abstractions. Moving the
  file as-is would force `ide-integration` to depend on CLI internals (a cycle),
  or require a large `ZedRuntimeContext` dependency-injection refactor of a
  2,100-line file.
- That refactor is orthogonal to the core value of #1593 (relocating IDE
  detection/client/installer and the LSP service client out of core) and would
  materially increase the risk surface of this PR.

This mirrors the #1586 (auth) precedent, where `OAuthManager` was deferred to a
follow-up rather than forced into the extracted package. A dedicated follow-up
issue should introduce `ZedRuntimeContext` and move the Zed integration into
`packages/ide-integration/src/zed/`.
