# Phase 01: Preflight Verification

## Phase ID

`PLAN-20260803-ISSUE2846.P01`

## Purpose

Capture the vitest baseline for all three workspaces BEFORE any migration
begins. This establishes the parity reference: after migration, Bun must
produce the same pass/fail/skip counts (within pre-existing skip tolerance).

## Verified Test File Inventory

### packages/tools — 65 vitest-importing test files

```
packages/tools/src/tools/activate-skill.test.ts
packages/tools/src/tools/ast-edit.ide.test.ts
packages/tools/src/tools/edit-utils.test.ts
packages/tools/src/tools/exa-web-search.test.ts
packages/tools/src/tools/direct-web-fetch.test.ts
packages/tools/src/tools/github.test.ts
packages/tools/src/tools/check-async-tasks.test.ts
packages/tools/src/tools/list-subagents.test.ts
packages/tools/src/tools/codesearch.test.ts
packages/tools/src/tools/memoryTool.test.ts
packages/tools/src/tools/write-file.test.ts
packages/tools/src/tools/tools.test.ts
packages/tools/src/tools/todo-store-injection.test.ts
packages/tools/src/tools/todo-store-single-resolve.test.ts
packages/tools/src/tools/generate-image/GenerateImageTool.test.ts
packages/tools/src/tools/generate-image/GenerateImageTool.surface.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-issue-1756.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-summary-counts.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-rust-validation.test.ts
packages/tools/src/tools/ast-edit/__tests__/validation-categorizer.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-ast-validation.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-preview.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-concurrency.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-edge-cases.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-preview-gaps.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-ambiguous-match.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-force-flag.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-crlf.test.ts
packages/tools/src/tools/ast-edit/__tests__/ast-edit-c-validation.test.ts
packages/tools/src/tools/ast-edit/__tests__/language-analysis.test.ts
packages/tools/src/formatters/ToolFormatter.test.ts
packages/tools/src/formatters/toolGovernanceUtils.test.ts
packages/tools/src/formatters/doubleEscapeUtils.test.ts
packages/tools/src/utils/ast-grep-utils.lazy.test.ts
packages/tools/src/utils/imageResize.test.ts
packages/tools/src/utils/fileUtils.test.ts
packages/tools/src/utils/textDelta.test.ts
packages/tools/src/__tests__/shell-tool.test.ts
packages/tools/src/__tests__/edit-ast-tools.test.ts
packages/tools/src/__tests__/public-surface.task-tool.test.ts
packages/tools/src/__tests__/removed-google-tools.test.ts
packages/tools/src/__tests__/interface-contracts.test.ts
packages/tools/src/__tests__/read-many-files-filtering-behavior.test.ts
packages/tools/src/__tests__/tool-registry-mcp-lazy.test.ts
packages/tools/src/__tests__/registry-contract.test.ts
packages/tools/src/__tests__/forbidden-dependencies.test.ts
packages/tools/src/__tests__/package-boundary.test.ts
packages/tools/src/__tests__/shell-helpers-schema.test.ts
packages/tools/src/__tests__/tool-key-storage.test.ts
packages/tools/src/__tests__/glob-filtering-behavior.test.ts
packages/tools/src/__tests__/todo-tools.test.ts
packages/tools/src/__tests__/export-surface-helpers.test.ts
packages/tools/src/__tests__/apply-patch.test.ts
packages/tools/src/__tests__/glob-filtering.test.ts
packages/tools/src/__tests__/ls-filtering-behavior.test.ts
packages/tools/src/__tests__/neutral-types.test.ts
packages/tools/src/__tests__/package-metadata.test.ts
packages/tools/src/__tests__/filesystem-tools.test.ts
packages/tools/src/__tests__/boundary-scan.test.ts
packages/tools/src/__tests__/ripGrep-args.test.ts
packages/tools/src/__tests__/wire-types.test.ts
packages/tools/src/__tests__/forbidden-imports.test.ts
packages/tools/src/__tests__/memory-tool.test.ts
packages/tools/src/__tests__/todo-emoji-filter.test.ts
packages/tools/src/__tests__/subagent-tools.test.ts
```

### packages/mcp — 43 vitest-importing test files

```
packages/mcp/src/auth/file-token-store.test.ts
packages/mcp/src/auth/oauth-provider.authenticate.test.ts
packages/mcp/src/auth/oauth-provider.token.test.ts
packages/mcp/src/auth/oauth-status.behavior.test.ts
packages/mcp/src/auth/oauth-utils.test.ts
packages/mcp/src/auth/oauth-provider-utils.test.ts
packages/mcp/src/auth/sa-impersonation-provider.test.ts
packages/mcp/src/auth/google-auth-provider.test.ts
packages/mcp/src/auth/oauth-token-storage.test.ts
packages/mcp/src/auth/token-storage/file-token-storage.test.ts
packages/mcp/src/auth/token-storage/keychain-token-storage.test.ts
packages/mcp/src/auth/token-storage/file-token-storage.behavior.test.ts
packages/mcp/src/auth/token-storage/keychain-token-storage.missing-keytar.test.ts
packages/mcp/src/auth/token-storage/base-token-storage.test.ts
packages/mcp/src/auth/token-storage/hybrid-token-storage.test.ts
packages/mcp/src/auth/token-store.test.ts
packages/mcp/src/__tests__/no-eslint-directives.test.ts
packages/mcp/src/fake/fakeMcpDiscovery.authorization.test.ts
packages/mcp/src/client/mcp-client-manager.fake-discovery.test.ts
packages/mcp/src/client/mcp-client.lifecycle.test.ts
packages/mcp/src/client/retryable-client-disconnections.test.ts
packages/mcp/src/client/mcp-client.discover-rollback.test.ts
packages/mcp/src/client/mcp-client.transport.test.ts
packages/mcp/src/client/mcp-public-api.test.ts
packages/mcp/src/client/trust-revocation-errors.test.ts
packages/mcp/src/client/mcp-tool.confirm.test.ts
packages/mcp/src/client/mcp-client.disconnect-cleanup.test.ts
packages/mcp/src/client/mcp-client.oauth.test.ts
packages/mcp/src/client/mcp-client.stale-error.test.ts
packages/mcp/src/client/mcp-client-manager.status-failure.test.ts
packages/mcp/src/client/mcp-client.discovery.test.ts
packages/mcp/src/client/mcp-client.publication-authorization.test.ts
packages/mcp/src/client/mcp-client.tools.test.ts
packages/mcp/src/client/mcp-oauth-helpers.test.ts
packages/mcp/src/client/mcp-tool.execute.test.ts
packages/mcp/src/client/mcp-client-manager-helpers.test.ts
packages/mcp/src/client/mcp-client-manager.test.ts
packages/mcp/src/client/mcp-client.resource-refresh.test.ts
packages/mcp/src/client/mcp-discovery.authorization.test.ts
packages/mcp/src/client/neutral-types.test.ts
packages/mcp/src/client/mcp-client-manager.trust.test.ts
packages/mcp/src/client/mcp-client-manager.partial-failure.test.ts
packages/mcp/src/client/mcp-client-manager.restart.test.ts
```

### packages/storage — 27 vitest-importing test files

```
packages/storage/src/secure-store/provider-key-storage.test.ts
packages/storage/src/secure-store/secure-store-integration.test.ts
packages/storage/src/secure-store/secure-store.spec.ts
packages/storage/src/secure-store/secure-store.fallback-v2.test.ts
packages/storage/src/secure-store/secure-store.fallback2.test.ts
packages/storage/src/secure-store/secure-store-errors.test.ts
packages/storage/src/secure-store/secure-store.basic.test.ts
packages/storage/src/secure-store/secure-store.fallback.test.ts
packages/storage/src/secure-store/secure-store.dual-mode.test.ts
packages/storage/src/secure-store/secure-store.native-keyring.test.ts
packages/storage/src/secure-store/envelope-codec.test.ts
packages/storage/src/secure-store/secure-store.fallback-behavior.test.ts
packages/storage/src/secure-store/provider-key-storage.fallback.test.ts
packages/storage/src/secure-store/secure-store.runtime-replaced.test.ts
packages/storage/src/secure-store/envelope.test.ts
packages/storage/src/secure-store/runtime-identity.test.ts
packages/storage/src/secure-store/secure-store.migration.test.ts
packages/storage/src/secure-store/machine-secret.test.ts
packages/storage/src/config/path-resolver.test.ts
packages/storage/src/config/storage.agentsSecurity.test.ts
packages/storage/src/config/storage.test.ts
packages/storage/src/utils/gitIgnoreParser.test.ts
packages/storage/src/testing/isolateStorageRoots.test.ts
packages/storage/src/services/fileDiscoveryService.test.ts
packages/storage/src/services/fileSystemService.test.ts
packages/storage/src/conversation/ConversationFileWriter.test.ts
packages/storage/src/session/sessionTypes.test.ts
```

## Preflight Verification Commands

Run these to capture the vitest baseline:

```bash
# Capture vitest test counts (run from repo root)
cd packages/tools && npx vitest run --reporter=json 2>/dev/null | jq '.testResults | length'
cd packages/mcp && npx vitest run --reporter=json 2>/dev/null | jq '.testResults | length'
cd packages/storage && npx vitest run --reporter=json 2>/dev/null | jq '.testResults | length'

# Or capture per-file pass/fail:
cd packages/tools && npx vitest run --reporter=verbose 2>&1 | tee /tmp/tools-vitest-baseline.txt
cd packages/mcp && npx vitest run --reporter=verbose 2>&1 | tee /tmp/mcp-vitest-baseline.txt
cd packages/storage && npx vitest run --reporter=verbose 2>&1 | tee /tmp/storage-vitest-baseline.txt
```

## Infrastructure Verification

### augment-bun-vi.ts (Vitest compatibility layer)

- **Path**: `test-setup/augment-bun-vi.ts`
- **Wired via**: `bunfig.toml [test].preload`
- **Provides**: vi.mock, vi.doMock, vi.spyOn, vi.fn, vi.stubEnv, vi.unstubAllEnvs,
  vi.stubGlobal, vi.unstubAllGlobals, vi.importActual, vi.importActualSync,
  vi.mocked, vi.hoisted, vi.useFakeTimers/useRealTimers (+ async variants),
  vi.advanceTimersByTime(+Async), vi.runAllTimers(+Async), vi.setSystemTime,
  vi.waitFor, vi.clearAllTimers, vi.restoreAllMocks
- **Throws on (unsupported)**: vi.resetModules, vi.doUnmock, vi.unmock
- **Test files needing refactoring for these**: ast-grep-utils.lazy.test.ts
  (resetModules + doMock/doUnmock), secure-store.fallback.test.ts (resetModules)

### run_bun_tests.ts (orchestrator)

- **Path**: `scripts/run_bun_tests.ts`
- **Behavior**: Reads manifest, spawns `bun test` per file in isolated process,
  `--max-concurrency 1`, handles preloads, writes JUnit XML
- **Manifest path**: `scripts/bun-test-manifest.ts`

### Storage isolation

- **Helper**: `packages/storage/src/testing/isolateStorageRoots.ts`
- **Vitest setup**: `packages/{tools,mcp,storage}/test-setup-storage-isolation.ts`
  (imports `isolateStorageRoots` from storage)
- **Bun preload**: Must be wired via `bunfig.toml [test].preload` or manifest
  `preload` field (Bun does not run vitest setupFiles)

### Workspace test scripts (current state)

| Workspace | Current `test` | Current `test:ci` | Has `test:vitest`? |
|-----------|---------------|-------------------|---------------------|
| tools     | `vitest run`  | `vitest run`      | No                  |
| mcp       | `vitest run`  | `vitest run`      | No                  |
| storage   | `vitest run`  | `vitest run`      | No                  |

### CI test execution path

- `rest` shard (owns tools, mcp, storage + others) runs:
  `bun scripts/test.ts --shard rest`
- This expands to per-workspace `npm run test` invocations
- `secure_store_backend` CI job runs SecureStore tests via:
  `npm run test:ci --workspace @vybestack/llxprt-code-storage -- --config $TEST_CONFIG`

## Blocking Issues Found (implementation must resolve)

1. **vi.resetModules in ast-grep-utils.lazy.test.ts**: Uses vi.doMock +
   vi.doUnmock + vi.resetModules to test lazy module initialization. All three
   APIs throw under Bun. Must refactor to process-isolated pattern (the
   orchestrator already runs each file in its own process, but this file uses
   resetModules within a single file for multiple test scenarios).

2. **vi.resetModules in secure-store.fallback.test.ts**: Uses vi.stubEnv +
   vi.resetModules to re-import secure-store.js with different XDG_DATA_HOME.
   Must refactor to avoid module reset (e.g., test the path resolution logic
   directly, or split into separate test files for each platform).

3. **resolves.not.toThrow in file-token-storage.test.ts**: Bun's expect does
   not support `.resolves.not.toThrow()`. Rewrite to:
   `await expect(storage.clearAll()).resolves.toBeUndefined()` or use a
   try/catch with `expect.fail`.

4. **Async vi.mock factories**: Several mcp files use
   `vi.mock('...', async (importOriginal) => {...})` with `await
   vi.importActual`. The augment-bun-vi.ts layer handles this via sync
   require() interception, but factories using `await import()` (not
   importActual) inside the body will deadlock. Must verify each async factory
   uses importActual/importActualSync, not bare dynamic import.

5. **SecureStore CI tests**: The native-keyring and fallback-behavior tests
   must continue running via vitest config selection in the
   `secure_store_backend` CI job. The storage package.json needs a script that
   runs these specific configs (e.g., `test:secure-store` or keep the existing
   `--config` passthrough on `test:vitest`).

## Verification Gate

- [ ] Vitest baselines captured for all three workspaces
- [ ] All 135 test files verified present and listed above
- [ ] augment-bun-vi.ts compatibility surface understood
- [ ] 5 blocking issues documented with resolution strategy
- [ ] CI execution path understood
