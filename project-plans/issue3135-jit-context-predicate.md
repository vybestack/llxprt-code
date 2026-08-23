# Issue #3135 - Collapse the two divergent JIT-context predicates and remove the dead settings read

## Problem (verified against HEAD, not the issue text)

The issue was filed before the #3173 refactor, so some line references have moved.
Re-verified inventory on `main`:

| Predicate | Definition | Production callers |
| --- | --- | --- |
| `isJitContextEnabled()` | `packages/core/src/config/configBaseCore.ts:623` - `return this.jitContextEnabled === true;` | `packages/agents/src/core/promptMemoryPolicy.ts:39`, `packages/cli/src/ui/commands/memoryCommand.ts:30`, `packages/cli/src/ui/containers/AppContainer/hooks/useMemoryRefreshAction.ts:53`, `packages/cli/src/ui/cliUiRuntime.ts:421,777` |
| `getJitContextEnabled()` | `packages/core/src/config/config.ts:688` - settings-service read, then `this.jitContextEnabled ?? false` | `config.ts:268,510,703,798`, `configBase.ts:73,80,87,94,101,108` (declared abstract at `configBase.ts:36`) |

`this.settingsService.get('jitContextEnabled')` is a dead read. A repository-wide
search for that settings key finds only the read itself. The user-facing setting
is `experimental.jitContext` (`packages/cli/src/config/settings-schema/schema-extensions.ts:297`),
resolved in `packages/cli/src/config/interactiveContext.ts:227-228` and threaded
through `configBuilder.ts:307` -> `ConfigParameters.jitContextEnabled` ->
`configConstructor.ts:514` (`params.jitContextEnabled ?? true`).

The `agents` public API's `settings: { jitContextEnabled: false }` escape hatch
(`agentConfig.adapter.ts:278-291`) writes into `ConfigParameters`, **not** into the
settings service, so it too resolves through the constructor field.

Because the settings read always returns `undefined`, both predicates fall through
to the same instance field and agree today. The divergence is latent.

`promptMemoryPolicy.resolvePromptMemory` selects `getGlobalMemory()` vs
`getUserMemory()` using `isJitContextEnabled()`, while `getUserMemory()`,
`getGlobalMemory()` and `getEnvironmentMemory()` all branch on
`getJitContextEnabled()`. A disagreement would send the workspace `LLXPRT.md`
hierarchy twice per request (once inside `getUserMemory()`'s
`globalMemory + environmentMemory` join, once via `getEnvironmentContext`'s
`getEnvironmentMemory()` block).

## Accepted behavior (scope)

1. Exactly one JIT-context predicate exists in `packages/core`. Every listed
   caller goes through it. The divergence becomes inexpressible.
2. The predicate resolves from one source only: the `jitContextEnabled` instance
   field assigned by the constructor. No settings-service key is read.
3. Runtime behavior is unchanged: global, environment, core and JIT-subdirectory
   memory keep landing in exactly the destinations they land in today.
4. No defensive reconciliation between accessors is added.

### Which name survives

Keep **`isJitContextEnabled()`**, defined once in `ConfigBaseCore` where the
`jitContextEnabled` field is declared. Delete `Config.getJitContextEnabled()`
and the `abstract getJitContextEnabled()` declaration on `ConfigBase`.

Reasons:
- The field lives on `ConfigBaseCore`; a concrete predicate there needs no
  abstract indirection through `ConfigBase`.
- `isJitContextEnabled` is already the name crossing package boundaries
  (`agents`, `cli`, and the `AppStateRuntime` interface in `cliUiRuntime.ts`).
- `getJitContextEnabled` is core-internal only; no docs, no external consumer.

Both fallbacks (`=== true` and `?? false`) produce `false` for `undefined`, so
collapsing onto `=== true` is behavior-preserving.

### Explicitly out of scope

- The unused `ConfigParameters.experimentalJitContext` field
  (`configTypes.ts:542`). Adjacent dead code, not named by the issue.
- Any change to how `experimental.jitContext` is read or plumbed.
- Any change to `memoryDiscovery`, `ContextManager`, or the memory destinations.

## Boundary cases the tests must cover

- `jitContextEnabled` omitted from `ConfigParameters` -> constructor defaults to
  `true` -> predicate returns `true`.
- `jitContextEnabled: true` / `jitContextEnabled: false` -> predicate mirrors it.
- A settings service carrying a `jitContextEnabled` value must NOT override the
  constructor-supplied value (proves the dead read is gone and the resolution
  order is single-sourced).
- Full request assembly with JIT on: workspace `LLXPRT.md` content appears
  exactly once.
- Full request assembly with JIT off: workspace `LLXPRT.md` content appears
  exactly once.

## Test plan (test-first, dev-docs/RULES.md)

### A. `packages/core/src/config/config.d.test.ts` - `describe('Config JIT context')`

Rewrite the three predicate tests onto `isJitContextEnabled()`:

- default (no param) -> `true`
- `jitContextEnabled: true` -> `true`; `jitContextEnabled: false` -> `false`
- **replaces** `'should respect the settings service value when available'`:
  construct a REAL `SettingsService`, `settingsService.set('jitContextEnabled', false)`,
  build a `Config` with `jitContextEnabled: true` and that settings service, and
  assert `isJitContextEnabled()` is still `true`. This is the behavioral
  statement of acceptance criterion 2 - a settings-service value cannot steer
  the predicate. No mock-call assertions.

Also assert `getJitContextEnabled` is no longer part of the `Config` surface only
if it can be done without a cast hack; otherwise rely on `typecheck` + the
compile-time removal.

### B. New behavioral test - the invariant that actually matters

File: `packages/agents/src/core/buildSystemInstruction.workspaceMemoryOnce.test.ts`

Assembles the REAL system instruction the way `ChatSessionFactory.createChatSession`
does (`ChatSessionFactory.ts:387-392`):

```
const envParts = await getEnvironmentContext(config);
const systemInstruction = await buildSystemInstruction(config, [], envParts, undefined, model);
```

Setup for both cases:
- `mkdtemp` a workspace directory; write `LLXPRT.md` containing a unique marker
  string (e.g. a randomly generated token) so nothing in the developer's real
  global memory can collide.
- Extract a shared `useTempWorkspace()` helper that registers the
  `beforeEach`/`afterEach` lifecycle once (RULES.md DRY-setup rule) rather than
  duplicating temp-dir boilerplate per describe block.

JIT ON case:
- `new Config({ cwd: tmp, targetDir: tmp, jitContextEnabled: true, ... })`
- `await initializeTestConfig(config)` (from
  `@vybestack/llxprt-code-core/test-utils/config.js`) - this constructs the REAL
  `ContextManager` and calls the REAL `refresh()`, loading the real file from disk.
- Assemble, then assert the marker occurs **exactly once** in the assembled
  system instruction.

JIT OFF case:
- Compute the eager memory the CLI would compute, using the REAL loader
  `loadServerHierarchicalMemory` from
  `@vybestack/llxprt-code-core/utils/memoryDiscovery.js` against the temp dir
  (this is what `environmentLoader.resolveMemoryContent` does when JIT is off).
- Pass the result as `ConfigParameters.userMemory` with
  `jitContextEnabled: false`.
- Assemble, then assert the marker occurs **exactly once**.

Assertion helper: count non-overlapping occurrences of the marker with an
explicit loop or `split(marker).length - 1`. Assert `=== 1`, not `>= 1`.

Anti-mock-theater notes:
- The `Config`, the `ContextManager`, the memory discovery, `getEnvironmentContext`
  and `buildSystemInstruction` are all REAL. Only the agent-client/tool-scheduler
  factories are test doubles, supplied by the existing `initializeTestConfig`
  helper; they are infrastructure unrelated to memory assembly.
- The marker literal appears on the INPUT side (written to disk) and the
  assertion is a derived count, not an echo of a stub's configured return value.
- Litmus: if the predicate divergence were reintroduced and the two predicates
  disagreed, the JIT-on case would emit the workspace hierarchy twice and the
  count assertion would fail.

### C. Existing tests that must keep passing unchanged

`packages/agents/src/core/promptMemoryPolicy.test.ts`,
`ChatSessionFactory.byteCompatibility.test.ts`,
`subagentRuntimeSetup.assembler.test.ts`,
`packages/cli/src/ui/commands/memoryCommand.test.ts`,
`useMemoryRefreshAction.test.ts` all already stub `isJitContextEnabled` - the
surviving name - so they need no edits. This is a positive signal for the naming
choice.

## Implementation

Only after the tests above are red.

1. `packages/core/src/config/configBaseCore.ts` - keep
   `isJitContextEnabled()`; add a short doc comment recording that it is the
   single JIT-context predicate and resolves only from the constructor-assigned
   field.
2. `packages/core/src/config/configBase.ts` - delete
   `abstract getJitContextEnabled(): boolean;` (line 36); rewrite the six
   `this.getJitContextEnabled()` call sites to `this.isJitContextEnabled()`.
3. `packages/core/src/config/config.ts` - delete `getJitContextEnabled()`
   (lines 688-695); rewrite `this.getJitContextEnabled()` at lines 268, 510, 703
   and 798 to `this.isJitContextEnabled()`. Confirm `this.settingsService` is
   still referenced elsewhere in the file (it is) so no unused-member lint fires.
4. `packages/core/src/config/config.d.test.ts` - as described in A.

No production changes outside `packages/core/src/config`.

## Test-harness note

`buildSystemInstruction.workspaceMemoryOnce.test.ts` initializes the prompt
system against its own `LLXPRT_PROMPTS_DIR`, the same pattern
`ChatSessionFactory.byteCompatibility.test.ts` uses. The prompt registry is a
process global, so running those two files in one `bun test` invocation makes
whichever `afterAll` runs first pull the directory out from under the other
("Core prompt not found"). `scripts/run_bun_tests.ts` executes each file in its
own process, so this does not affect `npm run test` or CI. Forcing
re-initialization per file would be defensive plumbing around a shared global
and is not done here.

## Deferred follow-up (out of scope for #3135)

Review raised one LOW finding that is deliberately not addressed here. The
agents public API's UNSTABLE `settings` escape hatch
(`packages/agents/src/api/agentConfig.adapter.ts` applySettings) accepts
`unknown` values and copies them straight into `ConfigParameters`. A caller can
therefore supply a truthy non-boolean such as `settings: { jitContextEnabled:
'true' }`. The old `getJitContextEnabled()` treated that as `true` while
`isJitContextEnabled()` returns `false`, so the collapse is not identical for
values outside the declared `boolean | undefined` contract.

No supported configuration produces such a value, and the pre-change behavior
was already self-inconsistent (the two predicates disagreed on it). Making the
escape hatch validate against `ConfigParameters` types is a separate concern
and would be scope expansion here.

## Verification

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
bun scripts/test-audit/scan.ts tmp/scan-branch
```

## Acceptance criteria mapping

| Issue criterion | Evidence |
| --- | --- |
| Exactly one predicate; all callers use it | `getJitContextEnabled` absent from the tree; `typecheck` green |
| No settings key read without a write | settings-service read deleted; test A case 3 |
| Workspace memory exactly once, JIT on and off | test B |
| Memory destinations unchanged | `promptMemoryPolicy.test.ts` + `ChatSessionFactory.byteCompatibility.test.ts` unchanged and green |
| No defensive reconciliation | one predicate, one resolution source |
