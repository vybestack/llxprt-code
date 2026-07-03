# Phase 03a: API-Surface Guard TDD Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P03a`

## Prerequisites
- Required: Phase 03 completed.
- Verification: `test -f project-plans/issue2285/.completed/P03.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **Parser helper exists and is functional (revision 3 finding 2)**:
   `apiSurfaceParser.mjs` (plain ESM, NOT `.ts`) exports
   `parseExportedNames`, `DENIED_INTERNAL_NAMES`, `loadExpectedSurface`.
2. **Declaration-aware with export-star resolution**: `parseExportedNames`
   reads `.d.ts` and recursively resolves `export *` re-exports (NOT a flat
   regex over `index.d.ts`). Verify by reading the source — it must follow
   export-star declarations or use the TypeScript compiler API.
3. **DENY set includes all three**: `AgentClient`, `CoreToolScheduler`,
   `AgenticLoop`.
4. **Type-only deny case**: a test proving a type-only export of a denied name
   is resolved by the parser (declaration-awareness + export-star resolution).
5. **Build-order guarantee via STANDALONE SCRIPT (revision 3 finding 3)**: the
   guard uses the standalone `lint:agents-api-surface` npm script
   (`scripts/check-agents-api-surface.mjs`). It is NOT wired into Vitest
   `globalSetup` (globalSetup runs inside the test lifecycle → forbidden for
   builds) and NOT into a per-test `beforeAll`. The Vitest test reads the JSON
   surface report; if absent it FAILS CLOSED (revision 5 finding 2: the test
   never silently skips — fails in CI, fails locally unless
   `LLXPRT_API_SURFACE_SKIP=1`). **Constraints (findings 1, 8, 20)**:
   (a) the script builds via an isolated temp tsconfig + direct `tsc -p`
   (B1/B1a/B1b) OR records fallback B2 (fresh shared dist) in the decision
   record (revision 5 finding 3: rootDir fallback proven in P01 preflight);
   (b) writes ONLY to a temp/isolated dir (removed on exit) and the gitignored
   JSON report; (c) the snapshot is READ; (d) fresh declaration contract
   enforced; (e) tsbuildinfo isolated to temp path (B1).
6. **GREEN characterization confirmed**: the test is GREEN against the current
   leaky root because it asserts the guard DETECTS the current leak (not a
   committed RED test). No phase leaves CI red.
7. **Export-star leak proof**: the JSON surface report shows
   `AgentClient`, `CoreToolScheduler`, and concrete `AgenticLoop` are resolved
   through the `export * from './internals.js'` chain.
8. **Snapshot path resolution proven**: the test's `beforeAll` asserts the
   report/snapshot is readable. Brittleness mitigated (architect finding 3).
9. **No mock theater**: no `toHaveBeenCalled`, no `NotYetImplemented`
   expectations.
10. **No deferred implementation language (scoped to phase-owned files — finding 4)**.
11. **TDD sequencing evidence (architect review finding 8)**: the P03 completion
    marker records that the contract test was established BEFORE the parser
    implementation (failing proof that would fail if export-star/type-only leak
    detection were absent), followed by the GREEN characterization proof. The
    completion marker contains both the failing-proof evidence and the GREEN
    result. This establishes the test/contract before implementation per
    `dev-docs/RULES.md`.

## Verification Commands

```bash
# Files exist (revision 3 finding 2 — .mjs parser)
test -f packages/agents/src/api/__tests__/apiSurfaceParser.mjs
test -f packages/agents/src/api/__tests__/publicSurface.guard.test.ts
test -f packages/agents/src/api/__tests__/expected-root-surface.json
test -f scripts/check-agents-api-surface.mjs

# Declaration-aware with export-star resolution (NOT flat regex only) — fail-closed
test "$(grep -c 'index.d.ts\|\.d\.ts' packages/agents/src/api/__tests__/apiSurfaceParser.mjs)" -ge 1 || { echo "FAIL: parser does not read .d.ts"; exit 1; }
test "$(grep -c 'export \*\|exportStar\|resolveExport\|ts\.\|createProgram\|getPreEmitFileEmitOutput' packages/agents/src/api/__tests__/apiSurfaceParser.mjs)" -ge 1 || { echo "FAIL: no export-star resolution"; exit 1; }
# Revision 6 architect finding 3: .js-to-.d.ts specifier normalization present
# (the real package root uses export * from './src/index.js'; the parser must
# normalize .js specifiers to .d.ts when traversing re-export declarations).
test "$(grep -c "\.d\.ts\|replace.*\.js\|specifier.*normaliz\|resolveDecl" packages/agents/src/api/__tests__/apiSurfaceParser.mjs)" -ge 1 || { echo "FAIL: no .js-to-.d.ts specifier normalization in parser (revision 6 finding 3)"; exit 1; }

# DENY assertions present (fail-closed — all three names must appear)
grep -rq "AgentClient" packages/agents/src/api/__tests__/apiSurfaceParser.mjs packages/agents/src/api/__tests__/publicSurface.guard.test.ts || { echo "FAIL: AgentClient deny missing"; exit 1; }
grep -rq "CoreToolScheduler" packages/agents/src/api/__tests__/apiSurfaceParser.mjs packages/agents/src/api/__tests__/publicSurface.guard.test.ts || { echo "FAIL: CoreToolScheduler deny missing"; exit 1; }
grep -rq "AgenticLoop" packages/agents/src/api/__tests__/apiSurfaceParser.mjs packages/agents/src/api/__tests__/publicSurface.guard.test.ts || { echo "FAIL: AgenticLoop deny missing"; exit 1; }

# Build-order guarantee via STANDALONE script (revision 3 finding 3 — config/script proof, finding 17)
test -f scripts/check-agents-api-surface.mjs
node -e "const p=require('./package.json'); if(!(p.scripts&&p.scripts['lint:agents-api-surface'])) { console.error('FAIL: lint:agents-api-surface not in package.json'); process.exit(1); }"
# Revision 4 architect findings 1, 8: verify CI workflow enforcement (NOT just package.json).
# Revision 6 architect finding 7 + architect review finding 3: CI job placement
# is mechanism-conditional AND must be JOB-SCOPED (not a loose "appears
# anywhere in ci.yml" grep). The prior revision grepped for
# lint:agents-api-surface anywhere in ci.yml and echoed OK for both paths —
# that passes even if the step is in the wrong job or duplicated incorrectly.
# The checks below extract the job context around each occurrence and verify
# the EXACT job placement required by each mechanism.
grep -q "lint:agents-api-surface" .github/workflows/ci.yml || { echo "FAIL: lint:agents-api-surface NOT in .github/workflows/ci.yml (architect finding 1)"; exit 1; }
GUARD_MECHANISM="$(grep -E '^mechanism:' project-plans/issue2285/analysis/api-guard-mechanism.md 2>/dev/null | head -1 | sed 's/^mechanism:[[:space:]]*//' || echo 'B1')"
echo "Recorded API guard mechanism: $GUARD_MECHANISM"
# Architect review finding 3: job-scoped CI placement verification.
# Extract the lines BEFORE each lint:agents-api-surface occurrence to find the
# enclosing job name (the nearest preceding "  JOB_NAME:" at 2-space indent).
CI_FILE=".github/workflows/ci.yml"
# Find all line numbers with the guard step
GUARD_LINES="$(grep -n 'lint:agents-api-surface' "$CI_FILE" | cut -d: -f1)"
if [ -z "$GUARD_LINES" ]; then
  echo "FAIL: no lint:agents-api-surface step found in ci.yml"; exit 1
fi
# For each occurrence, find the enclosing job by scanning backwards for a job header
JOBS_FOUND=""
for LINE in $GUARD_LINES; do
  JOB="$(awk -v target="$LINE" 'NR<=target && /^  [a-zA-Z_]+:/ { job=$0 } NR==target { gsub(/[^a-zA-Z_].*/,"",job); print job }' "$CI_FILE" | tail -1)"
  JOBS_FOUND="$JOBS_FOUND $JOB"
done
echo "Guard step found in jobs:$JOBS_FOUND"
if echo "$GUARD_MECHANISM" | grep -q '^B2'; then
  # B2: guard must be ONLY in the test job (post-build), NOT in lint_javascript
  for JOB in $JOBS_FOUND; do
    if echo "$JOB" | grep -qi 'lint_javascript\|lint'; then
      echo "FAIL: B2 mechanism but guard appears in lint_javascript job (must be post-build only)"; exit 1
    fi
  done
  echo "$JOBS_FOUND" | grep -qi 'test' || { echo "FAIL: B2 mechanism but guard NOT in test job"; exit 1; }
  echo "OK: B2 mechanism — guard is in the test job (post-build) only"
else
  # B1/B1a/B1b: guard must be in BOTH lint_javascript AND test
  echo "$JOBS_FOUND" | grep -qi 'lint_javascript\|lint' || { echo "FAIL: B1/B1a/B1b mechanism but guard NOT in lint_javascript job"; exit 1; }
  echo "$JOBS_FOUND" | grep -qi 'test' || { echo "FAIL: B1/B1a/B1b mechanism but guard NOT in test job"; exit 1; }
  echo "OK: B1/B1a/B1b mechanism — guard is in lint_javascript + test job"
fi
echo "OK: lint:agents-api-surface is CI-enforced with correct job-scoped placement"
# Revision 4 architect finding 9: the executable script is marker-free.
grep -E "@plan:|@requirement:" scripts/check-agents-api-surface.mjs && { echo "FAIL: executable script has markers (architect finding 9)"; exit 1; } || echo "OK: script is marker-free"
# Revision 5 architect finding 1: the .mjs helper is also marker-free (executable helper).
grep -E "@plan:|@requirement:" packages/agents/src/api/__tests__/apiSurfaceParser.mjs && { echo "FAIL: executable .mjs helper has markers (revision 5 finding 1)"; exit 1; } || echo "OK: .mjs helper is marker-free"
# Revision 4 architect finding 2: report written to gitignored path (node_modules/.cache).
grep -q "node_modules/.cache/agents-api-surface" scripts/check-agents-api-surface.mjs || { echo "FAIL: report not under node_modules/.cache (architect finding 2)"; exit 1; }
# The test does NOT shell out to build and does NOT wire globalSetup (fail-closed)
grep -E "execSync|spawnSync|child_process|npm run build|globalSetup" packages/agents/src/api/__tests__/publicSurface.guard.test.ts && { echo "FAIL: guard test shells out to build or wires globalSetup"; exit 1; } || echo "OK: no in-lifecycle build"

# GREEN phase: run the standalone script + the test and confirm PASS (characterization)
npm run lint:agents-api-surface
test $? -eq 0 || { echo "FAIL: API-surface script did not pass"; exit 1; }
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
test $? -eq 0 || { echo "FAIL: guard test did not pass"; exit 1; }

# Export-star leak proof: the JSON report contains the denied names (fail-closed)
# Revision 4 architect finding 2: report is at node_modules/.cache/...
node -e "
const fs=require('fs');
const report=JSON.parse(fs.readFileSync('node_modules/.cache/agents-api-surface/report.json','utf8'));
const names=new Set(report);
for (const denied of ['AgentClient','CoreToolScheduler','AgenticLoop']) {
  if (!names.has(denied)) { console.error('FAIL: '+denied+' not resolved through export-star'); process.exit(1); }
}
console.log('OK: export-star leak proof passed');
"

# Snapshot path resolution proof (report read in beforeAll OR skip) — fail-closed
test "$(grep -c 'existsSync\|readFileSync\|toThrow\|resolve\|import.meta.url\|surfaceReport\|JSON\|skip' packages/agents/src/api/__tests__/publicSurface.guard.test.ts)" -ge 1 || { echo "FAIL: no snapshot/report resolution proof"; exit 1; }

# No mock theater (fail-closed)
grep -r "toHaveBeenCalled" packages/agents/src/api/__tests__/publicSurface.guard.test.ts && { echo "FAIL: mock theater"; exit 1; } || echo "OK"

# No deferred language (revision 3 finding 4 — scoped to phase-owned files, fail-closed)
DEFERRED="$(grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder)" packages/agents/src/api/__tests__/apiSurfaceParser.mjs packages/agents/src/api/__tests__/publicSurface.guard.test.ts scripts/check-agents-api-surface.mjs || true)"
test -z "$DEFERRED" || { echo "FAIL: deferred language:"; echo "$DEFERRED"; exit 1; }

# eslint-guard (no suppression directives introduced) — fail-closed
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Semantic Verification Checklist

- [ ] I read the parser source (`apiSurfaceParser.mjs`): it recursively
      resolves `export *` re-exports (or uses the TS compiler API), not just a
      flat regex over `index.d.ts`.
- [ ] The characterization test is GREEN because it proves the guard DETECTS
      the current export-star leak (reads the JSON report from
      `lint:agents-api-surface`).
- [ ] The type-only deny case proves the parser resolves type-only re-exports
      through export-star.
- [ ] Build ordering is guaranteed via the STANDALONE
      `lint:agents-api-surface` script (revision 3 finding 3 — NOT
      globalSetup, NOT in-lifecycle build; isolated temp tsconfig B1/B1a/B1b
      or recorded fallback B2; tsbuildinfo isolated — findings 1, 20; revision
      5 finding 3: rootDir fallback proven in P01 preflight).
- [ ] The snapshot/report path resolution is proven.
- [ ] **Revision 5 finding 1**: `apiSurfaceParser.mjs` is marker-free (no
      `@plan`/`@requirement` in executable `.mjs` helpers).
- [ ] **Revision 5 finding 2**: the guard test's report-absent behavior is
      consistently fail-closed (never silently skips; fails in CI, fails locally
      unless `LLXPRT_API_SURFACE_SKIP=1`).
- [ ] The test is reachable via the agents test suite.
- [ ] No phase leaves CI red (characterization is GREEN, not a committed
      failing test).

## Success Criteria
- PASS: declaration-aware guard mechanism with export-star resolution exists
  (`.mjs` parser, revision 3 finding 2), characterization test GREEN (proves
  leak detection via the standalone `lint:agents-api-surface` script — finding
  3), snapshot/report path resolution proven, no mock theater, no deferred
  language (scoped — finding 4), eslint-guard passes.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P03a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
