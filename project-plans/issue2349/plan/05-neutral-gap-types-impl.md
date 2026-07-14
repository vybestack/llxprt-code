# Phase 05: Neutral gap types — IMPL

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P05`

## Prerequisites
- Required: Phase 04 completed (tests exist, failing).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P04" packages/core/src/llm-types`
- Expected files from previous phase: `packages/core/src/llm-types/__tests__/agentMessageInput.test.ts`, `.../modelEnvelope.test.ts` (behavioral + property tests, currently failing).
- Required: Phase 01 completed — `packages/core` Stryker tooling provisioned (`packages/core/stryker.conf.json`
  + `@stryker-mutator/*` devDeps + `test:mutation` script). Verification:
  `grep -n '"test:mutation"' packages/core/package.json && test -f packages/core/stryker.conf.json`.
  This makes the mutation gate below an EXECUTABLE command (C3).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/neutral-gap-types.md` — follow line numbers EXACTLY.

## Requirements Implemented (Expanded)

### REQ-001.1: AgentMessageInput neutral DTO
**Full Text**: `AgentMessageInput` neutral DTO replaces `PartListUnion` as the agent/turn user-message + initial-request input. Structure supports text, media, tool responses, and tool-call IDs with NO Google `Part`/`role` shape.
**Behavior**:
- GIVEN: string/`ContentBlock[]`/`IContent`/`IContent[]`
- WHEN: converted
- THEN: `IContent[]` with no Google shape.
**Why This Matters**: removes the primary Google-shaped input vector.

### REQ-001.2: Lossless legacy→IContent converter + neutral block→IContent helper
**Full Text**: A lossless legacy→`IContent` converter owns conversion of legacy input, preserving thought signatures, media, tool responses, and tool-call IDs. It MUST NOT be one of the §5.4 lossy paths on any thinking-bearing path. **Additionally (C4), `iContentFromBlocks(blocks, speaker?)` wraps already-neutral `ContentBlock[]` into ONE `IContent` for the AfterModel hook filtering paths (P07/P13) — the real shared helper replacing the former phantom name.**
**Behavior**:
- GIVEN: legacy input
- WHEN: converted
- THEN: thoughtSignature/media/toolResponse/toolCallId preserved; unsupported → `{ok:false,error}` (ES-2).
- GIVEN: neutral `ContentBlock[]`; WHEN: `iContentFromBlocks(blocks, speaker?)`; THEN: `{ speaker: speaker ?? 'ai', blocks }` with no Google shape (C4).
**Why This Matters**: no lossy conversion of legacy input, esp. thinking signatures (BR-5); and P07/P13 get a real, tested block→IContent helper for the after-model event path.

### REQ-001.3: Turn-level neutral request DTO
**Full Text**: Turn-level neutral request DTO replaces `SendMessageParameters` (reuse/extend `ModelGenerationRequest` or a sibling `AgentGenerationRequest`), carrying message + generation settings neutrally.
**Behavior**:
- GIVEN: a legacy message+config call
- WHEN: expressed via `sendParamsToRequest`
- THEN: a `ModelGenerationRequest` (`contents: IContent[]` + `settings`) with NO `GenerateContentConfig`/`PartListUnion`.
**Why This Matters**: removes the `SendMessageParameters` Google-shaped input vector at every turn-send call site.

### REQ-001.4: ModelOutput.afcHistory slot
**Full Text**: `ModelOutput.afcHistory?: IContent[]` first-class neutral AFC slot so `automaticFunctionCallingHistory` survives synthetic-response removal on BOTH streaming and direct paths with identical slicing/hook-restriction-filter semantics.
**Behavior**:
- GIVEN: `afcHistory: IContent[]`
- WHEN: accumulated
- THEN: preserved as `IContent[]`.
**Why This Matters**: AFC survives synthetic-response deletion without a Google-shaped detour.

### REQ-001.5: Neutral chunk preserves provider metadata
**Full Text**: Neutral chunk conversion preserves response-level provider metadata (`responseId`, provider `providerMetadata` under `gemini.*`) per the OQ-16 disposition, NOT silently dropped by plain `toModelStreamChunk`; block-level metadata carried by reference.
**Behavior**:
- GIVEN: `metadata.providerMetadata`/`metadata.id`/block-level metadata
- WHEN: converted
- THEN: all survive onto the chunk.
**Why This Matters**: closes the OQ-16 provider-metadata gap.

## Implementation Tasks (make ALL P04 tests pass)

### `packages/core/src/llm-types/agentMessageInput.ts`
- `iContentFromAgentMessageInput` — pseudocode lines 11-20.
- `iContentFromLegacyInput` — lines 21-27 (returns Result; never throws for control flow; never silent-drops).
- `mapLegacyParts` — lines 28-38 (BR-5 thoughtSignature via ThinkingBlock; unsupported → err).
- `legacyContentToIContent` — lines 39-41 (speaker from role; NO `.role`/`.parts` in output).
- **`iContentFromBlocks` — lines 42-48 (REQ-001.2, C4):** build ONE neutral `IContent` from already-neutral `ContentBlock[]`; `speaker` defaults to `'ai'`; return a NEW object `{ speaker: speaker ?? 'ai', blocks }` with ONLY `speaker`/`blocks` keys (NO `role`/`parts`/`candidates`); do NOT mutate the input `blocks`. This is the real shared helper P07 (streaming after-model) and P13 (direct after-model) call.
- `sendParamsToRequest` — lines 76-77 (REQ-001.3): map `AgentMessageInput` + `settings` → `ModelGenerationRequest`; assert no Google-shaped keys leak.
- Input typed `unknown` with structural guards — NO `@google/genai` import.
- Markers: `@plan:PLAN-20260707-AGENTNEUTRAL.P05`, `@requirement:REQ-001.1/.2/.3`, `@pseudocode lines 10-82`.

### `packages/core/src/llm-types/modelEnvelope.ts`
- Extend `toModelStreamChunk` — pseudocode lines 52-66 (preserve `responseId`, response-level `providerMetadata`; do NOT strip block-level metadata).
- `afcHistory` already added in P03; confirm it round-trips through `accumulateModelStreamChunk`.
- Markers: `@plan:PLAN-20260707-AGENTNEUTRAL.P05`, `@requirement:REQ-001.4/.5`, `@pseudocode lines 50-66`.

## Constraints
- Do NOT modify P04 tests. UPDATE existing files (no V2). Immutable (return NEW objects). No `any`/type assertions. No suppression directives.
- **Type predicates, NOT `as` casts (Additional Risk 3 / RULES.md §78-83):** the lossless legacy converter (input typed `unknown`) and EVERY legacy-shape branch MUST narrow via `(x: unknown): x is T` type predicates (`isLegacyPartArray`/`isLegacyContent`/`isLegacyContentArray`/`isIContent`/`isContentBlockArray`). ZERO `as`/`as unknown as` casts anywhere in the converter or its branches — verified by `grep -nE "\bas\b (unknown|[A-Z])" packages/core/src/llm-types/agentMessageInput.ts` ⇒ EMPTY.

## Verification Commands
```bash
npm test -- packages/core/src/llm-types/agentMessageInput.test.ts packages/core/src/llm-types/modelEnvelope.afc-providerMetadata.test.ts   # ALL pass
npm run typecheck && npm run build
if grep -rnE "TODO|FIXME|in a real|placeholder" packages/core/src/llm-types/agentMessageInput.ts; then echo "FAIL: deferred-impl marker in agentMessageInput.ts"; exit 1; fi
if grep -rn "@google/genai" packages/core/src/llm-types/agentMessageInput.ts; then echo "FAIL: @google/genai import in neutral gap type"; exit 1; fi
```

## Success Criteria
- All P04 tests green (incl. REQ-001.2 `iContentFromBlocks` [C4], REQ-001.3 `sendParamsToRequest`, and REQ-001.5 providerMetadata tests); monorepo build green (build-green checkpoint after P05); no deferred-impl markers.
- Mutation gate (verification-template §8) — HARD ≥80%, EXECUTABLE via the P01-provisioned core Stryker
  tooling (no tooling changes in this production phase). Run the EXACT command below from the repo root,
  scoped with `--mutate` to the two files this phase changed, and parse `mutation.json` (hard-fail <80):
  ```bash
  # Uses packages/core/stryker.conf.json + test:mutation (provisioned in P01). Scope to the CHANGED files only.
  npm --prefix packages/core run test:mutation -- \
    --mutate "src/llm-types/agentMessageInput.ts" \
    --mutate "src/llm-types/modelEnvelope.ts"
  node -e "const r=require('./packages/core/reports/mutation/mutation.json');const f=Object.values(r.files);const k=f.flatMap(x=>x.mutants).filter(m=>['Killed','Timeout'].includes(m.status)).length;const t=f.flatMap(x=>x.mutants).filter(m=>m.status!=='Ignored'&&m.status!=='NoCoverage').length;const s=100*k/Math.max(t,1);console.log('mutationScore='+s.toFixed(2));process.exit(s>=80?0:1)"
  ```
  The scoped run MUST exit 0 (Stryker's own `break:80` threshold fails below 80; the parse re-checks).
  Paste the `mutationScore=` line + surviving-mutant summary into the P05a completion marker.

## Failure Recovery
If this phase fails (a P04 test stays red, build breaks, deferred-impl markers present, or mutation <80%):
1. `git checkout -- packages/core/src/llm-types/agentMessageInput.ts packages/core/src/llm-types/modelEnvelope.ts packages/core/src/llm-types/index.ts`
2. Re-implement strictly against `neutral-gap-types.md` lines 10-82; do NOT edit P04 tests to pass.
3. Cannot proceed to Phase 06 until all P04 tests pass and the mutation gate is met.

## Phase Completion Marker
`project-plans/issue2349/.completed/P05.md`.
