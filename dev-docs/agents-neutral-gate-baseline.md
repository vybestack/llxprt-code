<!-- @plan:PLAN-20260707-AGENTNEUTRAL.P02 -->
<!-- @requirement:REQ-012.1 -->

# Agents Neutral Gate — Baseline Ceiling

> The shrink-ratchet baseline. Each migration slice APPENDS a new
> `count=<integer> owner=<PNN>` line — the LAST `count=` line is the current
> ceiling. P07 onward must strictly decrease.

## Metric Scope (Major 2)

At P02, `--count` = non-exempt hits from the checks implemented at this time:
**checkF structural (F1/F3/F5) + checkG-call (toGeminiContent(s) calls)**.
The import checks (checkA/B/C/E) are enforced via `--enforce-imports`, not
counted in the default ratchet. The deferred checks (checkD, checkG-barrel,
checkH) join the metric at P31 via an EXPLICIT documented re-baseline step.

## Current Ceiling

count=24 owner=P13
count=17 owner=P21
count=7 owner=P25
count=1 owner=P27

Command: `npx tsx scripts/agents-neutral-gate.ts --count`

## Per-site listing (--by-file baseline, frozen at P02)

packages/agents/src/agents/executor-prompt-builder.ts:57:F5-parts-access owner=P25
packages/agents/src/agents/executor-tool-dispatch.ts:513:F3-role-parts owner=P25
packages/agents/src/agents/executor.ts:224:F3-role-parts owner=P25
packages/agents/src/agents/recovery.ts:118:F3-role-parts owner=P25
packages/agents/src/core/ConversationManager.ts:274:F5-parts-access owner=P15
packages/agents/src/core/ConversationManager.ts:306:F3-role-parts owner=P15
packages/agents/src/core/ConversationManager.ts:310:F3-role-parts owner=P15
packages/agents/src/core/ConversationManager.ts:419:G-call-toGeminiContent owner=P15
packages/agents/src/core/DirectMessageProcessor.ts:178:G-call-toGeminiContent owner=P13
packages/agents/src/core/DirectMessageProcessor.ts:369:F3-role-parts owner=P13
packages/agents/src/core/DirectMessageProcessor.ts:685:F1-candidates-content owner=P13
packages/agents/src/core/DirectMessageProcessor.ts:688:F3-role-parts owner=P13
packages/agents/src/core/DirectMessageProcessor.ts:777:F3-role-parts owner=P13
packages/agents/src/core/DirectMessageProcessor.ts:865:F3-role-parts owner=P13
packages/agents/src/core/MessageConverter.ts:524:F1-candidates-content owner=P09
packages/agents/src/core/MessageStreamOrchestrator.ts:341:F3-role-parts owner=P27
packages/agents/src/core/StreamProcessor.ts:691:F3-role-parts owner=P07
packages/agents/src/core/TurnProcessor.ts:457:G-call-toGeminiContent owner=P08
packages/agents/src/core/TurnProcessor.ts:747:G-call-toGeminiContent owner=P08
packages/agents/src/core/TurnProcessor.ts:797:F5-parts-access owner=P08
packages/agents/src/core/TurnProcessor.ts:828:F3-role-parts owner=P08
packages/agents/src/core/agenticLoop/loopHelpers.ts:111:F3-role-parts owner=P27
packages/agents/src/core/agenticLoop/loopHelpers.ts:115:F3-role-parts owner=P27
packages/agents/src/core/baseLlmClient.ts:160:F3-role-parts owner=P27
packages/agents/src/core/baseLlmClient.ts:287:F3-role-parts owner=P27
packages/agents/src/core/baseLlmClient.ts:336:F3-role-parts owner=P27
packages/agents/src/core/client.ts:421:G-call-toGeminiContent owner=P21
packages/agents/src/core/client.ts:667:F3-role-parts owner=P21
packages/agents/src/core/hookToolRestrictions.ts:116:F5-parts-access owner=P11
packages/agents/src/core/hookToolRestrictions.ts:190:F5-parts-access owner=P11
packages/agents/src/core/streamRequestHelpers.ts:228:G-call-toGeminiContent owner=P07
packages/agents/src/core/streamRequestHelpers.ts:281:G-call-toGeminiContent owner=P07
packages/agents/src/core/streamResponseHelpers.ts:300:F3-role-parts owner=P15
packages/agents/src/core/subagent.ts:378:F3-role-parts owner=P23
packages/agents/src/core/subagent.ts:686:F3-role-parts owner=P23
packages/agents/src/core/subagentExecution.ts:165:F3-role-parts owner=P23
packages/agents/src/core/subagentExecution.ts:195:F3-role-parts owner=P23
packages/agents/src/core/subagentToolProcessing.ts:484:F3-role-parts owner=P23

> Owner tags are seeded from the P33 §2A.4 inventory-closure map. Each
> migration slice's NNa reads its OWNED hit IDs via
> `grep -F 'owner=<PNN>'` and asserts each is ABSENT in the current
> `--by-file` output, in addition to the net `--count` strictly decreasing.
