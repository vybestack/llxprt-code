# Pseudocode: Agents API-Surface Guard (declaration-aware)

Plan ID: PLAN-20260629-ISSUE2285
Component: agents public API-surface guard script/test

## Interface Contracts

```
INPUT: freshly emitted index.d.ts (built via isolated temp tsconfig — revision 3 finding 1)
INPUT: packages/agents/src/api/__tests__/expected-root-surface.json (checked-in snapshot)
OUTPUT: pass/fail + diff
```

## Numbered pseudocode

```
10: METHOD runApiSurfaceGuard()
20:   // PREFLIGHT-CONFIRMED mechanism: B1a (rootDir = repo root) — see
30:   // preflight-results.md §7 and api-guard-mechanism.md "Preflight-confirmed
40:   // mechanism: B1a". B1 (rootDir = packages/agents) FAILS with TS6059 once
50:   // TS2688 ambient-type noise is cleared; B1a (rootDir = repo root) avoids
60:   // it because all dependency SOURCE is within rootDir.
70:   // Build via an ISOLATED TEMP TSCONFIG extending the SOURCE-path
80:   // packages/agents/tsconfig.json (NOT tsconfig.build.json which maps deps
90:   // to ../core/dist/index.d.ts), overriding outDir, tsBuildInfoFile
100:  // (finding 20), rootDir (REPO ROOT, NOT packages/agents), types,
110:  // typeRoots, skipLibCheck, declaration.
120:  //   - mktemp -d a temp dir
130:  //   - writes tsconfig.api-surface.json extending the SOURCE-path
140:  //     packages/agents/tsconfig.json, with rootDir = repo root,
150:  //     types: ['node'], typeRoots: [<repo-root>/node_modules/@types],
160:  //     skipLibCheck: true, outDir = tempDir, tsBuildInfoFile = temp path
170:  //   - runs `tsc -p <temp-tsconfig>` directly (NOT build_package.js)
180:  //   - tsc MAY exit nonzero (test-file type errors + one WASM import do
190:  //     NOT affect root-barrel declaration emission); the guard checks
200:  //     declaration PRESENCE, not tsc exit code
210:  //   - reads <tempDir>/packages/agents/index.d.ts (NESTED — rootDir = repo
220:  //     root shifts output layout; NOT <tempDir>/index.d.ts which is B1)
230:  //   - resolves the real barrel at <tempDir>/packages/agents/src/index.d.ts
240:  //   - trap-removes the temp dir on exit
250:  tempDir = mktemp()
260:  repoRoot = gitRevParseShowToplevel()  // or process.cwd() at repo root
270:  writeTempTsconfig(tempDir,
280:    extends=SOURCE-PATH packages/agents/tsconfig.json,
290:    rootDir=repoRoot,                    // B1a: repo root, NOT packages/agents
300:    types=['node'],
310:    typeRoots=[repoRoot + '/node_modules/@types'],
320:    skipLibCheck=true,
330:    outDir=tempDir,
340:    tsBuildInfoFile=tempDir + '/info.tsbuildinfo')
350:  // tsc exit code is IGNORED — declaration presence is the contract
360:  run('tsc -p ' + tempDir + '/tsconfig.api-surface.json', allowNonZero=true)
370:  // B1a NESTED path (rootDir = repo root):
380:  rootDeclPath = tempDir + '/packages/agents/index.d.ts'
390:  barrelDeclPath = tempDir + '/packages/agents/src/index.d.ts'
400:  test -f rootDeclPath || FAIL("agents index.d.ts not emitted — build failed")
410:  declarationText = read(barrelDeclPath)
420:  exportedNames = parseExportedNames(declarationText)
430:  // parseExportedNames (revision 3 finding 2) lives in apiSurfaceParser.mjs
440:  // (plain ESM .mjs using the TS compiler API via createRequire('typescript')),
450:  // NOT a .ts helper, so standalone node scripts and the Vitest test can both
460:  // import it without a TS loader.
470:  //   - export { X } / export { X as Y } (value exports)
480:  //   - export type { X } (type-only exports)
490:  //   - export * from '...' RESOLVED names (recursively, from declarations)
500:  //     — revision 6 finding 3: normalize .js specifiers to .d.ts when
510:  //     traversing re-export declarations (the package root uses
520:  //     `export * from './src/index.js'`, so the emitted declaration
530:  //     references './src/index.d.ts')
540:  //   - export interface X / export class X / export function X
550:  //   - export const/let/var X
560:  expectedNames = read expected-root-surface.json
570:  // DENY assertions (independent of snapshot)
580:  DENY_SET = { 'AgentClient', 'CoreToolScheduler', 'AgenticLoop' }
590:  FOR name IN exportedNames:
600:    IF name IN DENY_SET:
610:      FAIL("internal name '" + name + "' leaked into root declaration surface")
620:  // Snapshot comparison (fail closed on unknown additions)
630:  added = exportedNames - expectedNames
640:  removed = expectedNames - exportedNames
650:  IF added is not empty:
660:    FAIL("unexpected new root exports: " + added + " — update expected-root-surface.json intentionally")
670:  IF removed is not empty:
680:    FAIL("previously-exported root names missing: " + removed + " — update expected-root-surface.json intentionally")
690:  // Emit a JSON report the Vitest test can read (revision 4 finding 2)
700:  // Revision 4 finding 2: write to ALREADY-GITIGNORED path, NOT to
710:  // packages/agents/src/api/__tests__/ (which would dirty the worktree).
720:  write('node_modules/.cache/agents-api-surface/report.json', exportedNames)
730:  PASS
740: ENDMETHOD
```

## Integration points

- Lines 20-240: build ordering + isolation guarantee (B1a —
  PREFLIGHT-CONFIRMED). The guard script builds declarations into a temp dir
  via a temp tsconfig (direct `tsc -p`) extending the SOURCE-path
  `tsconfig.json` with `rootDir` = repo root, never mutating shared `dist/` or
  the shared `node_modules/.cache/tsbuildinfo/agents.tsbuildinfo`
  (finding 20). The source-path tsconfig resolves dependencies to SOURCE
  (`../core/index.ts`), not `dist/`, so the guard does NOT require dependency
  `dist/` to exist — it works in the clean-CI lint job (which runs BEFORE
  `npm run build`). B1 (rootDir = packages/agents) was REJECTED by preflight
  (TS6059). B2 (fresh shared dist) was NOT chosen because B1a works; if B1a
  had failed, B2 would read `packages/agents/dist/index.d.ts` post-build,
  acknowledging the shared-dist side effect and requiring post-build ordering.
- Line 580: DENY_SET is the hard contract. Even if the snapshot is updated,
  these names must NEVER appear.
- Lines 630/650: snapshot update is a reviewable diff against
  `expected-root-surface.json`, committed intentionally.
- Line 720: the JSON report (revision 4 finding 2) is written to the
  already-gitignored path `node_modules/.cache/agents-api-surface/report.json`
  (NOT `packages/agents/src/api/__tests__/` which would dirty the worktree).
  This decouples the fail-closed script (which builds) from the Vitest test
  (which must NOT build — finding 3).

## Wiring (revision 4 findings 1, 3, 12 — standalone script, CI-enforced)

```
500: // The guard runs as a STANDALONE npm script, NOT inside the Vitest
510: // lifecycle (no globalSetup, no beforeAll shell-out). globalSetup is part
520: // of the Vitest run lifecycle and the plan forbids builds there.
530: // package.json gains:
540: //   "lint:agents-api-surface": "node scripts/check-agents-api-surface.mjs"
550: // Revision 4 finding 1: CI wiring — .github/workflows/ci.yml lint_javascript
552: //   job gains a new step (near lint:cli-boundary):
554: //       - name: 'Run agents API-surface guard'
556: //         run: npm run lint:agents-api-surface
560: // Revision 4 finding 12: CI test job — .github/workflows/ci.yml test job
562: //   gains a step BEFORE 'Run tests' to generate the report:
564: //       - name: 'Generate API-surface report'
566: //         run: npm run lint:agents-api-surface
568: //   The test job already runs `npm run build` before `npm run test`, so
569: //   the guard's source-path tsconfig resolution succeeds.
570: // The Vitest guard test reads node_modules/.cache/agents-api-surface/report.json
572: // (revision 4 finding 2); in CI (CI=true) it FAILS if absent (revision 4
574: // finding 12), and allows local skips only under LLXPRT_API_SURFACE_SKIP=1.
```

## Anti-pattern warnings

```
[ERROR] DO NOT: use Object.keys(root) at runtime — misses type-only exports
[OK] DO: parse freshly emitted index.d.ts for both value and type exports

[ERROR] DO NOT: auto-regenerate the snapshot in CI — that re-blesses leaks
[OK] DO: compare-only in CI; regeneration is a separate explicit developer step

[ERROR] DO NOT: read stale dist — type-only leaks could hide
[OK] DO: guarantee fresh build (temp tsconfig or fresh shared dist) before reading

[ERROR] DO NOT (revision 3 finding 1): pass an outDir override to
         scripts/build_package.js — it has no such path
[OK] DO: build via a temp tsconfig with `tsc -p` directly, or accept fresh
         shared dist and record the side-effect tradeoff

[ERROR] DO NOT (revision 3 finding 2): author the parser as a .ts test helper
         that standalone node scripts must import
[OK] DO: author it as apiSurfaceParser.mjs (plain ESM) importable by both node
         and Vitest

[ERROR] DO NOT (revision 3 finding 3): wire the build into Vitest globalSetup
         (it runs inside the test lifecycle)
[OK] DO: use a standalone npm script (lint:agents-api-surface)
```
