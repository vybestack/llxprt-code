# Phase 02: AST gate skeleton + working `--count` (early anti-#2424 enforcement)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P02`

> **Numbering note (Minor 1):** See the P01 numbering note. This is the P02 phase SLOT reused for the
> early AST-gate skeleton. The canonical PLAN.md P01 (analysis) / P02 (pseudocode) artifacts live in
> `analysis/` and are NOT executable phases. Numbering stays contiguous (01, 02, 03 … 33).

## Purpose (Major 4 + Major 5 + Major 6 fix)
The final full gate lands at P29-P31, AFTER all migration slices P07-P27 run. That means most of the
migration would otherwise proceed with only a BROAD grep ratchet (the exact false-positive-prone
approach the overview §756-780 warns against) and no real structural enforcement. This phase lands the
AST gate SKELETON EARLY — before the first migration slice (P07) — with a WORKING, context-aware
`--count` mode, so every shrink-ratchet count from P07 onward uses the SAME AST-context-aware logic
that the final gate uses (checkF's F1/F3/F5 structural matchers + the false-positive EXCLUDE list),
NOT a broad grep. The skeleton starts from a NONZERO baseline and ratchets DOWN to the bounded floor.

**Major 6 — the CHEAP, HIGH-VALUE #2424 vectors ALSO get FAIL-MODE here, not just at P31.** The four
checks that catch the LITERAL #2424 pattern are simple import/declaration AST scans and are implemented
in FAIL-MODE (exit non-zero on a non-exempt hit) in THIS phase: **(a)** raw `@google/genai` import
declarations; **(b)** banned Google symbol imports/aliases BOUND TO A BANNED MODULE only
(`GenerateContentResponse`, `Candidate`, `Part`, `PartListUnion`, `FunctionCall`, `Content`,
`SendMessageParameters`, `GenerateContentConfig`, `FinishReason`, `Type`, `Schema`, `Tool`,
`FunctionDeclaration`, `ApiError`, `GoogleGenAI`, `GenerateContentResponseUsageMetadata`,
`createUserContent` — the §1.3 list) — flagged ONLY when the specifier resolves to a banned module
(`@google/genai`/`core/clientContract`/`llm-types/geminiContent` or a resolver-proven re-export of those),
NOT when a same-named neutral/domain identifier is imported from a SAFE module; **(c)**
`Contract*` payload-type imports/aliases from `clientContract` (`ContractPart`/`ContractContent`/
`ContractContentUnion`/`ContractPartListUnion`/`ContractGenerateContentResponse`/
`ContractSendMessageParameters`/`ContractGenerateContentConfig`/`ContractUsageMetadata` — the exact
#2424 aliasing bypass); **(e)** enum RE-DECLARATION of `FinishReason`/`Type` (a local enum/const with
the Google enum's shape). These are cheap because they inspect import clauses + top-level
declarations, and they are the precise vectors #2424 used, so failing on them from the FIRST slice
prevents a re-introduction mid-migration. The EXPENSIVE structural checks (`checkF` structural-literal
F1/F3/F5, the `checkG-barrel` `GeminiContent*` barrel-import matcher, and `checkH` usage-key context
check) mature to full fail-mode at P31; here `checkF`/`checkG-call` run in COUNT mode (for the ratchet)
and (a)(b)(c)(e) run in FAIL mode.

> **Sequencing note for (a)(b)(c)(e) fail-mode during migration:** because the migration body has not
> run yet, the CURRENT tree HAS many raw imports / banned symbols / `Contract*` aliases (46 production
> importers, overview §3). Running (a)(b)(c)(e) in HARD fail-mode against the current tree would fail
> immediately. Therefore this phase wires (a)(b)(c)(e) fail-mode behind a `--enforce-imports` flag that
> is GREEN-on-clean and is asserted in the P02 verification against a FIXTURE (a re-introduced raw
> import / Contract alias / enum redecl must exit non-zero), while the DEFAULT run stays count-only until
> the tree is clean. Each migration slice's NNa additionally runs `--enforce-imports` scoped to THAT
> slice's just-migrated files, so a slice that migrates a file to neutral but re-introduces a raw import
> or `Contract*` alias in it FAILS immediately (not at P31). P31 flips `--enforce-imports` into the
> DEFAULT run once P27 reaches zero production importers. This gives real (a)(b)(c)(e) anti-#2424
> enforcement per-slice from P07 without a false global RED while the tree is mid-migration.

P29-P31 EXTEND this same script (the EXPENSIVE checks `checkF`-fail/`checkG-barrel`/`checkH` full
fail-mode, the test gate, CI wiring, npm scripts, central allow-list population, and flipping
`--enforce-imports` into the default run) — they do NOT create it from scratch, and they do NOT
re-implement (a)(b)(c)(e), which already have real fail-mode bodies from THIS phase.

## Prerequisites
- Required: Phase 01 completed and PASS.
- Verification: `test -f project-plans/issue2349/.completed/P01.md`
- Expected files from previous phase: `packages/core/stryker.conf.json` + `packages/core` `@stryker-mutator/*` devDeps + `test:mutation` script (P01 tooling; no `src/**` change).
- Preflight verification: Phase 0.5 completed — check 9 (a TypeScript parser is available: the `typescript` compiler API is always present;
  `ts-morph` optional) PASS — see `00a-preflight-verification.md` check 9.
- Pseudocode: `analysis/pseudocode/enforcement-gate.md` (this phase implements the input contract
  `resolveInputFiles` lines 9-9e (Critical 2 `--files`/`--root`/positional) + lines 20/26-35 `checkF`
  structural matchers + line 40-44 `--count`/`--by-file` modes + REAL fail-mode bodies for the cheap
  #2424 vectors (a)(b)(c)(e) at lines 10/12/14/18 via `runEnforceImports` lines 25a-25h behind
  `--enforce-imports` (Major 6); the EXPENSIVE checks `checkD`/`checkG-barrel`/`checkH` full fail-mode +
  `checkF`/`checkG-call` FAIL gate + the test gate are completed at P31).

## Requirements Implemented (Expanded)

### REQ-012.1 (partial — structural `--count`): Parser-based structural counter available early
**Full Text**: `scripts/agents-neutral-gate.ts` is an AST/parser-based check over `packages/agents/src`
production files detecting §8 checks (a)-(h). THIS phase implements the AST-context-aware structural
matcher (`checkF`: F1 `{candidates:[{content:{role?,parts?}}]}`, F3 `{role:'user'|'model', parts}`,
F5 generic `.parts` read/mutate on non-neutral values) plus the `toGeminiContent(s)` call matcher
(`checkG` call form) and a `--count` mode that prints ONLY the integer non-exempt structural-hit total.
The EXCLUDE list (checkF line 33-34: `*Candidate[]`/`PublicProfileCandidate[]`/
`CompressionLoadBalancerCandidate[]` domain candidates) is applied from day one so the count is precise.

> **`--count`/`--by-file` metric SCOPE (Major 2 — stable, documented, no silent mid-plan redefinition).**
> The `--count`/`--by-file` metric is defined as **the set of non-exempt hits from ALL checks IMPLEMENTED
> AT THAT TIME**. At P02 that is exactly: `checkA/B/C/E` (real, from Major 6) + `checkF` structural
> literals (F1/F3/F5) + `checkG-call` (the `toGeminiContent(s)` call matcher). The EXPENSIVE checks that
> are NOT yet implemented at P02 — `checkD` (round-trip symbols), `checkG-barrel` (`GeminiContent*`
> barrel imports), and `checkH` (usage keys) — are **DOCUMENTED AS ABSENT from the metric until P31**,
> where their real bodies land. Because `checkA/B/C/E` fire only under `--enforce-imports` (green-on-clean
> during migration — see the Purpose sequencing note), the DEFAULT `--count`/`--by-file` run reports the
> STRUCTURAL hits (`checkF` + `checkG-call`) that the shrink-ratchet drives to the bounded floor; the
> import/alias/enum vectors (A/B/C/E) are enforced as HARD FAILURES per-slice via `--enforce-imports`
> rather than counted. This gives ONE metric whose meaning is stable across every slice's ratchet
> language: **`--count` = non-exempt hits from the checks implemented at that time; deferred checks
> (D/G-barrel/H) join the metric ONLY at P31, and that join is an EXPLICIT documented re-baseline step
> in P31 (§"Re-baseline when D/G-barrel/H land"), never a silent redefinition.** `enforcement-gate.md`
> pseudocode `runCount()`/`collectAllHits()` (lines 40-48) describes the FINAL P31 detection surface
> (all of checkA..H); at P02 `collectAllHits()` collects only the checks implemented at that time, and
> the pseudocode's line 42 comment is annotated accordingly (the count grows to full checkA..H at P31
> with the documented re-baseline).

**Behavior**:
- GIVEN the current (pre-migration) `packages/agents/src` tree;
- WHEN `npx tsx scripts/agents-neutral-gate.ts --count` runs;
- THEN it prints a single nonzero integer = the AST-context-aware structural-hit total (`checkF` +
  `checkG-call`, allow-list-subtracted; domain `candidates`/neutral `.blocks` NOT counted; deferred
  `checkD`/`checkG-barrel`/`checkH` NOT yet included — see the metric-scope note above), which becomes
  the ratchet BASELINE ceiling.
**Why This Matters**: makes the shrink-ratchet precise (not broad grep) from the FIRST slice, so a
slice cannot fail for the wrong reason (a false positive) or pass while adding a hidden Google-shaped
adapter elsewhere (Major 4). It also puts real anti-#2424 structural detection in place before the
migration body runs (Major 5). The stable metric definition (Major 2) means the P07+ ratchet baseline
and the final P31 gate never silently diverge in meaning.

### REQ-012.2 (partial — allow-list artifact skeleton): central allow-list file exists
**Full Text**: `dev-docs/agents-neutral-gate-allowlist.md` records per exemption: exact file, permitted
AST-context pattern, written justification. Inline comments grant NOTHING (OQ-17). THIS phase creates
the artifact with headers + format spec (pseudocode lines 60-71) and NO entries yet (or only entries
already known to be permanent). The `--count` mode subtracts allow-listed hits so known bounded
exceptions are not counted ad hoc.
**Behavior**:
- GIVEN a structural hit whose file+AST-context matches an allow-list entry;
- WHEN `--count` runs;
- THEN that hit is EXEMPT (subtracted) via the central artifact — never via an inline comment.
**Why This Matters**: establishes the single authoritative exemption mechanism early so the ratchet
subtracts known false positives through the allow-list (Major 4), not through ad hoc reasoning.

## Implementation Tasks

### Files to Create
- `scripts/agents-neutral-gate.ts`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P02`, `@requirement:REQ-012.1`
  - Implement the parser plumbing (walk `packages/agents/src` production files; exclude
    `*.test.*`/`*.spec.*`/`__tests__`/`*-test-helpers*`) using the `typescript` compiler API.
  - **Implement the explicit INPUT-SCOPING CLI contract `resolveInputFiles(argv)` (Critical 2, pseudocode lines 9-9e):**
    the DEFAULT scan root is `packages/agents/src` (production-only globs), but it is OVERRIDABLE:
    (1) `--files <path...>` OR trailing positional file-path arguments evaluate EXACTLY those file(s);
    (2) `--root <dir>` replaces the scan root (same exclusion globs applied under `<dir>`);
    (3) when neither is given, the default scan runs; if both are given, `--files`/positional paths win.
    The AST checks + allow-list AST-context matching + `--count`/`--by-file`/`--enforce-imports` semantics are
    IDENTICAL regardless of input source — ONLY the file SET changes. `--count`, `--by-file`, and
    `--enforce-imports` all thread through `resolveInputFiles(argv)` so a fixture file path can be evaluated
    (this is what the P02 verification's `--enforce-imports scripts/__tests__/fixtures/<fixture>.ts` relies on).
  - Implement `checkF_structuralEnvelopes` (pseudocode lines 26-35): F1/F3/F5 structural matchers with
    the EXCLUDE guard for domain `*Candidate[]` (lines 33-34). Neutral IContent (`.blocks`) is NEVER a hit.
  - Implement the `toGeminiContent(s)(` call matcher (checkG call form, line 21) — a real migration
    signal present today.
  - Implement `parseAllowlist(...)` + `allowlist.matchesAstContext(hit)` (lines 11, 23) so `--count`
    subtracts centrally allow-listed hits (OQ-17: AST-context match only; inline comments grant nothing).
  - Implement a working `--count` mode (pseudocode lines 40-44): print ONLY the integer non-exempt
    structural-hit total. Exit 0.
  - Implement a `--by-file` detail mode (pseudocode lines 45-48) that prints, for each non-exempt hit,
    a STABLE per-site identity line: `<relative-file-path>:<line>:<checkF-subkind F1|F3|F5|G-call>` plus a
    short AST-context snippet. This is the AUTHORITATIVE per-site listing the migration slices use for
    Major-4 site-specific closure (each slice asserts its OWNED baseline hit IDs are ABSENT here), and the
    P33 §2A.4 inventory-closure gate consumes it. `--by-file` and `--count` share the SAME detection logic
    (so a hit counted is a hit listed); `--by-file` may also be combined with `--count` output for auditing.
  - **Major 6 — implement REAL fail-mode bodies for the cheap #2424 vectors (a)(b)(c)(e):**
    - `checkA_rawGenaiImports` (pseudocode line 10): flag any `import ... from '@google/genai'` declaration in a production file.
    - `checkB_bannedSymbols` (pseudocode line 12): flag import/alias of any §1.3 banned Google symbol ONLY when it is BOUND to a BANNED MODULE — `@google/genai`, `core/clientContract`, `llm-types/geminiContent`, OR an identified re-export module that itself re-exports one of those banned bindings (resolver-proven). This keys on IMPORT BINDING/PROVENANCE, NOT the bare symbol name from any module: names like `Content`/`Type`/`Schema`/`Tool` are legitimate NEUTRAL/domain identifiers when imported from a SAFE module and MUST be spared (see the false-positive fixtures below). Do NOT flag a banned NAME imported from a safe module; only a banned name whose specifier resolves to a banned binding.
    - `checkC_contractAliases` (pseudocode line 14): flag import/alias of any `Contract*` payload type from `clientContract` (the exact #2424 aliasing vector).
    - `checkE_enumRedeclarations` (pseudocode line 18): flag a local `enum`/`const` re-declaration of `FinishReason`/`Type` matching the Google enum shape.
    These four run behind a `--enforce-imports` flag (GREEN-on-clean; see the Purpose sequencing note): the DEFAULT `--count` run does NOT hard-fail on them yet (the tree is mid-migration), but `--enforce-imports` DOES exit non-zero on a non-exempt hit, and the P02 verification proves that on FIXTURES. `checkA/B/C/E` respect the central allow-list AST-context match (never inline comments).
  - STUB the EXPENSIVE fail-mode checks (`checkD` round-trip-symbol, `checkG-barrel` `GeminiContent*` barrel-import, `checkH` usage-key context) as functions returning `[]` with a
    signature + a `// full fail-mode implemented at P31 (extends this skeleton)` structural note — NOT a TODO in the
    deferred-impl sense; P31's TDD (P30) drives their real bodies. `checkF` structural-literal + `checkG-call` run in COUNT mode here (feeding `--count`/`--by-file`); their full FAIL gate matures at P31. The default (no-flag) run exits 0 on the current mid-migration tree; the full FAIL gate behavior is completed at P31.
  - `@pseudocode lines 9-44` (INCLUDING `resolveInputFiles` lines 9-9e + `runEnforceImports` lines 25a-25h — the Critical 2 `--files`/`--root`/positional input contract).

- `dev-docs/agents-neutral-gate-allowlist.md`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P02`, `@requirement:REQ-012.2`
  - Headers + format spec per pseudocode lines 60-71 (exact file, permitted AST-context pattern,
    written justification; RULE: inline `// gate-exempt` grants nothing). No entries yet unless a
    permanent one (e.g. the G3 hook-wire adapter in `streamRequestHelpers.ts`) is already known — if so,
    add it with its AST-context justification; otherwise leave the entry list empty with the format spec.

- `scripts/__tests__/fixtures/clean-neutral.ts`
  - A CLEAN neutral fixture (zero #2424 vectors): imports only neutral types (`IContent`/`ContentBlock`
    from core), constructs `{ speaker:'ai', blocks:[{ type:'text', text:'ok' }] }`, uses `.blocks` only.
    NO `@google/genai` import, NO banned symbol, NO `Contract*` alias, NO `FinishReason`/`Type` enum.
    `--enforce-imports` MUST exit 0 on this file. `@plan:PLAN-20260707-AGENTNEUTRAL.P02`, `@requirement:REQ-012.1`.
- `scripts/__tests__/fixtures/raw-genai-import.ts`
  - A NEGATIVE fixture triggering `checkA_rawGenaiImports`: `import { Content } from '@google/genai'`.
    `--enforce-imports` MUST exit non-zero on this file. `@requirement:REQ-012.1`.
- `scripts/__tests__/fixtures/banned-symbol.ts`
  - A NEGATIVE fixture triggering `checkB_bannedSymbols`: imports a §1.3 banned Google symbol
    (e.g. `GenerateContentResponse`) from a BANNED MODULE that is not the raw `@google/genai` specifier —
    i.e. from `core/clientContract` or `llm-types/geminiContent` (or a resolver-proven re-export of a banned
    binding), proving checkB catches the symbol by PROVENANCE (banned-module binding), not by raw
    `@google/genai` import alone. `--enforce-imports` MUST exit non-zero. `@requirement:REQ-012.1`.
- `scripts/__tests__/fixtures/safe-neutral-names.ts`
  - A FALSE-POSITIVE-GUARD fixture: imports the SAME-NAMED identifiers `Content`, `Tool`, `Schema` (and
    `Type`) from a SAFE, non-banned module (e.g. a local neutral domain module `./safe-domain-types`,
    NOT `@google/genai`/`clientContract`/`geminiContent`), used as legitimate neutral/domain types. checkB
    MUST SPARE these (they are banned NAMES but bound to a SAFE module — provenance, not name). `--enforce-imports`
    MUST exit 0 on this file. This proves checkB keys on import BINDING/provenance, not the bare symbol name
    (Major 4). `@requirement:REQ-012.1`.
- `scripts/__tests__/fixtures/contract-alias.ts`
  - A NEGATIVE fixture triggering `checkC_contractAliases`: `import { ContractContent } from '.../clientContract'`
    (the exact #2424 aliasing vector). `--enforce-imports` MUST exit non-zero. `@requirement:REQ-012.1`.
- `scripts/__tests__/fixtures/finishreason-enum.ts`
  - A NEGATIVE fixture triggering `checkE_enumRedeclarations`: a local `enum FinishReason { STOP='STOP' }`
    (Google-enum-shaped re-declaration). `--enforce-imports` MUST exit non-zero. `@requirement:REQ-012.1`.
  - **Fixture ownership note:** P02 CREATES these SIX fixtures (clean-neutral, raw-genai-import,
    banned-symbol, contract-alias, finishreason-enum, safe-neutral-names) because P02's own verification
    proves `--enforce-imports` fail-mode (and the checkB false-positive-sparing) against them (Critical 2 +
    Major 4). P30 REUSES/EXTENDS the SAME fixtures for the full-gate TDD (P30 adds the EXPENSIVE-check
    fixtures `{candidates}`/`x as GenerateContentResponse`/`{role,parts}`/raw-import-free `.parts`
    mutator/`toGeminiContents` call/usage-key + the additional false-positive guards); it does NOT
    re-create these #2424-vector + safe-neutral fixtures. Do NOT defer these six to P30.

- `dev-docs/agents-neutral-gate-baseline.md`
  - MUST include: `@plan:PLAN-20260707-AGENTNEUTRAL.P02`, `@requirement:REQ-012.1`
  - Record the BASELINE ceiling as a MACHINE-PARSEABLE line `count=<integer>` (the integer printed by
    `npx tsx scripts/agents-neutral-gate.ts --count` against the CURRENT tree), plus the exact command used.
    This is the ratchet ceiling that P07 onward must strictly decrease. (P07 onward does NOT create this file;
    each slice APPENDS a new `count=<integer> owner=<PNN>` line — the LAST `count=` line is the current
    ceiling — see the per-slice ratchet edits.) The stable format lets each slice's NNa read the prior ceiling
    with `grep -oE 'count=[0-9]+' ... | tail -1`.
  - ALSO record the FULL `--by-file` per-site listing (the stable `<file>:<line>:<subkind>` hit IDs) as
    the frozen per-site baseline, ONE HIT PER LINE, each tagged with its OWNING phase in the exact form
    `<file>:<line>:<subkind> owner=<PNN>` (e.g. `streamResponseHelpers.ts:299:F3 owner=P07`). This owner tag is
    what each migration slice's NNa uses for Major-4 site-specific closure: a slice reads its OWNED hit IDs via
    `grep -F 'owner=<PNN>'` and asserts each is ABSENT in the current `--by-file` output, in ADDITION to the net
    `--count` strictly decreasing. Later slices UPDATE the listing (remove the IDs they closed); the IDs must
    only ever be removed by their owning slice, never silently reappear. The owner attribution for every §2A.4
    site is the P33 §2A.4 inventory-closure map (P33) — P02 seeds the `owner=<PNN>` tags from that map.

### Required Code Markers
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P02
 * @requirement:REQ-012.1
 * @pseudocode lines 9-44
 */
```

## Verification Commands
```bash
# Script + artifacts exist and run
npx tsx scripts/agents-neutral-gate.ts --count            # prints a single NONZERO integer (the baseline)
test -f dev-docs/agents-neutral-gate-allowlist.md
test -f dev-docs/agents-neutral-gate-baseline.md
grep -nE '@plan:PLAN-20260707-AGENTNEUTRAL\.P02' scripts/agents-neutral-gate.ts

# The count is AST-context-aware, NOT broad grep: a domain `candidates: SomeCandidate[]` line must NOT
# be counted. Prove it by confirming the known domain sites are NOT in the hit list.
npx tsx scripts/agents-neutral-gate.ts --count --explain 2>/dev/null | grep -E "CompressionLoadBalancingProvider|CompressionProfileResolver|profilesControl" && echo "FAIL: domain candidate counted" || echo "domain candidates correctly excluded"

# Baseline integer recorded
grep -oE '[0-9]+' dev-docs/agents-neutral-gate-baseline.md | head -1

# ---- MAJOR 6 + CRITICAL 1: (a)(b)(c)(e) fail-mode present and REAL (not stubbed) — HARD-ASSERTED on fixtures ----
# The five fixtures are CREATED by THIS phase (Files to Create). --enforce-imports MUST exit 0 on the clean
# fixture and NON-ZERO on each #2424 vector fixture. These are MECHANICAL assertions (Major 5): the phase
# FAILS (exit 1) if any expectation is violated — no echo-and-continue.
test -f scripts/__tests__/fixtures/clean-neutral.ts
test -f scripts/__tests__/fixtures/raw-genai-import.ts
test -f scripts/__tests__/fixtures/banned-symbol.ts
test -f scripts/__tests__/fixtures/contract-alias.ts
test -f scripts/__tests__/fixtures/finishreason-enum.ts
test -f scripts/__tests__/fixtures/safe-neutral-names.ts
# CLEAN fixture: gate MUST exit 0 (fail the phase if it does not).
if ! npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/clean-neutral.ts; then echo "FAIL: gate flagged the CLEAN fixture"; exit 1; fi
# NEGATIVE fixtures: gate MUST exit non-zero on EACH (fail the phase if any passes).
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/raw-genai-import.ts;  then echo "FAIL: checkA did not flag raw @google/genai import"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/banned-symbol.ts;     then echo "FAIL: checkB did not flag banned Google symbol"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/contract-alias.ts;    then echo "FAIL: checkC did not flag Contract* alias"; exit 1; fi
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/finishreason-enum.ts; then echo "FAIL: checkE did not flag FinishReason enum redeclaration"; exit 1; fi
# MAJOR 4 — checkB is PROVENANCE-based: a banned NAME from a SAFE module MUST be SPARED (exit 0),
# proving checkB keys on import binding/provenance, not the bare symbol name.
if ! npx tsx scripts/agents-neutral-gate.ts --enforce-imports scripts/__tests__/fixtures/safe-neutral-names.ts; then echo "FAIL(Major 4): checkB false-flagged neutral Content/Tool/Schema imported from a SAFE module"; exit 1; fi
echo "PASS: --enforce-imports green on clean + safe-neutral, red on each (a)(b)(c)(e) vector fixture"
# Prove (a)(b)(c)(e) are NOT stubs: their bodies must reference real AST inspection, not `return []`.
grep -nE "checkA_rawGenaiImports|checkB_bannedSymbols|checkC_contractAliases|checkE_enumRedeclarations" scripts/agents-neutral-gate.ts
grep -nE "checkA_rawGenaiImports|checkB_bannedSymbols|checkC_contractAliases|checkE_enumRedeclarations" scripts/agents-neutral-gate.ts | wc -l   # >=4 (defined + invoked)
# Guard against regression to stubs: none of the four cheap-check bodies may be `return []`.
# (Extract each function body and assert it is not a bare `return []`.)
for fn in checkA_rawGenaiImports checkB_bannedSymbols checkC_contractAliases checkE_enumRedeclarations; do
  if awk "/function $fn|const $fn/{f=1} f&&/return \[\]/{print; found=1} f&&/^}/{f=0} END{exit found?0:1}" scripts/agents-neutral-gate.ts; then
    echo "FAIL: $fn is stubbed to return [] — must be a REAL fail-mode body (Major 6 / Critical 2)"; exit 1; fi
done
echo "PASS: checkA/B/C/E are real (no return [] stub body)"

# ---- CRITICAL 2: the explicit input-scoping CLI contract (--files / positional / --root) is REAL ----
# The --enforce-imports fixture assertions above depend on the gate EVALUATING THE GIVEN FILE PATH, not the
# default packages/agents/src scan. Prove the input contract is actually implemented (not silently ignored):
# (1) A positional/--files fixture path is evaluated as-given: the raw-genai fixture must flag under BOTH the
#     bare positional form AND the explicit --files form (identical result → the path is really the scan input).
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports --files scripts/__tests__/fixtures/raw-genai-import.ts; then echo "FAIL(Critical 2): --files did not scope the scan to the given fixture"; exit 1; fi
# (2) The clean fixture passes under --files (the given file — NOT the mid-migration tree — is what is scanned;
#     if the default packages/agents/src scan were used instead, it would be RED today and this would wrongly fail).
if ! npx tsx scripts/agents-neutral-gate.ts --enforce-imports --files scripts/__tests__/fixtures/clean-neutral.ts; then echo "FAIL(Critical 2): --files still scanned the default tree instead of the given clean fixture"; exit 1; fi
# (3) --root override: pointing the scan root at the fixtures dir must evaluate those fixtures (RED — they contain vectors),
#     proving --root replaces the default packages/agents/src root.
if npx tsx scripts/agents-neutral-gate.ts --enforce-imports --root scripts/__tests__/fixtures; then echo "FAIL(Critical 2): --root did not override the default scan root"; exit 1; fi
echo "PASS(Critical 2): --files/positional and --root input-scoping contract is real (resolveInputFiles honored)"

npm run typecheck
```

## Success Criteria
- `scripts/agents-neutral-gate.ts --count` prints a single nonzero integer using AST-context-aware
  `checkF`/`checkG-call` logic (domain `*Candidate[]` excluded), NOT a broad grep.
- **Major 6:** the cheap #2424 vectors (a)(b)(c)(e) have REAL fail-mode bodies (`checkA_rawGenaiImports`,
  `checkB_bannedSymbols`, `checkC_contractAliases`, `checkE_enumRedeclarations`) wired behind
  `--enforce-imports`: GREEN on the clean-neutral fixture and RED (exit non-zero) on each vector fixture.
  They are NOT stubbed. Only the EXPENSIVE checks (`checkD`/`checkG-barrel`/`checkH`) and the
  `checkF`/`checkG-call` FAIL gate are deferred to P31.
- The allow-list artifact + baseline file exist; the baseline integer is recorded with its command.
- The deferred EXPENSIVE checks are stubbed (return `[]`) with a structural note that P31 extends them;
  NO deferred-impl TODO/HACK; NO test asserts `NotYetImplemented`.
- `npm run typecheck` green; no lint/complexity loosening; no suppression directives; NO inline-comment
  exemption mechanism (only the central allow-list).

## Failure Recovery
If this phase fails (count is zero/broad-grep-like, domain candidates counted, or script does not run):
1. `git checkout -- scripts/agents-neutral-gate.ts` and remove the artifact files.
2. Re-implement `checkF` structurally per pseudocode lines 26-35 (F1/F3/F5 + EXCLUDE lines 33-34); do
   NOT fall back to bare-name grep. Implement REAL fail-mode bodies for the CHEAP vectors (a)(b)(c)(e)
   behind `--enforce-imports` (Major 6); do NOT add real fail-mode bodies for the EXPENSIVE checks
   `checkD`/`checkG-barrel`/`checkH` or the `checkF`/`checkG-call` FAIL gate (those are P31).
3. Cannot proceed to Phase 03 until `--count` prints a precise nonzero baseline, `--enforce-imports`
   is RED on each (a)(b)(c)(e) vector fixture and GREEN on the clean fixture, and the artifacts exist.

## Phase Completion Marker
Create `project-plans/issue2349/.completed/P02.md` with:
- The pasted `--count` output (the baseline integer) + the `--explain` proof that domain candidates are
  excluded.
- **Critical 1 evidence (REAL, pasted):** the pasted exit codes proving `--enforce-imports` exits **0** on
  `scripts/__tests__/fixtures/clean-neutral.ts` and **non-zero** on EACH of `raw-genai-import.ts` (checkA),
  `banned-symbol.ts` (checkB), `contract-alias.ts` (checkC), `finishreason-enum.ts` (checkE) — i.e. paste
  the `PASS: --enforce-imports green on clean, red on each (a)(b)(c)(e) vector fixture` line and the
  underlying command outputs. NOT an "expect non-zero" echo — the mechanical `if`-guarded assertions above.
- **Major 2 evidence:** the `--count`/`--by-file` metric-scope note is recorded (checks implemented at P02 =
  A/B/C/E + checkF + checkG-call; D/G-barrel/H join at P31 via the documented re-baseline).
- **Critical 2 evidence (input contract):** the pasted `PASS(Critical 2): --files/positional and --root
  input-scoping contract is real` line + the underlying `--files`/`--root` command outputs, proving
  `resolveInputFiles(argv)` (pseudocode lines 9-9e) overrides the default `packages/agents/src` scan so the
  fixture-path `--enforce-imports` assertions actually evaluate the given file.
- Confirmation the allow-list + baseline + the five fixture files exist with the recorded integer + command.
- The `@plan:PLAN-20260707-AGENTNEUTRAL.P02` / `@requirement:REQ-012.1/.2` markers.
