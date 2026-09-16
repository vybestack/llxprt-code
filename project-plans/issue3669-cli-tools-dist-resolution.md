# Issue #3669 — CLI tests fail loading canonicalizePolicyToolEntry from tools dist/index.d.ts

## Summary

`bun test` inside `packages/cli` (and any test that spawns the CLI, such as
`packages/test-utils/src/test-rig.test.ts`) dies at import time whenever
`packages/tools/dist` exists in a stale or declaration-only state:

```
SyntaxError: Export named 'canonicalizePolicyToolEntry' not found in module
'packages/tools/dist/index.d.ts'.
```

The cause is reproduced and isolated: `packages/cli/tsconfig.json` maps
`@vybestack/llxprt-code-tools` at `../tools/dist/index.d.ts`, and Bun applies
tsconfig `paths` at **runtime**, so that mapping shadows the tools package's
`bun` export condition (which points at TypeScript source) whenever the mapped
file exists. A stale or partial `dist` therefore becomes the code the CLI
executes. The fix removes the two tools entries from the CLI dev tsconfig's `paths`
entirely, so runtime resolution falls through to the tools package exports
`bun` condition (TypeScript source) — the repository's documented default for
Bun — regardless of dist state.

### Why not repoint the mappings at source

Repointing `@vybestack/llxprt-code-tools` to `../tools/index.ts` inside
`packages/cli/tsconfig.json` was implemented and verified at runtime (all four
dist states pass, guard red→green), but it breaks `tsc --noEmit` for the CLI
with 36 dist-vs-src type-identity errors (log:
`tmp/verify3669/typecheck-cli-pristine.log`). A `--traceResolution` run
(`tmp/verify3669/trace.log`) shows why — TypeScript resolves imports from the
project-referenced `core` package using core's own build config:

```
Resolving module '@vybestack/llxprt-code-tools' from 'packages/core/src/index.ts'.
Using compiler options of project reference redirect 'packages/core/tsconfig.build.json'.
→ resolved to 'packages/tools/dist/index.d.ts'
```

`packages/core/tsconfig.build.json` carries no tools mapping of its own (its
inherited `paths` cover other packages), so the CLI program's core redirect
resolves tools through the package exports `types` condition —
`packages/tools/dist/index.d.ts`. Mapping tools at source in the CLI tsconfig
therefore creates two ToolRegistry/DeclarativeTool identities in one program —
exactly the "dist-vs-src type identity conflict" #2735 documented when it chose
the dist mapping. Making the identities consistent from the CLI side means
redesigning the reference/build graph, which belongs to #2618 Phase B / #3536,
not this issue.

### Why deleting the mappings is safe and complete

- Runtime: CLI files then resolve tools through
  `node_modules/@vybestack/llxprt-code-tools` (workspace symlink) → exports map
  `bun` condition → `index.ts` / `src/acquisition/index.ts`. The CLI uses only
  two specifiers — the bare root (12 sites) and `acquisition.js` (4 sites) —
  and both are declared in the exports map with `bun` conditions (added by
  #2735). Stale/partial/absent dist can no longer affect runtime resolution.
- Typecheck: with no `paths` entry, `tsc` resolves tools through the same
  node_modules package → exports `types` condition → `dist/index.d.ts` — the
  byte-identical file the mapping hardcoded. The type graph (including the
  core project-reference redirect, also dist) is unchanged from main, so the
  36-error identity clash cannot occur. This is also exactly how
  `packages/a2a-server` (no tools mapping) behaves today.
- `typescript-eslint` resolves through `tsconfig.json` (per the #3387 note in
  `tsconfig.noemit.json`): it lands on the same `dist/index.d.ts` as before.

## Root cause (reproduced on branch issue3669, Bun 1.3.14, macOS)

Resolution chain: `bun test` in `packages/cli` → CLI source imports
`@vybestack/llxprt-code-tools` → Bun finds the nearest tsconfig
(`packages/cli/tsconfig.json`) and applies `paths` at runtime → mapping hits
`../tools/dist/index.d.ts` whenever that file exists (paths win over the
package exports `bun` condition). `dist/index.d.ts` is a one-line re-export,
`export * from './src/index.js'`, so runtime execution continues into the
compiled `dist/src/**/*.js`.

Dist-state matrix, focused command
`cd packages/cli && bun test src/config/cliArgParser.noPause.test.ts`
(logs in `tmp/verify3669/`):

| `packages/tools/dist` state | Result | Mechanism |
|---|---|---|
| full fresh build | 4/4 pass | `.d.ts` re-export lands on fresh dist JS |
| declaration-only (what `npm run build:types` emits) | FAIL: `Cannot find module './src/index.js' from .../tools/dist/index.d.ts` | paths hit loads the `.d.ts`; its re-export target JS does not exist |
| stale full build (JS predates a newly added export) | FAIL: `Export named 'canonicalizePolicyToolEntry' not found in module .../tools/dist/index.d.ts` — the issue's exact error | paths hit loads old JS missing the new export |
| absent | 4/4 pass | paths miss → node_modules → exports map `bun` condition → source |

This is the same hazard class the CI workflow already documents for
core→mcp (`.github/workflows/ci.yml`, "Either a complete `dist` or no `dist`
at all works; a partial one does not"). The #3294 failure is consistent with
that checkout's working tree carrying a tools `dist` older than the
`canonicalizePolicyToolEntry` export: the reproduction above produces the
byte-identical error from such a dist, and the issue's follow-up reports the
same test passing after a full build with no source change. The original
artifact state was not captured, so this is a reproduced explanation, not a
recorded observation of that checkout.

`packages/test-utils` fails through the same root cause: TestRig spawns Bun
directly on `packages/cli/index.ts` (`packages/test-utils/src/test-rig.ts`), so
the spawned process resolves tools through the CLI's tsconfig mapping too.

### Post-fix verification notes (stale-cache red herrings)

Two apparent regressions surfaced while verifying the deletion and both were
working-tree artifacts, not fix defects (logs in `tmp/verify3669/`):

- One residual `TS2322` identity error (`r2-typecheck.log`) came from
  `node_modules/.cache/tsbuildinfo/cli.tsbuildinfo` retaining a tools/src
  module from the earlier source-mapping experiment;
  `--traceResolution` on that run shows zero tools/src resolutions. Deleting
  the tsbuildinfo removed it. Dev note: when switching this tsconfig between
  resolution configurations, clear that file once.
- `TS2307 Cannot find module
  '@vybestack/llxprt-code-tools/utils/toolOutputMaxTokens.js'` came from the
  local tools dist predating that module (present in tools source and the
  exports map). `core/tsconfig.build.json` has no tools mapping of its own,
  so the CLI program's core redirect resolves tools through the exports map
  `types` condition on main as well — CLI typecheck already required a
  complete tools dist before this change. A tools rebuild fixed it
  (`r3-tools-build.log`), and with fresh dist + clean cache
  `cd packages/cli && npm run typecheck` passes with zero errors
  (`r3-typecheck-final.log`, incremental rerun also green).

Why the mapping exists: commit d86e88eb3 (#2735) added tools mappings to the
dev tsconfigs of agents, providers, cli, and a2a-server when introducing deep
subpath imports. Agents and providers got source mappings
(`../tools/index.ts`, `../tools/src/*`); only CLI got the dist variant. The
dist choice is load-bearing for type identity (see below), but hardcoding it
into the dev/test tsconfig also forces Bun's runtime through it. Build
configs (`tsconfig.build.json`) map dependencies at dist deliberately and are
out of scope.

## Acceptance criteria

### AC1 — Dist-state immunity for the focused CLI test (behavioral)

- GIVEN `packages/tools/dist` in any of the four states above (fresh,
  declaration-only, stale, absent)
- WHEN `cd packages/cli && bun test src/config/cliArgParser.noPause.test.ts`
- THEN the run reaches its assertions and passes 4/4 in every state.
  Before the fix, declaration-only and stale states fail at import time.

### AC2 — TestRig-spawned CLI starts (behavioral)

- GIVEN the fixed mapping and a stale/declaration-only tools dist
- WHEN `cd packages/test-utils && bun test src/test-rig.test.ts` (the suite
  containing the overlapping-run test from the issue)
- THEN the spawned CLI process imports tools successfully and the suite passes.

### AC3 — Regression guard (test)

A new Bun test in `packages/cli` (discovered by `run-bun-tests.ts`) that:

1. imports `canonicalizePolicyToolEntry` from the bare barrel and a value from
   the deep subpath `@vybestack/llxprt-code-tools/acquisition.js`, asserting
   the imports reach executable code (fail under the stale-dist mapping);
2. asserts `import.meta.resolve('@vybestack/llxprt-code-tools')` does not
   resolve inside `packages/tools/dist` and names the tools source entry
   (tolerating the `node_modules` workspace-symlink path form);
3. reads `packages/cli/tsconfig.json` and asserts no `compilerOptions.paths`
   target points into another package's `dist/` — the deterministic invariant
   that Bun applies these mappings at runtime, so dev/test mappings must not
   bind workspace dependencies to build output. This leg catches
   re-introduction even on a clean checkout where no dist exists.

### AC4 — No typecheck/build regression

- `cd packages/cli && npm run typecheck` (`tsconfig.noemit.json` +
  `tsconfig.test-bun.json`) passes: with the mappings deleted, `tsc` resolves
  tools through node_modules to the same `dist/index.d.ts` the mapping
  hardcoded, so the program's type graph is identical to main's.
- `npm run build` at the repository root still produces a correct CLI build
  (`tsconfig.build.json` defines its own `paths` and does not map tools; the
  build resolves tools through the exports map `types` condition — unchanged).

### AC5 — Full verification cycle

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build` all pass, and the smoke test
`bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`
boots the CLI from source and completes (the smoke test itself exercises the
spawned-CLI resolution path at issue).

## Implementation tasks

1. `packages/cli/tsconfig.json` — delete both
   `"@vybestack/llxprt-code-tools": ["../tools/dist/index.d.ts"]` and
   `"@vybestack/llxprt-code-tools/*": ["../tools/dist/src/*"]` from
   `compilerOptions.paths`. No other tsconfig is touched.
2. `packages/cli/test-bun/toolsResolution.issue3669.bun.ts` — the AC3 guard
   test (TS/Bun, following the typescript-test-writing skill; no mocks).
3. If and only if a doc explicitly documents the old CLI tools dist mapping,
   update that sentence; otherwise no doc changes.

## Out of scope (explicitly)

- Repointing the other dist mappings (`tsconfig.build.json` files,
  a2a-server's storage mapping, core→mcp): owned by #2618 Phase B and
  related efforts; CI's agents/scripts full-build legs are unaffected by this
  fix and stay as-is.
- Any change to `packages/tools` exports, the tools package manifest, CI
  workflows, or guard builds (#3104).
- Typecheck-ordering work (#3536).

## Verification commands

```bash
# dist-state matrix (focused)
cd packages/cli && bun test src/config/cliArgParser.noPause.test.ts   # fresh dist
# …repeat after simulating declaration-only and stale dist, and with dist absent…

# regression guard + rig
cd packages/cli && bun test ./test-bun/toolsResolution.issue3669.bun.ts
cd packages/test-utils && bun test src/test-rig.test.ts

# typecheck + full cycle
cd packages/cli && npm run typecheck
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"
```

Simulating dist states must restore the pristine `dist` afterward (full
`npm run build` in the final cycle regenerates it).
