# Upstream Gemini-CLI Commit Audit — Batch 3 (Commits 63-93)

**Audit Date:** 2026-03-24
**Auditor:** Manual (coordinator) — codeanalyzer subagent failed due to auth errors
**Method:** git show --stat + targeted diff review + LLxprt file existence checks

---

## fcd860e — feat(core): Add generalist agent
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Creates `generalist-agent.ts`, modifies `registry.ts`, `config.ts`, `prompts.ts`, `settingsSchema.ts`
**Rationale:** Upstream agent architecture — LLxprt has own subagent system, no generalist-agent.ts
**Conflicts expected:** NO | **Partial applicability:** None

## be37c26 — perf(ui): optimize text buffer and highlighting for large inputs
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `text-buffer.ts`, `highlight.ts`, `textUtils.ts`, `LruCache.ts` (all exist in LLxprt). Adds performance tests. Enhances LruCache with TTL support.
**Rationale:** Performance improvement for large inputs. All files exist in LLxprt. Note: later commit f2d3b76 removes LruCache for mnemoist (which we'll SKIP), so this enhancement stays.
**Conflicts expected:** YES — text-buffer.ts may have minor divergence | **Partial applicability:** All files apply

## 013a4e0 — fix(core): fix PTY descriptor shell leak
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `shellExecutionService.ts` and `shell-utils.ts` (both exist in LLxprt). Adds proper fd cleanup and leak detection tests.
**Rationale:** Important bug fix preventing file descriptor leaks in PTY operations.
**Conflicts expected:** LOW | **Partial applicability:** All files apply

## 5241174 — feat(plan): enforce strict read-only policy and halt execution on violation
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Creates `plan.toml`, modifies `coreToolScheduler.ts` for plan mode
**Rationale:** LLxprt has no plan mode or plan.toml. The coreToolScheduler changes are plan-specific.
**Conflicts expected:** NO | **Partial applicability:** None

## 59da616 — remove need-triage label from bug_report template
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** `.github/ISSUE_TEMPLATE/bug_report.yml`
**Rationale:** GitHub automation
**Conflicts expected:** NO | **Partial applicability:** None

## 42fd647 — fix(core): truncate large telemetry log entries
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Modifies `telemetry/semantic.ts` (does NOT exist in LLxprt) and `textUtils.ts`
**Rationale:** LLxprt doesn't have telemetry/semantic.ts. The textUtils.ts additions (truncateMiddle) could be useful standalone but are primarily for telemetry.
**Conflicts expected:** NO | **Partial applicability:** textUtils.ts has useful utility, but primary file missing

## 063f0d0 — docs(extensions): add Agent Skills support and mark feature as experimental
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Docs-only changes for upstream Agent Skills feature
**Rationale:** Upstream feature documentation not applicable to LLxprt
**Conflicts expected:** NO | **Partial applicability:** None

## 9722ec9 — fix(core): surface warnings for invalid hook event names in configuration
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `hookRegistry.ts` and `hooks/types.ts` (both exist in LLxprt). Adds `HOOK_EVENTS` set and validation of event names.
**Rationale:** Valuable validation improvement for hooks system. LLxprt has the full hooks system with hookRegistry.ts.
**Conflicts expected:** LOW — types.ts additions are additive | **Partial applicability:** All files apply

## 93224e1 — feat(plan): remove read_many_files from approval mode policies
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Modifies `plan.toml` and `read-only.toml`
**Rationale:** plan.toml doesn't exist in LLxprt. read-only.toml change is plan-mode specific.
**Conflicts expected:** NO | **Partial applicability:** None

## d8d4d87 — feat(admin): implement admin controls polling and restart prompt
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Creates `admin_controls.ts`, `AdminSettingsChangedDialog.tsx`. Adds admin polling, experiment flags.
**Rationale:** Google enterprise admin controls not in LLxprt
**Conflicts expected:** NO | **Partial applicability:** None

## f2d3b76 — Remove LRUCache class migrating to mnemoist
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Removes `LruCache.ts`, replaces with `mnemoist` library imports. LLxprt does NOT have mnemoist.
**Rationale:** LLxprt still uses LruCache. Mnemoist not installed. Would break LruCache dependents.
**Conflicts expected:** N/A | **Partial applicability:** None

## 608da23 — feat(settings): rename negative settings to positive naming (disable* -> enable*)
**Verdict:** REIMPLEMENT | **Confidence:** HIGH
**Evidence:** 22+ files modified. Renames `disableAutoUpdater`→`enableAutoUpdater`, `disableColors`→`enableColors`, etc. Adds migration layer in settings.ts.
**Rationale:** Significant settings UX improvement with migration for backward compatibility. LLxprt settings have diverged (multi-provider settings), so direct cherry-pick won't work. Need to adapt the rename + migration pattern for LLxprt's settings.
**Conflicts expected:** YES — extensive | **Partial applicability:** Concept applies, implementation differs

## 1681ae1 — refactor(cli): unify shell confirmation dialogs
**Verdict:** REIMPLEMENT | **Confidence:** MEDIUM
**Evidence:** Removes ShellConfirmationDialog (which LLxprt HAS), unifies into ToolConfirmationMessage. Changes slashCommandProcessor to use new dialog flow.
**Rationale:** Good refactoring but LLxprt's dialog/confirmation architecture may differ. Need careful merge.
**Conflicts expected:** YES — UI architecture differences | **Partial applicability:** Most files apply

## 272570c — feat(agent): enable agent skills by default
**Verdict:** REIMPLEMENT | **Confidence:** MEDIUM
**Evidence:** Adds `skills-backward-compatibility.test.ts`, modifies `settingsSchema.ts` and `config.ts` for skills default enabled. Also adds `generate-settings-doc.ts` changes.
**Rationale:** LLxprt has skills but the settings integration with "agent skills" concept differs. The backward compatibility migration is useful but needs adaptation.
**Conflicts expected:** YES — settings schema differs | **Partial applicability:** Concept applies

## ee8d425 — refactor(core): foundational truncation refactoring and token estimation optimization
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `tool-executor.ts`, `fileUtils.ts`, `tokenCalculation.ts` (all exist in LLxprt scheduler). Refactors truncation into reusable functions.
**Rationale:** LLxprt has all three files. Truncation improvements benefit tool output handling.
**Conflicts expected:** MEDIUM — tool-executor.ts may have diverged | **Partial applicability:** All files apply

## 1998a71 — fix(hooks): enable /hooks disable to reliably stop single hooks
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `hooksCommand.ts` and `config.ts` (both exist). Fixes individual hook disable by storing disabled hook names properly.
**Rationale:** Bug fix for hooks command. LLxprt has full hooks system with these files.
**Conflicts expected:** MEDIUM — config.ts has diverged | **Partial applicability:** All files apply

## e030426 — Don't commit unless user asks us to
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Adds one line to prompts.ts: `- NEVER stage or commit changes, unless explicitly instructed to.` Plus eval test.
**Rationale:** Important behavioral improvement for prompts.ts. Eval file won't apply but prompt change does.
**Conflicts expected:** LOW — single line addition | **Partial applicability:** prompts.ts applies, evals don't

## a769461 — chore: remove a2a-adapter and bump @a2a-js/sdk to 0.3.8
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Removes `a2a-client-manager.ts` and `a2a-client-manager.test.ts`. LLxprt doesn't have these files.
**Rationale:** Files being removed don't exist in LLxprt.
**Conflicts expected:** NO | **Partial applicability:** package.json version bumps could apply if a2a-server aligns

## 86dbf20 — fix: Show experiment values in settings UI for compressionThreshold
**Verdict:** REIMPLEMENT | **Confidence:** MEDIUM
**Evidence:** Modifies `SettingsDialog.tsx`, `settingsUtils.ts`, `core/index.ts`, `config.ts`. Adds experiment value display.
**Rationale:** LLxprt has SettingsDialog but it may have diverged. The concept of showing experiment values is useful.
**Conflicts expected:** YES — SettingsDialog.tsx likely diverged | **Partial applicability:** settingsUtils.ts additions may apply

## 6900253 — feat(cli): replace relative keyboard shortcuts link with web URL
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `Help.tsx` (exists in LLxprt) to use URL constant instead of relative path. Adds `KEYBOARD_SHORTCUTS_URL` to constants.ts.
**Rationale:** Simple UI improvement. File exists. Change is minimal.
**Conflicts expected:** LOW | **Partial applicability:** All files apply (needs LLxprt URL)

## 41e01c2 — fix(core): resolve PKCE length issue and stabilize OAuth redirect port
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `mcp/oauth-provider.ts` (exists in LLxprt). Fixes PKCE code verifier length and stabilizes OAuth port.
**Rationale:** MCP OAuth security fix. File exists in LLxprt.
**Conflicts expected:** LOW | **Partial applicability:** All files apply

## 20580d7 — Delete rewind documentation for now
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Removes `docs/cli/rewind.md`. LLxprt doesn't have rewind.
**Rationale:** File doesn't exist in LLxprt.
**Conflicts expected:** NO | **Partial applicability:** None

## 9d9e3d1 — Stabilize skill-creator CI and package format
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Modifies skill-creator integration tests and CJS scripts. LLxprt has no builtin skills.
**Rationale:** Skill-creator not in LLxprt.
**Conflicts expected:** NO | **Partial applicability:** None

## 203f520 — Stabilize the git evals
**Verdict:** REIMPLEMENT | **Confidence:** MEDIUM
**Evidence:** Modifies `prompts.ts` (adds `git --no-pager` guidance, expands "don't commit" text). Also modifies evals and test-rig.
**Rationale:** prompts.ts improvements are valuable (git --no-pager, clearer commit rules). Evals/test-rig don't apply. Should REIMPLEMENT to get the prompts.ts changes only.
**Conflicts expected:** LOW for prompts.ts | **Partial applicability:** prompts.ts applies, evals/test-rig don't

## 08c32f7 — fix(core): attempt compression before context overflow check
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Modifies `chatCompressionService.ts` (does NOT exist in LLxprt) and `client.ts`
**Rationale:** LLxprt has its own compression system (core/compression/). chatCompressionService.ts doesn't exist.
**Conflicts expected:** N/A | **Partial applicability:** None

## d87a3ac — Fix inverted logic
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Only modifies `evals/gitRepo.eval.ts`
**Rationale:** Evals-only change.
**Conflicts expected:** NO | **Partial applicability:** None

## d079b7a — chore(scripts): add duplicate issue closer script and fix lint errors
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Scripts for issue management
**Rationale:** Project-specific scripts.
**Conflicts expected:** NO | **Partial applicability:** None

## a4eb04b — docs: update README and config guide to reference Gemini 3
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** README and docs reference Gemini 3
**Rationale:** Gemini branding, LLxprt has own README.
**Conflicts expected:** NO | **Partial applicability:** None

## 4cfbe4c — fix(cli): correct Homebrew installation detection
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `installationInfo.ts` and tests (exist in LLxprt). Fixes Homebrew detection on macOS.
**Rationale:** Platform bug fix. Files exist in LLxprt.
**Conflicts expected:** LOW | **Partial applicability:** All files apply

## 49769152 — Demote git evals to nightly run
**Verdict:** SKIP | **Confidence:** HIGH
**Evidence:** Only modifies `evals/gitRepo.eval.ts`
**Rationale:** Evals-only change.
**Conflicts expected:** NO | **Partial applicability:** None

## d8a8b43 — fix(cli): use OSC-52 clipboard copy in Windows Terminal
**Verdict:** PICK | **Confidence:** HIGH
**Evidence:** Modifies `commandUtils.ts` and tests (exist in LLxprt). Fixes clipboard in Windows Terminal.
**Rationale:** Platform bug fix for Windows. Files exist in LLxprt.
**Conflicts expected:** LOW | **Partial applicability:** All files apply

---

## Summary

| Verdict | Count |
|---------|-------|
| PICK | 10 |
| REIMPLEMENT | 5 |
| SKIP | 16 |
| NO_OP | 0 |
