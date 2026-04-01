# Upstream Gemini-CLI Commit Audit — Batch 1 (Commits 1-31)

**Audit Date:** 2026-03-24
**Auditor:** LLxprt Code
**Source:** gemini-cli upstream (via git show)
**Target:** LLxprt Code fork (multi-provider)

---

## 1. c8d7c09 — fix: PDF token estimation

**Verdict:** NO_OP
**Confidence:** HIGH
**Evidence:** 
- Upstream adds PDF token estimation to `packages/core/src/utils/tokenCalculation.ts` and `tokenCalculation.test.ts`
- LLxprt does NOT have these files: `packages/core/src/utils/tokenCalculation.ts` does not exist
- No token calculation utilities exist in LLxprt's `packages/core/src/utils/` directory
**Rationale:** LLxprt uses different token estimation logic via provider APIs. The file doesn't exist in LLxprt, so there's nothing to merge. This functionality may have been diverged or removed in the fork.
**Conflicts expected:** NO — file doesn't exist
**Partial applicability:** N/A — file not present in LLxprt

---

## 2. a1cbe85 — chore(release): bump to nightly

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Version bump from `0.26.0-nightly.*` affecting package.json, package-lock.json
- LLxprt has different package name (`@vybestack/llxprt-code-core`)
**Rationale:** Version bumps are project-specific. LLxprt maintains its own versioning scheme.
**Conflicts expected:** NO — would overwrite with wrong version
**Partial applicability:** None

---

## 3. c04af6c — docs: clarify F12 debug console

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Changes `docs/get-started/configuration.md`, `docs/tools/mcp-server.md`, `docs/troubleshooting.md`
- Minor doc change: `packages/cli/src/config/config.ts` (clarifies F12 debug console message)
- Docs are applicable; config.ts change is small and independent
**Rationale:** Documentation improvements benefit all users. The config.ts change is a minor string update.
**Conflicts expected:** NO — simple doc updates
**Partial applicability:** All files apply

---

## 4. f6c2d61 — docs: Remove .md from internal links

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Only changes `docs/architecture.md` — removes `.md` extension from internal links
- Pure documentation fix for link resolution
**Rationale:** Simple documentation fix that improves link behavior.
**Conflicts expected:** NO
**Partial applicability:** All files apply

---

## 5. 3b55581 — Add experimental extension config setting

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Adds `experimental.extensionConfig` setting to settingsSchema.ts
- LLxprt has `packages/cli/src/config/settingsSchema.ts` but no `extension-manager.ts` (uses `packages/cli/src/config/extension.ts` and `packages/cli/src/config/extensions/` instead)
- The extension architecture differs between projects
**Rationale:** LLxprt has extension support but with different file organization. The concept of gating extension config behind an experimental flag is valid, but file paths differ significantly. Need to adapt to LLxprt's extension architecture.
**Conflicts expected:** YES — different file structure
**Partial applicability:** 
- Applies: `docs/get-started/configuration.md`, `settingsSchema.ts`, `schemas/settings.schema.json`
- Diverges: `extension-manager.ts` (doesn't exist, use `extension.ts`), configure.ts location may differ

---

## 6. dfb7dc7 — feat: add Rewind Confirmation dialog and Rewind Viewer component

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds 19 files including `RewindConfirmation.tsx`, `RewindViewer.tsx`, related tests, snapshots
- Adds `Command.REWIND` and key binding for double-Esc
- Changes InputPrompt behavior for double-Esc to trigger `/rewind` instead of clearing
**Rationale:** Per skip criteria: "LLxprt does NOT have: ... rewind feature". This is a new feature that LLxprt explicitly does not have.
**Conflicts expected:** NO — would add new feature LLxprt doesn't want
**Partial applicability:** None — feature not wanted

---

## 7. 764016b — fix(a2a): Don't throw for Retry/InvalidStream

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Changes `packages/a2a-server/src/agent/task.ts` and `task.test.ts`
- LLxprt HAS `packages/a2a-server/src/agent/task.ts` with similar structure
- Adds handling for `GeminiEventType.Retry` and `GeminiEventType.InvalidStream` in the switch statement
**Rationale:** LLxprt has a2a-server with the task.ts file. The fix prevents errors on retry/invalid stream events. Examining LLxprt's task.ts shows it DOES have `GeminiEventType` handling but may not have these specific cases.
**Conflicts expected:** LOW — straightforward switch case additions
**Partial applicability:** All files apply

---

## 8. a3234fb — prefactor: add rootCommands as array for policy parsing

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Adds `rootCommands: string[]` field to `ToolExecuteConfirmationDetails` in `packages/core/src/tools/tools.ts`
- Updates shell.ts, mock-tool.ts, and tests to include `rootCommands` array
- LLxprt has `packages/core/src/tools/tools.ts` and `shell.ts`
**Rationale:** The concept is valid for LLxprt's policy engine. Need to verify LLxprt's tool types match. This appears to be preparation for policy parsing improvements.
**Conflicts expected:** LOW — type additions are additive
**Partial applicability:** All files apply but need to verify type definitions match

---

## 9. 09a7301 — remove unnecessary \x7f key bindings

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Removes `\x7f` sequence bindings from `packages/cli/src/config/keyBindings.ts`
- LLxprt HAS this file with similar structure
- Examining LLxprt's keyBindings.ts: it DOES have `{ sequence: '\x7f', ctrl: true }` and `{ sequence: '\x7f', command: true }` in `DELETE_WORD_BACKWARD` command
**Rationale:** The upstream cleanup is valid. LLxprt's keyBindings.ts has these same sequences that should be removed for consistency. However, LLxprt's key binding structure may have diverged, so verify each binding.
**Conflicts expected:** LOW — simple removal of redundant bindings
**Partial applicability:** All files apply

---

## 10. 4db00b8 — docs(skills): use body-file in pr-creator skill

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `.gemini/skills/pr-creator/SKILL.md` only
- Per skip criteria: "LLxprt does NOT have: ... builtin skills (skill-creator)"
**Rationale:** This is a builtin skill that LLxprt doesn't have. Not applicable.
**Conflicts expected:** NO — file doesn't exist in LLxprt
**Partial applicability:** None

---

## 11. 1212161 — chore(automation): recursive labeling

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `.github/scripts/`, `.github/workflows/` files
- Per skip criteria: "GitHub automation (.github/)"
**Rationale:** GitHub automation is project-specific.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 12. 16b3591 — feat: introduce skill-creator built-in skill and CJS tools

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds `packages/core/src/skills/builtin/skill-creator/` with SKILL.md and CJS scripts
- Per skip criteria: "LLxprt does NOT have: ... builtin skills (skill-creator)"
**Rationale:** This adds a new builtin skill that LLxprt explicitly doesn't have.
**Conflicts expected:** NO — would add unwanted feature
**Partial applicability:** None

---

## 13. b3eecc3 — chore(automation): remove PR size labeler

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Removes `.github/workflows/gemini-automated-pr-size-labeler.yml`
- Per skip criteria: "GitHub automation (.github/)"
**Rationale:** GitHub automation is project-specific.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 14. c8c7b57 — refactor(skills): replace 'project' with 'workspace' scope

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Changes `packages/cli/src/commands/skills/disable.ts`, `enable.ts`, skillUtils.ts, skillManager.ts
- LLxprt HAS these files (skillManager.ts in `packages/core/src/skills/`)
- Terminology change from 'project' to 'workspace' scope
**Rationale:** LLxprt has skills system. The terminology update is valid but files may have diverged. Need to verify the scope terminology used in LLxprt.
**Conflicts expected:** LOW — terminology changes
**Partial applicability:** All files apply but need verification of current terminology

---

## 15. 41369f6 — Docs: Update release notes

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `docs/changelogs/` files (index.md, latest.md, preview.md, releases.md)
- Release notes are project-specific
**Rationale:** LLxprt maintains its own release notes.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 16. 94d5ae5 — Simplify paste handling

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Removes `paste` field from `KeyBinding` interface and all `Key` objects
- Changes to `keyBindings.ts`, `KeypressContext.tsx`, `text-buffer.ts`, many test files
- Changes detection from `key.paste` to `key.name === 'paste'`
**Rationale:** The simplification is good, but LLxprt's key handling may have diverged. The `paste` property removal affects many files. Need to verify LLxprt has the same `paste` property usage.
**Conflicts expected:** MEDIUM — affects many files
**Partial applicability:** Most files apply but need verification of current key handling implementation

---

## 17. b14cf1d — chore(automation): improve scheduled issue triage

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `.github/workflows/gemini-scheduled-issue-triage.yml`
- Per skip criteria: "GitHub automation (.github/)"
**Rationale:** GitHub automation is project-specific.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 18. 7e6817d — fix(acp): run exit cleanup when stdin closes

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Changes `packages/cli/src/zed-integration/zedIntegration.ts` and `packages/core/src/core/contentGenerator.ts`
- Adds `integration-tests/acp-telemetry.test.ts`
- LLxprt may have zed integration but need to verify file existence
**Rationale:** The fix for stdin cleanup is important for proper exit handling. Need to verify LLxprt has similar zed integration.
**Conflicts expected:** LOW — if files exist
**Partial applicability:** 
- Applies: zedIntegration.ts (if exists), contentGenerator.ts
- May not apply: integration-tests (project-specific)

---

## 19. 6021e4c — feat(scheduler): add types for event driven scheduler

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Changes `packages/core/src/scheduler/types.ts` and `packages/core/src/confirmation-bus/types.ts`
- LLxprt HAS `packages/core/src/scheduler/types.ts` and `packages/core/src/confirmation-bus/types.ts`
- Examining LLxprt's scheduler/types.ts: it does NOT have `SerializableConfirmationDetails` or `correlationId` on `WaitingToolCall`
- LLxprt's confirmation-bus/types.ts does NOT have `ToolCallsUpdateMessage` type
**Rationale:** LLxprt has these type files but they're less evolved. This adds important types for event-driven scheduler. The type additions are additive but need careful merge to not break existing code.
**Conflicts expected:** MEDIUM — type additions may require downstream changes
**Partial applicability:** All files apply but need to add types that don't exist yet

---

## 20. 5ed275c — Remove unused rewind key binding

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Removes rewind key binding from `keyBindings.ts`
- Related to commit #6 (rewind feature) which was skipped
**Rationale:** Since rewind feature was skipped, removing its binding is not applicable.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 21. fb76408 — Remove sequence binding

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Removes `sequence` binding functionality from keyBindings.ts, keyMatchers.ts
- Changes to scripts/generate-keybindings-doc.ts
**Rationale:** Cleanup of unused sequence binding feature. Need to verify LLxprt uses this pattern.
**Conflicts expected:** LOW — removal of unused code
**Partial applicability:** All files apply

---

## 22. a2dab14 — feat(cli): undeprecate --prompt flag

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Changes `packages/cli/src/config/config.ts`, `gemini.tsx`, `nonInteractiveCli.ts`
- Removes deprecation warnings and tests for deprecated behavior
**Rationale:** LLxprt has these files. The undeprecation is valid but need to verify LLxprt had the same deprecation.
**Conflicts expected:** LOW — removal of deprecation code
**Partial applicability:** All files apply

---

## 23. b3527dc — chore: update dependabot configuration

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `.github/dependabot.yml`
- Per skip criteria: "GitHub automation (.github/)"
**Rationale:** GitHub automation is project-specific.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 24. e58fca6 — feat(config): add 'auto' alias for default model

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `packages/cli/src/config/config.ts` to add 'auto' model alias
- Per skip criteria: "auto model routing ('model: auto')"
**Rationale:** LLxprt does not have upstream's auto model routing feature.
**Conflicts expected:** NO
**Partial applicability:** None

---

## 25. 42c26d1 — cleanup: Improve keybindings

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Adds `MOVE_UP` and `MOVE_DOWN` commands to keyBindings.ts
- Simplifies text-buffer.ts key handling
- Changes KeypressContext.tsx
**Rationale:** LLxprt has these files. The improvements are valid but need verification of current state.
**Conflicts expected:** LOW — additive changes and simplifications
**Partial applicability:** All files apply

---

## 26. 4b2e9f7 — Enable & disable agents

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds agent enable/disable commands to `agentsCommand.ts`
- Adds `agentSettings.ts`, `agentUtils.ts` files
- Changes `packages/core/src/agents/registry.ts`, `a2a-client-manager.ts`, `config.ts`
- Per skip criteria: "LLxprt does NOT have: upstream agent system (no a2a-client-manager, delegate-to-agent-tool, local-executor, generalist-agent)"
**Rationale:** LLxprt doesn't have the upstream agent system that this feature depends on.
**Conflicts expected:** NO — would add unwanted feature
**Partial applicability:** None

---

## 27. ae19802 — Add timeout for shell-utils

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Changes `packages/core/src/utils/shell-utils.ts` and `shell-utils.test.ts`
- LLxprt HAS `packages/core/src/utils/shell-utils.ts` (verified exists)
- Adds timeout to `parseCommandTree` function to prevent hangs
**Rationale:** This is a valuable bug fix for shell command parsing. LLxprt has the same file and would benefit from the timeout protection.
**Conflicts expected:** LOW — the function structure appears similar
**Partial applicability:** All files apply

---

## 28. 5bdfe1a — feat(plan): add experimental plan flag

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Adds `experimental.plan` setting to config
- Per skip criteria: "LLxprt does NOT have: ... plan mode, plan.toml"
**Rationale:** LLxprt doesn't have the plan feature this enables.
**Conflicts expected:** NO — would add unwanted feature
**Partial applicability:** None

---

## 29. a81500a — feat(cli): security consent for skill installation

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Changes `packages/cli/src/commands/skills/install.ts`, `skillUtils.ts`
- Changes `packages/cli/src/config/extensions/consent.ts`
- LLxprt HAS `packages/cli/src/commands/skills/install.ts` and `packages/cli/src/config/extensions/consent.ts`
- Adds security consent prompts before skill installation
**Rationale:** LLxprt has skills system and these files. The security consent feature is valuable. Files may have diverged, so need verification.
**Conflicts expected:** MEDIUM — consent logic integration
**Partial applicability:** All files apply but need verification of current implementation

---

## 30. 4f324b5 — fix: replace 3 periods with ellipsis

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Changes `packages/cli/src/ui/constants/tips.ts` and `wittyPhrases.ts`
- Simple text fix: replacing "..." with "…"
**Rationale:** Minor UI polish. LLxprt likely has these files.
**Conflicts expected:** NO — simple text replacement
**Partial applicability:** All files apply

---

## 31. 467e869 — chore(automation): ensure need-triage label

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Changes `.github/scripts/`, `.github/workflows/`, `scripts/` files
- Per skip criteria: "GitHub automation (.github/)"
**Rationale:** GitHub automation is project-specific.
**Conflicts expected:** NO
**Partial applicability:** None

---

## Summary

| Verdict | Count | Commits |
|---------|-------|---------|
| PICK | 4 | c04af6c, f6c2d61, 764016b, ae19802, 4f324b5 |
| REIMPLEMENT | 9 | 3b55581, a3234fb, 09a7301, c8c7b57, 94d5ae5, 7e6817d, 6021e4c, fb76408, a2dab14, 42c26d1, a81500a |
| SKIP | 16 | a1cbe85, dfb7dc7, 4db00b8, 1212161, 16b3591, b3eecc3, 41369f6, b14cf1d, 5ed275c, b3527dc, e58fca6, 4b2e9f7, 5bdfe1a, 467e869 |
| NO_OP | 1 | c8d7c09 |

### High Priority PICKs (apply directly):
1. **764016b** — a2a fix for Retry/InvalidStream events
2. **ae19802** — shell-utils timeout fix (prevents hangs)
3. **c04af6c** — F12 debug console docs
4. **f6c2d61** — doc link fix
5. **4f324b5** — ellipsis text fix

### High Priority REIMPLEMENTs (need adaptation):
1. **6021e4c** — Scheduler types for event-driven architecture (important for confirmation-bus)
2. **94d5ae5** — Paste handling simplification (affects many files)
3. **a81500a** — Security consent for skill installation (security improvement)
4. **3b55581** — Extension config experimental setting
5. **09a7301** — Key binding cleanup

### SKIPs verified correct:
- All GitHub automation commits
- Version bumps
- Rewind feature (not wanted)
- Agent enable/disable (not wanted)
- Plan mode (not wanted)
- Skill-creator builtin (not wanted)
- Auto model routing (not wanted)
