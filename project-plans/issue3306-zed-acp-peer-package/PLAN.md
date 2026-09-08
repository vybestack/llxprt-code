# Plan — Issue #3306: Move the Zed ACP integration into a peer client package

## 1. Problem restated

`packages/cli/src/zed-integration/**` (61 files: 32 production, 29 test) is a second
client of the agent system that ships *inside* the CLI package. Because it is not a
peer package, nothing structurally prevents it from importing CLI internals, and it
cannot demonstrate that the public agent API suffices for a non-CLI host.

Measured coupling today (grep over `packages/cli/src/zed-integration/**`):

| Import specifier | Count | Kind |
| --- | --- | --- |
| `@vybestack/llxprt-code-core` | 48 | workspace, public |
| `@agentclientprotocol/sdk` | 40 | external |
| `@vybestack/llxprt-code-agents` | 20 | workspace, public (the target API) |
| `@vybestack/llxprt-code-tools` (+ `/acquisition.js`) | 15 | workspace, public |
| `@vybestack/llxprt-code-storage` | 4 | workspace, public |
| `@vybestack/llxprt-code-telemetry` | 3 | workspace, public |
| `@vybestack/llxprt-code-providers/runtime.js` | 3 | workspace, public subpath |
| **`../config/settings.js`** | **5** | **CLI internal — must go** |
| **`../utils/cleanup.js`** | **1** | **CLI internal — must go** |

Plus `zod`, `glob`, and node builtins.

Only two CLI-internal edges exist, and both are narrow:

1. `LoadedSettings` — imported as a **type only**, and in the single production use
   (`ZedAgent` constructor, `zedIntegration.ts:97`) the parameter is named
   `_settings` and **is never read**. It is threaded from `cli.tsx` through
   `runZedIntegration(config, settings)` purely as dead weight.
2. `runExitCleanup` — imported by `runZedIntegration.ts` to drain the CLI's
   process-global cleanup registry in the `finally` block.

## 2. Accepted behavior (what we deliver)

- **AB-1** A peer workspace package `packages/zed-acp`
  (`@vybestack/llxprt-code-zed-acp`) exists alongside `packages/cli`, is registered in
  the root `workspaces`, builds, lints, typechecks, and runs its own tests.
- **AB-2** All ACP/Zed production and test sources live in `packages/zed-acp/src/**`
  and no ACP/Zed source remains under `packages/cli/src`.
- **AB-3** No module in `packages/zed-acp` imports anything from `packages/cli`
  (neither by relative path nor by the `@vybestack/llxprt-code` package name).
- **AB-4** The process-exit cleanup previously reached via `../utils/cleanup.js` is
  **injected by the host**: `runZedIntegration` accepts an optional
  `onExitCleanup: () => void | Promise<void>` and invokes it exactly once after agent
  disposal, whether the connection closed normally or threw. The CLI passes its own
  `runExitCleanup`. When no callback is supplied nothing is invoked and the run still
  completes. A rejecting callback must not propagate out of `runZedIntegration`.
- **AB-5** The unused `LoadedSettings` parameter is removed from `ZedAgent` and
  `runZedIntegration`, eliminating the type-only CLI dependency at its root instead of
  replacing it with a shim type. `ZedAgent`'s remaining positional parameters keep
  their order and meaning (`config`, `connection`, `sessionFileLister`).
- **AB-6** The runtime id registered by the ACP client is a package-owned constant
  `ZED_ACP_RUNTIME_ID = 'zed-acp.runtime'` exported from `packages/zed-acp`, replacing
  the hardcoded `'cli.runtime.zed'`. `allowDefaultHandoff: true` and the
  `metadata.source` / `metadata.stage` values are preserved (coexistence is explicitly
  out of scope).
- **AB-7** `llxprt --experimental-acp` still launches and completes an ACP session:
  `cli.tsx` calls `ensureAcpProviderActivated(config)` and then delegates to
  `runZedIntegration` imported from `@vybestack/llxprt-code-zed-acp`.
- **AB-8** The PR description enumerates every declared dependency of the new package
  and justifies each workspace dependency beyond `@vybestack/llxprt-code-agents` as a
  concrete agent-API gap.

## 3. Explicitly out of scope

- Two clients coexisting in one process (`allowDefaultHandoff` stays `true`).
- Any change to ACP protocol behavior, capabilities, wire messages, or Zed UX.
- Config decomposition (#2615) — `Config` remains the currency.
- Narrowing `setCliRuntimeContext` into a new public providers API. That is a real gap;
  it gets **recorded**, not fixed here (adding a public runtime-registration API is a
  new public abstraction and would need separate approval).
- Any refactor of files outside the moved tree, `cli.tsx`'s ACP path, and the build /
  test / release registration files listed in §5.

## 4. Boundary cases the tests must pin

| # | Case | Expected |
| --- | --- | --- |
| BC-1 | `runZedIntegration` with no `onExitCleanup` | completes; no throw |
| BC-2 | `onExitCleanup` supplied, connection closes normally | invoked exactly once, after agent disposal |
| BC-3 | `onExitCleanup` supplied, connection throws | connection error propagates; callback still invoked exactly once |
| BC-4 | `onExitCleanup` rejects | rejection swallowed and logged; `runZedIntegration` still settles per BC-2/BC-3 |
| BC-5 | Agent `disposeAll()` rejects | logged as a warning; `onExitCleanup` still runs |
| BC-6 | Signal-driven disposal (SIGINT/SIGTERM) | existing behavior unchanged: owned `Readable` destroyed, listeners removed |
| BC-7 | Runtime registration | `setCliRuntimeContext` receives `runtimeId === ZED_ACP_RUNTIME_ID` and `allowDefaultHandoff: true` |
| BC-8 | CLI delegation | with `getExperimentalZedIntegration() === true`, `cli.tsx` activates the ACP provider then calls the package's `runZedIntegration` and returns without building a foreground agent |

## 5. Work breakdown

### Phase 1 — Package scaffold

Create `packages/zed-acp` modelled on `packages/agents`:

- `package.json` — name `@vybestack/llxprt-code-zed-acp`, version `0.11.0`,
  `type: module`, `main`/`types` → `dist/`, `exports` map with a `bun` condition
  pointing at `index.ts` (matching every other workspace so Bun runs raw TS),
  `files: ["index.ts", "src", "dist", "!**/*.test.ts", ...]`,
  scripts `build` / `lint` / `format` / `test` / `test:ci` / `typecheck`,
  `engines.node >= 24`.
- `tsconfig.json` + `tsconfig.build.json` mirroring the agents pair (source `paths`
  for dev/typecheck, `dist/*.d.ts` `paths` for the build).
- `index.ts` barrel re-exporting the public client surface
  (`runZedIntegration`, `ZedAgent`, `ZED_ACP_RUNTIME_ID`, and whatever `zedIntegration.ts`
  already re-exports).
- `run-bun-tests.ts` **is not** added; the package uses the shared runner
  (`bun ../../scripts/run_bun_tests.ts --workspace zed-acp`) like `lsp`/`policy`.

Registration touch-points (each verified by an existing CI guard):

| File | Change | Guard that enforces it |
| --- | --- | --- |
| root `package.json` `workspaces` | add `packages/zed-acp` | `scripts/verify-bun-workspace-links.ts` |
| root `package.json` `files` | add `packages/zed-acp/index.ts`, `src/`, `package.json` | release packaging |
| `scripts/bun-test-roots.ts` | add root `zed-acp` with `test-setup-storage-isolation.ts` preload | `scripts/check-test-file-coverage.ts` |
| `scripts/test-shards.ts` | add `zed-acp` to the `rest` shard | `scripts/check-test-shards.ts` |
| `scripts/affected-test-shards.data.json` | `packageToShard`, `importEdges` for `zed-acp`, `cli → zed-acp` edge | `scripts/check-affected-test-shards.ts` |
| `packages/cli/package.json` | add `"@vybestack/llxprt-code-zed-acp": "file:../zed-acp"` | `scripts/bind-release-deps.ts` |
| `packages/cli/tsconfig.json` | add `paths` entry + `include` for the new package | `npm run typecheck` |
| `.github/workflows/release.yml` | add a publish step before the CLI publish | release dry run |
| `bun.lock` / `package-lock.json` | regenerate | `scripts/check-lockfile.ts` |

The new package is **not** added to `NON_NPM_RELEASE_PACKAGES` (the CLI depends on it
at runtime, so it must publish) and **not** added to `NON_DECLARATION_WORKSPACES` (the
CLI typechecks against its declarations).

### Phase 2 — Behavior change, test-first

Before moving anything, add the failing tests for AB-4/AB-5/AB-6 against the *current*
location so the behavior change is pinned independently of the move:

`runZedIntegration` builds its own transport from `process.stdin` / `createInkStdio()`,
so it cannot be driven whole from a test without inventing a transport-injection seam —
which is out of scope. Instead the two behaviors under change are exercised through
functions exported from the same module, following the seam the file **already** uses
for `buildSignalDisposalHandler` and `installDisposalSignalHandlers`:

- `cleanupAgents(agents, logger, onExitCleanup?)` becomes exported. Tests BC-1 … BC-5
  call it with real `ZedAgent`-shaped disposables (a resolving one, a rejecting one)
  and a real counting callback, asserting invocation count and settle behavior — not
  that a spy was called.
- `registerZedAcpRuntime(config)` is extracted and exported; it is the only caller of
  `setCliRuntimeContext` in the package. BC-7 calls it with a real `SettingsService`
  + `Config` pair and reads the resulting entry back out of the **real** providers
  runtime registry, asserting the recorded id is `ZED_ACP_RUNTIME_ID` and that the
  default-CLI-runtime pointer was handed off.

Both are called by `runZedIntegration` exactly where the inline code sits today, so the
composed path is unchanged. Then implement: `onExitCleanup` parameter,
`ZED_ACP_RUNTIME_ID`, drop `_settings`.

The `runExitCleanup()` call is replaced by `await onExitCleanup?.()` inside the existing
try/catch that already logs and swallows cleanup failure (BC-4 is therefore preserved
behavior, not new defensive code).

### Phase 3 — Move

`git mv packages/cli/src/zed-integration/* packages/zed-acp/src/` (use `git mv` so
history follows), then:

- Delete the now-dangling `../config/settings.js` type imports from the 4 test files
  and `runZedIntegration.ts` / `zedIntegration.ts`.
- No other import rewriting is expected: every remaining specifier is either
  package-local relative, a node builtin, an external dep, or a `@vybestack/…`
  workspace package that resolves identically from the new location.
- Remove `packages/cli/src/zed-integration/` entirely.

### Phase 4 — CLI delegation

- `cli.tsx`: `import { runZedIntegration } from '@vybestack/llxprt-code-zed-acp';`
  and `await runZedIntegration(config, { onExitCleanup: runExitCleanup });`
  `handleZedAcpIntegration` drops its `settings` parameter (it only forwarded it).
- `cliStartupOrdering.test.ts`: the two `mock.module('./zed-integration/zedIntegration.js', …)`
  calls become `mock.module('@vybestack/llxprt-code-zed-acp', …)`.
- Docs: `dev-docs/acp-conformance.md:38` path reference updated. `docs/zed-integration.md`
  is user-facing and describes the `--experimental-acp` flag, which is unchanged —
  update only if it names the internal path.

## 6. Verification

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

plus the targeted guards this change can break:

```
npm run lint:cli-boundary
npm run lint:agents-api-surface
npm run lint:test-shards
npm run lint:affected-shards
npm run lint:test-file-coverage
npm run lint:copyright-year
npm run lint:no-new-js
npm run lint:doc-links
bun scripts/verify-bun-workspace-links.ts
```

Evidence for AB-7 beyond unit tests: the `acp_conformance` CI job runs `acplint`
against `llxprt --experimental-acp`, which exercises a real ACP session end to end.

## 7. Dependency ledger (to be confirmed by implementation, then copied into the PR)

| Dependency | Why the ACP client needs it | Gap it represents |
| --- | --- | --- |
| `@agentclientprotocol/sdk` | ACP wire protocol | none — external protocol dep, expected |
| `@vybestack/llxprt-code-agents` | `fromConfig`, `Agent`, `AgentEvent` | none — this is the intended API |
| `@vybestack/llxprt-code-core` | `Config` (constructor currency), `createInkStdio`, content/tool types | **Gap:** the agents API takes and returns `Config`, so any client must depend on core. Tracked by #2615. |
| `@vybestack/llxprt-code-providers/runtime.js` | `setCliRuntimeContext` to claim the foreground runtime slot | **Gap:** no public "register this host as a runtime" API exists on `agents`; the only entry point is a `cli`-named providers function. |
| `@vybestack/llxprt-code-telemetry` | `DebugLogger` | **Gap:** `agents` exposes no logger for clients. |
| `@vybestack/llxprt-code-tools` | tool result/kind types for ACP tool-call projection | **Gap:** `agents` re-exports some stream types but not the tool value types ACP must map. |
| `@vybestack/llxprt-code-storage` | chat-session file locations for `session/load` and listing | **Gap:** session listing/loading is not on the `agents` surface. |
| `zod`, `glob` | schema validation, session file globbing | none — ordinary external deps |

`@vybestack/llxprt-code-settings` is **not** required: the settings dependency was
type-only and dead.

## 8. Risks

- **Test discovery drift.** The 29 moved test files currently run in the `cli`
  workspace runner (`packages/cli/run-bun-tests.ts`, purely structural discovery). After
  the move they must be discovered by `scripts/run_bun_tests.ts --workspace zed-acp`.
  `npm run lint:test-file-coverage` is the guard; run it explicitly.
- **Release wiring.** A new published package needs the `release.yml` step, otherwise
  the CLI would ship a dependency on an unpublished package. This is the highest-risk
  registration item because it is not exercised by PR CI.
- **Bundle.** The CLI bundle inlines workspace deps (the new package is not in
  `EXTERNALS`), so `npm run build` must be run and the bundle smoke-checked.
