# Verification phases (NNa) — common semantic checklist

Every `NNa-*-verification.md` phase (typescriptreviewer for retype/impl slices; deepthinker for holistic/cross-package slices) MUST perform SEMANTIC verification (PLAN.md §7), not marker-counting. Each `NNa` phase file itself carries the full phase structure (Phase ID, Prerequisites, Requirements Verified with the specific REQ BEHAVIOR it checks, Checks, Verification Commands, Success Criteria, Failure Recovery, Phase Completion Marker) — this template is the shared body those files reference, NOT a substitute for the per-phase sections.

## MANDATORY: every NNa phase states its verification in full GIVEN/WHEN/THEN (Major 1)

Per `PLAN-TEMPLATE.md:41-53`, a verification phase is not exempt from GWT — it just expresses GWT at the GATE level. Every `NNa` file's "Requirements Implemented (Expanded)" / "Requirements Verified" section MUST, for each requirement it gates, state THREE explicitly-labeled bullet lines (not one compressed sentence):

- **GIVEN:** the artifacts produced by the sibling impl/TDD phase NN (name the exact files/symbols/tests).
- **WHEN:** the verification check runs (name the exact command/inspection).
- **THEN:** the observable GATE outcome that must hold (the pass condition + what a FAIL looks like).

This is the verification-phase form of GWT; it is mandatory for ALL `NNa` siblings across the plan (01a–33a), including tooling/gate verification siblings. A reviewer mechanically checking template compliance must find the three labeled bullets in every NNa requirement block.

## Canonical marker syntax (whole plan)

- **Code markers** (in source/tests): `@plan:PLAN-20260707-AGENTNEUTRAL.P##` and `@requirement:REQ-###` — ALWAYS the colon form, no space. Optional `@pseudocode lines X-Y`.
- **Grep verification** MUST match the same colon form, e.g. `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P07" packages/agents/src`.
- Do NOT emit the space form `@plan PLAN-...`; every phase file in this plan uses the colon form so grep counts are exact.
- **OVERRIDE (Minor 1):** the generic `dev-docs/PLAN.md` examples show a SPACE form (`@plan PLAN-...` / `@requirement REQ-...`). For THIS plan the colon form is CANONICAL and OVERRIDES the PLAN.md example — a subagent copying the PLAN.md space form would emit markers this plan's greps miss. Every phase and this template use the colon form ONLY.
- **Space-form marker gate (Minor 1 — HARD FAIL over the phase touch set):** every NNa verifier runs, over `$PHASE_SRC`+`$PHASE_TESTS` (the §3 touch set), a grep that FAILS the phase on any space-form marker:
  ```bash
  # FAIL if any touched file emits a SPACE-form marker (must be the colon form).
  files="$PHASE_SRC $PHASE_TESTS"
  if [ -n "$files" ] && grep -nE "@plan[[:space:]]+PLAN-20260707-AGENTNEUTRAL|@requirement[[:space:]]+REQ-" $files; then
    echo "FAIL(Minor 1): space-form @plan/@requirement marker found — use the colon form (@plan:/@requirement:)"; exit 1; fi
  ```

## Shared semantic checklist

1. **READ the actual implementation + tests** (not just check existence). TRACE one complete data path input→output. State WHICH REQ BEHAVIOR (GIVEN/WHEN/THEN from the sibling impl/TDD phase) this verification confirms.
2. **Pseudocode compliance:** every numbered line of the phase's cited pseudocode file is traceable in the code; report deviations. Implementation phases MUST cite `@pseudocode` line numbers.
   - **Line-number freshness (Minor 2):** many phases cite exact CURRENT line numbers (e.g. `TurnProcessor.ts:130-133`, `MessageConverter.ts:518-543`) that may DRIFT. Before a subagent relies on any cited line number, the phase's Completion Marker MUST record the REFRESHED line evidence captured by the P0.5 preflight (which pastes fresh `sed`/`grep` output and updates the affected phase file lists on drift — see `00a-preflight-verification.md`). The `NNa` verifier confirms the phase's cited line ranges still match the refreshed P0.5 evidence (or the drift-updated ranges) and FAILS if a phase acted on a stale line number without the refreshed evidence.
3. **Fraud detection — MECHANICALLY SCOPED TO THIS PHASE'S TOUCH SET (C4).** All fraud/anti-pattern/deferred-impl/empty-impl greps below run ONLY over the files ADDED or MODIFIED by the current phase, NEVER repo-wide. The repo already contains ~89 legacy agents test files with `toHaveBeenCalled` (470 matches); a repo-wide grep would fail EVERY phase before any work. Pre-existing tests OUTSIDE a phase's touch set are LEGACY DEBT (not a phase failure) unless P28 explicitly rewrites them.
   - **Compute the phase touch set FIRST (exact command):**
     ```bash
     # PHASE_FILES = files changed by this phase's commit(s) PLUS the phase's explicitly-listed test files.
     # (a) changed files since the phase's base (use the phase branch/commit base, or HEAD~ if single-commit):
     git diff --name-only "${PHASE_BASE:-HEAD~1}"...HEAD -- 'packages/**/*.ts' > /tmp/phase_files.txt
     # (b) append the phase's explicitly-listed test files (from "Files to Create/Confirm"):
     printf '%s\n' "${PHASE_TEST_FILES[@]}" >> /tmp/phase_files.txt
     # de-dup, keep only existing files:
     sort -u /tmp/phase_files.txt | while read -r f; do [ -f "$f" ] && echo "$f"; done > /tmp/phase_touch_set.txt
     PHASE_TESTS=$(grep -E '\.(test|spec)\.ts$|__tests__' /tmp/phase_touch_set.txt || true)
     PHASE_SRC=$(grep -vE '\.(test|spec)\.ts$|__tests__' /tmp/phase_touch_set.txt || true)
     ```
   - **Mock theater / reverse testing — HARD grep over `$PHASE_TESTS` ONLY (these patterns are unambiguous):**
     ```bash
     [ -n "$PHASE_TESTS" ] && grep -nE "toHaveBeenCalled|toHaveBeenCalledWith" $PHASE_TESTS && echo "FAIL: mock theater in phase tests"
     [ -n "$PHASE_TESTS" ] && grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" $PHASE_TESTS && echo "FAIL: reverse testing in phase tests"
     ```
     FAIL if any match in the phase's OWN test files.
   - **Structure-only detector — ADVISORY early-warning grep, NOT the pass/fail authority (Major 5).** The `toHaveProperty|toBeDefined` grep is textual and BRITTLE: it flags valid behavioral tests that use `toBeDefined` as part of a value assertion, and misses structure-only tests that avoid those exact tokens. Therefore it is an ADVISORY signal only. The pass/fail authority is SEMANTIC verification (PLAN.md §7 holistic assessment), not the grep.
     ```bash
     # ADVISORY ONLY — flags candidates for the verifier to READ and classify; a match does NOT auto-fail.
     [ -n "$PHASE_TESTS" ] && grep -nE "toHaveProperty|toBeDefined" $PHASE_TESTS   # advisory list of assertions to classify
     ```
     **MANDATORY semantic classification (the real gate):** the `NNa` verifier MUST READ each flagged assertion and classify it as either (i) **structure-only** (asserts a property exists / is defined without pinning its VALUE — e.g. could pass with `{ id: null }`) → the test FAILS the phase and must be rewritten to assert the value/behavior; or (ii) **part of a behavioral value assertion** (e.g. `toBeDefined()` immediately followed by an equality/content assertion on that same value, or a null-guard before a value check) → acceptable. The verifier MUST paste, per flagged assertion, a one-line classification (`structure-only`→FAIL / `behavioral-value`→OK with the value assertion cited) into the completion marker. A flagged assertion left unclassified FAILS the phase. An UNFLAGGED test may still FAIL if the holistic assessment (§11) finds it structure-only — the grep is a floor, not a ceiling.
   - **Deferred impl — over `$PHASE_SRC` ONLY (impl phases; non-stub):**
     ```bash
     [ -n "$PHASE_SRC" ] && grep -nE "TODO|FIXME|HACK|STUB|for now|placeholder|in a real|will be|should be" $PHASE_SRC && echo "FAIL: deferred impl in phase src"
     ```
   - **Empty-impl — over `$PHASE_SRC` ONLY:** `grep -nE "return \[\]|return \{\}|return null|return undefined" $PHASE_SRC` in impl code → FAIL. Reason through 3 tests: would they fail if the impl body were deleted?
   - The `NNa` marker MUST paste the computed `/tmp/phase_touch_set.txt` list so the scope is auditable. A hit in a file OUTSIDE the touch set is NOT a phase failure (record as pre-existing legacy debt).
4. **Structural-avoidance (the #2424 discipline) — for EVERY migration/impl phase; scoped to `$PHASE_SRC` (the §3 touch set):**
   - `grep -l "@google/genai" $PHASE_SRC | grep -v test` ⇒ empty for files the phase neutralizes (a residual import in a NOT-yet-migrated file outside the touch set is expected until its own slice).
   - Over `$PHASE_SRC`: no `Contract*` payload-type import/alias reintroduced; no `{candidates}`/`{role,parts}` literal added; no `.parts` mutation on non-neutral values; no `toGeminiContent(s)` call added; no Gemini usage keys in the internal loop.
   - The DELETE targets for the phase are actually GONE (`ls` fails / `grep` empty): e.g. `streamChunkWrapper.ts`, `providerStopReason.ts`, `convertIContentToResponse`.
5. **Behavioral-preservation (BR-1..BR-11):** confirm the phase's characterization tests still pass and assert OBSERVABLE behavior (emitted `ServerAgentStreamEvent` ordering, committed `HistoryService` state, retry/refusal/finish reasons, usage/token accounting) — NOT `{candidates}` internals. Confirm public event shapes unchanged (RISK-1). **Hook JSON wire byte-shape (RISK-2):** for any phase that touches the hook path or the G3 adapter (P10/P11/P13/P25, and any slice editing `streamRequestHelpers.ts`/`hookToolRestrictions.ts`/before-model hook code), the named golden `packages/agents/src/core/__tests__/hookWire.golden.test.ts` (fixtures under `__tests__/fixtures/hookWire/`) MUST STILL PASS byte-for-byte; a changed golden without an explicit RISK-2 sign-off FAILS the phase.
6. **RULES.md + lint-guard:** no `any`, no type assertions, no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`, no severity downgrade, no complexity/size threshold increase (`npm run lint:eslint-guard`).
7. **Property-based ratio ≥30% — computed over ALL test files the phase adds/modifies (C4), not one hand-picked file.** Every TDD/characterization phase lists its full test-file set; the ratio is the AGGREGATE across that entire set. Use this reusable helper (pass EVERY test file the phase touches); it sums `it(`/`test(` and `fc.assert`/`fc.property`/`test.prop` across ALL of them, prints total/property/percentage, and HARD-FAILS below 30%:
   ```bash
   # Reusable aggregate property-ratio gate. Usage:
   #   bash scripts/plan-prop-ratio.sh <testfile1> <testfile2> ...
   # (or inline the body). Counts across ALL passed files; exits 1 if property ratio < 30%.
   prop_ratio() {
     local total=0 prop=0 f
     for f in "$@"; do
       [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
       total=$(( total + $(grep -cE "\b(it|test)\(" "$f") ))
       prop=$(( prop + $(grep -cE "fc\.assert|fc\.property|test\.prop" "$f") ))
     done
     local pct=0; [ "$total" -gt 0 ] && pct=$(( 100 * prop / total ))
     echo "files=$# totalTests=$total propertyTests=$prop percent=${pct}%"
     [ "$pct" -ge 30 ] || { echo "FAIL: property ratio ${pct}% < 30%"; exit 1; }
   }
   prop_ratio <file1.test.ts> <file2.test.ts> ...   # list EVERY test file the phase adds/modifies
   ```
   The `NNa` verifier MUST paste the aggregate `files=…/totalTests=…/propertyTests=…/percent=…` line (over the full file set) into the completion marker. A single-file count is NOT acceptable for a multi-file phase.
   - **The ratio count is a COARSE floor, not proof of behavioral property tests (Major 5).** A textual `fc.property`/`test.prop` count can be inflated by a property-based helper that still asserts the wrong (or trivial) thing. Therefore, for EACH property-based test the phase adds, the verifier MUST record a short SEMANTIC note: (a) the INVARIANT the property asserts (in words), and (b) WHY an empty/stub implementation would FAIL it (i.e. the property is not vacuously true). A property whose note cannot explain how a stub impl fails it is NOT a valid behavioral property and does NOT count toward the 30% floor — the verifier reduces the property count accordingly and re-checks the ratio. Paste the per-property invariant notes into the completion marker. Semantic verification (§11), not the raw count, is the authority for whether the property tests are behavioral.
8. **Mutation gate — HARD ≥80% (enforced, not reasoned).** For every impl/TDD slice that adds or changes tested production code, run Stryker scoped to the slice's changed files and PARSE the JSON report:
   - Command (run from `packages/agents`, scoped to the changed files to keep runtime bounded):
     ```bash
     cd packages/agents
     npx stryker run stryker.conf.json --mutate "<changed-file-glob-1>" --mutate "<changed-file-glob-2>"
     # example: --mutate "src/core/StreamProcessor.ts"
     node -e "const r=require('./reports/mutation/mutation.json');const f=Object.values(r.files);let k=0,t=0;for(const x of f){for(const m of x.mutants){if(m.status!=='Ignored'&&m.status!=='NoCoverage'||m.status==='NoCoverage'){t++;if(m.status==='Killed')k++;}}}const score=100*k/Math.max(t,1);console.log('mutationScore='+score.toFixed(2));process.exit(score>=80?0:1)"
     ```
   - The `stryker.conf.json` already sets `thresholds.break=80`; the slice-scoped run MUST exit 0 (Stryker itself fails the run below the break threshold). If the scoped JSON is parsed manually, the computed score on the phase's new/changed mutants MUST be ≥80 or the phase FAILS.
   - Paste the `mutationScore=` line and the surviving-mutant summary into the `NNa` completion marker. "Spot-check via reasoning" is NOT acceptable — the score is computed from a real Stryker run.
   - Note: `packages/agents/stryker.conf.json` currently scopes `mutate` to `src/api/**`; for a slice outside `src/api`, pass `--mutate` overrides for that slice's files so Stryker actually mutates them.
   - **ARCHIVE the scoped report (C5) — MANDATORY for the P33 acceptance gate.** After the scoped run passes ≥80%, COPY the JSON report to a known per-slice location AND append a one-line manifest entry so P33 can verify every required slice ran and passed WITHOUT re-running everything:
     ```bash
     mkdir -p project-plans/issue2349/.mutation-reports
     # <PNN> = this phase id (e.g. P07); <workspace> = agents|core
     cp packages/<workspace>/reports/mutation/mutation.json \
        project-plans/issue2349/.mutation-reports/<PNN>-<workspace>.mutation.json
     # Capture the EXACT tree/commit the report verifies (Additional Risk 1 — freshness):
     PHASE_SHA=$(git rev-parse HEAD)                     # commit the mutation run verifies
     PHASE_TREE=$(git rev-parse "HEAD^{tree}")           # tree hash (stable across amend/rebase of message)
     # append: phase | workspace | mutated files | score | commitSHA | treeHash | timestamp
     echo "<PNN> | <workspace> | <changed-file-list> | mutationScore=<score> | commit=${PHASE_SHA} | tree=${PHASE_TREE} | $(date -u +%FT%TZ)" \
        >> project-plans/issue2349/.mutation-reports/MANIFEST.md
     ```
     The `NNa` marker MUST reference the archived report path + manifest line INCLUDING the `commit=`/`tree=` of the run. **Additional Risk 1 (freshness):** a mutation report whose recorded `commit`/`tree` does not match the phase's final commit is STALE and does NOT satisfy the gate — P33 re-checks the SHA/tree, not just the score, so a report from an earlier revision cannot satisfy acceptance after later edits. P33 verifies every REQUIRED slice report exists, records a `commit`/`tree`, and passed ≥80% (see P33). The required-slice list is: P05 (core llm-types), P07, P08, P09, P11, P13, P15, P17, P19, P21, P23, P25, P27 (agents production).
9. **Shrink-ratchet structural check (from the FIRST migration slice onward) — AST-precise, NOT broad grep (Major 4/5). TWO gates: (i) site-specific OWNED-hit closure AND (ii) net-count ratchet — the net count alone is NOT sufficient.** The AST-context-aware `--count`/`--by-file` modes exist from **Phase 02** (the early gate skeleton), so both gates use the SAME context-aware logic (`checkF` F1/F3/F5 + the domain-`*Candidate[]` EXCLUDE list) from the very first slice — precise, never a broad grep that could fail for the wrong reason.
   - **(i) Site-specific OWNED-hit closure (Major 4 — MANDATORY, in ADDITION to the net count).** Each migration/impl slice DECLARES the exact set of structural-hit IDENTITIES it OWNS (file + line + `checkF` subkind, taken from the P02/P0.5 frozen `--by-file` baseline in `dev-docs/agents-neutral-gate-baseline.md` — each impl phase lists its owned hit IDs in its own "Owned structural-hit closure" section). The NNa verifier runs `npx tsx scripts/agents-neutral-gate.ts --count --by-file` and asserts EVERY one of the slice's OWNED baseline hit IDs is ABSENT from the current `--by-file` output. This proves the slice closed ITS OWN source-swap-like paths — a slice CANNOT pass by reducing some unrelated count while leaving its own structural site intact. A slice's owned hit ID still present FAILS the phase even if the net count dropped.
   - **(ii) Net-count ratchet (in ADDITION to (i)).** The ratchet ceiling is recorded in `dev-docs/agents-neutral-gate-baseline.md` as machine-parseable `count=<integer> owner=<PNN>` lines (the file + format are created in **P02**; each slice APPENDS a new line, it does not create the file). **Ordering is strict (so `tail -1` reads the PRIOR ceiling at assertion time):** each slice FIRST reads the prior ceiling `prev=$(grep -oE 'count=[0-9]+' … | tail -1 | cut -d= -f2)`, computes `cur=$(… --count)`, and HARD-ASSERTS `test "$cur" -lt "$prev"` (monotonic decreasing to the bounded floor; equal-or-higher FAILS — that signals a hidden synthetic/Google-shaped adapter); ONLY AFTER the assertion passes does the slice APPEND its own new `count=$cur owner=<PNN>` line and remove its closed hit IDs from the frozen `--by-file` listing. Never append the new count before asserting, or the comparison would read the slice's own line.
   - **AUTHORITATIVE ratchet (P02 onward — the ONLY pass/fail number):**
     ```bash
     npx tsx scripts/agents-neutral-gate.ts --count   # AST-context-aware integer; subtracts centrally allow-listed hits
     ```
     This is the single mechanism used for the strict-decrease gate at EVERY slice (P07-P27) — because the skeleton lands in P02, no slice runs on a broad grep. P29-P31 EXTEND this same script with the full fail-mode checks (a-h) + test gate + CI wiring; the `--count` integer is continuous across the whole plan.
   - **(iii) PER-SLICE HARD checks for the UNCOUNTED categories (checkD/checkG-barrel/checkH) until P31 — MANDATORY, closes the Major-3 fraud window.** The staged `--count` metric only counts `checkF` F1/F3/F5 + `checkG-call` until P31 (`checkD` round-trip symbols, `checkG-barrel` `GeminiContent*` imports, and `checkH` Gemini usage keys are STUBBED to `[]` in P02 and land in P31). That leaves a window where a slice could reduce counted hits while leaving/introducing an UNCOUNTED bypass and still pass the net ratchet. Therefore, in ADDITION to (i)+(ii), EVERY migration slice (P07/P08/P09/P11/P13/P15/P17/P19/P21/P23/P25/P27) MUST run these HARD-FAILING checks over the files IT TOUCHES (its `git diff --name-only HEAD` agents production set) — failing IMMEDIATELY on the slice, not only at P31:
     ```bash
     # UNCOUNTED-CATEGORY HARD checks (per-slice, over THIS slice's touched agents prod files) — fail immediately.
     SLICE_FILES=$(git diff --name-only HEAD | grep -E 'packages/agents/src/.*\.ts$' | grep -vE '\.(test|spec)\.|__tests__|test-helpers')
     if [ -n "$SLICE_FILES" ]; then
       # (a) checkD round-trip symbols — MUST NOT appear (except the streamChunkWrapper.ts/providerStopReason.ts FILES themselves until their P25 delete):
       if echo "$SLICE_FILES" | grep -vE 'streamChunkWrapper\.ts|providerStopReason\.ts' | xargs grep -nE "streamChunkWrapper|providerStopReason|chunkToParts|responseToModelStreamChunk|convertIContentToResponse|setProviderStopReason|getProviderStopReason" 2>/dev/null; then echo "FAIL(Major 3 checkD): round-trip symbol in a touched file (uncounted until P31 — caught per-slice)"; exit 1; fi
       # (b) checkG-barrel GeminiContent* barrel/direct imports — MUST NOT appear:
       if echo "$SLICE_FILES" | xargs grep -nE "GeminiContent(Part)?\b|GeminiFunctionCall\b" 2>/dev/null; then echo "FAIL(Major 3 checkG-barrel): GeminiContent* import in a touched file (uncounted until P31 — caught per-slice)"; exit 1; fi
       # (c) checkH Gemini usage keys OUTSIDE the api/ boundary modules (event-types/event-schema + the option-(C) mapper):
       if echo "$SLICE_FILES" | grep -vE 'api/event-types\.ts|api/event-schema\.ts|api/eventAdapter\.ts' | xargs grep -nE "promptTokenCount|candidatesTokenCount|totalTokenCount|cachedContentTokenCount|thoughtsTokenCount" 2>/dev/null; then echo "FAIL(Major 3 checkH): Gemini usage key in a touched file outside the api/ boundary (uncounted until P31 — caught per-slice)"; exit 1; fi
     fi
     echo "PASS(Major 3): no UNCOUNTED-category (checkD/checkG-barrel/checkH) bypass introduced/left on this slice's touched files"
     ```
     These are the REQUIRED fallback (round-8 Major 3 decision): rather than move the EXPENSIVE checkD/checkG-barrel/checkH AST bodies ahead of their P30 TDD into P02's `--count` (which would land untested detection before its tests), each slice hard-greps the exact uncounted patterns on its own touched files so the fraud window is closed from the FIRST slice while the full AST bodies still land TDD-first at P31. A slice touching a file that contains any of these patterns FAILS immediately.
   - **Re-baseline when the metric widens at P31 (round-6 Major 2 — explicit documented step).** The metric is deliberately staged: pre-P31 `--count` = `{checkF F1/F3/F5, checkG-call}`; at P31 it widens to the full `(a)-(h)` including checkD/checkG-barrel/checkH. P31 MUST re-baseline the two integers (record BOTH the pre-P31 metric's final value AND the full a-h value in `dev-docs/agents-neutral-gate-baseline.md` as a `count=<n> metric=preP31` / `count=<m> metric=full-a-h` pair with the transition documented) so the ratchet remains monotonic and honest across the widening — the widened count is NOT compared against a pre-widening ceiling. The per-slice (iii) hard checks above guarantee the earlier slices could not have false-passed on the uncounted categories, so the re-baseline only formalizes the metric change, it does not retroactively admit a bypass.
   - **Advisory-only fallback (NOT a pass/fail gate):** the broad grep below is retained ONLY as a rough human sanity cross-check, and ONLY over the files the CURRENT slice touches (never repo-wide as a hard gate), because it over-counts (domain `candidates`, neutral `.parts`-shaped false positives). It NEVER fails a phase; the AST `--count` is authoritative. Known false positives are subtracted via the central allow-list (`dev-docs/agents-neutral-gate-allowlist.md`), never ad hoc.
     ```bash
     # ADVISORY ONLY — scope to the current slice's changed files; do NOT use as the pass/fail gate.
     git diff --name-only HEAD | grep -E 'packages/agents/src/.*\.ts$' | grep -vE '\.(test|spec)\.|__tests__|test-helpers' \
       | xargs grep -Ec "\{ *candidates:|role: *'model'|role: *'user'|\.parts\b|toGeminiContents\(|promptTokenCount|candidatesTokenCount" 2>/dev/null | awk -F: '{s+=$2} END{print "advisory-scan="s}'
     ```
   Update the baseline integer in `dev-docs/agents-neutral-gate-baseline.md` at each slice and paste the before/after AST `--count` values into the `NNa` marker. This proves each slice shrinks the Google-shaped surface precisely, from the first slice.
10. **Cross-package build-green** (for the checkpoint phases P05/P07-P09/P13/P15/P19/P21/P32 per execution-tracker): `npm run typecheck` + `npm run build` green across the monorepo at phase end.
11. **Write a Holistic Functionality Assessment** (PLAN.md §7): What was implemented? Does it satisfy each REQ (cite code locations)? One traced data path. What could go wrong? PASS/FAIL verdict with reasoning.

FAIL → remediation subagent with the specific findings, then re-verify. NEVER proceed on FAIL. NEVER skip a phase number.
