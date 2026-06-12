## Summary

Extracts IDE integration and the LSP service client out of `packages/core` into a new dedicated workspace package, **`@vybestack/llxprt-code-ide-integration`**, addressing #1593. This follows the precedent set by the settings (#1588) and telemetry (#1589) extractions.

## What moved into `packages/ide-integration`

From `packages/core/src/ide/`:
- **IDE detection** (`detect-ide.ts`): `detectIde`, `detectIdeFromEnv`, `isCloudShell`, `IDE_DEFINITIONS`, `IdeInfo`
- **IDE constants**: `LLXPRT_CODE_COMPANION_EXTENSION_NAME`
- **IDE process utilities**: `getIdeProcessInfo`
- **IDE context store + notification schemas** (`ideContext.ts`): `ideContext`, `createIdeContextStore`, `FileSchema`, `IdeContextSchema`, and the diff notification schemas
- **IDE companion MCP client** (`ide-client.ts`): `IdeClient`, `IDEConnectionStatus`, `IDEConnectionState`
- **IDE installer** (`ide-installer.ts`): `getIdeInstaller`, `IdeInstaller`, `InstallResult`

From `packages/core/src/lsp/`:
- **LSP service client + types**: `LspServiceClient`, `normalizeServerStatus`, `LspConfig`, `Diagnostic`, `ServerStatus`, plus the envelope/id/config types

All moves were done with `git mv` so history is preserved (the diff shows them as renames).

## Architecture

The new package has **zero dependency on `@vybestack/llxprt-code-core`**. The only two couplings to core were broken cleanly:

- `isSubpath` was a pure path helper, so it is copied into `packages/ide-integration/src/utils/paths.ts`.
- `debugLogger` is sourced directly from `@vybestack/llxprt-code-telemetry/utils/debugLogger.js` — the same module core itself re-exported.

The resulting dependency direction is **acyclic**:

    core -> ide-integration -> telemetry

`packages/core/src/utils/ide-trust.ts` stays in core (it consumes the moved `ideContext` via the new package) and continues to be re-exported by core.

## Backward compatibility

- `packages/core` continues to re-export all moved IDE symbols from its public index, so existing external consumers keep working unchanged.
- All internal core/cli imports were repointed to the new package.

## Release / build wiring

- Registered `packages/ide-integration` in the root `workspaces` array **before** `packages/core` (core depends on it).
- Added path mappings, includes, and project references to the core and cli tsconfigs; added the `file:` dependency to core and cli `package.json`.
- Wired the new package into the release pipeline — `release.yml` publish step and sandbox tarball prep, `scripts/version.js`, `Dockerfile` COPY/install, and `scripts/build_sandbox.js` — positioned **after `mcp` and before `core`**.

## Deferred: Zed/ACP integration

The Zed/ACP integration (`packages/cli/src/zed-integration`, ~62KB) is **not** moved in this change. It couples tightly to ~30 core symbols plus CLI internals and would require a runtime-context abstraction; moving it here would risk a circular dependency. It is deferred to a follow-up, mirroring the `OAuthManager` deferral in the auth extraction (#1586). This is documented in `project-plans/issue1593/specification.md`.

## Acceptance criteria (from #1593)

- [x] Relevant IDE + LSP code lives in `packages/ide-integration`
- [x] Clean public interface with **no circular dependencies** (acyclic: core -> ide-integration -> telemetry)
- [x] All tests pass in the new package (109 tests)
- [x] Existing imports updated to use the new package (with core re-exports for backward compat)
- [ ] Zed integration — **deferred** to a follow-up issue (rationale above)

## Verification

- `packages/ide-integration`: **109 tests pass**
- `packages/core`: **7099 tests pass**
- scripts release-process tests: **15 pass**
- `typecheck`, `lint` (0 errors), `build`, and `format` all pass across the workspace
