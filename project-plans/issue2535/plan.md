# Plan: Delete expired token compatibility and confirmed inert runtime surfaces (Issue #2535)

Plan ID: PLAN-20260821-ISSUE2535
Generated: 2026-08-21
Issue: #2535
Status: In progress

## Problem statement

The codebase still carries several dead or dormant surfaces that were left behind
after earlier migrations:

1. `FileTokenStore` (`packages/mcp/src/auth/file-token-store.ts`), a
   deprecated legacy file token store, plus its barrel export
   (`packages/mcp/src/auth/index.ts`) and the `FileTokenStore` re-export from
   `packages/core/src/index.ts`, and its dedicated test file. Legacy hex-colon /
   plaintext read compatibility in `FileTokenStorage`
   (`packages/mcp/src/auth/token-storage/file-token-storage.ts`) is the actual
   expired-token compatibility path this issue is about and must be retired with it.

2. The dormant circuit-breaker config on `RetryOrchestrator`:
   `circuitBreakerEnabled`, `circuitBreakerFailureThreshold`,
   `circuitBreakerFailureWindowMs`, `circuitBreakerRecoveryTimeoutMs` config
   flags (defaults false/3/60000/30000), the `CircuitBreakerState` interface,
   the commented-out `circuitBreakerStates` field ("reserved for future
   implementation"), the RETRY_EPHEMERAL_KEYS circuit entries that are never read,
   and the "3. Circuit breaker pattern (optional)" doc bullet. The authoritative
   live circuit breaker is the load balancer's `CircuitBreakerManager`
   (`packages/providers/src/loadBalancing/circuitBreakerManager.ts`), which
   stays fully in place.

3. The dead MCP tool methods on `DiscoveredMCPTool`:
   `getFullyQualifiedPrefix`, `getFullyQualifiedName`, and the deprecated
   `asFullyQualifiedTool`, plus the `McpRegisteredTool` interface and
   `getFullyQualifiedName`-based `__` fallback in
   `packages/tools/src/tools/tool-registry.ts`.

4. The inert load-balancer stats accessors in
   `packages/providers/src/runtime/profileApplication.ts`:
   `getLoadBalancerStats`, `getLoadBalancerLastSelected`,
   `getAllLoadBalancerStats` — stubs returning undefined/null/empty Map that
   re-export through `runtimeSettings.ts` and `RuntimeContext.tsx` and are stubbed
   in CLI test mocks. Real stats live on `LoadBalancingProvider.getStats()` →
   `ExtendedLoadBalancerStats` (kept).

5. Stale/duplicate docs: `docs/cli/profiles.md` lists `lb_circuit_breaker_*`
   keys that exist nowhere in code; `docs/reference/ephemerals.md` documents the
   real `circuit_breaker_*` ephemerals (kept), but those references must be
   reconciled so the API docs/changelog identify the breaking removal.

## Preflight findings

1. `FileTokenStore` exists ONLY at:
   - `packages/mcp/src/auth/file-token-store.ts` (class, 27 tests file)
   - `packages/mcp/src/auth/file-token-store.test.ts`
   - `packages/mcp/src/auth/index.ts:27` (`export { FileTokenStore }`)
   - `packages/core/src/index.ts` (`FileTokenStore` re-export)
   No production consumer imports `./file-token-store.js` anywhere.
   `FileTokenStorage` (the modern store) stays: it backs `HybridTokenStorage` /
   `KeychainTokenStorage` fallback via `token-storage/index.ts` and is consumed
   through `MCPOAuthTokenStorage` by `oauth-provider.ts`, `mcp-oauth-helpers.ts`,
   `oauth-status.ts`, `diagnosticsTokens.ts` (all RETAINED). The removed
   "file tokens" surface is the expired legacy `FileTokenStore` compatibility class and
   the `FileTokenStorage` legacy hex-colon / plaintext read-back path.

2. The RetryOrchestrator circuit-breaker config is dormant: `retryRequestContext.ts`
   has ZERO circuit-breaker reads (only `retries`/`retrywait`/`auth-retry-timeout`
   are read); the `CircuitBreakerState` interface is duplicated in `RetryOrchestrator.ts`
   and never referenced; the per-provider `CircuitBreakerState` map is commented out.
   The live circuit breaker is `LoadBalancingProvider.circuitBreakerStates` +
   `CircuitBreakerManager`, `FailoverSettings.circuitBreaker*`, settings registry
   `circuit_breaker_*` entries, `statsBuilder.collectCircuitBreakerStates`,
   `backendRuntime.validateNotAllUnhealthy`, `failoverErrorHandler` +
   `backendAttemptExecutor` recording, and `LBStatsDisplay`/`diagnosticsCommand`
   reading `stats.circuitBreakerStates`. ALL of that is retained.

3. `asFullyQualifiedTool`/`getFullyQualifiedPrefix` have zero consumers.
   `getFullyQualifiedName` is consumed ONLY by:
   - `packages/tools/src/tools/tool-registry.ts:49` (`McpRegisteredTool`
     interface `getFullyQualifiedName?()`) and `tool-registry.ts:918-924`
     (`__` fallback loop).
   These four code sites die together. The construction path
   `mcp-tool.ts` `nameOverride ?? generateMcpToolName(serverName, serverToolName)`
   always supplies the canonical `mcp__server__tool` name, so MCP tools already
   have unique names; the `getFullyQualifiedName` fallback is unreachable in
   practice — the `__` fallback compares `name` to `server__tool` which can never
   equal `mcp__server__tool`. `tool-registry.ts` has several OTHER live uses of
   `isDiscoveredMcpTool` (sorting, defer, removeMcpToolsByServer,
   registerToolIntoMap, getToolsByServer, buildCoreToolsMap) that stay. Only the
   `McpRegisteredTool` interface + `getFullyQualifiedName?` + the `__` fallback
   loop are removed.

4. `getLoadBalancerStats`/`getLoadBalancerLastSelected`/`getAllLoadBalancerStats`
   are stubs in `profileApplication.ts` and are re-exported from
   `runtimeSettings.ts` + `RuntimeContext.tsx`; zero production consumers. Only
   test runtime-mocks reference them (`config.*.test.ts`, parity `__tests__/*.test.ts`,
   `test-utils/render.tsx`, `StatsDisplay.testHelpers.ts`). Real stats come from
   `LoadBalancingProvider.getStats()` (kept). These are deleted, including their
   `runtimeSettings.ts` re-export and `RuntimeContext.tsx` entries and every mock stub.

5. `docs/cli/profiles.md:211-214` lists `lb_circuit_breaker_threshold` /
   `lb_circuit_breaker_timeout_ms` / `lb_tpm_failover_threshold` keys that
   exist in NO code. `docs/reference/ephemerals.md:188-194` documents the real
   `circuit_breaker_*` keys legitimately. `docs/reference/ephemerals.md` does not
   document FileTokenStore anywhere. The PR adds a `CHANGELOG.md` "Removed
   (0.12.0 breaking cleanup)" entry naming:
   `FileTokenStore` + `getLoadBalancerStats` / `getLoadBalancerLastSelected` /
   `getAllLoadBalancerStats` + `DiscoveredMCPTool.asFullyQualifiedTool` /
   `getFullyQualifiedName` / `getFullyQualifiedPrefix` +
   RetryOrchestrator circuit-breaker config + legacy hex-colon file-token read path.

6. House style for locking in deleted symbols: absence-contract test builds the
   forbidden name from string fragments (see `packages/mcp/src/client/mcp-public-api.test.ts`
   `const staleDiscoveryGetter = 'getMCP' + 'DiscoveryState';`) and asserts
   absence from module namespaces. A `packages/tools/src/tools/tool-registry` lockstep
   absence test (new `tool-registry.inert-surfaces.bun.test.ts`) asserts the tools
   registry has no `getFullyQualifiedName` fallback and `mcp-tool` has none of
   the three methods, with fragmented names.

## Accepted behavior

### REQ-2535-1: `FileTokenStore` and legacy hex-colon / plaintext token reads are removed

**Full text:** Remove the deprecated `FileTokenStore` class
(`packages/mcp/src/auth/file-token-store.ts`) along with its barrel export
(`packages/mcp/src/auth/index.ts`), its `packages/core/src/index.ts` re-export,
and its dedicated `file-token-store.test.ts`. Remove the `FileTokenStorage` legacy
hex-colon / plaintext read-back path (the `iv:authTag:ciphertext` decrypt, its
`isLegacyHexColonFormat` probe and the `os`/`crypto` legacy KDF helpers) and
its test cases proving legacy-hex-colon read compatibility (delete
`file-token-storage.behavior.test.ts` legacy tests and `file-token-storage.test.ts`
legacy tests). New writes remain versioned-envelope-only through the codec: normally v:2,
with the retained v:1 fallback only when no machine secret is available and no v:2 file is
being overwritten (the existingEnvelopeVersion guard refuses v:2 → v:1). Malformed/unknown
files keep failing closed with "Token file corrupted". The RETAINED `FileTokenStorage`
remains the keychain fallback class; `MCPOAuthTokenStorage`, `HybridTokenStorage`,
`KeychainTokenStorage`, `oauth-provider.ts`, `oauth-status.ts`, `diagnosticsTokens.ts`
retain full functionality.
- GIVEN a running CLI with an active MCP OAuth server
- WHEN the MCP token store reads its token file
- THEN it reads v:2 envelopes via `FileTokenStorage`/`KeychainTokenStorage` and
  returns credentials (unchanged)
- AND an on-disk legacy hex-colon file or plaintext file is treated as
  not-a-valid-envelope and fails closed "Token file corrupted" (new lockstop test)
- AND `FileTokenStore` (the removed class name) cannot be imported from the package
  (absence contract test)
- AND deleting the legacy read path would break the retained "Token file corrupted"
  tests (deletion-litmus)

### REQ-2535-2: `RetryOrchestrator` dormant circuit-breaker config is removed

**Full text:** Remove from `RetryOrchestratorConfig`
(`circuitBreakerEnabled`, `circuitBreakerFailureThreshold`,
`circuitBreakerFailureWindowMs`, `circuitBreakerRecoveryTimeoutMs`),
its constructor defaults, the commented-out `private circuitBreakerStates` map, the
`CircuitBreakerState` interface in `RetryOrchestrator.ts`, and the
"3. Circuit breaker pattern (optional)" doc bullet. `LoadBalancingProvider`
circuit breaker (`CircuitBreakerManager`, `circuit_breaker_*` settings,
`statsBuilder` snapshot, `diagnosticsCommand`/`LBStatsDisplay` read) is RETAINED.
No forwarding wrapper or old/new probe is added.
- GIVEN a `RetryOrchestrator` constructed with `{ circuitBreakerEnabled: true }`
- WHEN the orchestrator retries a request
- THEN the extra config is not part of `RetryOrchestratorConfig` (structural)
- AND the orchestrator still performs backoff/retry/bucket-failover identically
- AND `retryRequestContext` resolves only `retries`/`retrywait`/`auth-retry-timeout`
  (existing `RetryOrchestrator.*.test.ts` retry tests still pass)
- AND `RetryOrchestrator` has no `CircuitBreakerState` and no
  `circuitBreakerEnabled` (absence contract); `LoadBalancingProvider.circuitBreakerStates`
  still exists and its circuitbreaker test file still passes

### REQ-2535-3: `asFullyQualifiedTool` / `getFullyQualifiedName` / `getFullyQualifiedPrefix` are removed

**Full text:** Remove `getFullyQualifiedPrefix`, `getFullyQualifiedName`, and
`asFullyQualifiedTool` from `DiscoveredMCPTool`, plus
`McpRegisteredTool.getFullyQualifiedName?`, the `__` fallback loop in
`tool-registry.ts`, and the import/consumption in `mcp-tool.ts`. MCP tools keep
unique names from `generateMcpToolName`. The other `isDiscoveredMcpTool` uses
(sort, defer, removeMcpToolsByServer, core map, getToolsByServer) are preserved.
- GIVEN a registry with an MCP tool registered under `mcp__server__tool`
- WHEN `getTool('mcp__server__tool')` or `getTool('server__tool')` is called
- THEN the exact `mcp__server__tool` lookup resolves the tool
- AND the `server__tool` name does NOT resolve via any `getFullyQualifiedName`
  fallback (because the fallback code no longer exists)
- AND the three methods are absent from `DiscoveredMCPTool` prototype (absence
  contract test, fragmented names)
- AND `getToolsByServer('server')` still lists the tool (live `isDiscoveredMcpTool`
  preserved)

### REQ-2535-4: Inert load-balancer stats accessors are removed

**Full text:** Remove `getLoadBalancerStats`, `getLoadBalancerLastSelected`,
`getAllLoadBalancerStats` from `profileApplication.ts`, their re-export from
`runtimeSettings.ts` and `RuntimeContext.tsx`, and every test-mock stub
(`config.test.ts`, `config.part{2,3,4}.test.ts`, `config.loadMemory.test.ts`,
parity `__tests__/{approvalModeParity,e2eOrderingParity,profileOverridePrecedenceParity,mcpFilteringParity,folderTrustOriginalSettingsParity,toolGovernanceParity,providerModelPrecedenceParity}.test.ts`,
`test-utils/render.tsx`, `StatsDisplay.testHelpers.ts`). `RuntimeContext.tsx`
production `runtimeFunctions`/`runtimeApi` drop the three entries. Real stats come
from `LoadBalancingProvider.getStats()` (`diagnosticsCommand`, `LBStatsDisplay`).
- GIVEN `/diagnostics` or the LB stats panel on an active load-balancer
- WHEN the runtime is asked about load balancer statistics
- THEN `getStats()` returns the real `ExtendedLoadBalancerStats` (state, counts,
  circuit breakers, TPM)
- AND the three stat functions cannot be imported from `@vybestack/llxprt-code-providers`
  (absence contract)
- AND the loadbalancer behavior tests / `diagnosticsCommand.loadbalancer.{test,spec}` /
  `LoadBalancingProvider.circuitbreaker.test` still pass

### REQ-2535-5: API docs/changelog identify the breaking removals

**Full text:** Update `docs/cli/profiles.md` (drop the `lb_circuit_breaker_*`
rows) and `CHANGELOG.md` [Unreleased] with a "Removed (0.12.0 breaking cleanup)"
entry naming: `FileTokenStore`, `FileTokenStorage` legacy-hex-colon reads,
`getLoadBalancerStats`/`getLoadBalancerLastSelected`/`getAllLoadBalancerStats`,
`DiscoveredMCPTool.asFullyQualifiedTool`/`getFullyQualifiedName`/`getFullyQualifiedPrefix`,
and the `RetryOrchestrator` circuit-breaker config. No new shim/probe.
- GIVEN a maintainer reads the 0.12.0 changelog
- WHEN they see the "Removed (0.12.0 breaking cleanup)" section
- THEN it names the removed APIs explicitly and points users/surfaces to the
  authoritative replacement (secure storage / `LoadBalancingProvider.getStats()`)

### REQ-2535-6: No replacement shim, forwarding class, or old/new probe added

**Full text:** The PR is pure deletion. No alias export, no deprecated forwarding
function, no behavioral probe. The deletion-litmus test passes: removing the source
implementation fails the tests with PR nonexports; the PR leaves no forwarding wrapper.
- GIVEN the PR's diff
- THEN `git diff` shows only removals plus the absence-contract tests, docs, and
  changelog
- AND the deleted symbols resolve nowhere (grep zero results)

## Files to delete

- `packages/mcp/src/auth/file-token-store.ts` (class)
- `packages/mcp/src/auth/file-token-store.test.ts`
- The `file-token-storage.ts` legacy-hex-colon read path (methods/fields inside
  the retained file), the legacy-hex-colon test cases, the `RetryOrchestrator`
  circuit config + `CircuitBreakerState`, the three `profileApplication.ts` accessors,
  their `runtimeSettings.ts`/`RuntimeContext.tsx`/mock-stub references, and the
  `mcp-tool.ts` methods + `tool-registry.ts` registry pieces.

## Files to add

- `packages/tools/src/tools/tool-registry.inert-surfaces.bun.test.ts` (NEW
  absence-contract test — the deletion-litmus for REQ-2535-3; the only new
  test file in the diff besides the changelog/docs and this plan)

## Files to modify

- `packages/mcp/src/auth/index.ts` — remove `FileTokenStore` export
- `packages/core/src/index.ts` — remove `FileTokenStore` from the mcp re-export
- `packages/mcp/src/auth/token-storage/file-token-storage.ts` — remove
  `legacyEncryptionKey`/`getLegacyEncryptionKey`/`decrypt`/`isLegacyHexColonFormat`
  (drop now-unused `os`/`crypto` imports) and collapse `loadTokens` to
  envelope-only (non-envelope → "Token file corrupted"). Keep the live v:2 codec
  surface: `existingEnvelopeVersion` anti-downgrade guard in `saveTokens` and
  `FileTokenStorageOptions.machineSecretLoader/machineSecretPath/tokenFilePath` are
  RETAINED (they are part of the current v:2 security behavior used by tests, not
  legacy compatibility; `machineSecretPath` remains in the FileTokenStorageOptions type).
- `packages/mcp/src/auth/token-storage/file-token-storage.behavior.test.ts` —
  retitle/trim the legacy-hex-colon + fail-closed-on-read cases to the new
  envelope-only contract (no legacy-read → fail-closed "Token file corrupted")
- `packages/mcp/src/auth/token-storage/file-token-storage.test.ts` — delete
  legacy-hex-colon seeding and corrupt→"Token file corrupted" cases; keep v:2
  CRUD + chmod tests and the retained `existingEnvelopeVersion` anti-downgrade
  coverage (now in `file-token-storage.behavior.test.ts`)
- `packages/providers/src/RetryOrchestrator.ts` — remove the four config
  fields, `CircuitBreakerState` interface, `// private circuitBreakerStates` map,
  "3. Circuit breaker pattern (optional)" bullet
- `packages/mcp/src/client/mcp-tool.ts` — remove the three methods +
  `asFullyQualifiedTool`
- `packages/tools/src/tools/tool-registry.ts` — remove `McpRegisteredTool`
  interface `getFullyQualifiedName?`, the `isDiscoveredMcpTool`-with-qualified
  interface ref, and the `__` fallback block (keep `isDiscoveredMcpTool`
  fn used elsewhere)
- `packages/providers/src/runtime/profileApplication.ts` — remove the three
  accessors
- `packages/providers/src/runtime/runtimeSettings.ts` — remove the three
  re-exports
- `packages/cli/src/ui/contexts/RuntimeContext.tsx` — remove the three
  imports + `runtimeFunctions`/`runtimeApi` entries
- `packages/cli/src/config/*.test.ts` and `packages/cli/src/config/__tests__/*.test.ts`
  + `test-utils/render.tsx` + `StatsDisplay.testHelpers.ts` — remove the three
  mock stubs
- `docs/cli/profiles.md` — drop `lb_circuit_breaker_*` rows
- `CHANGELOG.md` — "Removed (0.12.0 breaking cleanup)" entry
- `packages/tools/src/tools/tool-registry.inert-surfaces.bun.test.ts` — the
  only new file (absence contract, REQ-2535-3)

No new `.js` files; every new file is `.ts` and `bun:test`. No `.js`
tests (repo rule: no new `.js`; no vitest).

## Files that are RETAINED (do NOT change)

- `packages/providers/src/loadBalancing/circuitBreakerManager.ts`,
  `LoadBalancingProvider.ts` (circuit breaker + `getStats`),
  `loadBalancing/statsBuilder.ts`, `backendRuntime.ts`, `failoverErrorHandler.ts`,
  `backendAttemptExecutor.ts` (circuit breaker), `loadBalancerTypes.ts`
  (`FailoverSettings.circuitBreaker*`), `Packages MCP token storage
  (`BaseTokenStore`, `HybridTokenStorage`, `KeychainTokenStorage`,
  `MCPOAuthTokenStorage`, `oauth-provider.ts`, `oauth-status.ts`,
  `diagnosticsTokens.ts`, `auth/token-storage/index.ts`), `getToolsByServer`,
  `isDiscoveredMcpTool` live uses, `mcp-tool.confirm.test.ts`,
  `mcp-tool.execute.test.ts`, `diagnosticsCommand.loadbalancer.{test,spec}.ts`,
  `LBStatsDisplay.tsx`, `HistoryItemDisplay.tsx`, `tool-registry.ts` (all other
  `isDiscoveredMcpTool` uses), `docs/reference/ephemerals.md` (v:2 +
  circuit rows), `docs/reference` secure-store docs.

## Implementation tasks (ordered, RED→GREEN)

1. Delete `packages/mcp/src/auth/file-token-store.ts` +
   `packages/mcp/src/auth/file-token-store.test.ts`; update the two barrels;
   trim `file-token-storage.ts`; replace the legacy-hex-colon test cases.
2. Add `packages/tools/src/tools/tool-registry.inert-surfaces.bun.test.ts`
   absence-contract test (fragmented names) → RED; then delete the three
   methods + registry pieces instead of the source → GREEN.
3. Remove the three LB accessors + re-exports + mocks.
4. Remove `RetryOrchestrator` circuit config + doc bullet.
5. Docs + changelog. Run the full verification cycle.

## Verification

Full cycle (workflow skill):

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Plus deletion-litmus proof: restore the old source for `asFullyQualifiedTool` on a
scratch branch and show the absence test fails; grep-zero for all removed symbols in
`packages/*/src`; `git diff --stat` shows the PR is substantially deletion
plus the single new test; the removed test files gone and the
circuitbreaker/getToolsByServer/mcp-tool/BaseTokenStore tests retained.

Plus test-audit scanner on the diff (any findings must be DISJOINT-source; the
new absence test asserts absence — the fragmented-name assert is a disjoint-source
assert, NOT a mirror). Run `bun scripts/test-audit/scan.ts` and diff vs the
main baseline; no new MOCK_MIRROR / ALWAYS_TRUE / SELF_CONFIRMING /
NO_ASSERT findings.

## Explicit non-goals (unchanged scope)

- `LoadBalancingProvider` circuit breaker, `FailoverSettings.circuitBreaker*`,
  `circuit_breaker_*` settings registry entries, `statsBuilder` circuit snapshot,
  `LBStatsDisplay` circuit read, `docs/reference/ephemerals.md` circuit rows: NOT
  removed (RETAINED).
- `MCPOAuthTokenStorage`, `HybridTokenStorage`, `KeychainTokenStorage`,
  `BaseTokenStore`, `FileTokenStorage` v:2 envelope codec, `mcp-oauth-tokens-v2.json`,
  `secure-store`, `diagnosticsTokens`, `oauth-provider`/`oauth-status`: RETAINED.
- `isDiscoveredMcpTool` (sort/defer/remove/core-map/getToolsByServer): RETAINED.
- `LoadBalancingProvider.getStats()`/`ExtendedLoadBalancerStats`: RETAINED.
- No new stored procedures; the legacy path migration, `providerAccounts`/
  `machine_secret`/`keyring` surfaces are outside this issue.
- No forwarding wrappers / shims / probes added.
- No vitest/.js test files.

## Deletion ledger (PR body table)

| Removed surface | Files | Evidence (grep) |
| --- | --- | --- |
| `FileTokenStore` class + test | `file-token-store.ts`, `file-token-store.test.ts`, `auth/index.ts`, `core/index.ts` | grep `FileTokenStore` → 0 in `packages/*/src` + core after |
| `asFullyQualifiedTool` | `mcp-tool.ts` | grep → 0 |
| `getFullyQualifiedPrefix` | `mcp-tool.ts` | grep → 0 |
| `getFullyQualifiedName` (MCP + registry) | `mcp-tool.ts`, `tool-registry.ts` | grep → 0 |
| `getLoadBalancerStats` / `getLoadBalancerLastSelected` / `getAllLoadBalancerStats` | `profileApplication.ts`, `runtimeSettings.ts`, `RuntimeContext.tsx` + mocks | grep → 0 in `src` |
| RetryOrchestrator `circuitBreaker*` config | `RetryOrchestrator.ts` | grep → 0 in `RetryOrchestrator.ts` |
| `CircuitBreakerState` | `RetryOrchestrator.ts` | grep → 0 |
| `FileTokenStorage` legacy hex-colon read | `file-token-storage.ts` | grep `legacyEncryptionKey`/`scryptSync` → 0 |
| `lb_circuit_breaker_*` doc keys | `docs/cli/profiles.md` | grep → 0 |
| Test stubs for the three LB accessors | CLI config/parity test files | grep → 0 in `packages/cli/src` |
