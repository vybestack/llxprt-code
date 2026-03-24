# Batch A

# Batch A Audit Results (Commits 1-21)

## da85e3f8f23cfbcfd41b78d38d56cb37cd7715b1 — feat(core): improve activate_skill tool and use lowercase XML tags (#16009)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** skills, tools, prompts
**Evidence:** 
- Compared `packages/core/src/tools/activate-skill.ts` (LLxprt has uppercase tags)
- Compared `packages/core/src/core/prompts.ts` (LLxprt has uppercase ACTIVATED_SKILL/INSTRUCTIONS)
- Diff adds error handling with `ToolErrorType.INVALID_TOOL_PARAMS`
- Improves tool description with available skills hint
- Changes XML tags to lowercase for consistency
**Rationale:** LLxprt has the skills system and this commit improves error handling, adds better tool descriptions showing available skills, and uses lowercase XML tags. The error handling improvement is valuable - it returns proper error objects instead of just strings. This is a clean improvement to the skill activation tool.
**Conflicts expected:** NO — straightforward code changes
**Partial applicability:** NO

---

## 521dc7f26c3c166e0ee8b4724322a060f26737cb — Add initiation method telemetry property (#15818)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** telemetry
**Evidence:** 
- Diff modifies `packages/core/src/code_assist/telemetry.ts`, `telemetry.test.ts`, `types.ts`
- Adds `InitiationMethod` enum and property to `ConversationOffered`
- LLxprt has no `packages/core/src/code_assist/telemetry*.ts` files (removed)
**Rationale:** This commit adds telemetry properties to the ClearcutLogger infrastructure. All Google telemetry has been removed from LLxprt as per the audit criteria. No applicable code exists in LLxprt.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

## b54215f0a5583827e954cbb2f9716b3505672316 — chore(release): bump version to 0.25.0-nightly.20260107.59a18e710 (#16048)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** 
- Modifies package.json files to bump version numbers
- Only touches version fields
**Rationale:** Gemini-specific release version bump. LLxprt has its own versioning. Skip per audit criteria for version/release commits.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

## 982eee63b61e84b7ae0265857328cf0e3bc19d14 — Hx support (#16032)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** editor, terminal
**Evidence:**
- Compared `packages/core/src/utils/editor.ts` - LLxprt lacks 'hx' (Helix) support
- LLxprt has `TERMINAL_EDITORS = ['vim', 'neovim', 'emacs']` without 'hx'
- Diff adds 'hx' to terminal editors, editorCommands, EDITOR_DISPLAY_NAMES
- Adds diff command support for Helix (`hx --vsplit -- old.txt new.txt`)
**Rationale:** Adds support for Helix editor (hx), a popular terminal-based editor. This is a straightforward feature addition that enhances editor choice for users. LLxprt has the same editor infrastructure and this can be cherry-picked cleanly.
**Conflicts expected:** NO — additive changes only
**Partial applicability:** NO

---

## a26463b056dbf66d5a2744109ee7319c434ab4a0 — [Skills] Foundation: Centralize management logic and feedback rendering (#15952)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** skills, settings, cli
**Evidence:**
- LLxprt has `packages/cli/src/ui/commands/skillsCommand.ts` but no `skillSettings.ts` or `skillUtils.ts`
- Diff creates new utility files: `skillSettings.ts` (123 lines) and `skillUtils.ts` (66 lines)
- Refactors enable/disable logic into centralized functions
- Adds `SkillActionResult` type for structured return values
- Improves user feedback messages
**Rationale:** LLxprt has the skills system but lacks the centralized utility functions. This commit refactors skill enable/disable logic into reusable functions with proper result types. The code structure in LLxprt's skillsCommand.ts matches the pre-commit state (inline enable/disable logic). Cherry-picking will add the utility files and improve code organization.
**Conflicts expected:** YES — skillsCommand.ts and enable.ts/disable.ts have inline logic that conflicts with new centralized approach
**Partial applicability:** NO — all files should be picked together

---

## 7956eb239e865bbb746ca2a862db63fb3e4c87f4 — Introduce GEMINI_CLI_HOME for strict test isolation (#15907)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** testing, paths
**Evidence:**
- LLxprt `packages/core/src/utils/paths.ts` has no `GEMINI_CLI_HOME` or `LLXPRT_CODE_HOME`
- LLxprt uses `os.homedir()` directly without environment variable override
- Diff adds `homedir()` function that checks `GEMINI_CLI_HOME` env var
- Modifies 54 files across test infrastructure
**Rationale:** This is upstream test infrastructure to allow test isolation. LLxprt has a different test helper structure (uses `LLXPRT_DIR` constant). The `GEMINI_CLI_HOME` pattern would need to be adapted to `LLXPRT_CODE_HOME` if needed. However, this is primarily for upstream's test infrastructure and would require significant adaptation. The core paths.ts changes could be reimplemented if needed.
**Conflicts expected:** N/A
**Partial applicability:** Test infrastructure changes could be REIMPLEMENTED with LLXPRT_CODE_HOME branding

---

## 2d683bb6f8a1fd9348fb0c72230981a46ed16d07 — [Skills] Multi-scope skill enablement and shadowing fix (#15953)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** skills, settings
**Evidence:**
- Builds on commit a26463b056dbf66d5a2744109ee7319c434ab4a0
- Modifies `skillSettings.ts` to enable skills across all writable scopes
- Removes `scope` parameter from `enableSkill()` - now enables everywhere
- Fixes shadowing issues where skill disabled in one scope but enabled in another
**Rationale:** Bug fix for skill enablement across multiple scopes. When enabling a skill, it should be removed from disabled lists in both User and Workspace scopes. This is a UX improvement that prevents confusion. Depends on the skillSettings.ts infrastructure from commit 5.
**Conflicts expected:** YES — depends on skillSettings.ts from commit 5
**Partial applicability:** NO

---

## 5fe5d1da4678c21e18749981b7c511c3ec1f1ff9 — policy: extract legacy policy from core tool scheduler to policy engine (#15902)
**Verdict:** PARTIAL PICK
**Confidence:** MEDIUM
**Areas:** policy, tool-scheduler
**Evidence:**
- LLxprt `coreToolScheduler.ts` already has PolicyEngine integration (line 288, 1169)
- Diff removes `isAutoApproved()` method and shell-permissions utilities
- Diff modifies `packages/core/src/policy/utils.ts` to fix regex pattern
- LLxprt has `packages/core/src/policy/utils.ts` with different implementation
- LLxprt does NOT have `packages/core/src/utils/shell-permissions.ts`
**Rationale:** The core refactoring (removing isAutoApproved from scheduler) appears to already be done in LLxprt. However, the `policy/utils.ts` fix for regex matching is valuable - it prevents matching "git\status" -> "gitstatus" by disallowing generic backslash matching. The policy utils fix should be evaluated separately.
**Conflicts expected:** PARTIAL — policy/utils.ts has different implementation
**Partial applicability:** YES — only `policy/utils.ts` regex fix is applicable; scheduler changes already done

---

## 416d243027d975c284a8ca939e2ebcbefdf5c07f — Enhance TestRig with process management and timeouts (#15908)
**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Areas:** testing, integration-tests
**Evidence:**
- LLxprt has `integration-tests/test-helper.ts` with `TestRig` class
- LLxprt uses `LLXPRT_DIR` constant, not `GEMINI_DIR`
- LLxprt has different structure (no `GEMINI_CLI_HOME` env var)
- Diff adds process cleanup, timeout handling, spawn process tracking
**Rationale:** LLxprt has a different test helper structure. The improvements (process management, timeouts) are valuable but would need adaptation. The TestRig class exists but with different implementation. This should be reimplemented to match LLxprt's architecture.
**Conflicts expected:** YES — different test infrastructure
**Partial applicability:** NO

---

## 8f9bb6bccc65500a7d16078ffb3540407c2f90f6 — Update troubleshooting doc for UNABLE_TO_GET_ISSUER_CERT_LOCALLY (#16069)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** documentation
**Evidence:**
- LLxprt has `docs/troubleshooting.md`
- Diff adds `NODE_USE_SYSTEM_CA=1` as first solution before `NODE_EXTRA_CA_CERTS`
- Improves guidance for corporate network SSL issues
**Rationale:** Documentation improvement that helps users on corporate networks with SSL interception. This is a helpful addition that applies to any Node.js CLI tool. Clean cherry-pick.
**Conflicts expected:** NO — documentation only
**Partial applicability:** NO

---

## d1eb87c81ffeb4f9faf162c69afa0a2149d3acca — Add keytar to dependencies (#15928)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** dependencies, security
**Evidence:**
- Diff adds `keytar` to package.json, packages/core/package.json, esbuild.config.js
- keytar provides secure credential storage using OS keychain
**Rationale:** Adds keytar for secure credential storage using OS-native keychain integration. This is infrastructure for secure credential management. LLxprt can benefit from this for provider credential storage. Clean dependency addition.
**Conflicts expected:** NO — dependency addition only
**Partial applicability:** NO

---

## 97b31c4eefab2a9b7b9dedfc0511c930cf8d85a9 — Simplify extension settings command (#16001)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** extensions, cli
**Evidence:**
- Renames `settings.ts` to `configure.ts`
- Creates new `configure.ts` with cleaner interface
- Removes old `settings.ts` (162 lines deleted)
- Adds better prompts and scope handling
**Rationale:** Improves extension configuration UX with cleaner command structure. The new `configure` command is more intuitive than the old `settings` command. LLxprt has extensions system and this improves the user experience.
**Conflicts expected:** YES — file rename from settings.ts to configure.ts
**Partial applicability:** NO

---

## db99beda36912b2a568fb2f986241843c60cce4d — feat(admin): implement extensions disabled (#16024)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** admin, extensions
**Evidence:**
- Adds `extensionsEnabled` config parameter and `getExtensionsEnabled()` method
- Modifies extension manager to check `admin.extensions.enabled` setting
- LLxprt `config.ts` does not have `extensionsEnabled` or `getExtensionsEnabled`
**Rationale:** This commit is REVERTED in the next commit (19bdd95eab6209bcfc05c37ce933ceb41f6f4e49). Per audit criteria, reverted commits should be skipped unless the feature is re-implemented later.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

## 57012ae5b33bcccee2e90e345447df5bbf653a3d — Core data structure updates for Rewind functionality (#15714)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** compression, session, rewind
**Evidence:**
- Adds `rewindTo()` method to `ChatRecordingService`
- Adds `filePath` to `FileDiff` interface
- Adds `ResumedSessionData` for session continuation after compression
- Modifies `chatRecordingService.ts`, `client.ts`, `tools.ts`
**Rationale:** This adds infrastructure for a "Rewind" feature that LLxprt doesn't have. LLxprt uses `/continue` instead of `/restore`. Per audit criteria, Restore Command is a REIMPLEMENTED feature and should not be cherry-picked. The data structure changes are specific to the rewind/restore functionality.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

## c64b5ec4a3a0c2e50e046ab012733024435612df — feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** hooks
**Evidence:**
- LLxprt `packages/core/src/hooks/hookSystem.ts` is SIGNIFICANTLY different
- LLxprt has `dispose()` method, `messageBus` injection, `injectedDebugLogger`
- LLxprt references `PLAN-20250218-HOOKSYSTEM.P03` - a rewrite plan
- LLxprt has no `fireSessionStartEvent`, `fireSessionEndEvent`, `firePreCompressEvent` wrapper methods
- Upstream adds convenience wrapper methods that check `config.getEnableHooks()`
**Rationale:** LLxprt's hook system has been rewritten with different architecture (see PLAN references in code). The upstream change adds convenience wrapper methods. These could be added to LLxprt's HookSystem but would need to be implemented following LLxprt's architecture patterns. Not a direct cherry-pick.
**Conflicts expected:** YES — different HookSystem architecture
**Partial applicability:** NO

---

## 143bb63483ad432cb3184a693e95f7a7179cb563 — Add exp.gws_experiment field to LogEventEntry (#16062)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** telemetry, clearcut-logger
**Evidence:**
- Modifies `packages/core/src/telemetry/clearcut-logger/` files
- Adds experiment field to telemetry logging
**Rationale:** ClearcutLogger/telemetry commit. All telemetry infrastructure has been removed from LLxprt. Skip per audit criteria.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

## 19bdd95eab6209bcfc05c37ce933ceb41f6f4e49 — Revert "feat(admin): implement extensions disabled" (#16082)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** admin, extensions
**Evidence:**
- Reverts commit db99beda36912b2a568fb2f986241843c60cce4d
- No net code change when combined with the reverted commit
**Rationale:** This is a pure revert of commit 13. Since commit 13 is SKIP, this revert is NO_OP. Nothing to apply.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

## 4c961df3136b6b293a17a565c34541198b62062a — feat(core): Decouple enabling hooks UI from subsystem. (#16074)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** hooks, config
**Evidence:**
- Adds `enableHooksUI` separate from `enableHooks`
- `enableHooksUI` controls whether hooks command appears in UI
- `enableHooks` controls whether hook system actually runs
- LLxprt `config.ts` does not have `getEnableHooksUI()`
**Rationale:** The concept is valuable - separating UI visibility from functional enablement. However, LLxprt's hook system has been rewritten (see commit 15 analysis). The settingsSchema.ts and config.ts changes would need to be adapted to LLxprt's architecture. Not a direct cherry-pick.
**Conflicts expected:** YES — different config/settings structure
**Partial applicability:** NO

---

## 17b3eb730a9aee670bdbcd8ac2eeb22c9bf670ab — docs: add docs for hooks + extensions (#16073)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** documentation
**Evidence:**
- Adds documentation to `docs/extensions/index.md` and `docs/hooks/` files
- Explains hook and extension usage
**Rationale:** Documentation improvement. LLxprt has hooks and extensions systems. The documentation may need minor branding changes (e.g., gemini -> llxprt) but is otherwise applicable.
**Conflicts expected:** MINOR — branding changes needed
**Partial applicability:** NO

---

## a1dd19738e3a15a9bc78cefc194e8ea6920e0dc4 — feat(core): Preliminary changes for subagent model routing. (#16035)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** routing, model-config
**Evidence:**
- Modifies `packages/core/src/routing/` directory
- LLxprt does NOT have `packages/core/src/routing/` directory
- Adds `requestedModel` to `RoutingContext`
- Adds `isAutoModel()` function
- Adds `registerRuntimeModelOverride()` to `ModelConfigService`
**Rationale:** LLxprt doesn't have the routing directory or the same model routing architecture. This is infrastructure for subagent model routing that doesn't exist in LLxprt. The changes are specific to upstream's routing implementation.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

## d5996fea9994fb2e22cf2f92ca1292d9b46e65c5 — Optimize CI workflow: Parallelize jobs and cache linters (#16054)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ci, github-actions
**Evidence:**
- Modifies `.github/workflows/ci.yml` and `.github/workflows/chained_e2e.yml`
- Adds job parallelization and linter caching
- Modifies `scripts/lint.js`
**Rationale:** CI workflow specific to upstream. LLxprt has its own CI configuration. Per audit criteria, skip CI workflows specific to upstream.
**Conflicts expected:** N/A
**Partial applicability:** N/A

---

# Summary

## PICK (7 commits)
1. da85e3f8 — improve activate_skill tool (lowercase XML tags, better errors)
2. 982eee63 — Hx (Helix) editor support
3. a26463b0 — [Skills] Centralize management logic (creates skillSettings.ts, skillUtils.ts)
4. 2d683bb6 — [Skills] Multi-scope enablement fix (depends on #3)
5. 8f9bb6bc — Troubleshooting doc for SSL issues
6. d1eb87c8 — Add keytar dependency
7. 97b31c4e — Simplify extension settings command
8. 17b3eb73 — Hooks + extensions documentation

## PARTIAL PICK (1 commit)
1. 5fe5d1da — policy/utils.ts regex fix only (scheduler changes already done in LLxprt)

## REIMPLEMENT (3 commits)
1. 416d2430 — TestRig improvements (different test infrastructure)
2. c64b5ec4 — Hook firing wrapper methods (different HookSystem architecture)
3. 4c961df3 — Hooks UI decoupling (different config structure)

## SKIP (10 commits)
1. 521dc7f2 — Telemetry property (ClearcutLogger removed)
2. b54215f0 — Version bump (upstream release)
3. 7956eb23 — GEMINI_CLI_HOME (upstream test infrastructure)
4. db99beda — Extensions disabled (reverted)
5. 57012ae5 — Rewind functionality (LLxprt uses /continue)
6. 143bb634 — Telemetry experiment field (ClearcutLogger removed)
7. 19bdd95e — Revert extensions disabled (NO_OP)
8. a1dd1973 — Subagent model routing (no routing/ directory in LLxprt)
9. d5996fea — CI workflow optimization (upstream-specific)

## NO_OP (1 commit)
1. 19bdd95e — Revert (no net change)

---

## Dependency Chain for Skills Commits
- Commit 3 (a26463b0) must be picked BEFORE Commit 4 (2d683bb6)
- Both depend on LLxprt having the skills system (confirmed present)

## Notes on Hook System
LLxprt's hook system has been significantly rewritten with:
- PLAN-20250218-HOOKSYSTEM.P03 plan reference
- MessageBus integration (DELTA-HSYS-001)
- dispose() method for cleanup
- Injected dependencies support

Hook-related commits (15, 18) need careful reimplementation following LLxprt's architecture.


# Batch B

# DEEP CODE AUDIT: Batch B — Commits 22-42

Audit Date: 2026-01-19
Auditor: Claude Code Audit Agent
Fork: LLxprt Code (multi-provider)

---

## 0be8b5b1ed2928a08818c725284e6ca56bdd2116 — Add option to fallback for capacity errors in ProQuotaDialog (#16050)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ProQuotaDialog, Gemini-specific UI
**Evidence:** 
- File: `packages/cli/src/ui/components/ProQuotaDialog.tsx` — does NOT exist in LLxprt
- Upstream adds `retry_always` option for capacity errors to switch to fallback model
- LLxprt does not have ProQuotaDialog component (removed as Gemini-specific)
**Rationale:** ProQuotaDialog is a Gemini-specific component for handling quota errors with Google's API. LLxprt is multi-provider and doesn't have this component. The fallback model logic is tied to Gemini's flash/pro model hierarchy.
**Conflicts expected:** YES — component doesn't exist
**Partial applicability:** None — entire commit is for a non-existent component

---

## 1c77bac146a09f251d246110543e3994e223feb7 — feat: add confirmation details support + jsonrpc vs http rest support (#16079)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** A2A client manager, delegate-to-agent-tool, remote-invocation, registry
**Evidence:**
- Files: `packages/core/src/agents/a2a-client-manager.ts`, `packages/core/src/agents/delegate-to-agent-tool.ts`, `packages/core/src/agents/remote-invocation.ts`, `packages/core/src/agents/registry.ts`
- LLxprt has `packages/core/src/agents/registry.ts` (verified exists)
- Commit adds:
  1. JSON-RPC bypass logic in `createAdapterFetch` for compliant SDK requests
  2. Confirmation details forwarding for remote agent invocations
  3. ADCHandler for secure platform auth in registry
**Rationale:** This is a feature enhancement for the A2A (Agent-to-Agent) system. The JSON-RPC vs REST dialect translation fix and confirmation forwarding are general improvements not tied to Google auth. The ADCHandler usage may need review but appears to be for secure agent loading.
**Conflicts expected:** YES — minor conflicts possible in registry.ts around import statements
**Partial applicability:** All files apply but may need ADCHandler verification

---

## bd77515fd931b66f1fcdf42f72bfcba70447d163 — fix(workflows): fix and limit labels for pr-triage.sh script (#16096)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** GitHub workflows, PR triage
**Evidence:**
- File: `.github/scripts/pr-triage.sh` — upstream-specific workflow
**Rationale:** PR triage workflow script specific to upstream's repository automation. LLxprt has its own workflow processes. Per audit criteria: "gemini-automated-issue-triage.yml / PR triage workflows" should be skipped.
**Conflicts expected:** NO — file may not exist in LLxprt
**Partial applicability:** None

---

## d4b418ba01f16ed5962357cac95832fa4ff823aa — Fix and rename introspection agent -> cli help agent (#16097)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** Agents, CLI Help Agent, configuration
**Evidence:**
- File: `packages/core/src/agents/cli-help-agent.ts` — does NOT exist in LLxprt (verified via glob)
- LLxprt `packages/core/src/agents/registry.ts` exists but has no cli-help agent registration
- Commit renames `introspection-agent.ts` → `cli-help-agent.ts` and updates references
**Rationale:** LLxprt doesn't have the introspection/cli-help agent feature. The agent is designed to answer questions about Gemini CLI itself using internal docs. This is Gemini-specific functionality. Additionally, the agent uses `GEMINI_MODEL_ALIAS_FLASH` and references Gemini-specific config.
**Conflicts expected:** YES — feature doesn't exist
**Partial applicability:** None — entire feature is absent

---

## 51d3f44d51066ec7dd2d80a2f61de2534a54eed3 — Docs: Changelogs update 20260105 (#15937)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** Documentation, changelogs
**Evidence:**
- Files: `docs/changelogs/*.md`, `docs/get-started/gemini-3.md`
**Rationale:** Gemini-specific release documentation and changelogs. LLxprt maintains its own changelog. Per audit criteria: "Gemini-specific release commits" should be skipped.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 1aa35c879605ef14027f8fa80a3b34ece495520d — enable cli_help agent by default (#16100)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** Agents, configuration, CLI Help Agent
**Evidence:**
- Same as commit 24 above — CLI Help Agent doesn't exist in LLxprt
- Changes `cliHelpAgentSettings.enabled` default from `false` to `true`
**Rationale:** Depends on CLI Help Agent which doesn't exist in LLxprt. Skip because the feature is absent.
**Conflicts expected:** YES — feature doesn't exist
**Partial applicability:** None

---

## 1bd4f9d8b6fe819248abbe2c222effd763ba45cc — Optimize json-output tests with mock responses (#16102)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** Integration tests, test optimization
**Evidence:**
- Files: `integration-tests/json-output.test.ts`, `integration-tests/json-output.*.responses`
- Commit enables previously skipped tests by using mock responses instead of live API calls
**Rationale:** Test optimization that makes integration tests more reliable by using mock responses. This is a general improvement applicable to any fork. The mock response format is provider-agnostic (standard generateContentStream response).
**Conflicts expected:** NO — test file should exist
**Partial applicability:** Full applicability

---

## dd04b46e86d04d72682164b4a766baf9ddef12dc — Fix CI for forks (#16113)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** CI workflows
**Evidence:**
- File: `.github/workflows/ci.yml`
**Rationale:** CI workflow fixes specific to upstream's fork handling. Per audit criteria: "CI workflows specific to upstream (nightly releases, forks guards)" should be skipped. LLxprt has its own CI configuration.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 41cc6cf105df25dd3d10f495c6aa319537390b35 — Reduce nags about PRs that reference issues but don't fix them. (#16112)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** PR triage workflow
**Evidence:**
- File: `.github/scripts/pr-triage.sh`
**Rationale:** More PR triage workflow adjustments. Per audit criteria, skip PR triage workflow changes.
**Conflicts expected:** NO
**Partial applicability:** None

---

## d48c934357cd6f89f534385a712728387aae0fdc — feat(cli): add filepath autosuggestion after slash commands (#14738)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** Command completion, UI/UX
**Evidence:**
- File: `packages/cli/src/ui/hooks/useCommandCompletion.tsx` — EXISTS in LLxprt (verified)
- Commit reorders completion mode detection to check for `@` completion BEFORE slash command completion
- This allows `/cmd @file` to trigger file completion instead of slash command completion
**Rationale:** UX improvement for command completion that allows `@` file references after slash commands. The change is a simple reordering of priority in the completion logic. No Gemini-specific dependencies. Directly applicable to LLxprt.
**Conflicts expected:** NO — file exists and logic is compatible
**Partial applicability:** Full applicability

---

## aca6bf6aa0397b6ffcf53426af900447395fa18a — Add upgrade option for paid users (#15978)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ProQuotaDialog, Gemini billing
**Evidence:**
- Files: `packages/cli/src/ui/components/ProQuotaDialog.tsx`, `DialogManager.tsx`
- ProQuotaDialog does NOT exist in LLxprt
**Rationale:** Adds "Upgrade for higher limits" option for Gemini's paid tier users. This is Gemini-specific billing/quota UI. LLxprt doesn't have ProQuotaDialog. Per audit criteria, skip Gemini-specific features.
**Conflicts expected:** YES — component doesn't exist
**Partial applicability:** None

---

## 3e2f4eb8ba12bded08183f3e71163cb0f7b00b31 — [Skills] UX Polishing: Transparent feedback and CLI refinements (#15954)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** Skills system, CLI commands
**Evidence:**
- Files: `packages/cli/src/commands/skills/disable.ts`, `packages/cli/src/commands/skills/enable.ts`, `packages/cli/src/ui/commands/skillsCommand.ts`
- LLxprt has skills system (verified skillLoader.ts exists)
- Commit adds:
  1. Better feedback messages with file paths
  2. "Restart required to take effect" messages
  3. Changes default scope from 'user' to 'project'
**Rationale:** Skills system improvements for UX. These are general improvements to the skills command feedback and behavior. No Gemini-specific dependencies. LLxprt has skills support.
**Conflicts expected:** NO — skills commands should exist
**Partial applicability:** Full applicability

---

## 722c4933dc34f962f1ad1c877c5ab779500af859 — Polish: Move 'Failed to load skills' warning to debug logs (#16142)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** Skills system, logging
**Evidence:**
- File: `packages/core/src/skills/skillLoader.ts` — EXISTS in LLxprt (verified)
- Current LLxprt code uses `coreEvents.emitFeedback('warning', ...)` 
- Commit changes this to `debugLogger.debug(...)` instead
**Rationale:** UX improvement to reduce noise - failed skill loading warnings are moved to debug logs. This is a straightforward change. The LLxprt skillLoader.ts currently has the warning pattern that needs to be updated.
**Conflicts expected:** NO — file exists with same pattern
**Partial applicability:** Full applicability

---

## 030847a80a482d7bc545903de886da338f20e986 — feat(cli): export chat history in /bug and prefill GitHub issue (#16115)

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** Bug command, history export
**Evidence:**
- File: `packages/cli/src/ui/commands/bugCommand.ts` — EXISTS in LLxprt (verified)
- File: `packages/cli/src/ui/utils/historyExportUtils.ts` — does NOT exist in LLxprt
- LLxprt bugCommand.ts uses `vybestack/llxprt-code` URL, not `google-gemini/gemini-cli`
- Commit adds history export functionality and prefills GitHub issue
**Rationale:** Good feature to pick up, but needs reimplementation:
1. URL is already different (LLxprt uses vybestack org)
2. New file `historyExportUtils.ts` needs to be created
3. Bug command URL template already differs in LLxprt
4. The `INITIAL_HISTORY_LENGTH` constant may have different location
**Conflicts expected:** YES — needs brand adjustments
**Partial applicability:** Needs reimplementation with LLxprt branding

---

## eb75f59a96e48e4da5bd995be5f27da8d1ae4561 — bug(core): fix issue with overrides to bases. (#15255)

**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** Model config service, config resolution
**Evidence:**
- Files: `packages/core/src/services/modelConfigService.ts` — does NOT exist in LLxprt (via find)
- LLxprt may have different model config handling
- Commit fixes override application in alias hierarchy
**Rationale:** This is a significant bug fix for model configuration resolution. The fix ensures overrides applied to parent aliases properly affect child aliases. However, LLxprt may not have the `modelConfigService.ts` file — needs verification of whether similar functionality exists elsewhere or if this entire service is absent.
**Conflicts expected:** YES — file may not exist
**Partial applicability:** Unknown — need to verify if LLxprt has model config service

---

## cf021ccae46e3d419f21bcc41dc7fd0638c8cd6b — enableInteractiveShell for external tooling relying on a2a server (#16080)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** A2A server, configuration
**Evidence:**
- File: `packages/a2a-server/src/config/config.ts`
- Single line change: `enableInteractiveShell: true`
**Rationale:** Enables interactive shell for A2A server which external tooling relies on. Simple configuration change with no Gemini-specific dependencies.
**Conflicts expected:** NO — simple config addition
**Partial applicability:** Full applicability if a2a-server exists

---

## 97ad3d97cba27b871efbd84cb69f90ca4846760c — Reapply "feat(admin): implement extensions disabled" (#16082) (#16109)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** Admin settings, extensions, MCP
**Evidence:**
- Files: `packages/cli/src/config/config.ts`, `packages/cli/src/config/extension-manager.ts`, `packages/cli/src/services/BuiltinCommandLoader.ts`, `packages/core/src/config/config.ts`
- Adds `extensionsEnabled` config option with admin control
- LLxprt has `BuiltinCommandLoader.ts` (verified via test file existence)
**Rationale:** Admin feature to disable extensions via settings. This is a governance/enterprise feature useful for multi-provider CLI. Adds `getExtensionsEnabled()` to config and shows error message when extensions are disabled.
**Conflicts expected:** YES — extension-manager.ts doesn't exist in LLxprt
**Partial applicability:** Core config changes apply; extension-manager may need different file

---

## 660368f249066151e033a65668525ea17c20e3b3 — bug(core): Fix spewie getter in hookTranslator.ts (#16108)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** Hooks, hook translator
**Evidence:**
- File: `packages/core/src/hooks/hookTranslator.ts` — EXISTS in LLxprt (verified)
- Current LLxprt code has `text: sdkResponse.text` at line 270
- Commit changes to `text: getResponseText(sdkResponse) ?? undefined`
**Rationale:** Bug fix for extracting text from SDK response. The `sdkResponse.text` getter can fail in certain cases; using `getResponseText()` is safer. This is a general fix applicable to any provider using the GenAI SDK types.
**Conflicts expected:** NO — file exists with same pattern
**Partial applicability:** Full applicability

---

## eb3f3cfdb8a0d2fd9a81ed7ab7d2a96f965ac483 — feat(hooks): add mcp_context to BeforeTool and AfterTool hook inputs (#15656)

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** Hooks, MCP tools
**Evidence:**
- Files: `packages/core/src/core/coreToolHookTriggers.ts` — EXISTS in LLxprt but different structure
- LLxprt has rewritten hook system with `triggerBeforeToolHook` and `triggerAfterToolHook` functions
- Upstream uses `fireBeforeToolHook`/`fireAfterToolHook` with message bus
- LLxprt uses `HookSystem` singleton with `fireBeforeToolEvent`/`fireAfterToolEvent`
**Rationale:** Great feature to add — MCP context in hooks allows hook scripts to know which MCP server/tool is being invoked. However, LLxprt has a significantly different hook trigger architecture:
1. LLxprt uses `triggerBeforeToolHook`/`triggerAfterToolHook` functions
2. LLxprt uses `HookSystem.getEventHandler().fireBeforeToolEvent()`
3. Upstream uses message bus pattern with `fireBeforeToolHook`
Need to adapt the MCP context extraction logic to LLxprt's architecture.
**Conflicts expected:** YES — different hook architecture
**Partial applicability:** Concept applies, needs architecture adaptation

---

## 02cf264ee10b88e24cef1f2ca01299ed29768cd1 — Add extension linking capabilities in cli (#16040)

**Verdict:** PICK
**Confidence:** HIGH
**Areas:** Extensions, CLI commands
**Evidence:**
- File: `packages/cli/src/ui/commands/extensionsCommand.ts` — EXISTS in LLxprt (verified)
- Adds `/extensions link <source>` command for local development
**Rationale:** Extension linking is useful for extension developers. Allows linking a local extension directory instead of installing. General feature applicable to any CLI with extensions.
**Conflicts expected:** NO — file exists
**Partial applicability:** Full applicability

---

## 76d020511fd4703da0a4a2d166531cc5ae4a97c0 — Update the page's title to be consistent and show in site. (#16174)

**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** Documentation
**Evidence:**
- File: `docs/cli/model-routing.md`
- Single character change: `##` → `#` for proper markdown title
**Rationale:** Documentation formatting fix specific to upstream's doc site. LLxprt maintains its own docs. Minor change with no code impact.
**Conflicts expected:** NO
**Partial applicability:** None — doc-only change

---

# SUMMARY

## PICK (10 commits)
1. `1c77bac146a09f251d246110543e3994e223feb7` — A2A JSON-RPC/REST support and confirmation details
2. `1bd4f9d8b6fe819248abbe2c222effd763ba45cc` — JSON-output test optimization with mock responses
3. `d48c934357cd6f89f534385a712728387aae0fdc` — Filepath autosuggestion after slash commands
4. `3e2f4eb8ba12bded08183f3e71163cb0f7b00b31` — Skills UX polishing
5. `722c4933dc34f962f1ad1c877c5ab779500af859` — Move skills warning to debug logs
6. `cf021ccae46e3d419f21bcc41dc7fd0638c8cd6b` — Enable interactive shell for A2A server
7. `97ad3d97cba27b871efbd84cb69f90ca4846760c` — Admin extensions disabled feature
8. `660368f249066151e033a65668525ea17c20e3b3` — Fix spewie getter in hookTranslator
9. `02cf264ee10b88e24cef1f2ca01299ed29768cd1` — Extension linking capabilities
10. `eb75f59a96e48e4da5bd995be5f27da8d1ae4561` — Model config override fix (needs file verification)

## REIMPLEMENT (2 commits)
1. `030847a80a482d7bc545903de886da338f20e986` — Export chat history in /bug (brand adjustments needed)
2. `eb3f3cfdb8a0d2fd9a81ed7ab7d2a96f965ac483` — MCP context in hooks (different hook architecture)

## SKIP (9 commits)
1. `0be8b5b1ed2928a08818c725284e6ca56bdd2116` — ProQuotaDialog fallback (component doesn't exist)
2. `bd77515fd931b66f1fcdf42f72bfcba70447d163` — PR triage script (upstream workflow)
3. `d4b418ba01f16ed5962357cac95832fa4ff823aa` — CLI help agent rename (feature doesn't exist)
4. `51d3f44d51066ec7dd2d80a2f61de2534a54eed3` — Changelogs update (release docs)
5. `1aa35c879605ef14027f8fa80a3b34ece495520d` — Enable CLI help agent (feature doesn't exist)
6. `dd04b46e86d04d72682164b4a766baf9ddef12dc` — Fix CI for forks (upstream workflow)
7. `41cc6cf105df25dd3d10f495c6aa319537390b35` — PR triage nags (upstream workflow)
8. `aca6bf6aa0397b6ffcf53426af900447395fa18a` — Upgrade option for paid users (ProQuotaDialog)
9. `76d020511fd4703da0a4a2d166531cc5ae4a97c0` — Doc title fix (documentation)

## Notes for Implementation

### High Priority PICKs:
- `660368f249066151e033a65668525ea17c20e3b3` — Hook translator fix is a simple one-line change
- `722c4933dc34f962f1ad1c877c5ab779500af859` — Skills warning to debug log is straightforward
- `d48c934357cd6f89f534385a712728387aae0fdc` — Command completion reordering is clean

### Needs Verification:
- `eb75f59a96e48e4da5bd995be5f27da8d1ae4561` — Verify if LLxprt has modelConfigService.ts equivalent
- `97ad3d97cba27b871efbd84cb69f90ca4846760c` — Verify extension-manager.ts location in LLxprt

### REIMPLEMENT Details:
- Bug command history export: Need to create `historyExportUtils.ts` with LLxprt branding
- MCP context in hooks: Need to adapt to LLxprt's `HookSystem` architecture instead of message bus


# Batch C

# Audit Batch C — Commits 43-63

## ced5110dab1649bfd0ca1199d373ffe805388f47 — docs: correct typo in bufferFastReturn JSDoc (#16056)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** docs
**Evidence:** 
- Upstream: `packages/cli/src/ui/contexts/KeypressContext.tsx` line 196 — "accomodate" → "accommodate" typo fix
- LLxprt: Same file exists, would need to verify if same typo exists
**Rationale:** This is a trivial typo fix in a JSDoc comment. The typo may already exist in LLxprt or may not depending on fork timing. Such trivial doc typo fixes have no functional impact.
**Conflicts expected:** NO — trivial text change
**Partial applicability:** May already be fixed in LLxprt or the typo may not exist

---

## 75bc41fc20efd8f087a13564df9a2d63ac964ac7 — fix: typo in MCP servers settings description (#15929)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** docs
**Evidence:**
- Upstream: `docs/extensions/index.md` — "settingsd" → "settings" typo fix
- LLxprt: Documentation file exists, would need to verify if same typo exists
**Rationale:** Trivial documentation typo fix with no functional impact. Whether this applies depends on whether LLxprt has the same typo.
**Conflicts expected:** NO — trivial text change
**Partial applicability:** May already be fixed in LLxprt or the typo may not exist

---

## 1a4ae413978cb2a55029279669c03243e1bfdd94 — fix: yolo should auto allow redirection (#16183)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** policy, security
**Evidence:**
- Upstream: `packages/core/src/policy/policies/yolo.toml` — adds `allow_redirection = true` to yolo policy
- LLxprt: `packages/core/src/policy/policies/yolo.toml` already has `allow_redirection = true` on line 8
**Rationale:** This fix is ALREADY APPLIED in LLxprt. The yolo.toml in LLxprt already contains `allow_redirection = true`. No action needed.
**Conflicts expected:** NO — already applied
**Partial applicability:** Already present in LLxprt

---

## f8138262fa7cc5e6c2f8f5af8baff2efcd4888e1 — fix(cli): disableYoloMode shouldn't enforce default approval mode against args (#16155)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** config, approval-mode
**Evidence:**
- Upstream: `packages/cli/src/config/config.ts` — removes line that forces `approvalMode = ApprovalMode.DEFAULT` when disableYoloMode is true
- LLxprt: Same file exists, need to check if this line exists
**Rationale:** This is a bug fix where `disableYoloMode` was incorrectly overriding user-specified approval mode (like `auto_edit`). The fix removes an overzealous line that forced DEFAULT mode even when user explicitly requested a different mode. This is a legitimate bug fix that respects user CLI arguments.
**Conflicts expected:** NO — removes a line, clean cherry-pick
**Partial applicability:** N/A

---

## fbfad06307c7292287333c380005d9c5ce2f39e2 — feat: add native Sublime Text support to IDE detection (#16083)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ide-detection
**Evidence:**
- Upstream: `packages/core/src/ide/detect-ide.ts` — adds `sublimetext` definition and detection for `TERM_PROGRAM === 'sublime'`
- LLxprt: `packages/core/src/ide/detect-ide.ts` — currently lacks Sublime Text support
**Rationale:** Adds support for Sublime Text IDE detection. This is a compatible feature addition that expands IDE support without breaking existing functionality. LLxprt's detect-ide.ts currently does NOT have Sublime Text support.
**Conflicts expected:** NO — additive change
**Partial applicability:** N/A

---

## 16da6918cb56b04141583ad7253270afc7a77e34 — refactor(core): extract ToolModificationHandler from scheduler (#16118)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** scheduler, refactoring
**Evidence:**
- Upstream: Creates new `packages/core/src/scheduler/tool-modifier.ts` and refactors `coreToolScheduler.ts` to use it
- LLxprt: `packages/core/src/scheduler/` only has `types.ts` and `tool-executor.ts` — no `tool-modifier.ts`
- LLxprt: `packages/core/src/core/coreToolScheduler.ts` still has `_applyInlineModify` method inline
**Rationale:** LLxprt has NOT applied this refactoring. The scheduler still has the inline modification logic. This is a pure refactoring commit that extracts code into a separate handler class. While clean, it's a structural change that:
1. Doesn't fix a bug
2. Adds complexity (new file/class)
3. Could introduce merge conflicts with LLxprt's scheduler changes

Given the "Tool scheduler queue changes" are listed as REMOVED in audit criteria, and this is a significant scheduler restructuring, SKIP is appropriate.
**Conflicts expected:** YES — scheduler has diverged
**Partial applicability:** Could reimplement but not worth the effort for a pure refactor

---

## 01d2d4373721415cb4a9cd8a1bbe055e3beeb145 — Add support for Antigravity terminal in terminal setup utility (#16051)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** terminal-setup, ide-integration
**Evidence:**
- Upstream: `packages/cli/src/ui/utils/terminalSetup.ts` — adds `antigravity` to `SupportedTerminal` type and detection logic
- LLxprt: `packages/cli/src/ui/utils/terminalSetup.ts` — currently only supports `vscode`, `cursor`, `windsurf`
**Rationale:** Adds support for Antigravity terminal. This is a compatible feature addition that expands terminal support. LLxprt's terminalSetup.ts does NOT have Antigravity support yet.
**Conflicts expected:** NO — additive change
**Partial applicability:** N/A

---

## 41a8809280f844870600f63a4beea4c0bd585d8e — feat(core): Wire up model routing to subagents. (#16043)
**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Areas:** agents, model-routing, multi-provider
**Evidence:**
- Upstream: Changes `packages/core/src/agents/local-executor.ts` and `registry.ts` to support model routing with `isAutoModel()` check
- Uses `DEFAULT_GEMINI_MODEL` as fallback
**Rationale:** This commit wires up model routing to subagents. For LLxprt's multi-provider architecture:
1. The concept of model routing is valid
2. But `DEFAULT_GEMINI_MODEL` fallback is Gemini-specific
3. The `isAutoModel()` logic may need adaptation for multi-provider

This should be reimplemented with multi-provider awareness, using a provider-aware default model fallback instead of hardcoding Gemini.
**Conflicts expected:** YES — Gemini-specific fallback
**Partial applicability:** Core logic is sound, but needs multi-provider adaptation

---

## 7e02ef697ddc147037a4e7261f22c80617125df5 — feat(cli): add /agents slash command to list available agents (#16182)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** cli, agents, slash-commands
**Evidence:**
- Upstream: Adds `packages/cli/src/ui/commands/agentsCommand.ts`, `AgentsStatus.tsx` component, and wires up in `BuiltinCommandLoader.ts`
- Creates new `MessageType.AGENTS_LIST` and `HistoryItemAgentsList` type
**Rationale:** Adds `/agents` slash command to list available local and remote agents. This is a useful UX feature for discovering available agents. The implementation is self-contained and doesn't have Gemini-specific assumptions.
**Conflicts expected:** NO — additive feature
**Partial applicability:** N/A

---

## 9062a943e732c4af1179bf31a4fcc0323a38ee6b — docs(cli): fix includeDirectories nesting in configuration.md (#15067)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** docs
**Evidence:**
- Upstream: Binary file change to `docs/cli/configuration.md`
- This doc file was deleted in commit 26505b58 (next commit in batch)
**Rationale:** This documentation fix is immediately obsoleted by the next commit which deletes the entire file. No action needed.
**Conflicts expected:** NO — file deleted in next commit
**Partial applicability:** File deleted upstream

---

## e5f7a9c4240c4655e4075863c06ae842ca81e369 — feat: implement file system reversion utilities for rewind (#15715)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** rewind, file-operations, utilities
**Evidence:**
- Upstream: Adds `packages/cli/src/ui/utils/rewindFileOps.ts` with `calculateTurnStats`, `calculateRewindImpact`, `revertFileChanges` functions
- Adds `packages/core/src/utils/fileDiffUtils.ts` with `getFileDiffFromResultDisplay`, `computeAddedAndRemovedLines`
**Rationale:** Implements file system reversion utilities for the rewind feature. This provides:
1. Smart revert with patching (handles user modifications after agent changes)
2. Turn stats calculation
3. File diff utility functions

This is a legitimate feature addition with no Gemini-specific assumptions. The implementation uses standard Node.js fs operations and the `diff` library.
**Conflicts expected:** NO — new files
**Partial applicability:** N/A

---

## d75792703a0288ae5bbba0a2e98b4871661d1670 — Always enable redaction in GitHub actions. (#16200)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** security, environment-sanitization
**Evidence:**
- Upstream: `packages/core/src/services/environmentSanitization.ts` — adds check for `SURFACE === 'Github'` to enable strict sanitization
- Also modifies test file
**Rationale:** This is a GitHub-specific security enhancement that forces environment variable redaction when running in GitHub Actions. While the security principle is sound, this is specific to upstream's GitHub deployment context. LLxprt may have different deployment contexts.
**Conflicts expected:** NO — but context-specific
**Partial applicability:** Could pick if LLxprt runs in similar CI contexts, but SKIP for now as it's upstream-specific

---

## e51f3e11f1f24409c051fc627fe2ec9d478f5509 — fix: remove unsupported 'enabled' key from workflow config (#15611)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ci, workflows
**Evidence:**
- Upstream: Modifies `.github/workflows/gemini-automated-issue-dedup.yml` and `gemini-scheduled-issue-dedup.yml`
**Rationale:** These are Gemini-specific CI workflow files for issue deduplication. Per audit criteria, "gemini-automated-issue-triage.yml / PR triage workflows" should be SKIPPED.
**Conflicts expected:** N/A — upstream-specific workflows
**Partial applicability:** N/A

---

## 26505b580cc905e889e6494eddb75515ae8cd3f1 — docs: Remove redundant and duplicate documentation files (#14699)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** docs
**Evidence:**
- Upstream: Deletes `docs/cli/configuration.md` and `docs/get-started/deployment.md`
- Updates links in other docs to point to remaining files
**Rationale:** This removes documentation files that are specific to upstream's structure and deployment. LLxprt likely has its own documentation structure. The deleted files contain Gemini-specific installation instructions and deployment architecture.
**Conflicts expected:** YES — doc structure differs
**Partial applicability:** LLxprt should maintain its own doc structure

---

## a7f758eb3a42904ea21f6ff009c9fc2b6ccdae6b — docs: shorten run command and use published version (#16172)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** docs, branding
**Evidence:**
- Upstream: `README.md` — changes `npx https://github.com/google-gemini/gemini-cli` to `npx @google/gemini-cli`
**Rationale:** This is a branding-specific change for upstream's package name. LLxprt uses `@vybestack/llxprt-code-core` branding. This change is not applicable.
**Conflicts expected:** YES — branding mismatch
**Partial applicability:** N/A — LLxprt has its own package name

---

## 84710b19532fec3609b445cd8fa2a8d55e87917a — test(command-registry): increase initialization test timeout (#15979)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** testing, a2a-server
**Evidence:**
- Upstream: `packages/a2a-server/src/commands/command-registry.test.ts` — increases timeout from default to 20000ms
**Rationale:** This is a test-only change for flaky tests in the a2a-server package. While harmless, it's a test timeout adjustment specific to upstream's CI environment. LLxprt may have different timing characteristics.
**Conflicts expected:** NO — but context-specific
**Partial applicability:** Can pick if test is flaky in LLxprt too

---

## 4ab1b9895add04adef60a790bb7c84532492b14d — Ensure TERM is set to xterm-256color (#15828)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** terminal, shell-execution
**Evidence:**
- Upstream: `packages/core/src/services/shellExecutionService.ts` — changes `name: 'xterm'` to `name: 'xterm-256color'` in PTY spawn options
**Rationale:** This ensures proper terminal color support by using `xterm-256color` instead of basic `xterm`. This is a compatibility improvement that enables 256-color support in terminal sessions. Simple one-line fix with no downstream impact.
**Conflicts expected:** NO — simple value change
**Partial applicability:** N/A

---

## ffb80c2426d5627d212b334162e95a0be784a4e0 — The telemetry.js script should handle paths that contain spaces (#12078)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** telemetry, scripts
**Evidence:**
- Upstream: `scripts/telemetry.js` — changes `execSync` to `execFileSync` to handle paths with spaces
**Rationale:** Per audit criteria, "ClearcutLogger / Google telemetry commits (ALL telemetry removed from LLxprt)" should be SKIPPED. This is a telemetry script fix.
**Conflicts expected:** N/A — telemetry removed
**Partial applicability:** N/A — LLxprt has no telemetry

---

## 6166d7f6ec6a7ba519fc583e81303597edcc2e7d — ci: guard links workflow from running on forks (#15461)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ci, workflows
**Evidence:**
- Upstream: `.github/workflows/links.yml` — adds `if: github.repository == 'google-gemini/gemini-cli'` guard
**Rationale:** Per audit criteria, "CI workflows specific to upstream (nightly releases, forks guards)" should be SKIPPED. This is a fork guard for upstream's CI.
**Conflicts expected:** N/A — upstream-specific CI
**Partial applicability:** N/A

---

## f1ca7fa40a253400a0a96eb6d5833270bec534f0 — ci: guard nightly release workflow from running on forks (#15463)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ci, workflows
**Evidence:**
- Upstream: `.github/workflows/release-nightly.yml` — adds `if: "github.repository == 'google-gemini/gemini-cli'"` guard
**Rationale:** Per audit criteria, "CI workflows specific to upstream (nightly releases, forks guards)" should be SKIPPED. This is a fork guard for upstream's nightly release workflow.
**Conflicts expected:** N/A — upstream-specific CI
**Partial applicability:** N/A

---

## 18dd399cb571e47178dda7fc811d9f4a1867991c — Support @ suggestions for subagents (#16201)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ui, agents, suggestions, at-command
**Evidence:**
- Upstream: Adds agent support to `atCommandProcessor.ts`, `useAtCompletion.ts`, `SuggestionsDisplay.tsx`
- Adds `CommandKind.AGENT` enum value
- Adds tests in `atCommandProcessor_agents.test.ts` and `useAtCompletion_agents.test.ts`
**Rationale:** This adds `@AgentName` syntax support for explicitly selecting agents via the @ command system. Features:
1. Detects agent references in @ commands
2. Adds `[Agent]` suffix in suggestions display
3. Adds nudge message to use `delegate_to_agent` tool

This is a useful UX feature that integrates with the agent system without Gemini-specific assumptions.
**Conflicts expected:** NO — additive feature
**Partial applicability:** N/A

---

## Summary

| Commit | Verdict | Confidence |
|--------|---------|------------|
| ced5110d (typo JSDoc) | NO_OP | HIGH |
| 75bc41fc (typo MCP docs) | NO_OP | HIGH |
| 1a4ae413 (yolo redirection) | PICK (already applied) | HIGH |
| f8138262 (disableYoloMode fix) | PICK | HIGH |
| fbfad063 (Sublime Text IDE) | PICK | HIGH |
| 16da6918 (ToolModificationHandler refactor) | SKIP | HIGH |
| 01d2d437 (Antigravity terminal) | PICK | HIGH |
| 41a88092 (model routing subagents) | REIMPLEMENT | MEDIUM |
| 7e02ef69 (/agents command) | PICK | HIGH |
| 9062a943 (docs nesting fix) | NO_OP | HIGH |
| e5f7a9c4 (rewind file ops) | PICK | HIGH |
| d7579270 (GitHub redaction) | SKIP | HIGH |
| e51f3e11 (workflow config fix) | SKIP | HIGH |
| 26505b58 (remove dup docs) | SKIP | HIGH |
| a7f758eb (shorten run command) | SKIP | HIGH |
| 84710b19 (test timeout) | SKIP | HIGH |
| 4ab1b989 (TERM xterm-256color) | PICK | HIGH |
| ffb80c24 (telemetry spaces) | SKIP | HIGH |
| 6166d7f6 (links workflow guard) | SKIP | HIGH |
| f1ca7fa4 (nightly workflow guard) | SKIP | HIGH |
| 18dd399c (@ suggestions agents) | PICK | HIGH |

**PICK count:** 8 (including 1 already applied)
**REIMPLEMENT count:** 1
**SKIP count:** 10
**NO_OP count:** 2


# Batch D

# Audit Batch D — Commits 64-84

## e1e3efc9d04a1e93899e559e888b93c95b14ae2f — feat(hooks): Support explicit stop and block execution control in model hooks (#15947)
**Verdict:** REIMPLEMENT  
**Confidence:** MEDIUM  
**Areas:** core/hooks, core/geminiChat, core/turn  
**Evidence:** 
- Upstream adds `AgentExecutionStoppedError`, `AgentExecutionBlockedError` classes to geminiChat.ts
- Adds `AGENT_EXECUTION_STOPPED`, `AGENT_EXECUTION_BLOCKED` stream event types
- Adds `stopped`, `blocked` fields to `BeforeModelHookResult` and `AfterModelHookResult` interfaces
- Modifies `fireBeforeModelHook` and `fireAfterModelHook` in geminiChatHookTriggers.ts
- LLxprt search found NO matches for `AgentExecutionStopped` or `AgentExecutionBlocked` in packages/core
- LLxprt has HookSystem-based geminiChatHookTriggers.ts with `triggerBeforeModelHook` function (different pattern)
**Rationale:** LLxprt has rewritten hooks infrastructure using HookSystem singleton pattern. The stop/block execution control semantics are valuable but need to be implemented within LLxprt's `HookSystem` architecture. The upstream approach uses `fireBeforeModelHook`/`fireAfterModelHook` functions with error-based control flow; LLxprt uses `triggerBeforeModelHook`/`triggerAfterModelHook` that return typed hook output objects. The new stream event types and execution control semantics need to be added to LLxprt's event system.
**Conflicts expected:** YES  
**Partial applicability:** Stream event types and error classes can be ported; hook trigger logic needs adaptation to HookSystem pattern.

---

## 41e627a7ee4ca48a8cfdf4f8498153b0ac91b619 — Refine Gemini 3 system instructions to reduce model verbosity (#16139)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** core/prompts, core/prompts.test  
**Evidence:**
- Adds "No Chitchat" section for Gemini 3 models in prompts.ts
- Refined "Explain Before Acting" mandate text
- LLxprt has `isGemini3Model()` function in `packages/core/src/config/models.ts`
- LLxprt likely has similar prompt generation logic in prompts.ts
**Rationale:** Reduces model verbosity for Gemini 3 models - pure prompt engineering improvement. Changes the "Explain Before Acting" mandate to be more flexible and adds explicit "No Chitchat" guidance. These are model behavior improvements that apply to any Gemini 3 model regardless of provider.
**Conflicts expected:** NO  
**Partial applicability:** N/A

---

## aa480e5fbbbe4acd99b9f3f66de67511fa7aab6c — chore: clean up unused models and use consts (#16246)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** core/tokenLimits  
**Evidence:**
- Replaces hardcoded model strings with imported consts (`DEFAULT_GEMINI_MODEL`, `PREVIEW_GEMINI_MODEL`, etc.)
- Simplifies tokenLimit function switch statement
- LLxprt has model constants in `packages/core/src/config/models.ts`
**Rationale:** Code cleanup that uses model constants instead of hardcoded strings. Improves maintainability. The specific model names may differ in LLxprt (multi-provider), but the pattern of using constants should apply.
**Conflicts expected:** MINIMAL  
**Partial applicability:** May need to adapt which model constants are used.

---

## 88f1ec8d0ae40ee81eba7a997abe7a324f101aa7 — Always enable bracketed paste (#16179)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** cli/ui/contexts/KeypressContext, cli/ui/utils/terminalCapabilityManager  
**Evidence:**
- Removes `bufferFastReturn` function from KeypressContext.tsx
- Removes `isBracketedPasteEnabled()` check before enabling bracketed paste
- Always calls `enableBracketedPasteMode()` since terminals ignore it if unsupported
- LLxprt search found `bufferFastReturn` still exists at KeypressContext.tsx L210, L725
- LLxprt has `terminalCapabilityManager` with bracketed paste support
**Rationale:** Simplifies terminal handling by always enabling bracketed paste mode since terminals that don't support it will ignore the escape sequence. Removes the `bufferFastReturn` fallback code that was needed before bracketed paste was widely supported.
**Conflicts expected:** NO  
**Partial applicability:** N/A

---

## f7b97ef55ec96d851c53998ea19d090e4e01cff0 — refactor: migrate app container hook calls to hook system (#16161)
**Verdict:** SKIP  
**Confidence:** HIGH  
**Areas:** cli/ui/AppContainer  
**Evidence:**
- Upstream migrates from `fireSessionStartHook`/`fireSessionEndHook` to `config.getHookSystem()?.fireSessionStartEvent()`
- LLxprt search found NO matches for `fireSessionStartHook` or `fireSessionEndHook` in packages
- LLxprt already uses HookSystem-based approach with `triggerSessionStartHook` pattern
**Rationale:** LLxprt has already implemented hook system migration using its own HookSystem architecture. The upstream commit migrates from an older hook pattern to the newer HookSystem pattern - LLxprt doesn't have the old pattern to migrate from.
**Conflicts expected:** N/A  
**Partial applicability:** N/A

---

## b9f8858bfb6ff8989ef098588dbf54da7c4e7e3d — refactor: migrate clearCommand hook calls to HookSystem (#16157)
**Verdict:** SKIP  
**Confidence:** HIGH  
**Areas:** cli/ui/commands/clearCommand  
**Evidence:**
- Upstream migrates from `fireSessionStartHook`/`fireSessionEndHook` to `config.getHookSystem()?.fireSessionStartEvent()`
- LLxprt search found NO matches for `fireSessionStartHook` or `fireSessionEndHook`
- LLxprt already uses HookSystem pattern
**Rationale:** Same as commit 68 - LLxprt has already migrated to HookSystem-based approach. The old `fireSessionStartHook`/`fireSessionEndHook` pattern doesn't exist in LLxprt.
**Conflicts expected:** N/A  
**Partial applicability:** N/A

---

## 77e226c55fe7e795982843596ad93ac1a5756983 — Show settings source in extensions lists (#16207)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** cli/config/extension-manager, cli/config/extensions/extensionSettings, cli/ui/components/views/ExtensionsList, core/config/config  
**Evidence:**
- Adds `scope` and `source` fields to `ResolvedExtensionSetting` interface
- Shows where each setting came from (user/workspace, file path or Keychain)
- Updates `ExtensionsList.tsx` to display scope information
- LLxprt has extension manager and settings infrastructure
**Rationale:** UX improvement for extension settings visibility. Shows users where their settings are coming from (user-level vs workspace-level, file path vs keychain). Purely additive feature that improves debugging and user experience.
**Conflicts expected:** MINIMAL  
**Partial applicability:** N/A

---

## 8bc3cfe29a6339c81eb5d777ec489def6a2e695c — feat(skills): add pr-creator skill and enable skills (#16232)
**Verdict:** PICK  
**Confidence:** MEDIUM  
**Areas:** .gemini/skills, .gemini/settings.json, .gitignore  
**Evidence:**
- Adds `.gemini/skills/pr-creator/SKILL.md` with PR creation workflow
- Adds `.gemini/settings.json` enabling `experimental.skills`
- Updates `.gitignore` to not ignore skills directory
- LLxprt glob found NO files matching `**/.gemini/skills/**`
**Rationale:** Adds a skill (reusable prompt template) for creating PRs. The skill itself is useful and the skills feature appears to be a prompt/template system. Would need to create the skills directory and add the skill file. May need to verify skills feature is enabled in LLxprt.
**Conflicts expected:** NO  
**Partial applicability:** Skill content applies directly; settings file may need adjustment.

---

## c1401682ed0d65e511310c92e83d2601c919c14f — fix: handle Shift+Space in Kitty keyboard protocol terminals (#15767)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** cli/ui/contexts/KeypressContext  
**Evidence:**
- Adds `[32u` to KEY_INFO_MAP for space key
- Handles Shift+Space and Ctrl+Space in Kitty protocol
- Sets correct `insertable` and `sequence` properties
- LLxprt has KeypressContext.tsx with KEY_INFO_MAP
**Rationale:** Bug fix for keyboard handling in terminals using Kitty keyboard protocol. Ensures Shift+Space is recognized correctly. Pure terminal handling improvement.
**Conflicts expected:** NO  
**Partial applicability:** N/A

---

## 041463d112265fbf7cf9a5ab2e7fcdb860c80dd9 — feat(core, ui): Add /agents refresh command. (#16204)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** cli/ui/commands/agentsCommand, core/agents/a2a-client-manager, core/agents/registry, core/utils/events  
**Evidence:**
- Adds `agentsRefreshCommand` as subcommand of `agentsCommand`
- Adds `clearCache()` method to `A2AClientManager`
- Adds `reload()` method to `AgentRegistry`
- Adds `AgentsRefreshed` core event
- LLxprt has agents infrastructure
**Rationale:** Adds ability to refresh/reload agents without restarting. Includes cache clearing for A2A client manager. UI improvement for agent management.
**Conflicts expected:** MINIMAL  
**Partial applicability:** N/A

---

## ca4866142339601a70db5daa837ab10baf450755 — feat(core): add local experiments override via GEMINI_EXP (#16181)
**Verdict:** PICK  
**Confidence:** MEDIUM  
**Areas:** core/code_assist/experiments  
**Evidence:**
- Adds ability to load experiments from local file via `GEMINI_EXP` env var
- Makes `server` parameter optional in `getExperiments()`
- Falls back to empty experiments if no server and no env var
- LLxprt has experiments infrastructure in code_assist
**Rationale:** Development/debugging feature that allows loading experiments from a local JSON file instead of fetching from server. Useful for testing experiment flags without server access. The experiments system may be Google-specific but the local override mechanism is generally useful.
**Conflicts expected:** MINIMAL  
**Partial applicability:** May need branding changes if paths reference GEMINI.

---

## 14f0cb45389deff7b0293dfe58e04fea11ee151c — feat(ui): reduce home directory warning noise and add opt-out setting (#16229)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** cli/config/settingsSchema, cli/gemini, cli/utils/userStartupWarnings, docs, schemas  
**Evidence:**
- Adds `ui.showHomeDirectoryWarning` setting (default: true)
- Updates warning message to mention how to disable
- Skips warning if folder trust is enabled and workspace is trusted
- LLxprt has settings schema and startup warnings
**Rationale:** UX improvement that reduces warning noise for users who intentionally work in home directory. Adds configurable setting and improves warning message. Also integrates with folder trust feature.
**Conflicts expected:** NO  
**Partial applicability:** N/A

---

## 9d187e041c8f8c8e6e464fe0711504c6c37d7ead — refactor: migrate chatCompressionService to use HookSystem (#16259)
**Verdict:** SKIP  
**Confidence:** HIGH  
**Areas:** core/services/chatCompressionService  
**Evidence:**
- Upstream migrates from `firePreCompressHook` to `config.getHookSystem()?.firePreCompressEvent()`
- LLxprt has REWRITTEN compression as noted in audit criteria
- LLxprt search found no `firePreCompressHook` pattern
**Rationale:** Per audit criteria: "LLxprt has REWRITTEN compression — commits touching chatCompressionService may need REIMPLEMENT not PICK." LLxprt has its own compression implementation that already uses HookSystem pattern. This upstream migration commit doesn't apply.
**Conflicts expected:** N/A  
**Partial applicability:** N/A

---

## c7d17dda49daf0dcecf800c140f0360719772849 — fix: properly use systemMessage for hooks in UI (#16250)
**Verdict:** REIMPLEMENT  
**Confidence:** MEDIUM  
**Areas:** cli/nonInteractiveCli, cli/ui/hooks/useGeminiStream, core/core/client, core/core/turn, docs/hooks  
**Evidence:**
- Adds `systemMessage` field to `ServerGeminiAgentExecutionStoppedEvent` and `ServerGeminiAgentExecutionBlockedEvent`
- Updates UI handlers to prefer `systemMessage` over `reason` when displaying to users
- LLxprt search found NO matches for `AgentExecutionStopped` or `AgentExecutionBlocked` in packages/core
**Rationale:** This fix depends on commit 64's `AgentExecutionStopped`/`AgentExecutionBlocked` events which don't exist in LLxprt. The `systemMessage` field allows hooks to display user-facing messages separate from internal `reason`. Would need to implement alongside commit 64.
**Conflicts expected:** YES  
**Partial applicability:** Docs changes can be picked directly; code changes depend on commit 64.

---

## ea7393f7fd5a072a2884db814b650d986e1cc933 — Infer modifyOtherKeys support (#16270)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** cli/ui/utils/terminalCapabilityManager, cli/ui/components/InputPrompt.test, cli/ui/components/SettingsDialog.test  
**Evidence:**
- Removes `isModifyOtherKeysEnabled()` method
- Changes `modifyOtherKeysEnabled` from boolean flag to inferred behavior
- Enables modifyOtherKeys if device attributes received (ANSI terminal detected)
- LLxprt has terminalCapabilityManager.ts
**Rationale:** Terminal handling improvement that infers modifyOtherKeys support from DA1 response instead of explicit query. Simplifies terminal capability detection and improves compatibility.
**Conflicts expected:** MINIMAL  
**Partial applicability:** N/A

---

## e04a5f0cb0ee6f659278260ca559a89b54ed9ed1 — feat(core): Cache ignore instances for performance (#16185)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** core/utils/gitIgnoreParser  
**Evidence:**
- Changes cache from `Map<string, string[]>` to `Map<string, Ignore>`
- Stores compiled `Ignore` instances instead of raw pattern arrays
- Avoids re-creating Ignore instances for cached directories
- LLxprt has gitIgnoreParser.ts
**Rationale:** Performance optimization that caches compiled ignore instances instead of raw patterns. Reduces overhead when checking gitignore rules repeatedly.
**Conflicts expected:** NO  
**Partial applicability:** N/A

---

## d74bf9ef2f2b55f1b034f00fca876583d4c2a143 — feat: apply remote admin settings (no-op) (#16106)
**Verdict:** SKIP  
**Confidence:** MEDIUM  
**Areas:** cli/config/settings, cli/gemini  
**Evidence:**
- Adds `setRemoteAdminSettings()` method to `LoadedSettings`
- Applies remote admin settings from CCPA (Code Assist) that override file-based admin settings
- Moves auth refresh before sandbox entry to fetch remote settings
- References `GeminiCodeAssistSetting` type
**Rationale:** This implements remote admin settings fetched from Google's Code Assist service. This is Google-specific infrastructure that allows enterprise admins to push settings remotely. LLxprt is multi-provider and wouldn't have access to Google's Code Assist Platform Admin (CCPA) service. The settings precedence logic may be useful but the remote fetch mechanism is Google-only.
**Conflicts expected:** N/A  
**Partial applicability:** Settings precedence pattern could be useful if LLxprt adds its own remote settings mechanism.

---

## 1fb55dcb2e0b0fe876f4792669adf9432b535bc6 — Autogenerate docs/cli/settings.md (#14408)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** docs/cli/settings.md, docs/get-started/configuration.md, scripts/generate-settings-doc.ts, packages/cli/src/config/settingsSchema.ts  
**Evidence:**
- Updates docs generation script to also output to docs/cli/settings.md
- Adds table format output in addition to list format
- Updates various setting descriptions and defaults
- LLxprt has docs and settings schema
**Rationale:** Documentation improvement that auto-generates settings documentation. Adds table format for settings.md and keeps list format for configuration.md. Pure docs/developer tooling improvement.
**Conflicts expected:** MINIMAL  
**Partial applicability:** Setting names/values may differ in LLxprt; script may need adaptation.

---

## 356f76e545df28b26e8d7c6f2e5a0ade1fa55cd6 — refactor(config): remove legacy V1 settings migration logic (#16252)
**Verdict:** SKIP  
**Confidence:** HIGH  
**Areas:** cli/config/settings, cli/gemini, cli/test-utils/render, integration-tests/test-helper  
**Evidence:**
- Removes `MIGRATION_MAP`, `needsMigration`, `migrateSettingsToV2`, `migrateSettingsToV1` functions
- Removes `migratedInMemoryScopes` from LoadedSettings
- Removes `migrateDeprecatedSettings` function
- Removes `loadEnvironment` function
- LLxprt likely doesn't have V1 migration logic to remove
**Rationale:** Removes legacy code for migrating from V1 settings format to V2. If LLxprt forked after the V2 format was established, this migration code never existed there. The commit is cleanup of dead code that LLxprt likely never had.
**Conflicts expected:** N/A  
**Partial applicability:** N/A

---

## c87d1aed4c5ad90dcff551a0eeb150f8994a9feb — Fix an issue where the agent stops prematurely (#16269)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** cli/ui/hooks/useQuotaAndFallback, core/availability/fallback_integration, core/config/config, core/config/flashFallback  
**Evidence:**
- Resets quota error flags (`setModelSwitchedFromQuotaError(false)`, `setQuotaErrorOccurred(false)`) when retrying
- Changes `activateFallbackMode` to call `setActiveModel` + `coreEvents.emitModelChanged()` instead of `setModel(model, true)`
- Adds new test file `fallback_integration.test.ts`
**Rationale:** Bug fix for agent stopping prematurely when quota error occurs and user chooses to retry. The quota error flags weren't being reset, causing the agent loop to terminate. Also fixes the fallback mode activation to properly emit model change events.
**Conflicts expected:** MINIMAL  
**Partial applicability:** N/A

---

## b08b0d715b55559fbf484bfeed6e0aa2aab50a42 — Update system prompt to prefer non-interactive commands (#16117)
**Verdict:** PICK  
**Confidence:** HIGH  
**Areas:** core/core/prompts, core/core/__snapshots__/prompts.test.ts.snap  
**Evidence:**
- Changes "Prefer non-interactive commands when it makes sense" to "Always prefer non-interactive commands"
- Adds guidance to use "run once" or "CI" modes for test runners
- Adds note about preferring terminating commands for tests
**Rationale:** Prompt engineering improvement that instructs the model to prefer non-interactive/terminating commands. Helps avoid situations where the model runs commands that hang waiting for input (like npm test in watch mode).
**Conflicts expected:** NO  
**Partial applicability:** N/A

---

## Summary

| Verdict | Count | Commits |
|---------|-------|---------|
| PICK | 13 | 65, 66, 67, 70, 71, 72, 73, 74, 75, 78, 79, 81, 83, 84 |
| SKIP | 6 | 68, 69, 76, 77, 80, 82 |
| REIMPLEMENT | 2 | 64, 77 |

### Key Observations

1. **Hook System Divergence**: Commits 68, 69, 76 are SKIP because LLxprt already uses HookSystem-based hooks. The upstream commits migrate from an older pattern (`fireSessionStartHook`) that LLxprt never had.

2. **Agent Execution Events Need Implementation**: Commits 64 and 77 introduce `AgentExecutionStopped`/`AgentExecutionBlocked` events and `systemMessage` field for hooks. These need REIMPLEMENT because LLxprt's hook architecture differs.

3. **Compression Rewritten**: Commit 76 is SKIP per audit criteria noting LLxprt has rewritten compression.

4. **Google-Specific Features**: Commit 80 (remote admin settings) is SKIP as it depends on Google's Code Assist Platform Admin service.

5. **Legacy Code Removal**: Commit 82 removes V1 settings migration that LLxprt likely never had.

6. **Terminal Improvements**: Multiple commits (67, 72, 78) improve terminal handling and are safe PICKs.

7. **Prompt Engineering**: Commits 65, 84 improve model behavior through prompt changes and are safe PICKs.


# Batch E

# Batch E Audit Report (Commits 85-105)

## b54e688c75f4693b43c74fb09179b9707f41648e — Update ink version to 6.4.7 (#16284)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** dependencies
**Evidence:** package.json, packages/cli/package.json (ink version bump from 6.4.6 to 6.4.7)
**Rationale:** Dependency version bump for @jrichman/ink fork. LLxprt manages its own dependency versions separately. Not a bug fix or feature - just a routine update. Cherry-picking would conflict with LLxprt's independent dependency management.
**Conflicts expected:** YES
**Partial applicability:** None

---

## 461c277bf2de4057a704505315d138cad9ab7ead — Support for Built-in Agent Skills (#16045)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** skills, UI
**Evidence:** 
- packages/cli/src/commands/skills/list.ts - LLxprt has simpler version without `isBuiltin` filtering
- packages/cli/src/ui/commands/skillsCommand.ts - adds `--all` flag for built-in skills
- packages/core/src/skills/skillLoader.ts - adds `isBuiltin` to SkillDefinition
**Rationale:** Adds `isBuiltin` property to skills and filters them by default in `/skills list`. LLxprt's `SkillDefinition` interface doesn't have `isBuiltin`. Need to add this property to skillLoader.ts and update list.ts/skillsCommand.ts to support `--all` flag filtering. LLxprt uses different architecture for skills command.
**Conflicts expected:** YES
**Partial applicability:** Core concept applicable but LLxprt has diverged

---

## 3090008b1c0f60058afce5750cb01717ea3a4152 — fix(skills): remove "Restart required" message from non-interactive commands (#16307)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** skills, UX
**Evidence:** 
- packages/cli/src/commands/skills/disable.ts - LLxprt has different implementation
- packages/cli/src/commands/skills/enable.ts - LLxprt has different implementation
**Rationale:** LLxprt's skills disable/enable commands have different message format and don't include "Restart required" text. The upstream fix removes a message that doesn't exist in LLxprt's implementation. No-op for LLxprt.
**Conflicts expected:** NO
**Partial applicability:** Not applicable - different codebase

---

## 6f7d7981894ad34553d8f0ba04c1b099ab1451ff — remove unused sessionHookTriggers and exports (#16324)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** hooks
**Evidence:** 
- packages/core/src/hooks/index.ts - LLxprt has completely different exports structure
- File packages/core/src/core/sessionHookTriggers.ts doesn't exist in LLxprt
**Rationale:** LLxprt underwent a major HookSystem rewrite (PLAN-20260216-HOOKSYSTEMREWRITE). The sessionHookTriggers.ts file doesn't exist in LLxprt, and hooks/index.ts has different exports that include lifecycleHookTriggers from a different location. This upstream cleanup doesn't apply.
**Conflicts expected:** NO
**Partial applicability:** Not applicable - LLxprt has different architecture

---

## 72dae7e0eebc7da2656c83daa4fea5a1226c854d — Triage action cleanup (#16319)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** CI
**Evidence:** .github/workflows/gemini-automated-issue-triage.yml, scripts/relabel_issues.sh
**Rationale:** Triage workflow modifications - explicitly SKIP per audit criteria. Changes to GitHub Actions for issue triage are upstream-only CI.
**Conflicts expected:** NO
**Partial applicability:** None

---

## d130d99ff02e6908a7e517ec7b2b69073f748d40 — fix: Add event-driven trigger to issue triage workflow (#16334)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** CI
**Evidence:** .github/workflows/gemini-scheduled-issue-triage.yml, scripts/batch_triage.sh
**Rationale:** Triage workflow modifications - explicitly SKIP per audit criteria. Adds event-driven trigger for issue triage.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 446058cb1c717d59e383a6876343e7b4f25c07fe — fix: fallback to GITHUB_TOKEN if App ID is missing
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** CI
**Evidence:** .github/workflows/gemini-automated-issue-triage.yml
**Rationale:** Triage workflow modification - explicitly SKIP per audit criteria. GitHub App token fallback logic.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 33e3ed0f6ce244597f2a6f2d377fbb92a2a35008 — fix(workflows): resolve triage workflow failures and actionlint errors (#16338)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** CI
**Evidence:** .github/workflows/gemini-automated-issue-triage.yml, .github/workflows/gemini-scheduled-issue-triage.yml
**Rationale:** Triage workflow fixes - explicitly SKIP per audit criteria. Fixes actionlint errors and JSON parsing.
**Conflicts expected:** NO
**Partial applicability:** None

---

## b9762a3ee1b348c23ba052c420626175afef3b0e — docs: add note about experimental hooks (#16337)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** docs
**Evidence:** docs/hooks/index.md - adds experimental hooks note and usage instructions
**Rationale:** Documentation update explaining that hooks are experimental and need explicit enablement. Good for user guidance. Low risk documentation change.
**Conflicts expected:** NO
**Partial applicability:** May need adjustment for LLxprt branding

---

## 39b3f20a2285e85f265cc0a160ff34cc4de27321 — feat(cli): implement passive activity logger for session analysis (#15829)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** debug, telemetry
**Evidence:** 
- packages/cli/src/utils/activityLogger.ts (new file)
- packages/cli/src/gemini.tsx (integration)
- packages/core/src/config/storage.ts (getProjectTempLogsDir)
**Rationale:** Passive activity logger for debug mode that captures network requests and console logs. Only activates when `isInteractive() && config.storage && config.getDebugMode()`. Useful debugging feature. Must ensure no ClearcutLogger dependencies.
**Conflicts expected:** NO
**Partial applicability:** Full applicability - new feature file

---

## 0e955da17108acc339325180269ac6157f33b3e8 — feat(cli): add /chat debug command for nightly builds (#16339)
**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Areas:** debug, UI
**Evidence:**
- packages/cli/src/ui/commands/chatCommand.ts - adds debugCommand
- packages/core/src/utils/apiConversionUtils.ts (new file)
- packages/core/src/config/config.ts - getLatestApiRequest/setLatestApiRequest
**Rationale:** Adds `/chat debug` command to export API request as JSON. Uses `isNightly()` check which LLxprt may not have. The `convertToRestPayload` utility is useful for debugging. Need to check if LLxprt has isNightly() and adapt accordingly. The debug command is useful but nightly gating may need adjustment.
**Conflicts expected:** YES
**Partial applicability:** Core feature useful, nightly gating may need adjustment

---

## 93b57b82c10c05a6de779f7be5dfbd4da34b8f85 — style: format pr-creator skill (#16381)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** skills
**Evidence:** .gemini/skills/pr-creator/SKILL.md - markdown formatting
**Rationale:** Pure formatting change to pr-creator skill documentation. No functional changes. Low risk.
**Conflicts expected:** NO
**Partial applicability:** Full applicability

---

## 9703fe73cf910716b255891e76ec5dafd43696b9 — feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** hooks, UI
**Evidence:**
- packages/cli/src/ui/commands/hooksCommand.ts - LLxprt has different implementation
- packages/cli/src/ui/components/views/HooksList.tsx - panel display
- docs/hooks/index.md - documentation
**Rationale:** Adds `/hooks enable-all` and `/hooks disable-all` commands. LLxprt's hooksCommand.ts has different architecture (uses HookSystem/Registry pattern). Need to adapt the enable-all/disable-all logic to LLxprt's HookSystem which uses different methods (setHookEnabled on registry).
**Conflicts expected:** YES
**Partial applicability:** Feature applicable but architecture different

---

## d315f4d3dad7d6be1f51a0c0ce54b72958b1de09 — fix(core): ensure silent local subagent delegation while allowing remote confirmation (#16395)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** agents, policy
**Evidence:**
- packages/core/src/agents/delegate-to-agent-tool.ts
- packages/core/src/policy/policies/agent.toml
- docs/core/policy-engine.md
**Rationale:** Fixes local agent delegation to be silent (returns false from shouldConfirmExecute) while allowing remote agents to prompt for confirmation. Changes policy default from "allow" to "ask_user" for delegate_to_agent. Bug fix for UX.
**Conflicts expected:** NO
**Partial applicability:** Full applicability - bug fix

---

## 7b7f2fc69e37e5648ee8e8993f1804a9618f3946 — Markdown w/ Frontmatter Agent Parser (#16094)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** agents
**Evidence:**
- packages/core/src/agents/agentLoader.ts (renamed from toml-loader.ts)
- Parses .md files with YAML frontmatter instead of TOML
- Supports both local and remote agents from markdown
**Rationale:** Major feature: switches agent definitions from TOML to Markdown with YAML frontmatter. LLxprt doesn't have toml-loader.ts or agentLoader.ts. This is a new feature that could be picked up. The agent definition format change is significant but represents improvement in usability.
**Conflicts expected:** NO
**Partial applicability:** Full applicability - new feature

---

## 64c75cb767cee155c9722129fd081f1a0251650f — Fix crash on unicode character (#16420)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** bug-fix, UI
**Evidence:**
- packages/cli/src/ui/utils/textUtils.ts - getCachedStringWidth
**Rationale:** Bug fix for string-width crash on certain unicode characters (U+0602). LLxprt's textUtils.ts has getCachedStringWidth but without try-catch. Need to add the try-catch fallback to prevent crashes.
**Conflicts expected:** NO
**Partial applicability:** Full applicability - critical bug fix

---

## 950244f6b00ff54c9c9ee40b2b0d16d980021f80 — Attempt to resolve OOM w/ useMemo on history items (#16424)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** performance, UI
**Evidence:**
- packages/cli/src/ui/components/MainContent.tsx
**Rationale:** Performance fix using useMemo for history items to prevent OOM. Wraps history mapping in useMemo and uses MemoizedHistoryItemDisplay. Low risk performance improvement.
**Conflicts expected:** NO
**Partial applicability:** Full applicability - performance fix

---

## 465ec9759dbb173118f43f36b4e90c42482ee140 — fix(core): ensure sub-agent schema and prompt refresh during runtime (#16409)
**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Areas:** agents, config
**Evidence:**
- packages/core/src/config/config.ts - adds dispose(), onAgentsRefreshed
- packages/core/src/agents/registry.ts - adds dispose(), event listener cleanup
- packages/cli/src/utils/cleanup.ts - calls config.dispose()
**Rationale:** Ensures agent definitions refresh during runtime when agents are added/modified. Adds dispose() methods and event listener management. LLxprt's AgentRegistry and Config have different implementations. The pattern (event-driven refresh + dispose) is valuable but needs adaptation to LLxprt's architecture.
**Conflicts expected:** YES
**Partial applicability:** Pattern applicable, implementation different

---

## ed7bcf9968edece61b8d2d7eb3403dd001e3bb28 — Update extension examples (#16274)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** docs, extensions
**Evidence:**
- packages/cli/src/commands/extensions/examples/ - adds hooks and skills examples
- Converts example.ts to example.js, removes tsconfig
**Rationale:** Documentation/example update for extension development. Adds hooks and skills examples. Low risk documentation improvement.
**Conflicts expected:** NO
**Partial applicability:** Full applicability

---

## 8656ce8a27451a906bede9b74ad5a56e9221a9ad — revert the change that was recently added from a fix (#16390)
**Verdict:** SKIP
**Confidence:** LOW
**Areas:** config
**Evidence:**
- packages/core/src/config/config.ts - activateFallbackMode change
**Rationale:** Reverts activateFallbackMode to use setModel() instead of setActiveModel(). This appears to be related to FlashFallback behavior which is REMOVED per audit criteria. The FlashFallback feature was removed from LLxprt, so this revert is not applicable.
**Conflicts expected:** NO
**Partial applicability:** Not applicable - FlashFallback removed

---

## 8a2e0fac0d8c3499e628ed52d517987163f32541 — Add other hook wrapper methods to hooksystem (#16361)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** hooks
**Evidence:**
- packages/core/src/hooks/hookSystem.ts - adds fireBeforeAgentEvent, fireAfterAgentEvent
- packages/core/src/core/client.ts - uses HookSystem methods instead of clientHookTriggers
**Rationale:** Adds fireBeforeAgentEvent and fireAfterAgentEvent to HookSystem class. LLxprt's HookSystem.ts has different architecture (has HookEventHandler, doesn't have these wrapper methods). LLxprt already has lifecycle hook triggers in a different location. Need to adapt the pattern of centralizing hook firing through HookSystem.
**Conflicts expected:** YES
**Partial applicability:** Pattern applicable, implementation different

---

## Summary

| Verdict | Count | Commits |
|---------|-------|---------|
| PICK | 7 | b9762a3, 39b3f20, 93b57b8, 64c75cb, 950244f, ed7bcf9, d315f4d |
| REIMPLEMENT | 5 | 461c277, 0e955da, 9703fe7, 465ec97, 8a2e0fa |
| SKIP | 8 | b54e688, 72dae7e, d130d99, 446058c, 33e3ed0, 3090008, 6f7d798, 8656ce8 |
| NO_OP | 1 | 6f7d798 |

### High Priority Picks (Bug Fixes / Critical)
1. **64c75cb** - Fix crash on unicode character (string-width)
2. **d315f4d** - Silent local subagent delegation fix
3. **950244f** - OOM fix with useMemo

### High Priority Reimplements
1. **461c277** - Built-in Agent Skills (isBuiltin property)
2. **7b7f2fc** - Markdown Agent Parser (new feature)
3. **9703fe7** - Hooks enable-all/disable-all commands
4. **8a2e0fa** - Hook wrapper methods in HookSystem

### Notes
- Commits 72dae7e through 33e3ed0 are triage workflow changes - explicitly SKIP
- Commit 8656ce8 reverts FlashFallback-related change - not applicable (FlashFallback removed)
- LLxprt's HookSystem underwent major rewrite, so hook-related commits need careful adaptation


# Batch F

# DEEP CODE AUDIT: Batch F — commits 106-126

## 106. 15891721ad09f030cb761d66d9e0772ae53f9332 — feat: introduce useRewindLogic hook for conversation history navigation (#15716)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ui, hooks, rewind
**Evidence:** 
- Upstream: `packages/cli/src/ui/hooks/useRewind.ts` (new), `packages/cli/src/ui/hooks/useRewind.test.ts` (new)
- LLxprt: No existing `useRewind*` files found in `packages/cli/src/ui/hooks/`
**Rationale:** New hook for rewind feature - LLxprt has the Rewind feature system. The hook encapsulates state management for message selection and rewind impact calculation. This is a clean abstraction that doesn't depend on telemetry or auth systems. The hook uses `rewindFileOps` utilities which may already exist in LLxprt.
**Conflicts expected:** NO
**Partial applicability:** None - clean additive change

---

## 107. 0167392f2268473e348f54af541a4d6d6ed50f64 — docs: Fix formatting issue in memport documentation (#14774)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** docs
**Evidence:**
- Upstream: `docs/core/memport.md` (2 line fix - adds missing markdown fence)
- LLxprt: Documentation file fix
**Rationale:** Pure documentation fix - adds a missing ``` fence in markdown. This is a trivial fix that may or may not apply to LLxprt's docs. If the file exists with the same bug, it's a simple fix.
**Conflicts expected:** NO
**Partial applicability:** May not apply if LLxprt doesn't have this doc or the bug doesn't exist

---

## 108. 64cde8d439501f9b8448acdfa5baa9b6963bdee7 — fix(policy): enhance shell command safety and parsing (#15034)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** security, policy, shell
**Evidence:**
- Upstream: `packages/core/src/policy/policy-engine.ts` (major refactor), `packages/core/src/policy/shell-safety.test.ts` (extensive new tests), `packages/core/src/policy/types.ts` (adds `name` field to PolicyRule)
- LLxprt: `packages/core/src/policy/policy-engine.ts` exists
**Rationale:** Critical security enhancement for shell command safety:
1. Fixes command injection vulnerabilities with `&&`, `||`, `;` separators
2. Handles command substitution `$()` and backticks
3. Handles process substitution `<()` and `>()`
4. Pipes `|` now properly checked
5. Adds rule attribution for better debugging
6. Adds `allowRedirection` to PolicyRule
The commit changes `checkShellCommand` return type to include rule attribution and adds comprehensive subcommand checking. LLxprt's policy-engine should be checked for current implementation.
**Conflicts expected:** YES - Significant changes to policy-engine.ts method signatures and logic
**Partial applicability:** Need to verify LLxprt's current policy engine state

---

## 109. 3b678a4da0fffa6bafc0e570d5578cb99afc2c45 — fix(core): avoid 'activate_skill' re-registration warning (#16398)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** core, skills
**Evidence:**
- Upstream: `packages/core/src/config/config.ts` (adds `unregisterTool` before re-registration), `packages/core/src/config/config.test.ts` (test fix)
- LLxprt: `packages/core/src/config/config.ts` exists
**Rationale:** Simple fix - calls `unregisterTool(ACTIVATE_SKILL_TOOL_NAME)` before re-registering to avoid warning. This is a bug fix that improves developer experience and prevents console noise.
**Conflicts expected:** NO - Simple additive fix
**Partial applicability:** None

---

## 110. 2306e60be455c622719009b93105034cb50755b6 — perf(workflows): optimize PR triage script for faster execution (#16355)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ci, workflows
**Evidence:**
- Upstream: `.github/scripts/pr-triage.sh` (refactor), `.github/workflows/gemini-scheduled-pr-triage.yml`
**Rationale:** Upstream-only CI/workflow optimization for PR triage. LLxprt has different CI infrastructure and this script is specific to Google's internal workflows.
**Conflicts expected:** N/A
**Partial applicability:** N/A - upstream-only CI

---

## 111. d65eab01d2569474c7866c6e76ce8060a6ce1535 — feat(admin): prompt user to restart the CLI if they change auth to oauth mid-session (#16426)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** auth, ui
**Evidence:**
- Upstream: Adds `LoginWithGoogleRestartDialog`, new `AuthState.AwaitingGoogleLoginRestart`, `setAuthContext` in UIActions
- LLxprt: Uses `AuthType.USE_PROVIDER` - multi-provider auth system
**Rationale:** Google-only auth feature. LLxprt uses multi-provider auth with `AuthType.USE_PROVIDER`. The concept of "restart CLI for OAuth" is specific to Google's authentication flow. This feature adds Google-specific UI flows that don't apply to LLxprt's provider-based auth.
**Conflicts expected:** N/A
**Partial applicability:** N/A - Google-only auth

---

## 112. 7d9224201108ccbef51ecda09dcefa9ec7c0f6ae — Update cli-help agent's system prompt in sub-agents section (#16441)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** agents, docs
**Evidence:**
- Upstream: `packages/core/src/agents/cli-help-agent.ts` (system prompt update)
**Rationale:** Documentation update for cli-help agent's system prompt. Updates the description of local/remote agents in the sub-agents section. This is a helpful clarification for users. Pure content update, no code logic changes.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 113. 8437ce940a1cc478c65630c05bc9e015271c572a — Revert "Update extension examples" (#16442)
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** examples, extensions
**Evidence:**
- Upstream: Reverts previous extension example updates, converts example.js to example.ts, adds tests, removes some example files
**Rationale:** This is a revert + fix combo. The main change converts MCP server example from JS to TS and adds proper tests. The skills and hooks examples were removed. If LLxprt uses these examples, this should be picked. However, it's primarily about example code quality.
**Conflicts expected:** MAYBE - depends on whether LLxprt has these example files
**Partial applicability:** Example files may differ

---

## 114. e049d5e4e8fc8020a537a92b1607a7f0f28dec0b — Fix: add back fastreturn support (#16440)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ui, terminal, keypress
**Evidence:**
- Upstream: `packages/cli/src/ui/contexts/KeypressContext.tsx` (adds `bufferFastReturn` function), test files
**Rationale:** Fixes terminal compatibility issue for older terminals that don't use bracket paste mode. The `bufferFastReturn` function converts return keys pressed quickly after other keys into plain insertable characters. This improves paste behavior on older terminals. Uses `terminalCapabilityManager.isKittyProtocolEnabled()`.
**Conflicts expected:** NO - Additive functionality
**Partial applicability:** None

---

## 115. d7bff8610f8cd177776453ecc05145d629573b16 — feat(a2a): Introduce /memory command for a2a server (#14456)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** a2a, memory, commands
**Evidence:**
- Upstream: `packages/a2a-server/src/commands/memory.ts` (new), `packages/core/src/commands/memory.ts` (new), updates to `packages/cli/src/ui/commands/memoryCommand.ts`
- LLxprt: `packages/cli/src/ui/commands/memoryCommand.ts` exists
**Rationale:** Introduces `/memory` command for a2a server and refactors memory commands into core. Creates shared `showMemory`, `addMemory`, `refreshMemory`, `listMemoryFiles` functions. This is a good refactoring that centralizes memory logic. Note: This commit is large and touches multiple packages including a2a-server.
**Conflicts expected:** YES - Significant refactoring of memoryCommand.ts
**Partial applicability:** a2a-server may not exist in LLxprt; core memory.ts is new

---

## 116. b8cc414d5b3f1088c58883fdf7abf49b949ccf76 — docs: fix broken internal link by using relative path (#15371)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** docs
**Evidence:**
- Upstream: `docs/releases.md` (1 line fix - changes link from absolute GitHub URL to relative path)
**Rationale:** Trivial documentation fix for a broken link. May or may not apply to LLxprt's docs structure.
**Conflicts expected:** NO
**Partial applicability:** May not apply if LLxprt docs differ

---

## 117. 95d9a339966b6d594bddc2ed649b2348f1e94000 — migrate yolo/auto-edit keybindings (#16457)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ui, keybindings
**Evidence:**
- Upstream: `packages/cli/src/config/keyBindings.ts` (adds `TOGGLE_YOLO`, `TOGGLE_AUTO_EDIT`), `packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts` (uses keyMatchers)
- LLxprt: `packages/cli/src/config/keyBindings.ts` exists but doesn't have `TOGGLE_YOLO`/`TOGGLE_AUTO_EDIT`; `useAutoAcceptIndicator.ts` uses hard-coded key checks
**Rationale:** Migrates YOLO (Ctrl+Y) and Auto-Edit (Shift+Tab) keybindings to the data-driven keyBindings system. LLxprt's `useAutoAcceptIndicator.ts` still has hard-coded `key.ctrl && key.name === 'y'` and `key.shift && key.name === 'tab'`. This should be picked to use the proper keyMatchers pattern.
**Conflicts expected:** NO - Additive to keyBindings, refactor in useAutoAcceptIndicator
**Partial applicability:** None

---

## 118. 2e8c6cfdbb82bc360cec83738dfec5132b06ff0a — feat(cli): add install and uninstall commands for skills (#16377)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** cli, skills
**Evidence:**
- Upstream: `packages/cli/src/commands/skills/install.ts` (new), `packages/cli/src/commands/skills/uninstall.ts` (new), `packages/cli/src/utils/skillUtils.ts` (adds install/uninstall logic)
- LLxprt: `packages/cli/src/commands/skills/` has `disable.ts`, `enable.ts`, `list.ts` but NOT `install.ts` or `uninstall.ts`
**Rationale:** Adds skill install/uninstall commands for CLI. Allows installing skills from git repos, local directories, or .skill files. This is a useful feature for skill management. The implementation uses `Storage` class and `cloneFromGit` utility.
**Conflicts expected:** NO - New files
**Partial applicability:** None - clean additive

---

## 119. ca6786a28bdcc1f452352acb19cfa53542059b55 — feat(ui): use Tab to switch focus between shell and input (#14332)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ui, shell, keybindings
**Evidence:**
- Upstream: `packages/cli/src/config/keyBindings.ts` (changes `TOGGLE_SHELL_INPUT_FOCUS` to `TOGGLE_SHELL_INPUT_FOCUS_IN`/`OUT`), `packages/cli/src/ui/AppContainer.tsx`, `packages/cli/src/ui/components/InputPrompt.tsx`
- LLxprt: `packages/cli/src/config/keyBindings.ts` has `TOGGLE_SHELL_INPUT_FOCUS` only
**Rationale:** Changes shell focus toggle from Ctrl+F to Tab. This is a UX improvement that makes shell focus more intuitive. The implementation:
1. Splits command into `TOGGLE_SHELL_INPUT_FOCUS_IN` (Tab) and `TOGGLE_SHELL_INPUT_FOCUS_OUT` (Tab/Shift+Tab)
2. Adds timing logic to avoid stealing Tab from autocomplete
3. Updates hint text in UI from "(ctrl+f to focus)" to "(tab to focus)"
**Conflicts expected:** YES - Changes to keyBindings.ts and AppContainer.tsx
**Partial applicability:** None

---

## 120. e9c9dd1d6723fde75c255e2ade5ed33280c6809c — feat(core): support shipping built-in skills with the CLI (#16300)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** skills, build
**Evidence:**
- Upstream: `packages/core/src/skills/skillManager.ts` (implements `discoverBuiltinSkills`), `scripts/copy_bundle_assets.js`, `scripts/copy_files.js`
- LLxprt: `packages/core/src/skills/builtin/` does NOT exist
**Rationale:** Enables shipping built-in skills with the CLI. Adds `builtin` directory under `skills/` and modifies scripts to copy them during build. This is infrastructure for bundling default skills. LLxprt could benefit from this for providing default skills.
**Conflicts expected:** NO - Additive feature
**Partial applicability:** Need to create builtin skills directory if LLxprt wants to ship built-in skills

---

## 121. 6ef2a92233bca8e94a1603efaf929aca2943f257 — Collect hardware details telemetry. (#16119)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** telemetry, clearcut-logger
**Evidence:**
- Upstream: `packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts` (adds GPU/CPU/RAM collection), `packages/core/package.json` (adds `systeminformation` dependency)
- LLxprt: ClearcutLogger was REMOVED per audit criteria
**Rationale:** ClearcutLogger/telemetry commit - explicitly marked SKIP per audit criteria "SKIP: ClearcutLogger/telemetry". Adds hardware telemetry collection using `systeminformation` package.
**Conflicts expected:** N/A
**Partial applicability:** N/A - ClearcutLogger removed

---

## 122. 548641c952a7abff9e474120dee9abc1c6ede1e3 — feat(agents): improve UI feedback and parser reliability (#16459)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** agents, parser
**Evidence:**
- Upstream: `packages/core/src/agents/agentLoader.test.ts`, `packages/core/src/agents/cli-help-agent.ts`, `packages/core/src/skills/skillLoader.ts`, `packages/cli/src/ui/commands/agentsCommand.ts`
**Rationale:** Multiple improvements:
1. Adds UI feedback message when refreshing agents
2. Fixes frontmatter regex to handle files without trailing newlines
3. Adds agent name validation (must be valid slug)
4. Updates cli-help agent system prompt
The frontmatter regex fix is important: `FRONTMATTER_REGEX` change from `---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)` to `---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?` - the optional body group.
**Conflicts expected:** YES - FRONTMATTER_REGEX change affects parsing
**Partial applicability:** None

---

## 123. 8d3e93cdb0d7cec5ab62f8afaa5cf9b7797f00d5 — Migrate keybindings (#16460)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** keybindings, text-buffer, docs
**Evidence:**
- Upstream: `packages/cli/src/config/keyBindings.ts` (adds many new commands), `packages/cli/src/ui/components/shared/text-buffer.ts`, docs
- LLxprt: `packages/cli/src/config/keyBindings.ts` has fewer commands
**Rationale:** Major keybindings migration that adds:
- `UNDO`, `REDO`
- `MOVE_LEFT`, `MOVE_RIGHT`, `MOVE_WORD_LEFT`, `MOVE_WORD_RIGHT`
- `DELETE_CHAR_LEFT`, `DELETE_CHAR_RIGHT`, `DELETE_WORD_FORWARD`
These were previously hard-coded in `text-buffer.ts` and are now data-driven. This makes keybindings more configurable and consistent. Also updates keyboard shortcuts documentation.
**Conflicts expected:** YES - Significant changes to keyBindings.ts and text-buffer.ts
**Partial applicability:** None

---

## 124. c572b9e9ac686eed1e434b60c7a0c2461043a1e9 — feat(cli): cleanup activity logs alongside session files (#16399)
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** cli, session-cleanup
**Evidence:**
- Upstream: `packages/cli/src/utils/sessionCleanup.ts` (adds activity log cleanup)
- LLxprt: sessionCleanup not found in search
**Rationale:** Cleans up activity logs when session files are expired. This is cleanup/maintenance logic. However, the activity logger is noted as a "new feature" in audit criteria - need to verify if LLxprt has activity logging. The commit adds cleanup for logs in `getProjectTempDir()/logs/session-${sessionId}.jsonl`.
**Conflicts expected:** MAYBE - depends on whether LLxprt has sessionCleanup and activity logging
**Partial applicability:** May need adaptation if LLxprt uses different session management

---

## 125. 2fc61685a32eaa58477ba46d14ed1465ce7c356b — feat(cli): implement dynamic terminal tab titles for CLI status (#16378)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ui, terminal, window-title
**Evidence:**
- Upstream: `packages/cli/src/utils/windowTitle.ts`, `packages/cli/src/ui/AppContainer.tsx`, `packages/cli/src/config/settingsSchema.ts`
- LLxprt: `computeTerminalTitle`/`dynamicWindowTitle` not found in search
**Rationale:** Implements dynamic terminal window titles with status icons:
- Ready: ◇
- Action Required: 
- Working: 
Adds `ui.dynamicWindowTitle` setting (default true). Refactors `computeWindowTitle` to `computeTerminalTitle` with more sophisticated logic. This is a nice UX improvement that shows CLI status in terminal tab/window title.
**Conflicts expected:** YES - New setting, new function, changes to AppContainer.tsx
**Partial applicability:** None

---

## 126. b81fe6832589b13b0874f7bcb9f21cd211773a0a — feat(core): add disableLLMCorrection setting to skip auto-correction in edit tools (#16000)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** tools, edit, settings
**Evidence:**
- Upstream: `packages/core/src/config/config.ts`, `packages/core/src/tools/edit.ts`, `packages/core/src/tools/write-file.ts`, `packages/core/src/utils/editCorrector.ts`
- LLxprt: `disableLLMCorrection` not found in config.ts search
**Rationale:** Adds `tools.disableLLMCorrection` setting to disable LLM-based error correction for edit tools. When enabled, tools fail immediately if exact string matches aren't found, instead of attempting LLM self-correction. This is useful for:
1. Users who want deterministic behavior
2. Users concerned about LLM making unwanted changes
3. Testing/debugging exact match behavior
The setting integrates into `editCorrector.ts` by skipping LLM correction calls when enabled.
**Conflicts expected:** YES - Changes to config.ts, edit.ts, write-file.ts, editCorrector.ts
**Partial applicability:** LLxprt uses deterministic edits (replace + fuzzy) - this setting may already be partially implemented or have different behavior

---

## SUMMARY

| # | SHA | Verdict | Confidence | Conflicts |
|---|-----|---------|------------|-----------|
| 106 | 15891721 | PICK | HIGH | NO |
| 107 | 0167392f | NO_OP | HIGH | NO |
| 108 | 64cde8d4 | PICK | HIGH | YES |
| 109 | 3b678a4d | PICK | HIGH | NO |
| 110 | 2306e60b | SKIP | HIGH | N/A |
| 111 | d65eab01 | SKIP | HIGH | N/A |
| 112 | 7d922420 | PICK | HIGH | NO |
| 113 | 8437ce94 | PICK | MEDIUM | MAYBE |
| 114 | e049d5e4 | PICK | HIGH | NO |
| 115 | d7bff861 | PICK | HIGH | YES |
| 116 | b8cc414d | NO_OP | HIGH | NO |
| 117 | 95d9a339 | PICK | HIGH | NO |
| 118 | 2e8c6cfd | PICK | HIGH | NO |
| 119 | ca6786a2 | PICK | HIGH | YES |
| 120 | e9c9dd1d | PICK | HIGH | NO |
| 121 | 6ef2a922 | SKIP | HIGH | N/A |
| 122 | 548641c9 | PICK | HIGH | YES |
| 123 | 8d3e93cd | PICK | HIGH | YES |
| 124 | c572b9e9 | PICK | MEDIUM | MAYBE |
| 125 | 2fc61685 | PICK | HIGH | YES |
| 126 | b81fe683 | PICK | HIGH | YES |

**PICK: 16 commits**
**SKIP: 2 commits** (110, 111, 121 - upstream CI, Google auth, telemetry)
**NO_OP: 2 commits** (107, 116 - trivial doc fixes)

**High conflict commits requiring careful merge:**
- 108: policy-engine.ts (security fix)
- 115: memory command refactoring
- 119: Tab focus toggle
- 122: Frontmatter regex fix
- 123: Keybindings migration
- 125: Dynamic window titles
- 126: disableLLMCorrection setting


# Batch G

## 6adae9f7756d8efbc4c5901fe5884fa4a35f1f68 — fix: Set both tab and window title instead of just window title (#16464)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** cli-ui, terminal-title
**Evidence:** upstream `packages/cli/src/gemini.tsx`, `packages/cli/src/ui/AppContainer.tsx`; llxprt `packages/cli/src/gemini.tsx:1318-1321`, `packages/cli/src/ui/AppContainer.tsx` search showed title writes still use `\x1b]2;`
**Rationale:** The upstream diff changes terminal title writes from OSC 2 to OSC 0 so both tab and window titles update. LLxprt still emits `\x1b]2;` in `packages/cli/src/gemini.tsx` and does not show the upstream switch anywhere in `packages/cli/src`. This is a self-contained terminal UX fix with no Google-only dependency and no multi-provider risk.
**Conflicts expected:** YES — branding/title string expectations in LLxprt tests and any title-writing logic split between `gemini.tsx` and AppContainer may need small manual reconciliation.
**Partial applicability:** Likely full behavioral applicability; test snapshots/expectations will need LLxprt branding-aware adjustment.

## 7bbfaabffa7051b8a7b3250f6d5e7a5f24e5304d — fix(policy): ensure MCP policies match unqualified names in non-interactive mode (#16490)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** policy-engine, MCP, tool-scheduler
**Evidence:** upstream `packages/core/src/core/coreToolScheduler.ts`, `packages/core/src/policy/policy-engine.ts`; llxprt `packages/core/src/policy/policy-engine.ts` search shows existing serverName validation and MCP qualification handling, and `packages/core/src/core/coreToolScheduler.ts` already propagates `serverName`
**Rationale:** The intent of the upstream patch is already satisfied in LLxprt. Current policy code explicitly validates `serverName`, distinguishes MCP-qualified names, and scheduler flow already carries MCP server context into policy decisions. Earlier direct comparison in this audit confirmed denial/reporting paths include server-aware handling. Cherry-picking would likely duplicate or conflict with stronger existing logic.
**Conflicts expected:** YES — upstream implementation would overlap with LLxprt’s already-diverged policy engine and scheduler internals.
**Partial applicability:** None needed; behavior is already present.

## 304caa4e43aa8032828a00209309007419e5798f — fix(cli): refine 'Action Required' indicator and focus hints (#16497)
**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Areas:** cli-ui, loading-indicator, shell-focus
**Evidence:** upstream `packages/cli/src/ui/AppContainer.tsx`, `packages/cli/src/ui/hooks/useGeminiStream.ts`, `packages/cli/src/ui/hooks/usePhraseCycler.ts`; llxprt `packages/cli/src/ui/AppContainer.tsx`, `packages/cli/src/ui/hooks/useGeminiStream.ts:1886-1899`, `packages/cli/src/ui/hooks/usePhraseCycler.ts`
**Rationale:** Upstream refines action-required wording/focus hinting and changes inactivity timing to account for Gemini output activity, not just tool/shell output. LLxprt diverges in the relevant UI state model: it does not expose the upstream `isShellAwaitingFocus`/`showShellActionRequired` naming, and its `lastOutputTime` calculation still derives from tool/shell output only. The UX problem is relevant, but the exact patch is not directly portable.
**Conflicts expected:** YES — AppContainer and stream hooks have diverged structurally.
**Partial applicability:** Reimplement the intent only: improve shell action-required labeling and loading phrase suppression based on all response activity, using LLxprt’s current stream state architecture.

## a6dca02344bae91108dd7297944203339af96ad0 — Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495)
**Verdict:** NO_OP
**Confidence:** MEDIUM
**Areas:** hooks, agent-lifecycle
**Evidence:** upstream `packages/core/src/core/client.ts`, `packages/core/src/hooks/hookSystem.ts`; llxprt `packages/core/src/core/client.ts`, `packages/core/src/core/lifecycleHookTriggers.ts`, `packages/core/src/hooks/hookSystem.ts`
**Rationale:** The upstream change is a formatting/refactor around before/after agent hook events. LLxprt already routes agent lifecycle hooks through dedicated trigger helpers and equivalent wrapper logic rather than the exact upstream implementation. The behavior appears already covered, but through a different code path. Because this is output-shape-sensitive and the branch has lifecycle refactors, the commit is not a clean cherry-pick target.
**Conflicts expected:** YES — file layout and lifecycle trigger structure differ.
**Partial applicability:** None unless a concrete output mismatch is observed in hook payloads.

## 8faa23cea6c67fb75740a53f333f2de8f4656371 — feat(agents): clarify mandatory YAML frontmatter for sub-agents (#16515)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** agents, docs/help, loader
**Evidence:** upstream `packages/core/src/agents/agentLoader.ts`, `packages/core/src/agents/cli-help-agent.ts`; llxprt probe for `/packages/core/src/agents/agentLoader.ts` returned file-not-found
**Rationale:** The primary loader file touched upstream does not exist in this LLxprt branch, so the exact feature path is absent or replaced. Without a corresponding loader implementation, this cherry-pick is not actionable as-is. The intent may already be handled elsewhere, but there is no direct patch target in current code.
**Conflicts expected:** YES — missing files / different agent architecture.
**Partial applicability:** Only as a separate documentation or parser audit in LLxprt’s actual subagent loader path, not as this commit.

## 0f7a136612ef49f812f8c516a58df88cc4675c4a — docs(telemetry): add Google Cloud Monitoring dashboard documentation (#16520)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** docs, telemetry
**Evidence:** upstream `docs/cli/telemetry.md` and dashboard image assets; audit criteria explicitly exclude Google Cloud Monitoring telemetry docs
**Rationale:** LLxprt removed upstream telemetry infrastructure and the audit criteria explicitly say to skip Google Cloud Monitoring telemetry documentation.
**Conflicts expected:** NO — skipped by policy.
**Partial applicability:** None.

## aa524625503ff15029c744864936afb55076d6e9 — Implement support for subagents as extensions. (#16473)
**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Areas:** extensions, subagents, registry, config
**Evidence:** upstream `packages/cli/src/config/extension-manager.ts`, `packages/core/src/agents/registry.ts`, `packages/core/src/config/config.ts`; llxprt `packages/cli/src/config/extension-manager.ts`, `packages/core/src/agents/registry.ts`, `packages/core/src/config/config.ts` exist but have diverged; prior symbol scan indicated related support already exists in some form
**Rationale:** This feature is in-scope for LLxprt, but the relevant extension and agent systems have diverged substantially. There are signs of existing related functionality, so the likely question is parity/completeness rather than total absence. A direct cherry-pick would be risky; a targeted comparison-driven reimplementation is safer if there is a concrete missing behavior around extension-provided subagents.
**Conflicts expected:** YES — config and registry code are branch-specific and multi-provider aware.
**Partial applicability:** Likely partial; audit extension metadata format and agent registration precedence before implementing anything.

## 91fcca3b1c77590c500d27350dff9c2dbb1d0c21 — refactor: make baseTimestamp optional in addItem and remove redundant calls (#16471)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** ui-history, commands, trust-dialogs, stream-hooks
**Evidence:** upstream `packages/cli/src/ui/hooks/useHistoryManager.ts` and many UI command callsites; llxprt `packages/cli/src/ui/hooks/useHistoryManager.ts` still requires `addItem(itemData, baseTimestamp: number)` and numerous callers still pass `Date.now()` explicitly
**Rationale:** This is a straightforward cleanup/refactor that reduces redundant timestamp plumbing. LLxprt still has the old API shape and redundant `Date.now()` usage, so the improvement is missing. The change is framework-local and provider-agnostic.
**Conflicts expected:** YES — many callsites, but conflicts should be mechanical rather than conceptual.
**Partial applicability:** Full intent applies; exact touched files may differ slightly because LLxprt has extra commands/tests.

## e931ebe581bf46de8b9b900392af9431d6c694cf — Improve key binding names and descriptions (#16529)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** keybindings, docs, input UX
**Evidence:** upstream `packages/cli/src/config/keyBindings.ts`, `packages/cli/src/ui/AppContainer.tsx`, `packages/cli/src/ui/components/InputPrompt.tsx`, `packages/cli/src/ui/keyMatchers.test.ts`; llxprt `packages/cli/src/config/keyBindings.ts` still uses old command names such as `TOGGLE_IDE_CONTEXT_DETAIL`
**Rationale:** This is a low-risk UX/documentation cleanup. LLxprt still carries the pre-rename terminology, so the change has not landed. It does not depend on removed infrastructure or provider-specific logic.
**Conflicts expected:** YES — LLxprt may have extra custom bindings and labels, so rename mapping will need manual merge.
**Partial applicability:** Full intent applies, but names/descriptions should be adapted to LLxprt-specific commands and branding.

## 92e31e3c4aede4a84f29ea31b372f29dbd55b67e — feat(core, cli): Add support for agents in settings.json. (#16433)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** settings-schema, core-config, agent-registry, model-config
**Evidence:** upstream `packages/core/src/config/config.ts`, `packages/cli/src/config/config.ts`, `packages/cli/src/config/settingsSchema.ts`, `schemas/settings.schema.json`, `packages/core/src/agents/registry.ts`; llxprt `packages/core/src/config/config.ts` has no `AgentSettings/getAgentsSettings`, and current `packages/core/src/agents/registry.ts` is a simpler/diverged registry without upstream override wiring
**Rationale:** The feature is relevant to LLxprt’s subagent system, but the branch has materially different config, schema, and multi-provider runtime plumbing. Upstream assumes a core config surface that does not exist here. Direct cherry-pick risk is high; the right move would be to reimplement the user-facing settings concept atop LLxprt’s current provider-aware configuration model.
**Conflicts expected:** YES — heavy conflicts in settings, schema generation, config objects, and agent registration.
**Partial applicability:** Concept applies; implementation must be redesigned for LLxprt’s config architecture.

## e8be252b755864bf9e60f18a69c198a762a11df0 — fix(cli): fix 'gemini skills install' unknown argument error (#16537)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** skills-cli
**Evidence:** upstream touches `packages/cli/src/commands/skills/install.ts`, `uninstall.ts`, `disable.ts`, `list.ts`; llxprt directory `/packages/cli/src/commands/skills` contains only `disable`, `enable`, and `list` command files/tests, and `install.ts` / `uninstall.ts` are absent
**Rationale:** The commit’s primary bug concerns commands that LLxprt does not currently ship. The exact bug path is therefore not applicable. There may be minor description/builder cleanups in shared files, but the headline fix cannot be cherry-picked meaningfully.
**Conflicts expected:** NO — skipped because the affected command surface does not exist.
**Partial applicability:** Only tiny wording consistency updates in existing skills commands, if desired separately.

## b518125c4618dbc661b47a639d63e13e5f3d2f9e — chore(ui): optimize AgentsStatus layout with dense list style and group separation (#16545)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** ui, agents-status
**Evidence:** upstream `packages/cli/src/ui/components/views/AgentsStatus.tsx`; llxprt probe for `/packages/cli/src/ui/components/views/AgentsStatus.tsx` returned file-not-found
**Rationale:** The component being tuned upstream is absent in this branch, so there is no direct applicability.
**Conflicts expected:** NO — skipped as non-applicable.
**Partial applicability:** None.

## b2e866585d4ae4545351afbd831f6fd713a8a633 — fix(cli): allow @ file selector on slash command lines (#16370)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** input-prompt, command-completion, file-selector
**Evidence:** upstream `packages/cli/src/ui/hooks/useCommandCompletion.tsx`, `packages/cli/src/ui/components/InputPrompt.tsx`; llxprt `packages/cli/src/ui/hooks/useCommandCompletion.tsx` already defines `CompletionMode` and exposes `completionMode`, matching the core mechanism added upstream
**Rationale:** The essential upstream change adds `completionMode` plumbing so `@` completion can work correctly on slash-command lines. LLxprt already has `CompletionMode` in `useCommandCompletion.tsx`, returns it from the hook, and imports it in prompt-related code. The underlying capability appears already present, so this commit is effectively absorbed.
**Conflicts expected:** YES — direct patch would likely overlap with existing implementation.
**Partial applicability:** None needed unless a specific regression reproduces in LLxprt.

## 63c918fe7de79c760236270036647ae7a64530a6 — fix(ui): resolve sticky header regression in tool messages (#16514)
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** ui, tool-messages, sticky-headers
**Evidence:** upstream `packages/cli/src/ui/components/StickyHeader.tsx`, `messages/ToolMessage.tsx`, `messages/ShellToolMessage.tsx`; llxprt `packages/cli/src/ui/components/StickyHeader.tsx:7-33` still lacks `containerRef`, while `packages/cli/src/ui/components/messages/ToolMessage.tsx:147-154` already uses fragment-wrapped layout similar to the upstream fix; `ShellToolMessage.tsx` file is absent from current component search
**Rationale:** LLxprt already contains part of the upstream fix: `ToolMessage` is fragment-wrapped specifically to preserve sticky-header behavior. But `StickyHeader` itself does not yet accept a ref, and the shell-specific message component touched upstream is absent or folded into different code. So the regression fix is partially present and partially diverged. The remaining missing piece is still worth picking in intent, but it will require a manual port.
**Conflicts expected:** YES — missing shell component and existing partial fix mean this is not a clean cherry-pick.
**Partial applicability:** Apply only the still-missing sticky-header infrastructure that fits LLxprt’s current tool rendering.

## d66ec38f82909eb291788328cd16af6c6584fbd3 — feat(core): Align internal agent settings with configs exposed through settings.json (#16458)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** agents, model-config, run-config, settings-alignment
**Evidence:** upstream `packages/core/src/agents/types.ts`, `registry.ts`, `local-executor.ts`, `cli-help-agent.ts`, `codebase-investigator.ts`; llxprt `packages/core/src/agents/types.ts` still uses legacy fields `temp`, `top_p`, `max_time_minutes`, `max_turns`
**Rationale:** LLxprt is still on the older internal agent config shape, while upstream migrated to `generateContentConfig`, `maxTimeMinutes`, and `maxTurns` to align with settings.json and model config services. This matters functionally if LLxprt wants future settings-based agent overrides, but the branch is far enough behind/diverged that the change is more of a schema migration than a safe cherry-pick.
**Conflicts expected:** YES — widespread type, executor, registry, and test conflicts.
**Partial applicability:** Strong conceptual applicability, but should be done as a coordinated internal-agent schema migration, likely together with any settings.json support work.

## c7c409c68fba8990af9452fcb32f6d5de35eb578 — fix(cli): copy uses OSC52 only in SSH/WSL (#16554)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** clipboard, terminal-interop, remote-shell
**Evidence:** upstream `packages/cli/src/ui/utils/commandUtils.ts`; llxprt `packages/cli/src/ui/utils/commandUtils.ts:117-120` still enables OSC52 for `isSSH() || inTmux() || inScreen() || isWSL()`
**Rationale:** Upstream narrows OSC52 usage to actual remote contexts (SSH/WSL), falling back to system clipboard locally even inside tmux/screen. LLxprt still uses the older broader condition, so the fix is missing. This is a focused UX/compatibility improvement with no provider coupling.
**Conflicts expected:** LOW — small, localized logic/test update.
**Partial applicability:** Full applicability.

## 778de55fd8c312b9e8a5cc39cc8d666ff043f21b — docs(skills): clarify skill directory structure and file location (#16532)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** docs, skills
**Evidence:** upstream `docs/cli/skills.md`; llxprt `docs/cli/skills.md` still documents only broad conventions and could absorb location/structure clarifications
**Rationale:** This is documentation-only, skills are present in LLxprt, and no excluded infrastructure is involved. The update should be straightforward to adapt to LLxprt branding and any local path conventions.
**Conflicts expected:** LOW — doc wording merge only.
**Partial applicability:** Full, with wording adjusted for LLxprt terminology if needed.

## 8dbaa2bceaf947b293868ad5ed9244fa872ab31f — Fix: make ctrl+x use preferred editor (#16556)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** editor-integration, input-buffer, preferences
**Evidence:** upstream `packages/cli/src/ui/components/shared/text-buffer.ts`, `packages/core/src/utils/editor.ts`, `packages/cli/src/ui/AppContainer.tsx`; llxprt `packages/cli/src/ui/components/shared/text-buffer.ts:2140-2185` still opens external editor from env/default only and `AppContainer.tsx:1259-1265` has preferred-editor callback logic separate from text buffer opening
**Rationale:** LLxprt still has the pre-fix behavior: Ctrl+X text-buffer editor launch ignores the configured preferred editor and instead uses `VISUAL/EDITOR/default`. The upstream patch cleanly fixes that by plumbing preferred editor into the buffer and reusing editor command selection utilities. This is directly applicable and provider-agnostic.
**Conflicts expected:** YES — LLxprt has extra editor-availability/open-dialog behavior, so the callback plumbing should be merged carefully.
**Partial applicability:** Full intent applies; adapt to LLxprt’s existing preferred-editor validation flow.

## eda47f587cfd18d98b28ae3f0773718c3f4b067f — fix(core): Resolve race condition in tool response reporting (#16557)
**Verdict:** PICK
**Confidence:** HIGH
**Areas:** tool-scheduler, batching, cancellation
**Evidence:** upstream `packages/core/src/core/coreToolScheduler.ts`; llxprt `packages/core/src/core/coreToolScheduler.ts:1732-1760` still copies `toolCalls` into `completedCalls` and awaits `onAllToolCallsComplete(completedCalls)` once without the upstream finalizing/drain loop
**Rationale:** LLxprt still has the race-prone completion reporting pattern that upstream replaced with a guarded finalization loop. This is a real concurrency correctness fix and aligns with LLxprt’s existing scheduler architecture closely enough to be valuable.
**Conflicts expected:** MEDIUM — scheduler has local divergences, but the fix is localized and conceptually portable.
**Partial applicability:** Full intent applies; port the guarded batch-draining logic rather than blindly cherry-picking.

## 04f65d7b4eff956124f1cc41b09cd62c04764af3 — feat(ui): highlight persist mode status in ModelDialog (#16483)
**Verdict:** SKIP
**Confidence:** MEDIUM
**Areas:** ui, model-dialog
**Evidence:** upstream `packages/cli/src/ui/components/ModelDialog.tsx`; llxprt comparative read set did not confirm corresponding persist-mode concept in current dialog flow
**Rationale:** This is a UI enhancement around upstream persist-mode semantics. The audit criteria prefer compatible UI/UX features, but without confirming the same persist-mode concept in LLxprt’s model dialog, this is not safe to pick from subject/diff alone. Current batch evidence is insufficient to show direct applicability.
**Conflicts expected:** YES — likely UI/model-setting divergence.
**Partial applicability:** Revisit only if LLxprt has the same persist-mode affordance and wants clearer highlighting.

## 428e6028822b73b492d514f14a6cbc2fd8647b42 — refactor: clean up A2A task output for users and LLMs (#16561)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** A2A, remote-agents
**Evidence:** upstream `packages/core/src/agents/a2aUtils.ts`, `packages/core/src/agents/remote-invocation.ts`; llxprt searches for `extractTaskText`, `extractMessageText`, and `RemoteAgentInvocation` under `packages/core/src` returned no matches, and `packages/core/src/agents/a2aUtils.ts` is absent
**Rationale:** Although LLxprt has A2A server support, the exact utility/invocation files touched by upstream are not present under the same paths. This indicates major implementation divergence, so the commit is not a cherry-pick candidate as-is. If LLxprt wants the cleaner output behavior, it should be audited against its actual A2A codepath separately.
**Conflicts expected:** YES — missing files / different A2A implementation.
**Partial applicability:** Concept may apply, but only via a fresh implementation in LLxprt’s existing A2A stack.

## 4afd3741df7c3322f7bce276876682d320fa7ae2 — feat(core/ui): enhance retry mechanism and UX (#16489)
**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Areas:** retry, core-events, loading-indicator, stream-ui
**Evidence:** upstream `packages/core/src/utils/retry.ts`, `packages/core/src/utils/events.ts`, `packages/core/src/core/geminiChat.ts`, `packages/cli/src/ui/hooks/useGeminiStream.ts`, `packages/cli/src/ui/hooks/useLoadingIndicator.ts`; llxprt `packages/core/src/utils/retry.ts:18-35` still defaults to `maxAttempts: 5` and lacks `onRetry`, search found no `RetryAttempt` event plumbing, and `packages/cli/src/ui/AppContainer.tsx:1587-1596` still calls `useLoadingIndicator(...)` without retry status
**Rationale:** The upstream commit is a bundle of two changes: retry-policy expansion and retry UX signaling. LLxprt lacks the event plumbing and UI state entirely, so that portion is missing. But retry behavior itself has already diverged in LLxprt (`maxAttempts: 5`, custom retry orchestrator tests exist), so blindly taking upstream defaults would overwrite branch-specific retry policy. The correct path is to reimplement only the useful UX/event aspects, while preserving LLxprt’s existing retry strategy unless separately justified.
**Conflicts expected:** YES — retry internals and provider retry orchestration have diverged.
**Partial applicability:** High partial applicability: add retry-attempt event/UI surfacing without necessarily adopting upstream retry-count defaults.


# Batch H

# Audit Batch H — Commits 149-169

## 149. 933bc5774fe25a477b429c012ab91b7d32f78cee — Modernize MaxSizedBox to use <Box maxHeight> and ResizeObservers (#16565)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** UI/components
**Evidence:** 
- Upstream: 16 files changed, massive rewrite of MaxSizedBox.tsx (612 lines → much smaller)
- LLxprt: `packages/cli/src/ui/components/shared/MaxSizedBox.tsx` - completely different implementation
- Upstream removes `setMaxSizedBoxDebugging`, uses ResizeObserver-based approach
- LLxprt has its own MaxSizedBox with different architecture (styled text layout, no ResizeObserver)
**Rationale:** LLxprt's MaxSizedBox implementation is fundamentally different from upstream. The upstream rewrite to use Ink's `<Box maxHeight>` with ResizeObservers would conflict with LLxprt's custom text layout approach. LLxprt's implementation appears to handle the same problem differently.
**Conflicts expected:** YES - would require complete reimplementation
**Partial applicability:** None - different architecture

---

## 150. 8030404b08be0d62a825ee6e857a25de4d2cdb41 — Behavioral evals framework. (#16047)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** CI/testing
**Evidence:**
- Adds `.github/workflows/evals-nightly.yml`
- Creates `evals/` directory with evaluation framework
- Adds `packages/test-utils/src/test-rig.ts`
- Modifies `eslint.config.js` to exclude evals
**Rationale:** Per audit criteria: "upstream-only CI" should be skipped. This is an upstream-specific evaluation framework for their CI pipeline.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 151. 66e7b479ae427d77d9634ad5c87d8e3229afbcc7 — Aggregate test results. (#16581)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** CI/testing
**Evidence:**
- Modifies `.github/workflows/evals-nightly.yml`
- Adds `scripts/aggregate_evals.js`
- Modifies `evals/` files
**Rationale:** Upstream CI/test infrastructure. Part of the evals framework from commit 150.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 152. bb6c57414434ecc6272bec40f5b1d4f0917b2f87 — feat(admin): support admin-enforced settings for Agent Skills (#16406)
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** config, skills, admin
**Evidence:**
- Adds `admin.skills.enabled` setting (default: true)
- Modifies `packages/cli/src/config/config.ts` - adds `adminSkillsEnabled`
- Modifies `packages/cli/src/config/settingsSchema.ts` - adds schema for skills admin
- Modifies `packages/cli/src/services/BuiltinCommandLoader.ts` - shows error when skills disabled
- Modifies `packages/cli/src/ui/commands/skillsCommand.ts` - checks admin enabled
- Modifies `packages/core/src/config/config.ts` - adds refresh for adminSkillsEnabled
- Modifies `packages/core/src/skills/skillManager.ts` - adds `isAdminEnabled()` method
- Updates docs and schemas
**Rationale:** Admin-enforced settings for skills is a legitimate feature that LLxprt should support. It allows administrators to disable skills if needed. The implementation is straightforward configuration logic with no Gemini-specific dependencies.
**Conflicts expected:** NO - standard config/settings pattern
**Partial applicability:** May need branding updates for package names in imports

---

## 153. cd7a5c96045b109fc327a84151b8321c20af9c49 — chore(release): v0.25.0-preview.0
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:**
- Version bump from `0.25.0-nightly.20260107.59a18e710` to `0.25.0-preview.0`
- Updates all package.json files and sandboxImageUri
**Rationale:** Per audit criteria: "release bumps (chore(release):)" should be skipped.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 154. 1d5e792a4110dc53b72fda5061e89197be2621ea — fix(patch): cherry-pick cfdc4cf to release/v0.25.0-preview.0-pr-16759
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** hooks, tool-scheduler
**Evidence:**
- Upstream diff: Changes `scheduleToolCalls` from sync void to async Promise<void>
- Changes `ScheduleFn` type from `void` to `Promise<void>`
- Adds `await` to all `scheduleToolCalls` calls in `useGeminiStream.ts`
- LLxprt already has: 
  - `ScheduleFn` returns `Promise<void>` (line 69-72 in useReactToolScheduler.ts)
  - `await scheduleToolCalls` calls at lines 627 and 1202 in useGeminiStream.ts
**Rationale:** LLxprt already has this fix implemented. The ScheduleFn type already returns Promise<void> and the await calls are already in place. This was likely fixed independently or picked up from an earlier upstream commit.
**Conflicts expected:** N/A - already implemented
**Partial applicability:** None

---

## 155. 46079d9daaebaecfe96ebb3b3622955c57012198 — Patch #16730 into v0.25.0 preview (#16882)
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** build, tsconfig
**Evidence:**
- Adds path mapping to `packages/core/tsconfig.json`:
  ```json
  "baseUrl": ".",
  "paths": {
    "@google/gemini-cli-core": ["./index.ts"]
  }
  ```
**Rationale:** Build configuration fix. LLxprt has different package structure (`@vybestack/llxprt-code-core`). This path mapping would need to be adjusted for LLxprt branding and is likely already configured appropriately.
**Conflicts expected:** YES - branding differences
**Partial applicability:** If needed, would require LLxprt branding changes

---

## 156. de86bccd0d756549489cd726fe54a2a54a7159a0 — chore(release): v0.25.0-preview.1
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** Version bump from preview.0 to preview.1
**Rationale:** Release version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 157. f6a5fa0e03af0b41aa93ad1e67de99eaa944c07d — fix(ui): ensure rationale renders before tool calls (#17043)
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** UI, hooks, history
**Evidence:**
- Upstream diff adds pending history item flush before scheduling tool calls:
  ```typescript
  if (toolCallRequests.length > 0) {
    if (pendingHistoryItemRef.current) {
      addItem(pendingHistoryItemRef.current, userMessageTimestamp);
      setPendingHistoryItem(null);
    }
    await scheduleToolCalls(toolCallRequests, signal);
  }
  ```
- LLxprt has `pendingHistoryItemRef` and related logic
- LLxprt already has `await scheduleToolCalls` at line 1202
- Need to verify if the pending history flush is present before the tool call
**Rationale:** This fixes a race condition where tool results could be added to history before the rationale text. This ordering bug could affect LLxprt as well. The fix is small and isolated.
**Conflicts expected:** NO - standard React hook pattern
**Partial applicability:** Need to verify exact location in LLxprt's useGeminiStream.ts

---

## 158. ea0e3de4302a9602e710e0ca14396e9e5a4eb3e4 — fix(core): deduplicate ModelInfo emission in GeminiClient (#17075)
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** core, client, GeminiClient
**Evidence:**
- Upstream diff modifies `packages/core/src/core/client.ts`:
  ```typescript
  if (!signal.aborted && !this.currentSequenceModel) {
    yield { type: GeminiEventType.ModelInfo, value: modelToUse };
  }
  this.currentSequenceModel = modelToUse;
  ```
- Previously always yielded ModelInfo event even when model hadn't changed
- LLxprt has `currentSequenceModel` at line 221 in client.ts
- LLxprt has `getCurrentSequenceModel()` at line 998
**Rationale:** This is a GeminiClient fix to prevent duplicate ModelInfo events. While LLxprt has multi-provider architecture, it still uses GeminiClient for Gemini provider. The fix prevents redundant model info emissions during retries.
**Conflicts expected:** NO - isolated fix
**Partial applicability:** Directly applicable to GeminiClient used by LLxprt

---

## 159. b1f7a7e6f7d921eaeb2e67bce72e7004756a0ec5 — chore(release): v0.25.0-preview.2
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** Version bump from preview.1 to preview.2
**Rationale:** Release version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 160. 6289c3ee3f667643170c3ff31b066ae39201b4f4 — fix(patch): cherry-pick 3b55581 to release/v0.25.0-preview.2-pr-16506
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** config, extensions
**Evidence:**
- Adds `experimental.extensionConfig` setting (default: false)
- Controls whether extension configuration is enabled
- Modifies extension-manager.ts to check this flag
- Modifies configure.ts command to check the flag
**Rationale:** Extension configuration feature flag. This is specific to upstream's extension system. LLxprt may have different extension handling or may not need this feature.
**Conflicts expected:** YES - extension system differences
**Partial applicability:** Could be picked if LLxprt wants this extension config feature

---

## 161. 982fd1fc294d10283e7bf13140676b12490113c6 — chore(release): v0.25.0-preview.3
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** Version bump from preview.2 to preview.3
**Rationale:** Release version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 162. 02e68e455474e251b4c3a1a341cbdfa905511e7a — Fix: Process all parts in response chunks when thought is first (#13539)
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** core, turn, thinking
**Evidence:**
- Upstream diff:
  - `turn.ts`: Changed from checking only `parts[0]` to iterating all parts for thoughts
  - `partUtils.ts`: Added `!part.thought` filter to exclude thoughts from text
- LLxprt already has both fixes:
  - `turn.ts` lines 367-377: Iterates all parts for thoughts
  - `generateContentResponseUtilities.ts` lines 34-38, 52-54: Filters thoughts from text
**Rationale:** LLxprt already has this fix implemented. The thinking support was added with PLAN-20251202-THINKING.P16 which properly handles thoughts in all positions.
**Conflicts expected:** N/A - already implemented
**Partial applicability:** None

---

## 163. 217f27758050afb3307017ae76007bd13cfd06d6 — fix: update currentSequenceModel when modelChanged (#17051)
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** core, client, model-switching
**Evidence:**
- Upstream diff:
  - Adds `handleModelChanged` listener in GeminiClient constructor
  - Sets `currentSequenceModel = null` when model changes
  - Adds `dispose()` method to remove listener
  - Uses `coreEvents.on(CoreEvent.ModelChanged, this.handleModelChanged)`
  - Also fixes fallback handling to use `activateFallbackMode` instead of `setActiveModel`
- LLxprt has `currentSequenceModel` at line 221 in client.ts
- LLxprt does NOT have `handleModelChanged` or `ModelChanged` event handling
- LLxprt does have `getCurrentSequenceModel()` method
**Rationale:** This fix ensures that when a user changes the model mid-session, the GeminiClient properly re-routes to the new model. Without this, the client could cache the old model and not respect the change. This is a legitimate bug fix that LLxprt should adopt.
**Conflicts expected:** LOW - need to verify CoreEvent.ModelChanged exists in LLxprt
**Partial applicability:** May need to adapt to LLxprt's event system if different

---

## 164. eb88343419687119674c23a5e81475c2f7327aa1 — chore(release): v0.25.0-preview.4
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** Version bump from preview.3 to preview.4
**Rationale:** Release version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 165. c9dbf700433179dea85a8a4c6270fd3c03276e20 — chore(release): v0.25.0
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** Version bump from preview.4 to 0.25.0
**Rationale:** Release version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 166. 2a8e1a8cc1cf5760cb28b88f41fe34cad2931ab7 — fix(patch): cherry-pick 87a0db2 to release/v0.25.0-pr-17308 [CONFLICTS]
**Verdict:** PICK
**Confidence:** MEDIUM
**Areas:** auth, startup, sandbox
**Evidence:**
- Upstream diff modifies `packages/cli/src/gemini.tsx`:
  - Adds `initialAuthFailed` flag
  - Catches auth failure gracefully instead of immediate exit
  - Only exits with auth error if sandbox is configured
  - Allows non-sandbox mode to continue even with auth failure
- Also modifies `gemini.test.tsx` to add mocks for `getRemoteAdminSettings` and `isInteractive`
**Rationale:** This fix handles the case where auth fails during startup. Instead of immediately exiting, it defers the exit until sandbox mode check. This allows the CLI to potentially work in limited modes even without successful auth. Useful for robustness.
**Conflicts expected:** LOW - standard error handling pattern
**Partial applicability:** Directly applicable to LLxprt's startup flow

---

## 167. 29d4b1e6b84221a3e989a667542d2bc735c36e57 — chore(release): v0.25.1
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** Version bump from 0.25.0 to 0.25.1
**Rationale:** Release version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## 168. 18e854c3309d1bc9178cdc86e060e02783c43ba9 — fix(patch): cherry-pick 9866eb0 to release/v0.25.1-pr-17166
**Verdict:** NO_OP
**Confidence:** HIGH
**Areas:** UI, text-buffer, editor
**Evidence:**
- Upstream diff fixes VISUAL/EDITOR environment variable parsing:
  ```typescript
  // Before (buggy):
  (process.env['VISUAL'] ??
   process.env['EDITOR'] ??
   process.platform === 'win32')
    ? 'notepad'
    : 'vi';
  
  // After (fixed):
  process.env['VISUAL'] ??
  process.env['EDITOR'] ??
  (process.platform === 'win32' ? 'notepad' : 'vi');
  ```
- LLxprt already has the correct fix at lines 2144-2146 in text-buffer.ts:
  ```typescript
  process.env['VISUAL'] ??
  process.env['EDITOR'] ??
  (process.platform === 'win32' ? 'notepad' : 'vi');
  ```
**Rationale:** LLxprt already has the correct implementation. The fix properly chains the environment variable checks with the ternary for platform default.
**Conflicts expected:** N/A - already implemented
**Partial applicability:** None

---

## 169. 83a3b070505590a534388447d6bedac6552918e9 — chore(release): v0.25.2
**Verdict:** SKIP
**Confidence:** HIGH
**Areas:** release
**Evidence:** Version bump from 0.25.1 to 0.25.2
**Rationale:** Release version bump.
**Conflicts expected:** N/A
**Partial applicability:** None

---

## Summary

| Commit | Subject | Verdict | Confidence |
|--------|---------|---------|------------|
| 149 | MaxSizedBox modernization | SKIP | HIGH |
| 150 | Behavioral evals framework | SKIP | HIGH |
| 151 | Aggregate test results | SKIP | HIGH |
| 152 | Admin-enforced settings for Agent Skills | PICK | MEDIUM |
| 153 | v0.25.0-preview.0 | SKIP | HIGH |
| 154 | scheduleToolCalls async fix | NO_OP | HIGH |
| 155 | tsconfig path mapping | SKIP | HIGH |
| 156 | v0.25.0-preview.1 | SKIP | HIGH |
| 157 | Rationale renders before tool calls | PICK | MEDIUM |
| 158 | Deduplicate ModelInfo emission | PICK | MEDIUM |
| 159 | v0.25.0-preview.2 | SKIP | HIGH |
| 160 | extensionConfig feature flag | SKIP | HIGH |
| 161 | v0.25.0-preview.3 | SKIP | HIGH |
| 162 | Process all parts for thoughts | NO_OP | HIGH |
| 163 | Update currentSequenceModel on modelChanged | PICK | MEDIUM |
| 164 | v0.25.0-preview.4 | SKIP | HIGH |
| 165 | v0.25.0 | SKIP | HIGH |
| 166 | Auth failure handling fix | PICK | MEDIUM |
| 167 | v0.25.1 | SKIP | HIGH |
| 168 | VISUAL/EDITOR env var fix | NO_OP | HIGH |
| 169 | v0.25.2 | SKIP | HIGH |

### PICK Summary (4 commits):
1. **152** - Admin-enforced settings for Agent Skills (skills config)
2. **157** - Ensure rationale renders before tool calls (history ordering bug)
3. **158** - Deduplicate ModelInfo emission in GeminiClient (GeminiClient fix)
4. **163** - Update currentSequenceModel when modelChanged (model switching fix)
5. **166** - Auth failure handling fix (startup robustness)

### NO_OP Summary (3 commits):
- **154** - scheduleToolCalls async fix (already implemented)
- **162** - Process all parts for thoughts (already implemented)
- **168** - VISUAL/EDITOR env var fix (already implemented)

### SKIP Summary (13 commits):
- **149** - MaxSizedBox rewrite (different architecture)
- **150** - Evals framework (upstream-only CI)
- **151** - Aggregate test results (upstream-only CI)
- **153, 156, 159, 161, 164, 165, 167, 169** - Release version bumps (8 commits)
- **155** - tsconfig path mapping (branding conflicts)
- **160** - extensionConfig feature flag (extension-specific)

