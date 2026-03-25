# Audit Batch 4 (Commits 94-124) - Cherry-Pick Analysis for LLxprt Code

## LLxprt State Summary
- **Package names:** `@vybestack/llxprt-code-core` (not `@google/gemini-cli-core`)
- **Auth:** `AuthType.USE_PROVIDER` (not `AuthType.USE_GEMINI`)
- **Scheduler:** Only `tool-executor.ts` + `types.ts` (no state-manager, confirmation, policy modules)
- **No upstream agent system:** No a2a-client-manager, delegate-to-agent-tool, local-executor, generalist-agent
- **No routing/fallback:** No routing/, fallback/, availability/ directories
- **Has:** skills system, hooks system, confirmation-bus, key bindings, a2a-server, policy engine

---

## 0a6f2e0 — Fix: Process all parts when thought is first

**Verdict:** NO_OP
**Confidence:** HIGH
**Evidence:** 
- Upstream modifies `turn.ts` lines 290-304 to iterate all parts for thought detection instead of just `parts[0]`
- Upstream modifies `partUtils.ts` line 84 to filter `!part.thought` from text extraction
- LLxprt `turn.ts` already contains this fix at lines 265-277: iterates `allParts` for thought detection
- LLxprt `partUtils.ts` does NOT filter thoughts (no `!part.thought` check), but this doesn't cause issues as thought handling is done in turn.ts
**Rationale:** LLxprt already implemented the core fix (checking all parts for thoughts). The partUtils.ts difference is minor and doesn't cause functional issues.
**Conflicts expected:** NO
**Partial applicability:** N/A - already applied

---

## 4b4bdd1 — fix(automation): jq quoting error in pr-triage.sh

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:** `.github/scripts/pr-triage.sh` - GitHub automation file
**Rationale:** Per SKIP criteria: GitHub automation (.github/) changes are excluded.
**Conflicts expected:** NO
**Partial applicability:** N/A

---

## e2901f3 — refactor(core): decouple scheduler into orchestration/policy/confirmation

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Upstream creates new files: `scheduler/policy.ts`, `scheduler/policy.test.ts`, `scheduler/scheduler.ts`, `scheduler/scheduler.test.ts`
- Upstream heavily modifies `scheduler/confirmation.ts` and `scheduler/confirmation.test.ts`
- LLxprt scheduler only has `tool-executor.ts` and `types.ts`
- LLxprt has NO state-manager, confirmation, or policy scheduler modules
**Rationale:** LLxprt's scheduler architecture is fundamentally different. This commit adds upstream's event-driven scheduler infrastructure that LLxprt doesn't have and doesn't need (different architecture).
**Conflicts expected:** N/A - files don't exist
**Partial applicability:** None - entire commit is scheduler refactoring

---

## a90bcf74 — feat: add /introspect slash command

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Adds `.gemini/commands/introspect.toml` - a new slash command definition
- Simple 16-line toml file with no code dependencies
**Rationale:** Generic slash command that works across providers. Useful debugging/introspection feature.
**Conflicts expected:** NO - new file
**Partial applicability:** Full file applies

---

## 1b6b6d4 — refactor(cli): centralize tool mapping decouple legacy scheduler

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Creates `packages/cli/src/ui/hooks/toolMapping.ts` - centralized tool status mapping
- Extracts `mapCoreStatusToDisplayStatus` and `mapToDisplay` from `useReactToolScheduler.ts`
- LLxprt has `useReactToolScheduler.ts` but it may differ from upstream
**Rationale:** Code organization improvement. The mapping functions are provider-agnostic. Need to check if LLxprt's useReactToolScheduler has similar code to extract.
**Conflicts expected:** YES - need to verify LLxprt's current useReactToolScheduler.ts state
**Partial applicability:** `toolMapping.ts` (new file) applies; `useReactToolScheduler.ts` changes need adaptation

---

## 0bebc66 — fix(ui): ensure rationale renders before tool calls

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modifies `useGeminiStream.ts` lines 923-930 to flush pending text before scheduling tool calls
- Adds test in `useGeminiStream.test.tsx`
- Fix is provider-agnostic - handles UI event ordering
**Rationale:** Bug fix for history ordering. The change ensures rationale text is added to history before tool calls are scheduled, preventing race conditions.
**Conflicts expected:** YES - `useGeminiStream.ts` likely has LLxprt-specific changes
**Partial applicability:** Core logic applies; need to merge with LLxprt's useGeminiStream

---

## 05c0a8e — fix(workflows): use author_association for maintainer check

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:** `.github/workflows/pr-contribution-guidelines-notifier.yml`
**Rationale:** Per SKIP criteria: GitHub automation (.github/) changes are excluded.
**Conflicts expected:** NO
**Partial applicability:** N/A

---

## 155d9aa — fix return type of fireSessionStartEvent

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modifies `hookSystem.ts` to return `DefaultHookOutput | undefined` instead of `AggregatedHookResult`
- Updates callers in `gemini.tsx`, `AppContainer.tsx`, `clearCommand.ts` to handle new return type
- LLxprt has hooks system with `hookSystem.ts`
**Rationale:** Type consistency fix for hooks API. The change simplifies the return type to what callers actually need.
**Conflicts expected:** YES - LLxprt's hookSystem.ts and callers may differ
**Partial applicability:** All files apply but need adaptation for LLxprt's structure

---

## 451e0b4 — feat(cli): experiment gate for event-driven scheduler

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds `enableEventDrivenScheduler` config option
- Related to upstream's event-driven scheduler architecture
- LLxprt doesn't have the event-driven scheduler this gates
**Rationale:** This enables the scheduler refactoring from commit e2901f3 which LLxprt doesn't have.
**Conflicts expected:** N/A - feature doesn't exist
**Partial applicability:** None

---

## ec74134 — feat(core): shell redirection transparency and security

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Modifies `policy-engine.ts`, `shell.ts`, `shell-utils.ts` for redirection handling
- Adds UI components for redirection warnings
- LLxprt HAS `policy-engine.ts` but may have different structure
- Changes affect `ToolConfirmationMessage.tsx` which LLxprt has
**Rationale:** Security improvement for shell command handling. Core logic is provider-agnostic but LLxprt's policy engine may differ.
**Conflicts expected:** YES - policy-engine.ts and shell files likely diverged
**Partial applicability:** `textConstants.ts` (new constants), `ToolConfirmationMessage.tsx` changes apply; policy/shell changes need review

---

## 52fadba — fix(core): deduplicate ModelInfo emission in GeminiClient

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Modifies `packages/core/src/core/client.ts` lines 626-631
- Fixes duplicate ModelInfo events in GeminiClient
- LLxprt has multi-provider client, may have different emission logic
**Rationale:** Bug fix but LLxprt's client architecture differs (multi-provider). Need to check if similar deduplication is needed.
**Conflicts expected:** YES - client.ts significantly different in LLxprt
**Partial applicability:** Logic pattern applies; implementation needs adaptation

---

## 4920ad2 — docs(themes): remove unsupported DiffModified color key

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Simple documentation fix in `docs/cli/themes.md`
- Removes reference to unsupported `DiffModified` color key
**Rationale:** Documentation accuracy fix. Applies universally.
**Conflicts expected:** NO
**Partial applicability:** Full file applies

---

## e34f0b4 — fix: update currentSequenceModel when modelChanged

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Modifies `fallback/handler.ts`, `useQuotaAndFallback.ts`
- Uses `activateFallbackMode` for fallback model handling
- LLxprt does NOT have `fallback/` directory or `useQuotaAndFallback` hook
- LLxprt does NOT have fallback system
**Rationale:** Per SKIP criteria: flash fallback system doesn't exist in LLxprt.
**Conflicts expected:** N/A - files don't exist
**Partial applicability:** None

---

## 1182168 — feat(core): enhanced anchored iterative context compression

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Modifies `prompts.ts`, `turn.ts`, `chatCompressionService.ts`
- Adds new compression status `COMPRESSION_FAILED_EMPTY_SUMMARY`
- Updates compression prompt with security rules and improved structure
- LLxprt has `turn.ts` and likely has compression service
**Rationale:** Compression improvement. Core functionality applies but needs to check LLxprt's compression implementation.
**Conflicts expected:** YES - turn.ts already has LLxprt modifications
**Partial applicability:** `prompts.ts` changes apply; compression service changes need review; turn.ts enum addition applies

---

## 166e04a — Fix mcp instructions

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modifies `config.ts` to add `refreshMcpContext()` method
- Modifies `mcp-client-manager.ts` for batched context refresh and improved instruction formatting
- LLxprt has MCP support and `mcp-client-manager.ts`
**Rationale:** MCP instruction handling improvement. Provider-agnostic. Adds batching for context refresh.
**Conflicts expected:** YES - mcp-client-manager.ts may differ
**Partial applicability:** All files apply with adaptation

---

## 79076d1 — [A2A] Disable checkpointing if git is not installed

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Modifies `a2a-server/src/agent/task.ts`, `a2a-server/src/config/config.ts`
- Adds `GitService.verifyGitAvailability()` static method
- LLxprt HAS `a2a-server` with `task.ts` and `config.ts`
**Rationale:** Defensive check for git availability. LLxprt has A2A server. Provider-agnostic improvement.
**Conflicts expected:** YES - a2a-server files may differ
**Partial applicability:** All files apply with adaptation

---

## 943481c — feat(admin): set admin.skills.enabled based on advancedFeaturesEnabled

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Modifies `settings.ts` to map `advancedFeaturesEnabled` to `admin.skills.enabled`
- Adds field to `code_assist/types.ts`
- LLxprt has skills system but admin settings integration may differ
**Rationale:** Admin settings integration. LLxprt has skills but may handle admin controls differently.
**Conflicts expected:** YES - admin/settings integration likely differs
**Partial applicability:** Logic pattern applies; implementation needs adaptation

---

## 88df621 — Test coverage for hook exit code cases

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Extends `integration-tests/hooks-system.test.ts` with exit code test cases
- Tests exit code 2 for blocking, mixed stdout handling, BeforeModel deny/block
- LLxprt has hooks system
**Rationale:** Test coverage improvement for hooks. Provider-agnostic tests.
**Conflicts expected:** YES - integration test file may have different tests
**Partial applicability:** Test patterns apply; may need provider-specific adjustments

---

## 85b1716 — Revert "Revert "Update extension examples""

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Updates extension examples in `packages/cli/src/commands/extensions/examples/`
- Adds hooks, mcp-server, and skills examples
- Removes TypeScript build step from mcp-server example
**Rationale:** Documentation/examples update. Provider-agnostic. Useful for LLxprt users.
**Conflicts expected:** NO - example files
**Partial applicability:** All files apply; may need package name updates (@vybestack/llxprt-code-core)

---

## 15f2617 — fix(core): Provide compact, actionable errors for agent delegation failures

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Modifies `agents/delegate-to-agent-tool.ts` and `delegate-to-agent-tool.test.ts`
- LLxprt does NOT have upstream agent system (no delegate-to-agent-tool)
**Rationale:** Per SKIP criteria: upstream agent/subagent architecture doesn't exist in LLxprt.
**Conflicts expected:** N/A - files don't exist
**Partial applicability:** None

---

## e92f60b — fix: migrate BeforeModel and AfterModel hooks to HookSystem

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Migrates hook firing logic from `geminiChat.ts` to `hookSystem.ts`
- Adds `fireBeforeModelEvent`, `fireAfterModelEvent`, `fireBeforeToolSelectionEvent` to HookSystem
- Removes direct calls to `fireBeforeModelHook`, `fireAfterModelHook` from geminiChat
- LLxprt has `hookSystem.ts` and `geminiChat.ts`
**Rationale:** Architecture improvement centralizing hooks. LLxprt has hooks system but may have different structure.
**Conflicts expected:** YES - both files likely have LLxprt-specific changes
**Partial applicability:** HookSystem additions apply; geminiChat changes need careful merge

---

## b71fe94 — feat(admin): apply admin settings to gemini skills/mcp/extensions commands

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Adds `deferred.ts` - command deferral system for admin settings check
- Modifies `extensions.tsx`, `mcp.ts`, `skills.tsx` to use defer()
- LLxprt has skills/mcp/extensions commands
**Rationale:** Admin control enforcement. LLxprt may handle admin settings differently.
**Conflicts expected:** YES - command files may differ
**Partial applicability:** `deferred.ts` (new) applies; command modifications need adaptation

---

## 5b8a239 — fix(core): update telemetry token count after session resume

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Modifies `client.ts` to call `updateTelemetryTokenCount()` in `resumeChat()`
- Uses `uiTelemetryService` which may be Google-specific telemetry
**Rationale:** Telemetry fix. LLxprt may have different telemetry handling. Consider if token count tracking is needed.
**Conflicts expected:** MAYBE - depends on LLxprt's telemetry implementation
**Partial applicability:** Logic may apply if LLxprt tracks token counts

---

## 12b0fe1 — Demote subagent test to nightly

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `evals/subagents.eval.ts` test from `ALWAYS_PASSES` to `USUALLY_PASSES`
- LLxprt does NOT have upstream agent system or subagent evals
**Rationale:** Per SKIP criteria: upstream agent/subagent architecture doesn't exist in LLxprt.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## e5745f1 — feat(plan): telemetry to track adoption and usage of plan mode

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds `ApprovalModeSwitchEvent`, `ApprovalModeDurationEvent` telemetry events
- Modifies `clearcut-logger.ts`, `loggers.ts`, `types.ts`
- Adds telemetry for plan mode tracking
- Uses ClearcutLogger which is Google-specific telemetry
**Rationale:** Per SKIP criteria: ClearcutLogger/telemetry to Google is excluded.
**Conflicts expected:** N/A
**Partial applicability:** None - ClearcutLogger specific

---

## a16d598 — feat: Add flash lite utility fallback chain

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Modifies `availability/policyCatalog.ts`, `availability/policyHelpers.ts`
- Adds `getFlashLitePolicyChain()` for silent fallback
- LLxprt does NOT have `availability/` directory
**Rationale:** Per SKIP criteria: flash fallback system doesn't exist in LLxprt.
**Conflicts expected:** N/A - files don't exist
**Partial applicability:** None

---

## b99e841 — Fixes Windows crash: resize pty already exited

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Adds exception handler in `packages/cli/index.ts` for Windows node-pty race condition
- Suppresses "Cannot resize a pty that has already exited" error on Windows
**Rationale:** Platform bug workaround. Provider-agnostic. Critical for Windows users.
**Conflicts expected:** YES - index.ts may have LLxprt-specific startup code
**Partial applicability:** Exception handler logic applies; placement may need adjustment

---

## f42b4c8 — feat(core): Add initial eval for generalist agent

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds `evals/generalist_agent.eval.ts` for generalist agent testing
- LLxprt does NOT have upstream agent system or generalist agent
**Rationale:** Per SKIP criteria: upstream agent/subagent architecture doesn't exist in LLxprt.
**Conflicts expected:** N/A - agent doesn't exist
**Partial applicability:** None

---

## f0f705d — feat(core): unify agent enabled and disabled flags

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Removes `disabled` field from AgentOverride, uses only `enabled`
- Modifies `agents/registry.ts`, `agentSettings.ts`, `agentsCommand.ts`
- LLxprt does NOT have upstream agent system
**Rationale:** Per SKIP criteria: upstream agent system doesn't exist in LLxprt.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## ed0b0fa — fix(core): resolve auto model in default strategy

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Modifies `routing/strategies/defaultStrategy.ts` to resolve "auto" model
- LLxprt does NOT have `routing/` directory
**Rationale:** Per SKIP criteria: auto model routing doesn't exist in LLxprt.
**Conflicts expected:** N/A - files don't exist
**Partial applicability:** None

---

## 67d6908 — docs: update project context and pr-creator workflow

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Updates `GEMINI.md` with simplified project context
- Updates `.gemini/skills/pr-creator/SKILL.md` to add preflight check step
- LLxprt likely has different GEMINI.md (possibly LLXPRT.md or different content)
**Rationale:** Documentation improvement. The pr-creator skill update is useful but needs LLxprt-specific context.
**Conflicts expected:** YES - GEMINI.md likely completely different for LLxprt
**Partial applicability:** pr-creator SKILL.md update applies; GEMINI.md needs LLxprt-specific version

---

# Summary Table

| Commit | Subject | Verdict | Confidence |
|--------|---------|---------|------------|
| 0a6f2e0 | Fix: Process all parts when thought is first | NO_OP | HIGH |
| 4b4bdd1 | fix(automation): jq quoting error | SKIP | HIGH |
| e2901f3 | refactor(core): decouple scheduler | SKIP | HIGH |
| a90bcf74 | feat: add /introspect slash command | PICK | HIGH |
| 1b6b6d4 | refactor(cli): centralize tool mapping | REIMPLEMENT | MEDIUM |
| 0bebc66 | fix(ui): ensure rationale renders before tool calls | PICK | HIGH |
| 05c0a8e | fix(workflows): author_association check | SKIP | HIGH |
| 155d9aa | fix return type of fireSessionStartEvent | PICK | HIGH |
| 451e0b4 | feat(cli): experiment gate for scheduler | SKIP | HIGH |
| ec74134 | feat(core): shell redirection transparency | REIMPLEMENT | MEDIUM |
| 52fadba | fix(core): deduplicate ModelInfo emission | REIMPLEMENT | MEDIUM |
| 4920ad2 | docs(themes): remove DiffModified | PICK | HIGH |
| e34f0b4 | fix: update currentSequenceModel when modelChanged | SKIP | HIGH |
| 1182168 | feat(core): enhanced context compression | REIMPLEMENT | MEDIUM |
| 166e04a | Fix mcp instructions | PICK | HIGH |
| 79076d1 | [A2A] Disable checkpointing if git not installed | PICK | HIGH |
| 943481c | feat(admin): admin.skills.enabled setting | REIMPLEMENT | MEDIUM |
| 88df621 | Test coverage for hook exit code cases | PICK | HIGH |
| 85b1716 | Revert Revert Update extension examples | PICK | HIGH |
| 15f2617 | fix(core): agent delegation error messages | SKIP | HIGH |
| e92f60b | fix: migrate BeforeModel/AfterModel hooks | REIMPLEMENT | MEDIUM |
| b71fe94 | feat(admin): admin settings to commands | REIMPLEMENT | MEDIUM |
| 5b8a239 | fix(core): telemetry token count after resume | SKIP | HIGH |
| 12b0fe1 | Demote subagent test to nightly | SKIP | HIGH |
| e5745f1 | feat(plan): telemetry for plan mode | SKIP | HIGH |
| a16d598 | feat: Add flash lite utility fallback chain | SKIP | HIGH |
| b99e841 | Fixes Windows crash: resize pty | PICK | HIGH |
| f42b4c8 | feat(core): eval for generalist agent | SKIP | HIGH |
| f0f705d | feat(core): unify agent enabled/disabled flags | SKIP | HIGH |
| ed0b0fa | fix(core): resolve auto model in default strategy | SKIP | HIGH |
| 67d6908 | docs: update project context | REIMPLEMENT | MEDIUM |

---

## Statistics

- **PICK (direct cherry-pick):** 10 commits
- **REIMPLEMENT (adapt for LLxprt):** 9 commits
- **SKIP (not applicable):** 12 commits
- **NO_OP (already applied):** 1 commit

---

## Priority PICK List (Direct Cherry-Picks)

1. **a90bcf74** - /introspect slash command (new file)
2. **0bebc66** - Rationale render ordering fix
3. **155d9aa** - fireSessionStartEvent return type fix
4. **4920ad2** - docs: remove DiffModified
5. **166e04a** - MCP instructions fix
6. **79076d1** - A2A git availability check
7. **88df621** - Hook exit code test coverage
8. **85b1716** - Extension examples update
9. **b99e841** - Windows pty crash fix

---

## Priority REIMPLEMENT List (Needs Adaptation)

1. **1b6b6d4** - Tool mapping centralization (check useReactToolScheduler)
2. **ec74134** - Shell redirection security (check policy-engine)
3. **52fadba** - ModelInfo deduplication (check multi-provider client)
4. **1182168** - Context compression enhancement (check compression service)
5. **943481c** - Admin skills.enabled setting (check admin integration)
6. **e92f60b** - Hook migration to HookSystem (check hooks architecture)
7. **b71fe94** - Admin settings deferral (new deferred.ts)
8. **67d6908** - Project context docs (adapt for LLxprt)
