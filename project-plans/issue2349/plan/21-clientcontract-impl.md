# Phase 21: clientContract cross-package neutralization — IMPL (core + 23 CLI + 5 core consumers)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P21`

## Prerequisites
- Required: Phase 20 completed (safety net green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P20" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/api/__tests__/clientContract.characterization.spec.ts` (history round-trip clone + idle-wait, direct-message observable output, stream event sequence — PASSING against current Google-shaped surface).
- Preflight verification: Phase 0.5 completed — check 6 re-counts the 23 CLI + 5 core `Contract*` consumers (Appendix A.2/A.3); the generated consumer inventory (below) is refreshed from that evidence BEFORE the flip (Minor 2).
- Pseudocode: `analysis/pseudocode/clientcontract-neutralization.md` — follow line numbers EXACTLY.

## Requirements Implemented (Expanded)

### REQ-009.1: Contract* payload types deleted
**Full Text**: The Google-shaped payload types (`ContractPart`/`ContractContent`/`ContractContentUnion`/`ContractPartListUnion`/`ContractGenerateContentConfig`/`ContractGenerateContentResponse`/`ContractSendMessageParameters`/`ContractUsageMetadata`) are removed from `packages/core/src/core/clientContract.ts`. `IContent` MUST NOT be aliased back to `ContractContent` (the #2424 trap).
**Behavior**:
- GIVEN: the flip
- WHEN: the tree is searched
- THEN: zero `Contract*` payload-type references remain in core/cli/agents production.
**Why This Matters**: the corollary from the governing principle — the contract itself was Google-shaped and must be fixed, not worked around.

### REQ-009.2: Client-surface interfaces retyped neutral (INCLUDES the getHistory return-type flip + G1/G2 deletion — Major 3)
**Full Text**: `AgentClientContract`/`AgentChatContract` member signatures are retyped to `IContent`/`ModelOutput`/`ModelGenerationSettings`/`AgentMessageInput`; the surface interfaces survive; `getHistory` returns `IContent[]`, `generateDirectMessage` returns `ModelOutput`, `sendMessageStream` takes `AgentMessageInput`. The `getHistory` return-type flip and the **G1** (`client.ts:420-422`) + **G2** (`ConversationManager.ts:412-424`) `toGeminiContents` deletions land HERE (moved from P15, Major 3), atomic with the migration of every cross-package `getHistory` caller (CLI: `checkpointPersistence.ts`, `chatCommand.ts`, `copyCommand.ts`; core: `agentClientLifecycle.ts`, `config.ts`, `checkpointUtils.ts`; agents-internal: `chatSession.ts`, `turn.ts`, `agentImpl.ts`, `sessionControl.ts`).
**Behavior**:
- GIVEN: the P20 characterization (history round-trip CLONE + idle-wait, direct-message OBSERVABLE visible text/usage, stream event SEQUENCE — P20 asserts observable behavior, NOT the neutral types)
- WHEN: the surface is flipped
- THEN: those tests stay green AND the NEW type-surface assertions (`generateDirectMessage` returns `ModelOutput`; `sendMessageStream` takes `AgentMessageInput`; `getHistory` returns `IContent[]` with idle-wait + defensive clone PRESERVED) become provable HERE/P21a, the G1/G2 `toGeminiContents` boundary conversions are GONE, and the public `ServerAgentStreamEvent`/`StreamEvent` shapes are unchanged.
**Why This Matters**: neutralizes the cross-package contract that all CLI/core consumers depend on; the `getHistory` flip is done HERE (not P15) so the monorepo build never has a boundary where `client.ts`/`ConversationManager.ts` are neutral but the public contract still requires `Content[]` (Major 3).

### REQ-INT-002: CLI + core consumers migrated (build-green in ONE phase, OQ-4)
**Full Text**: The 23 CLI (Appendix A.2) + 5 core (Appendix A.3) production consumers compile against the neutral surface IN THE SAME PHASE as the contract flip; the whole monorepo `npm run build` is green at phase end. Consumers read `c.blocks`, not `.parts`.
**Behavior**:
- GIVEN: the atomic flip
- WHEN: the monorepo builds
- THEN: all 28 consumers compile and the build is green — no intermediate broken state is committed.
**Why This Matters**: the contract flip is a hard cross-package boundary; staging it would leave the build red between phases (OQ-4 decided this is an atomic phase).

## Implementation Tasks (single build-green phase — OQ-4 STEP C)

### `packages/core/src/core/clientContract.ts`
- DELETE payload types (pseudocode lines 10-18). RETYPE `AgentClientContract`/`AgentChatContract` members (lines 20-41) to neutral (`IContent`/`ModelOutput`/`ModelGenerationSettings`/`AgentMessageInput`).

### Required Code Markers
EVERY retyped interface member / touched function MUST carry the marker block with the SPECIFIC `@pseudocode` line range (from `clientcontract-neutralization.md`), not only the prose "lines 10-18/20-41" bullets:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P21
 * @requirement:REQ-009.2
 * @pseudocode lines 20-41   // AgentClientContract/AgentChatContract neutral retype (per-member range)
 */
```
- Payload-type deletion (`ContractPart`/`ContractContent`/…) → `@pseudocode lines 10-18`; `@requirement:REQ-009.1`.
- `AgentClientContract.getHistory` (now `Promise<IContent[]>`, G1 deletion — moved here from P15, see Major 3 note) → `@pseudocode lines 20-41`; `@requirement:REQ-009.2`, `@requirement:REQ-010.1`.
- `ConversationManager.getHistory` (now `IContent[]`, G2 deletion — moved here from P15) → `@pseudocode lines 20-41`; `@requirement:REQ-009.2`, `@requirement:REQ-010.1`.
- `AgentClientContract.generateDirectMessage`/`AgentChatContract.sendMessageStream` neutral members → `@pseudocode lines 20-41`; `@requirement:REQ-009.2`.
- `client.ts` surface implementation + 23 CLI + 5 core consumers → `@requirement:REQ-INT-002` (annotate each retyped call site; consumer edits follow the same `clientcontract-neutralization.md` surface, no per-consumer pseudocode function).
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P21`, `@requirement:REQ-009.1/.2/REQ-010.1/REQ-INT-002`, plus the per-member `@pseudocode lines X-Y` above.

### `packages/agents/src/core/client.ts` (implements surface) + `packages/agents/src/core/ConversationManager.ts` — getHistory flip (Major 3, moved from P15)
- Retype method signatures to match the neutral surface; internal `generateContentConfig` → `ModelGenerationSettings`; drop `@google/genai`.
- `AgentClient.getHistory()` → flip return type to `Promise<IContent[]>`; DELETE the **G1** `toGeminiContents` at the stored-history path (`client.ts:420-422`); PRESERVE the idle-wait (`waitForIdle()`) and the defensive clone (return a clone of the neutral `IContent[]`, not a live reference). Update the chat-live path (`:413`) and `_previousHistory` path to return `IContent[]`.
- `ConversationManager.getHistory()` → flip return type to `IContent[]`; DELETE the **G2** `toGeminiContents` (`ConversationManager.ts:412-424`); return `structuredClone` of the neutral `IContent[]` (defensive clone preserved).
- Update the agents-internal `getHistory` callers to the neutral type: `chatSession.ts:503` (passthrough), `turn.ts:629` (`[...getHistory(true), req]` now `IContent[]`), `agentImpl.ts:842` (drop the `as readonly AgentMessage[]` cast or adapt to neutral), `agentImpl.ts:1244`, `sessionControl.ts:194/313` (drop the `as Content[]` casts). These are inside `packages/agents` and MUST compile at phase end.

### 23 CLI consumers (Appendix A.2 — EXACT paths embedded below; retype together)
- Edit EVERY file in Appendix A.2 (the exact 23 sorted paths). Replace `Contract*`/`Content` variables with `IContent`/`ModelOutput`; read `c.blocks` not `.parts`.
- Markers `@requirement:REQ-INT-002`.

### 5 core consumers (Appendix A.3 — EXACT paths embedded below)
- Edit EVERY file in Appendix A.3 (the exact 5 sorted paths) → neutral `IContent[]`/`ModelOutput`.

## Checkpointed diff review BEFORE completion (Additional Risk 1 — MANDATORY)
This is the highest-blast-radius atomic phase (core contract + agents client + 23 CLI + 5 core + getHistory flip). Before P21 is marked complete:
1. Produce the FULL cross-package diff on the dedicated sub-branch: `git diff --stat main...HEAD` (must list core clientContract.ts, agents client.ts/ConversationManager.ts, the 23 CLI files, the 5 core files, and the getHistory callers) AND `git diff main...HEAD`.
2. A **deepthinker** checkpointed diff review (named reviewer, per execution-tracker P21 "deepthinker verify") MUST read the full diff and confirm: (a) every intended file in the embedded inventory (Appendix A.2/A.3 below) is present in the diff and nothing extra; (b) no `Contract*` alias or `IContent`→`ContractContent` re-alias survives; (c) getHistory idle-wait + defensive clone preserved; (d) public `ServerAgentStreamEvent`/`StreamEvent` shapes unchanged. Paste the review verdict into `.completed/P21.md`.
3. Only commit the atomic phase once the diff review PASSES and `npm run build` is green across all workspaces.

## Constraints
- Build MUST be green at phase end across the whole monorepo (OQ-4). No `Contract*` alias survives. Do NOT alias `IContent` back to `ContractContent`.

## Verification Commands
```bash
if grep -rnE "Contract(Part|Content|GenerateContentResponse|PartListUnion|SendMessageParameters|GenerateContentConfig|UsageMetadata|ContentUnion|PartUnion)" packages/core/src packages/cli/src packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: a Contract* alias survives the contract flip"; exit 1; fi
# Major 3 — getHistory flip + G1/G2 deletion land HERE (moved from P15):
if grep -rn "toGeminiContents" packages/agents/src/core/client.ts packages/agents/src/core/ConversationManager.ts | grep -v test; then echo "FAIL: G1/G2 toGeminiContents not deleted"; exit 1; fi
grep -nE "getHistory\(\)\s*:\s*Promise<IContent\[\]>|getHistory\([^)]*\)\s*:\s*IContent\[\]" packages/agents/src/core/client.ts packages/agents/src/core/ConversationManager.ts   # getHistory now returns IContent[] (diagnostic; typecheck below is authoritative)
if grep -rn "as Content\[\]\|as readonly AgentMessage\[\]" packages/agents/src/api/control/sessionControl.ts packages/agents/src/api/agentImpl.ts | grep -v test; then echo "FAIL: Content[] casts not removed from session-control surface"; exit 1; fi
# No cross-package caller still expects Content[] from getHistory (typecheck is authoritative; this is diagnostic):
grep -rn "\.getHistory(" packages/cli/src packages/core/src --include=*.ts | grep -v test   # all consume IContent[] now (build-green proves it) — diagnostic
npm run typecheck && npm run build   # green cross-package (single atomic build-green boundary — Major 3)
npm test -- packages/agents/src/api/__tests__/clientContract.characterization.spec.ts   # green
```

## Success Criteria
- `Contract*` payload types gone; surface neutral; all 28 consumers (Appendix A.2/A.3) + the 2 A.1 files compile; monorepo build green.
- **Major 3:** `getHistory` returns `IContent[]` on BOTH `AgentClient` and `ConversationManager`; G1 + G2 `toGeminiContents` deleted; idle-wait + defensive clone preserved; every cross-package + agents-internal getHistory caller compiles against `IContent[]`; no boundary where the surface still requires `Content[]`.
- **Additional Risk 1:** the checkpointed deepthinker diff review PASSED and its verdict is pasted into `.completed/P21.md`.

## GENERATED consumer inventory (Additional Risk 1 — regenerate from P0.5 before starting)
Before editing, regenerate the EXACT consumer file set from fresh evidence and paste it into the P21a marker (do NOT rely on prose categories alone):
```bash
# 23 CLI Contract* consumers (Appendix A.2):
grep -rlE "Contract(Content|Part|GenerateContentResponse|PartListUnion|SendMessageParameters|GenerateContentConfig|UsageMetadata|ContentUnion|PartUnion)" packages/cli/src \
  | grep -vE "\.(test|spec)\.|test-helpers|__tests__" | sort
# 5 core Contract* consumers (Appendix A.3):
grep -rlE "Contract(Content|Part|GenerateContentResponse|PartListUnion|SendMessageParameters|GenerateContentConfig|UsageMetadata|ContentUnion|PartUnion)" \
  packages/core/src/commands/types.ts packages/core/src/config/agentClientLifecycle.ts packages/core/src/utils/checkpointUtils.ts packages/core/src/utils/llm-edit-fixer.ts packages/core/src/utils/summarizer.ts
```
The generated list MUST equal the 23 CLI + 5 core files in **Appendix A.2 / A.3** below (28 total, incl. the 2 definition/client files in A.1 = 30 edited files). If the count drifted from 23/5 (P0.5 check 6), the flip is INCOMPLETE until the drift is reconciled and Appendix A updated. Every file in the generated set MUST typecheck at phase end; a consumer omitted from the edit set will break the build.

## Appendix A — EXACT consumer inventory (embedded intended edit set; Major 2)

> These are the EXACT sorted paths discovered from the current tree (verified: 23 CLI + 5 core = 28, matching overview §4 blast radius). P0.5 check 6 re-counts them as a freshness check; if the count drifts, the GENERATED grep above MUST equal this list — reconcile any difference (add/remove the drifted path here + record in `.completed/P0.5.md`) BEFORE the flip. Every file below MUST typecheck at phase end; a file omitted from the edit set will break the build.

### Appendix A.1 — core contract definition + agents client (2 files)
- `packages/core/src/core/clientContract.ts` (payload types DELETED; surface retyped).
- `packages/agents/src/core/client.ts` (implements the surface; `generateContentConfig`→`ModelGenerationSettings`; getHistory flip + G1 deletion).
- (Also in the agents workspace, flipped with the getHistory callers: `packages/agents/src/core/ConversationManager.ts` — G2 deletion + getHistory return-type flip; and the agents-internal getHistory callers `chatSession.ts`, `turn.ts`, `agentImpl.ts`, `api/control/sessionControl.ts`.)

### Appendix A.2 — 23 CLI consumers (EXACT sorted paths)
```
packages/cli/src/nonInteractiveCli.ts
packages/cli/src/nonInteractiveCliCommands.ts
packages/cli/src/ui/hooks/agentStream/queryPreparer.ts
packages/cli/src/ui/hooks/agentStream/streamUtils.ts
packages/cli/src/ui/hooks/agentStream/toolCompletionHandler.ts
packages/cli/src/ui/hooks/agentStream/types.ts
packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts
packages/cli/src/ui/hooks/agentStream/useAgentStream.ts
packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts
packages/cli/src/ui/hooks/agentStream/useStreamEventHandlers.ts
packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts
packages/cli/src/ui/hooks/atCommandProcessor.ts
packages/cli/src/ui/hooks/atCommandProcessorHelpers.ts
packages/cli/src/ui/hooks/atCommandResourceHelpers.ts
packages/cli/src/ui/hooks/shellCommandProcessor.ts
packages/cli/src/ui/hooks/slashCommandHandlers.ts
packages/cli/src/ui/hooks/usePromptCompletion.ts
packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts
packages/cli/src/ui/utils/autoPromptGenerator.ts
packages/cli/src/ui/utils/historyExportUtils.ts
packages/cli/src/zed-integration/zed-content-utils.ts
packages/cli/src/zed-integration/zed-path-resolver.ts
packages/cli/src/zed-integration/zedIntegration.ts
```

### Appendix A.3 — 5 core consumers (EXACT sorted paths; excludes the `clientContract.ts` definition file itself)
```
packages/core/src/commands/types.ts
packages/core/src/config/agentClientLifecycle.ts
packages/core/src/utils/checkpointUtils.ts
packages/core/src/utils/llm-edit-fixer.ts
packages/core/src/utils/summarizer.ts
```

> **getHistory cross-package callers (Major 3) that ALSO migrate in this atomic phase** (some overlap Appendix A.2/A.3, some are additional): CLI `checkpointPersistence.ts`, `chatCommand.ts`, `copyCommand.ts`; core `config.ts` (in addition to `agentClientLifecycle.ts`/`checkpointUtils.ts` already in A.3). These consume `getHistory()`'s return value and must compile against `IContent[]` at phase end. The GENERATED grep freshness check above is `Contract*`-scoped; the getHistory callers are additionally enumerated here because the flip retypes `getHistory` in the SAME atomic phase.

## Why atomic (not staged) — OQ-4 STEP C
The contract is a type-level cross-package boundary: deleting `Contract*` and retyping the surface makes every consumer fail to typecheck simultaneously. There is no partial superset that keeps BOTH the old Google-shaped and new neutral consumers compiling (they are the SAME members). Staging would require a temporary dual-typed surface (aliasing `IContent` back to `ContractContent`) — the exact #2424 trap this plan forbids. Therefore the flip + all 28 consumers land in ONE build-green phase.

## Failure Recovery / Rollback
This is the largest single phase; treat it as one atomic commit.
1. Work on a dedicated sub-branch; do NOT push a partially-migrated tree.
2. If the monorepo build cannot be made green within this phase: `git checkout -- packages/core/src/core/clientContract.ts packages/agents/src/core/client.ts` and the CLI/core consumer files (full list above) to restore the pre-flip state; the plan stays at P20 (characterization green) with the contract still Google-shaped — a valid, build-green resting point.
3. Re-attempt per pseudocode `clientcontract-neutralization.md`, consumer-by-consumer within the same working tree, only committing once `npm run build` is green across all workspaces.
4. Cannot proceed to Phase 22 until P20 tests are green AND the full monorepo build is green.

## Phase Completion Marker
`project-plans/issue2349/.completed/P21.md`.

**MANDATORY marker contents (Additional Risk 1 round 8 — drift STOPS the phase, do NOT defer):** the marker MUST paste (1) the REGENERATED exact consumer inventory (the `git grep`/`grep` output for the 23 CLI + 5 core `Contract*` consumers, refreshed from P0.5 evidence at phase start) AND (2) the FULL `npm run build` output across all workspaces (green). If the regenerated consumer set does NOT exactly equal the embedded Appendix A.2/A.3 list (23 CLI + 5 core = 28, +2 A.1 = 30), the phase STOPS IMMEDIATELY: reconcile the drift (update Appendix A + `.completed/P0.5.md`) and re-run — the flip may NOT be marked complete, and the drift may NOT be deferred to a later phase. A marker missing the regenerated list or the full build output is INVALID.
