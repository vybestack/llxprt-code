# Phase 33: Full verification — final phase

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P33`

## Prerequisites
- Required: Phase 32 completed.
- Verification: `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P32" packages/agents/package.json dev-docs/genai-import-baseline.md` (dep removed; baseline 0).
- Expected files from previous phases: all 13 required per-slice mutation reports under `project-plans/issue2349/.mutation-reports/` (P05-core + P07/P08/P09/P11/P13/P15/P17/P19/P21/P23/P25/P27-agents) with `MANIFEST.md` — each manifest line recording a `commit=`/`tree=` for its run (Additional Risk 1 freshness); `scripts/agents-neutral-gate.ts` + `scripts/agents-neutral-test-gate.ts` + `dev-docs/agents-neutral-gate-allowlist.md` (P31); `packages/agents/package.json` with `@google/genai` removed (P32).
- Preflight verification: Phase 0.5 completed.
- Verifier: deepthinker (holistic, whole-migration).

## Requirements Implemented (Expanded)

### REQ-INT-004: Whole-migration acceptance (overview §9.1)
**Full Text**: Every acceptance invariant in overview §9.1 (items 1-10) holds: zero raw genai imports; zero Google-shaped types (§8 a-h); zero structural-Gemini currency (§2A); usage-metadata decision applied (§7A); no synthetic round-trip streaming+direct; AFC preserved; both side-channels retired; clientContract neutralized; core/history still neutral; CLI+core consumers migrated; behavioral contracts §7 preserved; tests migrated behaviorally; gates in place (prod+test).
**Behavior** (Major 1 — verification stated in GWT):
- GIVEN: the fully-migrated tree after P32 (genai dep removed, baseline 0), all 13 per-slice mutation reports, and both enforcement gates present
- WHEN: the full acceptance command set below runs (test/lint/typecheck/format/build + AST gate `--count`==floor + test gate + mutation gate + `@google/genai` zero-import grep + §2A.4 inventory-closure `--by-file` + smoke haiku) and each result is mapped to an overview §9.1 invariant
- THEN: all 10 §9.1 invariants PASS with pasted evidence — zero prod raw imports, the AST gate exits non-zero on any non-exempt structural hit (and here exits 0), the two dead FILES (`streamChunkWrapper.ts`/`providerStopReason.ts`) are gone, `sendMessage` returns `ModelOutput`, the core `HookGenerateContentResponse` wire DTO is the ONLY allow-listed hook-wire survivor, no suppression directives were added, and the smoke haiku runs — otherwise the specific failure routes to its owning phase's remediation (never patched here)
**Why This Matters**: this is the single gate that proves the migration is complete and cannot silently preserve a #2424-style Google-shaped bypass.

## Implementation Tasks
This is the final whole-migration verification phase (deepthinker, holistic): its "tasks" are to run the
full acceptance command set below, map every result to an overview §9.1 invariant, and write the holistic
assessment. No production code is written here (any failure routes to the owning phase's remediation per
Failure Recovery).

## Verification Commands (run ALL; paste outputs into the marker)
```bash
npm run test
npm run lint
npm run typecheck
npm run format
# Minor 3 / Major 5: npm run format MUTATES the tree. The formatter diff MUST be reviewed AND committed
# BEFORE sign-off — do NOT sign a PASS on unreviewed formatter churn, and do NOT let an echo swallow the
# failure. Root has both scripts (package.json:96-99).
npm run format:check          # after format, this MUST report no remaining diffs (non-zero exit fails the phase)
git diff --stat               # review the formatter's changes; paste this into the marker
# HARD gate (Major 5): the working tree MUST be clean here. If `npm run format` churned files, they must be
# reviewed and COMMITTED before P33 sign-off; an uncommitted formatter diff FAILS the phase (no echo-and-continue):
if ! git diff --exit-code; then echo "FAIL: uncommitted formatter churn — review + commit the diff above before sign-off"; exit 1; fi
npm run build
npm run lint:eslint-guard              # no loosening/suppression added
# STRUCTURAL-BYPASS ABSENCE IS PROVEN EXCLUSIVELY BY THE AST GATE (Major 5) — run via npm as CI does and
# PASTE the gate's per-check (a)-(h) summary into the marker. The greps further below are SUPPLEMENTAL
# SANITY CHECKS ONLY; they do NOT prove structural-bypass absence.
npm run lint:agents-neutral-gate       # run via npm script EXACTLY as CI does -> exit 0; paste per-check (a)-(h) summary
npm run lint:agents-neutral-test-gate  # exit 0

# ============================================================================
# HARD MUTATION GATE (C5) — cover the ACTUAL migrated production surface, NOT just src/api/**.
# Two-part gate: (1) verify every required per-slice archived report passed ≥80%; (2) run a
# representative whole-surface mutation with explicit --mutate lists split by workspace, PLUS the
# packages/core mutation over the changed llm-types files (P01 tooling). Do NOT rely on test:mutation:api.
# ============================================================================

# --- Part 1: verify every REQUIRED slice archived a passing (>=80%) report (from verification-template §8) ---
# Additional Risk 1 (freshness): each report's MANIFEST line MUST record a commit=/tree= for the run, and the
# recorded tree hash MUST still exist in the repo (a stale report from a discarded revision cannot satisfy P33).
node -e '
const fs=require("fs"),path=require("path"),cp=require("child_process");
const dir="project-plans/issue2349/.mutation-reports";
const required=["P05-core","P07-agents","P08-agents","P09-agents","P11-agents","P13-agents","P15-agents","P17-agents","P19-agents","P21-agents","P23-agents","P25-agents","P27-agents"];
const manifestPath=path.join(dir,"MANIFEST.md");
const manifest=fs.existsSync(manifestPath)?fs.readFileSync(manifestPath,"utf8"):"";
let fail=false;
for(const key of required){
  const p=path.join(dir,key+".mutation.json");
  if(!fs.existsSync(p)){console.error("MISSING slice mutation report:",p);fail=true;continue;}
  const r=JSON.parse(fs.readFileSync(p,"utf8"));const f=Object.values(r.files);
  const k=f.flatMap(x=>x.mutants).filter(m=>["Killed","Timeout"].includes(m.status)).length;
  const t=f.flatMap(x=>x.mutants).filter(m=>m.status!=="Ignored"&&m.status!=="NoCoverage").length;
  const s=t?100*k/t:0;console.log(key,"mutationScore="+s.toFixed(1));
  if(s<80){console.error("FAIL <80% for",key);fail=true;}
  // Freshness (Additional Risk 1): find this key`s MANIFEST line and require a commit=/tree= that still resolves.
  const pnn=key.split("-")[0];
  const line=manifest.split("
").find(l=>l.trim().startsWith(pnn+" ")||l.includes("| "+key.replace("-"," | ")+" |")||l.startsWith(pnn+" |"));
  if(!line){console.error("FAIL(freshness): no MANIFEST line for",key);fail=true;continue;}
  const treeM=line.match(/tree=([0-9a-f]{7,40})/);const commitM=line.match(/commit=([0-9a-f]{7,40})/);
  if(!treeM||!commitM){console.error("FAIL(freshness): MANIFEST line for",key,"lacks commit=/tree=");fail=true;continue;}
  try{cp.execSync("git cat-file -e "+treeM[1]+"^{tree}",{stdio:"ignore"});}
  catch(e){console.error("FAIL(freshness): recorded tree",treeM[1],"for",key,"does not exist in repo (stale report)");fail=true;}
}
if(fail){console.error("FAIL: required slice mutation reports missing, below 80%, or STALE (commit/tree absent)");process.exit(1);}
console.log("all required slice mutation reports present, >=80%, and fresh (commit/tree recorded + resolvable)");
'

# --- Part 2a: representative WHOLE-SURFACE agents production mutation (core migrated files, explicit --mutate) ---
( cd packages/agents && npx stryker run stryker.conf.json \
    --mutate "src/core/StreamProcessor.ts" \
    --mutate "src/core/TurnProcessor.ts" \
    --mutate "src/core/turn.ts" \
    --mutate "src/core/MessageConverter.ts" \
    --mutate "src/core/DirectMessageProcessor.ts" \
    --mutate "src/core/ConversationManager.ts" \
    --mutate "src/core/hookToolRestrictions.ts" \
    --mutate "src/core/streamResponseHelpers.ts" \
    --mutate "src/core/beforeModelHookDecision.ts" \
    --mutate "src/subagent/**/*.ts" \
    --mutate "src/agents/executor*.ts" \
    --mutate "src/api/**/*.ts" \
    --mutate "!src/**/__tests__/**" --mutate "!src/**/*.test.ts" --mutate "!src/**/*.spec.ts" )
node -e "const r=require('./packages/agents/reports/mutation/mutation.json');const f=Object.values(r.files);const k=f.flatMap(x=>x.mutants).filter(m=>['Killed','Timeout'].includes(m.status)).length;const t=f.flatMap(x=>x.mutants).filter(m=>m.status!=='Ignored'&&m.status!=='NoCoverage').length;const s=t?100*k/t:0;console.log('agents whole-surface mutation score',s.toFixed(1));if(s<80){console.error('FAIL <80%');process.exit(1);}"

# --- Part 2b: packages/core changed llm-types mutation (P01 tooling; the surface P05 provisioned) ---
npm --prefix packages/core run test:mutation -- \
    --mutate "src/llm-types/agentMessageInput.ts" \
    --mutate "src/llm-types/modelEnvelope.ts"
node -e "const r=require('./packages/core/reports/mutation/mutation.json');const f=Object.values(r.files);const k=f.flatMap(x=>x.mutants).filter(m=>['Killed','Timeout'].includes(m.status)).length;const t=f.flatMap(x=>x.mutants).filter(m=>m.status!=='Ignored'&&m.status!=='NoCoverage').length;const s=t?100*k/t:0;console.log('core llm-types mutation score',s.toFixed(1));if(s<80){console.error('FAIL <80%');process.exit(1);}"

# ============================================================================
# §2A.4 INVENTORY-CLOSURE GATE (Critical 3, option a) — NAMED-SITE closure, per-site → owning-phase.
# A "strictly lower AST count" does NOT substitute for named-inventory closure. This gate asserts that
# EVERY overview §2A.4-I construction site AND §2A.4-II access/mutation/AFC/usage-key site is gone-or-
# centrally-allow-listed, attributed to its OWNING phase. If any named inventory site silently survives,
# THIS gate fails even if the net --count is at floor.
# The closure map (per-site → owning phase) is in the "§2A.4 inventory-closure map" table below.
# Mechanically re-assert every non-allow-listed inventory site is ABSENT from the final tree:
# ============================================================================
# §2A.4-I construction sites (must be GONE — retyped/contract-vanished) — HARD asserts:
if grep -rnE "convertIContentToResponse|_buildBlockingSyntheticResponse|patchMissingFinishReason" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL(§2A.4-I): synthetic fabricator site survives (P09/P13)"; exit 1; fi
if grep -rnE "\{ *candidates: *\[" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL(§2A.4-I): {candidates} literal survives (P07/P08/P13) — allow-listed context only, else FAIL"; exit 1; fi
# §2A.4-II .parts/candidate.content readers & mutators (must be GONE — retyped to blocks):
if grep -rnE "\.parts *=|\.parts\.push|candidate\??\.content\??\.parts|\.candidates\?\.\[0\]" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL(§2A.4-II): .parts/candidate.content reader/mutator survives (P08/P11/P13/P15/P19)"; exit 1; fi
# §2A.4-II AFC/content-length filters (must be neutral IContent[] block filters):
if grep -rnE "content\.parts\?\.length" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL(§2A.4-II): content.parts?.length filter survives (P08/P11/P13)"; exit 1; fi
# §2A.4-II Google usage keys inside the loop (must be neutral UsageStats; permitted ONLY in api/ boundary):
if grep -rnE "promptTokenCount|candidatesTokenCount|totalTokenCount" packages/agents/src/core --include=*.ts | grep -v test; then echo "FAIL(§2A.4-II): Gemini usage key inside the core loop (P08/P15/P19; turnLogging must be neutral)"; exit 1; fi
# The AST gate's --by-file detail must show ZERO non-allow-listed inventory hits (authoritative closure):
npx tsx scripts/agents-neutral-gate.ts --count --by-file   # every remaining hit MUST map to a central allow-list entry; NO named §2A.4 inventory site survives un-allow-listed
# M3 evidence (Additional Risk 3 + Critical 3 round 8): confirm P19's core ServerUsageMetadataEvent check ran & passed
# with CONCRETE evidence — production-dead (zero production emitters) AND live-path-neutral (Finished usage = UsageStats),
# NOT a vague shape snapshot:
test -f project-plans/issue2349/.completed/P19.md && grep -qE "serverUsageMetadataEvent\.shape|ServerUsageMetadataEvent.*(PASS|passed)" project-plans/issue2349/.completed/P19.md && echo "M3 evidence present" || { echo "FAIL: P19 marker lacks pasted ServerUsageMetadataEvent check PASS evidence (do NOT overstate §9.1-2b)"; exit 1; }
npm test -- packages/core/src/core/__tests__/serverUsageMetadataEvent.shape.test.ts   # re-run here; PASTE PASS output (§9.1-2b evidence)
# Re-assert the two CONCRETE facts here as well (Critical 3): (a) production-dead + (b) live-path-neutral.
if grep -rnE "type:\s*AgentEventType\.UsageMetadata" packages/agents/src packages/core/src --include=*.ts | grep -vE "__tests__|\.test\.|\.spec\.|test-helpers" | grep -vE "packages/core/src/core/turn\.ts" | grep -vE "case\s+AgentEventType\.UsageMetadata"; then echo "FAIL(§9.1-2b/Critical 3): a PRODUCTION emitter of ServerUsageMetadataEvent exists (must stay production-dead)"; exit 1; fi

# ============================================================================
# SUPPLEMENTAL SANITY CHECKS ONLY (Major 5) — these do NOT prove structural-bypass absence.
# Structural-bypass absence (anonymous {candidates}/{role,parts} literals, .parts mutators, Contract*
# aliases, toGeminiContent(s) contexts, enum redeclarations, usage keys) is proven EXCLUSIVELY by the AST
# gate above (checks (a)-(h) + central allow-list). The greps below only cross-check raw imports + three
# round-trip symbol names as a coarse human sanity net.
# ============================================================================
if grep -rl "@google/genai" packages/agents/src | grep -vE "\.(test|spec)\.|test-helpers|__tests__"; then echo "FAIL(supplemental): production @google/genai importer remains"; exit 1; fi
if grep -rnE "convertIContentToResponse|streamChunkWrapper|providerStopReason" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL(supplemental): round-trip symbol survives"; exit 1; fi
# toGeminiContents: proven by the allow-list-aware AST gate (permits ONLY the G3 hook adapter, OQ-1a); NOT a broad grep.

# smoke test
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

## Success Criteria
- EVERY command above exits 0 with pasted evidence (tests/lint/typecheck/format/format:check/build green;
  both neutral gates exit 0; smoke haiku succeeds).
- **Mutation gate (C5):** Part 1 confirms ALL 13 required slice reports (P05-core + P07/P08/P09/P11/P13/P15/P17/P19/P21/P23/P25/P27-agents) exist under `.mutation-reports/` and each passed ≥80%; Part 2a's agents whole-surface run over the migrated `src/core/**` + `src/subagent/**` + `src/agents/executor*` + `src/api/**` files scores ≥80%; Part 2b's `packages/core` llm-types run scores ≥80%. The api-only `test:mutation:api` default is NOT the acceptance gate.
- **Mutation-report freshness (Additional Risk 1):** every required slice's `MANIFEST.md` line records a `commit=`/`tree=` for the run and the recorded tree still resolves in the repo (`git cat-file -e <tree>^{tree}`); a report with a missing or unresolvable `commit`/`tree` is STALE and FAILS Part 1 regardless of its score, so a report from a discarded revision cannot satisfy acceptance after later edits.
- **Structural-bypass proof (Major 5):** `npm run lint:agents-neutral-gate`'s per-check (a)-(h) summary is PASTED into the marker and every check passes; this — plus the central allow-list — is the SOLE proof of structural-bypass absence. The supplemental greps are recorded as sanity cross-checks only, never as the structural proof.
- **§2A.4 inventory-closure (Critical 3):** EVERY named §2A.4-I/II site in the inventory-closure map is CLOSED (gone or centrally allow-listed) and attributed to its owning phase; the AST `--by-file` detail shows ZERO non-allow-listed inventory hits; the only permitted survivors are the G3 hook-wire adapter (AST-context allow-listed) and the core-owned `ServerUsageMetadataEvent` (with M3 shape-check evidence pasted). A named inventory site surviving un-allow-listed FAILS P33 regardless of the net `--count`.
- **M3 evidence (Additional Risk 3 + Critical 3 round 8):** the `ServerUsageMetadataEvent` core check is re-run here AND P19's pasted PASS evidence is present with the CONCRETE facts — (a) production-dead (zero production emitters/constructors) and (b) live-path-neutral (`ServerFinishedEvent.value.usageMetadata` = `UsageStats | undefined`); §9.1-2b is NOT signed off on a vague shape snapshot or without this evidence.
- `npm run format:check` reports no remaining diffs and the post-format `git diff` was reviewed before
  sign-off (Minor 3) — no unreviewed formatter churn.
- EVERY overview §9.1 invariant (1-10) maps to a PASS in the Acceptance map below with pasted evidence.
- No lint/complexity loosening or suppression directive anywhere (`npm run lint:eslint-guard`).

## Acceptance → verification map (must all PASS)
- §9.1-1 zero raw imports → AST gate check (a) [authoritative] + supplemental grep sanity.
- §9.1-2 / 2a / 2b zero Google-shaped types / structural currency / usage decision → AST gate checks (b)-(h) [authoritative — structural-bypass absence is proven EXCLUSIVELY here, per Major 5; the greps are supplemental only]. §9.1-2b additionally requires: the option-(C) mapper maps ONLY the 4 declared public keys (no public reasoning/thought token — OQ-14 PUBLIC out of scope; `UsageStats.reasoningTokens` preserved INTERNALLY only), AND the core-owned `ServerUsageMetadataEvent` M3 check is CONCRETE (production-dead + live-path-neutral, not a shape snapshot).
- §9.1-3 / 3a / 3b no synthetic round-trip / AFC preserved / provider metadata dispositioned → P07-P09,P13,P19 + characterization.
- §9.1-4 side-channels retired → P11 + gate (d).
- §9.1-5 clientContract neutralized → P21 + gate (c).
- §9.1-6 core/history neutral → HistoryService unchanged (0 genai).
- §9.1-7 CLI+core migrated → build green (P21).
- §9.1-8 behavioral contracts §7 → all characterization suites green (P06/P10/P12/P14/P16/P18/P20/P22/P24/P26).
- §9.1-9 tests behavioral + allow-list → P28 + test gate.
- §9.1-10 gates in place → P31.
- Mutation coverage of the migrated surface (C5) → Part 1 (13 archived slice reports ≥80%) + Part 2a (agents whole-surface ≥80%) + Part 2b (core llm-types ≥80%). NOT the api-only default.
- §2A.4 inventory-closure (Critical 3) → the "§2A.4 inventory-closure map" below: EVERY named §2A.4-I/II site maps to an owning phase and is asserted gone-or-allow-listed; the AST `--by-file` detail shows ZERO non-allow-listed inventory hits.

## §2A.4 inventory-closure map (Critical 3 — per-site → owning phase; ALL must be CLOSED)
This gate exists so a named inventory site cannot silently survive behind a "lower net count". Each overview §2A.4 site is attributed to the phase that retires/neutralizes it; P33 re-asserts closure mechanically (greps above + AST `--by-file`). A site that is neither GONE nor centrally allow-listed FAILS P33 and routes to its owning phase.

**§2A.4-I construction sites → owning phase**
- (a) synthetic-response `{candidates}` fabricators: `MessageConverter.convertIContentToResponse` → **P13** (DELETE, chain from P09); `DirectMessageProcessor._buildBlockingSyntheticResponse` → **P13**; `streamRequestHelpers.patchMissingFinishReason` → **P13**.
- (b) contract/public `{role,parts}` builders (`MessageConverter` builder path, `baseLlmClient` request wrappers/systemInstruction, `client.ts:667-668`, `MessageStreamOrchestrator:341-342`) → **P15** (client/orchestrator) + **P17/P27** (baseLlmClient/MessageConverter builder per retype slice).
- (c) history/write-path `Content` builders (`streamResponseHelpers:299-301`, `ConversationManager:272-277/:306/:310`, `TurnProcessor:796-801/:828`, `loopHelpers:110-117`) → **P07** (streamResponseHelpers), **P15** (ConversationManager), **P08** (TurnProcessor), **P27** (loopHelpers).
- (d) hook fallback/restriction adapters (`StreamProcessor:690-693`, `DirectMessageProcessor:368-371/:775-779/:865-866`, `hookToolRestrictions:115-118/:189-191`) → **P07/P13** (StreamProcessor/DirectMessageProcessor synthetic-vanish) + **P11** (hookToolRestrictions neutralize).
- (e) subagent/executor structural sites incl. the raw-import-free `executor-prompt-builder.ts:47-58` mutator → **P23** (subagent group) + **P25** (executor group, OQ-12).

**§2A.4-II access/mutation/AFC/usage-key sites → owning phase**
- (f) `.parts`/`candidate.content` readers & mutators: `client.stripThoughts` → **P15** (internal) + **P21** (getHistory boundary); `clientHelpers` → **P15**; `clientLlmUtilities` (×2) → **P15**; `ConversationManager` (×3) → **P15**; `DirectMessageProcessor._ensureResponseText`/`_extractResponseText` → **P13**; `MessageStreamOrchestrator:333` → **P15**; `subagent.ts:563`/`subagentNonInteractive:365` → **P23**; `executor-stream-processor:74` → **P25**; `MessageConverter` (`isValidContent`/`extractCuratedHistory`+`collectModelRun`/`hasTextContent`) → **P09/P17**; `streamResponseHelpers.accumulateChunkMetadata:101-108` → **P07**; `TurnProcessor._recordOutputContent:798-803` → **P08**; `hookToolRestrictions.filterHookRestrictedContent:184-192` → **P11**; `streamChunkWrapper.responseToIContent:77-83` → usage stops **P08** (TurnProcessor migrates off `responseToModelStreamChunk`); whole-file DELETE of `streamChunkWrapper.ts` → **P25** (last consumer `executor-stream-processor.ts`, C2).
- (g) AFC/content-length filters: `TurnProcessor:728` → **P08**; `DirectMessageProcessor:386/:764` → **P13**; `hookToolRestrictions:133` → **P11**.
- (h) internal Google usage keys: `TurnProcessor:844-850` → **P08**; `streamResponseHelpers:149-151/:308-314` → **P07**; `MessageConverter:651-662` → **P09/P13** (vanishes with fabricator); `turnLogging:85-104` → **P19** (retyped to neutral `UsageStats`; NOT allow-listed per OQ-3t).

> The ONLY permitted survivors are: the **G3 hook-wire** `toGeminiContents` at `streamRequestHelpers.ts:228` (AST-context allow-listed, P31, iff OQ-1a) and the core-owned `ServerUsageMetadataEvent` public event type (out-of-agents-gate scope, §7A; a DOCUMENTED PRODUCTION-DEAD Gemini-named type — zero production emitters — verified by the CONCRETE M3 check above: production-dead grep + live-path-neutral `ServerFinishedEvent.value.usageMetadata` = `UsageStats`). EVERY other §2A.4 site above MUST be GONE. If the AST `--by-file` output contains a hit not attributable to one of these two allow-listed survivors, P33 FAILS.

## Holistic Assessment (deepthinker)
Full PLAN.md §7 assessment across the whole migration: read the final tree, confirm each §9.1 invariant, prove no synthetic-response reintroduction path, and that the gate would block a #2424 regression. Verdict PASS/FAIL.

## Stryker failure-triage rule (Minor 2 — MANDATORY before touching code or the gate)
The whole-surface Part-2a run mutates many large files (`src/core/**` + `src/subagent/**` + `src/agents/executor*` + `src/api/**`); a non-zero Stryker exit is NOT automatically "surviving mutants". Before changing ANY code or weakening ANY threshold, CLASSIFY the failure into exactly one of these four categories and act accordingly:
1. **Mutation score <80% (real surviving mutants).** The report parsed cleanly and the computed score is below 80. → This is a genuine test-strength gap. RE-RUN the SMALLEST failing `--mutate` subset (a single file or a single directory from the list) to isolate which file's mutants survived, inspect the surviving mutants, and strengthen the OWNING slice's tests (route to that slice's NNa). Do NOT weaken the gate.
2. **Test-runner crash / config error.** Stryker aborted before producing a score (e.g. vitest config not found, TS compile error under mutation, dry-run failure). → This is a TOOLING problem, NOT a score failure. Fix the runner/config (confirm `packages/<ws>/vitest.config.*` path in `stryker.conf.json`, from P0.5 task 12 / P01), then re-run the SAME `--mutate` subset. Do NOT record a score or change production code based on a crash.
3. **Timeout / resource failure.** Mutants marked `Timeout` due to slow/hung tests or machine resource limits, not logical survival. → Re-run the SMALLEST failing `--mutate` subset with adequate resources; `Timeout` mutants count as KILLED in the score formula (`['Killed','Timeout']`), so confirm whether the failure is actually score<80 (category 1) or a run that never completed (category 2). Do NOT weaken thresholds to absorb timeouts.
4. **No-mutants / no-coverage misconfiguration.** Stryker reports `NoCoverage`/`NoMutants` for a file that SHOULD be covered (e.g. a `--mutate` glob that matched nothing, or tests not wired to the mutated file). → This is a MISCONFIG, not a pass. Fix the `--mutate` glob / test wiring so the intended files are actually mutated and covered, then re-run. A "green" run that mutated nothing is a FAIL, not a PASS.

RULE: for categories 2-4, RE-RUN the smallest failing `--mutate` subset to confirm the true category BEFORE editing production code or the gate. NEVER lower `thresholds.break`, add `--ignore`, or exclude a migrated file from `mutate` to make Part 2a/2b pass.

## Failure Recovery
If ANY command fails or ANY §9.1 invariant does not map to a PASS:
1. DO NOT paste a PASS marker. Record the exact failing command/invariant in `.completed/P33.md`.
2. For a Stryker failure specifically: FIRST apply the Stryker failure-triage rule above (classify into one of the four categories and re-run the smallest failing `--mutate` subset) before routing or editing.
3. Route the specific failure to the owning phase's remediation: a red gate → P31; a residual structural hit → the owning migration slice (P08-P27) + re-run its NNa; a red characterization suite → the owning char phase (P06/P10/P12/P14/P16/P18/P20/P22/P24/P26); a build/typecheck break → P21 (contract flip) or the slice that introduced it; a lint/suppression regression → fix the underlying code (NEVER loosen the rule); a MISSING slice mutation report or a confirmed-category-1 <80% slice/whole-surface/core mutation score → the owning slice's NNa (re-run its scoped Stryker, strengthen tests, re-archive the report), then re-run P33 Parts 1-2.
4. Re-run the full P33 command set after remediation. Cannot sign off until every command passes and every §9.1 invariant maps to a PASS with pasted evidence.

## Phase Completion Marker
`project-plans/issue2349/.completed/P33.md` with all command outputs + the §9.1 map + Holistic Assessment.
