# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260610-ISSUE1592.P00A`

## Goal

Verify every assumption in `analysis/reverse-dependency-map.md` and `analysis/move-map.md` against the actual working tree BEFORE any code changes. Output `project-plans/issue1592/analysis/preflight-results.md` with pasted command outputs.

## Required Verifications

1. **Move-set inventory**: `ls packages/core/src/core packages/core/src/agents packages/core/src/scheduler` and confirm move-map covers every non-test file (list any file present in the directories but absent from the move map — each must get an explicit disposition).
2. **Class-construction couplings** (must be exactly these three in core production code):
   ```bash
   grep -rn "new AgentClient(" packages/core/src --include="*.ts" | grep -v test
   grep -rn "import('../core/coreToolScheduler.js')\|new CoreToolScheduler(" packages/core/src --include="*.ts" | grep -v test | grep -v "src/core/"
   grep -rn "TaskTool" packages/core/src/config --include="*.ts" | grep -v test
   ```
3. **Type-only stayer imports**: for each file in reverse-dependency-map §1, confirm the import is type-only or resolves to a staying module. Paste evidence.
4. **agents/ dir isolation**: confirm zero external imports.
5. **scheduler/types.ts consumers**: confirm exactly confirmation-bus/types.ts + policy/policy-helpers.ts (+ scheduler internals).
6. **providers package**: confirm zero imports of any moved module (`grep -rn "core/client.js\|coreToolScheduler\|chatSession.js\|subagent" packages/providers/src` — chatSession hits in tests must be examined).
7. **Config construction sites**: enumerate ALL `new Config(` call sites across packages (~54 files / ~251 occurrences including tests and test-utils) and CLASSIFY each into: (a) composition root — must wire concrete factories; (b) initializing test — needs test factories/fakes; (c) non-initializing test — no change needed (factories optional, error at use time). The classification table is a P01 input; blanket edits are forbidden.
   **Known production non-test site requiring explicit classification**: `packages/providers/src/gemini/GeminiProvider.ts:958` constructs a minimal Config for OAuth resolution (`resolveOAuthConfig`). providers must NOT depend on agents, so this site CANNOT receive agent factories — verify it never calls `initialize()`/`initializeContentGeneratorConfig()`/`getAgentClient()` (it only needs OAuth plumbing) and classify it as (c). If verification shows it crosses the seam, STOP and redesign before P01.
8. **a2a-server TaskTool/task usage**: determine whether a2a registers TaskTool (check `toolRegistryFactory` usage and a2a config flow); document expected behavior when TaskToolRegistration is not wired.
9. **buildContinuationDirective relocation**: KNOWN consumer `cli/src/integration-tests/compression-todo.integration.test.ts:31` imports it from core's root barrel, so it STAYS core-owned. Verify the extraction plan (move-map §E): confirm `buildContinuationDirective` (compression/utils.ts ~line 194) has only staying-module deps; confirm moved strategies (MiddleOutStrategy, OneShotStrategy) are the only other consumers; record the new staying module path.
10. **geminiRequest consumers**: `grep -rn "geminiRequest\|GeminiCodeRequest\|partListUnionToString" packages/*/src --include="*.ts"` — confirm the STAYS disposition still holds (expected consumers: only staying `tools/glob.test.ts:9` and `index.ts:81`; zero move-set consumers). If a move-set consumer has appeared, re-evaluate before P03.
11. **CLI `Turn` usage**: confirm the 5 CLI files use Turn only as a type (paste import lines + usage).
12. **Dynamic imports / vi.mock paths**: `grep -rn "vi.mock('.*core/\(client\|chatSession\|coreToolScheduler\|subagent\)" packages/*/src | wc -l` and `grep -rn "await import(" packages/core/src/core packages/core/src/agents` — list all dynamic-import and mock-path sites that moves will break.
13. **Core exports map**: list which subpaths agents' moved code will need from core (mechanically: run the import-extraction one-liner from reverse-dep map §1 over the move set and diff against core package.json exports).
14. **Build/CI references**: confirm release.yml/build-sandbox.yml/build_sandbox.js/version.js handle providers; identify the exact lines to mirror for agents. Note: `scripts/prepare-package.js` handles only core+cli (no providers) — decide whether agents needs it (see P02).
15. **Stayer-test blast radius**: run the full test-audit grep from P03 task 9 (AgentClient|ChatSession|CoreToolScheduler|SubAgentScope|SubagentOrchestrator|TaskTool + vi.mock paths over packages/core/src tests) and produce the complete disposition table (MOVE / STRUCTURAL FAKE / RETARGET / UNAFFECTED) — this table is a P03 input, created BEFORE any move.
16. **Move-set import inventory**: generate the external+workspace import list for every moved production and test file (P02 task 1 input). Paste the inventory.

## Verification Gate

ALL items verified with pasted evidence. Any mismatch with the analysis docs requires updating the analysis docs and move-map BEFORE P01. Blocking issues go in a "Blocking Issues" section with proposed resolutions.

## Completion Marker

`project-plans/issue1592/.completed/P00A.md` including the holistic assessment and a verdict (PASS/FAIL).
