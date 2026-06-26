# Build regressions introduced by the dependency bumps (and their fixes)

Some of the security bumps raised packages that ship their own TypeScript types
or stricter runtime contracts. Those changes surfaced compile/lint breakage on
this branch. To be certain these were **caused by the bumps** and not
pre-existing, a pristine `origin/main` worktree was built from scratch
(`npm ci && npm run build`) and type-checked: it produced **0 errors**.
Therefore every error below is attributable to this PR's bumps and is fixed
here.

> Method note: a baseline typecheck is only meaningful **after** `npm run build`,
> because sibling workspace packages must have fresh `dist/` output; an unbuilt
> baseline reports spurious "Cannot find module" errors.

## 1. OTEL `0.203 -> 0.219` added required `forceFlush()` to `LogRecordExporter`

**File:** `packages/telemetry/src/telemetry/file-exporters.ts`

`@opentelemetry/sdk-logs` `0.219` added a **required** `forceFlush(): Promise<void>`
member to the `LogRecordExporter` interface (it had only `export` + `shutdown`
in `0.203`). Our base `FileExporter` class did not implement it, so the file
log-exporter no longer satisfied the interface.

Fix: add a no-op `forceFlush()` to the base class (file writes are synchronous,
so there is nothing buffered to flush):

    forceFlush(): Promise<void> {
      return Promise.resolve();
    }

`FileMetricExporter` already had a `forceFlush` (the metrics
`PushMetricExporter` contract required it before); it was changed to
`override forceFlush()` to satisfy TS4114 now that the base class declares one.
`SpanExporter.forceFlush` remains optional and needed no change.

## 2. `@types/express-serve-static-core 5.0.7 -> 5.1.1` typed `req.params` value as `string | string[]`

**File:** `packages/a2a-server/src/http/app.ts` (~L401)

The newer express type definitions widened route-param values from `string` to
`string | string[]`. The handler used `req.params.taskId` directly as a
`string`, which no longer type-checks.

Fix: normalize to a single string at the boundary:

    const taskIdParam = req.params.taskId;
    const taskId = Array.isArray(taskIdParam) ? taskIdParam[0] : taskIdParam;

This is the only `req.params` access in the file and feeds both former
error lines.

## 3. `typescript-eslint` bump made two assertions detectably unnecessary

**Files:**
- `packages/vscode-ide-companion/src/extension.test.ts` (~L130)
- `packages/vscode-ide-companion/src/open-files-manager.test.ts` (~L101)

The bump improved `no-unnecessary-type-assertion` detection and flagged two test
casts as redundant:

- `mockResolvedValue(undefined as never)` -> `mockResolvedValue(undefined)`
- `... as unknown as vscode.Uri` -> a typed helper
  `const getUri = (path: string) => vscode.Uri.file(path);`

The pristine baseline's `vscode-ide-companion` lint passes, confirming these two
were introduced by the bump.

## 4. `ajv`/`fdir` hoisting broke 6 hardcoded `vitest.config.ts` alias paths

**Files:** `packages/{a2a-server,core,cli,agents,providers,vscode-ide-companion}/vitest.config.ts`

The security bumps caused `ajv` to be **hoisted** to a top-level `ajv@8.20.0`,
which removed the `node_modules/ajv-formats/node_modules/ajv/...` copy that six
vitest configs referenced by hardcoded relative path (and `fdir` moved out of
`node_modules/vite/node_modules/fdir/...` likewise). `ajv@8.20.0` additionally
ships **no `exports` map**, so a bare `ajv/dist/2020.js` deep import is not
guaranteed to resolve the same way across layouts.

Fix: resolve these paths in a **hoisting-independent** way with `createRequire`
instead of assuming a fixed `node_modules` layout:

    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    // ajv deep files:
    require.resolve('ajv/dist/2020.js');
    require.resolve('ajv/dist/ajv.js');
    // fdir entry:
    resolve(dirname(require.resolve('fdir/package.json')), 'dist/index.mjs');

This resolves correctly whether the package is nested or hoisted, so the configs
no longer break when the dependency tree is re-floated.

## 5. (withdrawn) T5p test change — superseded by main's #2120

**File:** `packages/agents/src/api/__tests__/switch-context.spec.ts` — **no
change on this branch** (identical to `main`).

For the record: an earlier revision of this branch added a branch-local
`SettingsService` guard that *threw* on `__proto__`/`constructor`/`prototype`
setting keys, which conflicted with this file's T5p property test (it feeds
arbitrary model-param keys and asserts round-trip). That generator was
temporarily narrowed to benign names.

When `main` advanced, PR #2149 / issue #2120 landed a reviewed
prototype-pollution hardening that **deliberately allows** dangerous keys as
safe **own properties on a null-prototype provider record** (rejecting them only
as dotted *path* segments). That makes the T5p round-trip valid again, so the
branch-local guard and the test edit were both dropped during the rebase. The
file now matches `main` verbatim and the test passes unchanged (11/11). See
`codescanning-prototype-pollution.md`.

## 6. Lockfile regeneration dropped nested-`execa` hoisted deps (cli test collapse)

**File:** `package-lock.json` (subtree under `packages/cli`)

Regenerating the lockfile to apply the security overrides dropped the top-level
`merge-stream@2.0.0`, `is64bit@2.0.0`, and `system-architecture` nodes. These
are required (through hoisting) by `packages/cli/node_modules/execa@8.0.1`,
which is pulled in by `clipboardy@4.0.0` and carries no own `node_modules`.
The result was 49 cli test files failing at collection with
`Cannot find package 'merge-stream' imported from .../execa/lib/stream.js`.

This is a **lockfile-completeness** regression, not a code or consumer change:
`clipboardy@4` + nested `execa@8` are byte-identical to `origin/main`; only the
hoisted transitive nodes went missing during re-resolution. A plain
`npm install` made it worse (it actively removed the node and refused to re-add
it).

Fix: free the incomplete `packages/cli/node_modules/{clipboardy,execa}` nodes
and re-resolve just that subtree (`npm install --package-lock-only`), which
restored all three hoisted nodes. Verified by:

- a lockfile completeness scan → **0** declared deps without a resolvable node;
- a clean `npm ci` (strict lockfile materialization) → exit 0;
- `npm run test --workspace=packages/cli` → **398 files / 4742 tests pass**.

## Non-regression that looked like one

`ChatSessionFactory.ts` briefly reported a `resetTokenAccounting` error against
`HistoryService`. This was **stale `dist/`** only — the method exists at
`HistoryService.ts:265`. A full `npm run build` cleared it; no source change was
needed.
