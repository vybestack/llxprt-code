# Phase 05a: Agents Root Depollution + API-Surface Guard Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P05a`

## Prerequisites
- Required: Phase 05 completed.
- Verification: `test -f project-plans/issue2285/.completed/P05.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **`export * from './internals.js'` removed**: grep returns 0.
2. **API-surface guard GREEN in deny mode**: DENY assertions pass (names
   absent), snapshot comparison passes (updated to depolluted surface).
3. **Declaration-aware with export-star resolution (semantic)**: re-run the
   `apiSurfaceParser.mjs` `parseExportedNames` over the built `dist/index.d.ts`
   after `npm run build` — it must confirm `AgentClient`, `CoreToolScheduler`,
   and concrete `AgenticLoop` are absent from the resolved export-name SET and
   curated names are present, INCLUDING any transitive export-star chain. This
   is a semantic export-graph check, NOT a flat grep — flat greps on
   `dist/index.d.ts` are unreliable because the root barrel is export-star
   only and flat greps can be fooled by JSDoc/comment text.
4. **FULL REPO typecheck passes** — no cross-package breakage because P04
   migrated all consumers BEFORE depollution (architect finding 1).
5. **Disambiguation audit has three-evidence trail per symbol** (finding 7):
   snapshot + declaration + api-barrel evidence for each disambiguation export.
6. **API guard build constraints satisfied** (finding 8): deterministic CI
   inclusion, no tracked-file mutation, fresh declaration contract.
7. **Intentional curated loop API preserved**: `createAgenticLoop`,
   `AgenticLoopRunner`, `AgenticLoopEvent`, `AgenticLoopMessage` still in root.
8. **createTaskToolRegistration retained**: still a root export (curated).
9. **Identity assertions removed**: `root.AgentClient === internals.AgentClient`
   gone; replaced with root DENY (`toBeUndefined`).
10. **No marker comment churn in production source** (finding 5).
11. **Agents typecheck + tests pass**.
12. **No deferred language**.
13. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# Root clean (fail-closed)
test "$(grep -c "export \* from './internals.js'" packages/agents/src/index.ts)" -eq 0 || { echo "FAIL: root still re-exports internals"; exit 1; }

# Guard GREEN in deny mode via standalone script (revision 3 — no in-lifecycle build, no globalSetup)
npm run lint:agents-api-surface
test $? -eq 0 || { echo "FAIL: API-surface script did not pass in deny mode"; exit 1; }
npm run test --workspace @vybestack/llxprt-code-agents -- publicSurface.guard
test $? -eq 0 || { echo "FAIL: guard test did not pass in deny mode"; exit 1; }
# Confirm no in-lifecycle build / no globalSetup (revision 3)
grep -E "execSync|spawnSync|child_process|npm run build|globalSetup" packages/agents/src/api/__tests__/publicSurface.guard.test.ts && { echo "FAIL: guard test shells out to build or wires globalSetup"; exit 1; } || echo "OK: no in-lifecycle build"

# Semantic declaration export-graph proof (revision 7 — replaces flat greps
# that were fooled by JSDoc/comment text). The package root barrel
# (`packages/agents/index.ts`) is a bare `export * from './src/index.js'`; the
# emitted `dist/index.d.ts` is therefore a single export-star line with NO
# literal curated-name substrings. Flat greps on dist/index.d.ts cannot prove
# API exports — they only match comment text. Instead, use the real
# `apiSurfaceParser.mjs` (`parseExportedNames`) to resolve the export-star
# graph recursively over the built `dist/index.d.ts` and assert against the
# resolved exported-name SET. This is the same parser the standalone
# `lint:agents-api-surface` script uses to build the report.
npm run build --workspace @vybestack/llxprt-code-agents
test $? -eq 0 || { echo "FAIL: agents build"; exit 1; }
node --input-type=module -e "
import { parseExportedNames, DENIED_INTERNAL_NAMES } from './packages/agents/src/api/__tests__/apiSurfaceParser.mjs';
const names = parseExportedNames('./packages/agents/dist/index.d.ts');
// Denied internal names must be ABSENT from the resolved export graph.
for (const denied of DENIED_INTERNAL_NAMES) {
  if (names.has(denied)) { console.error('FAIL: denied name still exported in dist export graph: ' + denied); process.exit(1); }
}
// Curated names must be PRESENT in the resolved export graph.
const curated = ['createAgentClient','createToolScheduler','createTaskToolRegistration','createAgenticLoop','AgenticLoopRunner','AgenticLoopEvent','AgenticLoopMessage'];
const missing = curated.filter((n) => !names.has(n));
if (missing.length > 0) { console.error('FAIL: curated names absent from dist export graph: ' + missing.join(', ')); process.exit(1); }
console.log('OK: semantic export-graph check — denied absent, curated present (' + names.size + ' names resolved)');
"
test $? -eq 0 || { echo "FAIL: semantic export-graph declaration check failed"; exit 1; }

# Export-star resolution in the .mjs parser (revision 3 finding 2 — fail-closed)
test "$(grep -c 'export \*\|exportStar\|resolveExport\|ts\.\|createProgram' packages/agents/src/api/__tests__/apiSurfaceParser.mjs)" -ge 1 || { echo "FAIL: no export-star resolution in parser"; exit 1; }

# Snapshot path resolution proof (fail-closed)
test "$(grep -c 'existsSync\|readFileSync\|import.meta.url\|toMatchSnapshot\|skip' packages/agents/src/api/__tests__/publicSurface.guard.test.ts)" -ge 1 || { echo "FAIL: no snapshot path resolution proof"; exit 1; }

# createTaskToolRegistration retained in source root barrel (fail-closed).
# Uses a semantic parser check, not a flat grep on dist (which is export-star
# only). The source barrel declares it directly as a named export.
node --input-type=module -e "
import { parseExportedNames } from './packages/agents/src/api/__tests__/apiSurfaceParser.mjs';
const names = parseExportedNames('./packages/agents/src/index.ts');
if (!names.has('createTaskToolRegistration')) { console.error('FAIL: createTaskToolRegistration absent from root source export graph'); process.exit(1); }
console.log('OK: createTaskToolRegistration present in root source export graph');
"
test $? -eq 0 || { echo "FAIL: createTaskToolRegistration absent from root"; exit 1; }

# Identity assertions removed (fail-closed)
test "$(grep -rc 'root.AgentClient === internals.AgentClient' packages/agents/src/api/__tests__/ | awk -F: '{s+=$2} END{print s+0}')" -eq 0 || { echo "FAIL: identity assertions still present"; exit 1; }

# FULL REPO typecheck passes (no cross-package breakage — finding 1)
npm run typecheck
test $? -eq 0 || { echo "FAIL: full repo typecheck"; exit 1; }

# Agents typecheck + tests
npm run typecheck --workspace @vybestack/llxprt-code-agents
test $? -eq 0 || { echo "FAIL: agents typecheck"; exit 1; }
npm run test --workspace @vybestack/llxprt-code-agents
test $? -eq 0 || { echo "FAIL: agents tests"; exit 1; }

# API guard CI inclusion via ACTUAL workflow check (revision 4 architect
# findings 1, 8: verify .github/workflows/ci.yml contains the step, NOT just
# that the script exists in package.json — package.json proves local wiring,
# not CI enforcement).
test -f scripts/check-agents-api-surface.mjs || { echo "FAIL: scripts/check-agents-api-surface.mjs missing"; exit 1; }
node -e "const p=require('./package.json'); if(!(p.scripts&&p.scripts['lint:agents-api-surface'])) { console.error('FAIL: lint:agents-api-surface not in package.json'); process.exit(1); } console.log('OK: lint:agents-api-surface wired in package.json');"
grep -q "lint:agents-api-surface" .github/workflows/ci.yml || { echo "FAIL: lint:agents-api-surface NOT in .github/workflows/ci.yml (architect finding 1 — not CI-enforced)"; exit 1; }
echo "OK: lint:agents-api-surface is in the GitHub CI workflow"

# API guard report path is gitignored (revision 4 architect finding 2 — no worktree dirtying)
grep -q "node_modules/.cache/agents-api-surface" scripts/check-agents-api-surface.mjs || { echo "FAIL: report not under node_modules/.cache (architect finding 2)"; exit 1; }
echo "OK: report path is gitignored (node_modules/.cache)"

# API guard executable script is marker-free (revision 4 architect finding 9)
grep -E "@plan:|@requirement:" scripts/check-agents-api-surface.mjs && { echo "FAIL: script has markers (architect finding 9)"; exit 1; } || echo "OK: script marker-free"

# API guard does NOT write tracked files (finding 8 — no tracked-file mutation, fail-closed)
test "$(grep -c 'writeFileSync\|fs.write' packages/agents/src/api/__tests__/publicSurface.guard.test.ts)" -eq 0 || { echo "FAIL: guard test writes tracked files"; exit 1; }

# Disambiguation audit evidence (finding 7 — fail-closed)
test -f project-plans/issue2285/analysis/disambiguation-audit.md || { echo "FAIL: disambiguation-audit.md missing"; exit 1; }
test "$(grep -c 'snapshot\|declaration\|api/index.ts\|dist/index.d.ts' project-plans/issue2285/analysis/disambiguation-audit.md)" -ge 1 || { echo "FAIL: disambiguation audit lacks evidence"; exit 1; }

# No NEWLY INTRODUCED deferred language (architect review finding 6: pre-phase
# baseline comparison). Pre-existing debt tolerated; only newly introduced FAILS.
# Scan git diff added lines in the phase-owned files.
P05A_FILES="packages/agents/src/index.ts packages/agents/src/api/__tests__/publicSurface.nonbreaking.test.ts packages/agents/src/api/__tests__/nonBreaking.exports.test.ts packages/agents/src/api/__tests__/publicSurface.guard.test.ts packages/agents/src/api/__tests__/apiSurfaceParser.mjs"
EXISTING=""
for f in $P05A_FILES; do [ -f "$f" ] && EXISTING="$EXISTING $f"; done
NEW_DEFERRED="$(git diff -- $EXISTING 2>/dev/null | grep '^+' | grep -v '^+++' | grep -iE '(TODO|FIXME|HACK|STUB|TEMPORARY|placeholder|for now)' || true)"
test -z "$NEW_DEFERRED" || { echo "FAIL: newly introduced deferred language:"; echo "$NEW_DEFERRED"; exit 1; }
echo "OK: no newly introduced deferred language (pre-existing baseline tolerated)"

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Export-star leak re-proof (revision 3 — finding 19: self-contained synthetic d.ts fixture, no production source mutation, no copy of index.ts/internals.ts without deps)

The verifier confirms the parser would catch a RE-INTRODUCED export-star leak
WITHOUT editing `packages/agents/src/index.ts` AND WITHOUT copying
`index.ts`/`internals.ts` shorn of their dependencies (the prior fixture was
unrealistic: it copied source files that import many transitively-required
modules, then parsed them with a declaration parser, which would fail to
resolve). The corrected proof uses a **self-contained synthetic `.d.ts`
fixture** generated by Node: a temp dir with a synthetic `index.d.ts` that
re-exports from a synthetic `internals.d.ts` containing a denied name, parsed
by the real `apiSurfaceParser.mjs`. No production source is touched and no
real dependency graph is required.

```bash
# Revision 3 finding 19 + finding 18 (generate fixture files with Node, not sed).
# Revision 6 architect finding 3: fixture uses .js specifiers matching the real
# package root pattern (export * from './src/index.js') so the parser's
# .js-to-.d.ts normalization is exercised.
TMPDIR_PROOF="$(node -e "const fs=require('fs'),os=require('os'),p=require('path'); const d=fs.mkdtempSync(p.join(os.tmpdir(),'export-star-proof-')); fs.mkdirSync(p.join(d,'src')); fs.writeFileSync(p.join(d,'index.d.ts'), \"export * from './src/index.js';\\nexport declare function createAgent(): void;\\n\"); fs.writeFileSync(p.join(d,'src','index.d.ts'), \"export * from './internals.js';\\n\"); fs.writeFileSync(p.join(d,'src','internals.d.ts'), \"export declare class AgentClient {}\\nexport declare class CoreToolScheduler {}\\nexport declare class AgenticLoop {}\\n\"); process.stdout.write(d);")"
# Run the REAL .mjs parser against the synthetic fixture (fail-closed).
node -e "
const { parseExportedNames, DENIED_INTERNAL_NAMES } = await import('./packages/agents/src/api/__tests__/apiSurfaceParser.mjs');
const names = parseExportedNames('${TMPDIR_PROOF}/index.d.ts');
for (const denied of DENIED_INTERNAL_NAMES) {
  if (!names.has(denied)) { console.error('FAIL: re-proof did not resolve denied name: ' + denied); process.exit(1); }
}
console.log('OK: synthetic export-star re-proof resolved all denied names');
" --input-type=module
test $? -eq 0 || { echo "FAIL: export-star re-proof failed"; exit 1; }
# Cleanup (never touched production source).
rm -rf "$TMPDIR_PROOF"
```

If the synthetic re-proof does not resolve the denied names, the parser's
export-star resolution is broken — return to P03 to fix it. This is a
BLOCKING failure of Gate 1/4.

## Semantic Verification Checklist

- [ ] I read `packages/agents/src/index.ts`: no internals re-export.
- [ ] The resolved export-name SET from `parseExportedNames(dist/index.d.ts)`
      does NOT contain denied names (semantic export-graph, not flat grep).
- [ ] The parser recursively resolves export-star — the re-proof confirms.
- [ ] FULL repo typecheck passes — no cross-package breakage (finding 1). P04
      migrated consumers before depollution.
- [ ] Disambiguation audit has three-evidence trail per symbol (finding 7).
- [ ] API guard build constraints satisfied (finding 8): CI inclusion, no
      tracked-file mutation, fresh declarations.
- [ ] Curated loop API preserved.
- [ ] createTaskToolRegistration decision is explicit and recorded.
- [ ] No NEW `@plan:PLAN-20260629-ISSUE2285` marker comment churn in production
      source (finding 5 + architect review finding 5). Pre-existing markers
      from other issues are NOT counted as failures.
- [ ] No phase left CI red — the FULL repo is GREEN.

## Non-Deferral Gate 1 (Agents Root Barrel) Evidence

Fill in execution-tracker.md Gate 1 verifier evidence with:
- grep output confirming no `export * from './internals.js'`.
- guard test PASS output (deny mode GREEN).
- FULL repo typecheck PASS output (finding 1 — no cross-package breakage).
- semantic export-graph proof (`parseExportedNames` over `dist/index.d.ts`)
  confirming denied names absent and curated names present.
- export-star re-proof output.
- disambiguation audit evidence (finding 7).
- API guard build constraint verification (finding 8).

## Success Criteria
- PASS: agents root clean, guard green in deny mode, FULL repo typecheck passes
  (finding 1), disambiguation audit with evidence (finding 7), API guard build
  constraints satisfied (finding 8), agents tests pass, no deferred language,
  no marker churn in production source (finding 5), gate 1 evidence recorded.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P05a.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
