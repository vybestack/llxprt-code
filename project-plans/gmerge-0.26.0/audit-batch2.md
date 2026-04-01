# Upstream Gemini-CLI Commit Audit - Batch 2 (Commits 32-62)

**Audit Date:** Generated automatically
**Auditor:** LLxprt Code Audit System
**Target:** LLxprt Code (multi-provider fork)

## Executive Summary

| Verdict | Count | Notes |
|---------|-------|-------|
| PICK | 8 | Clean cherry-pick candidates |
| REIMPLEMENT | 6 | Requires adaptation for LLxprt differences |
| SKIP | 17 | Not applicable to LLxprt (GitHub automation, upstream agents, version bumps) |
| NO_OP | 0 | N/A |

---

## 4848f42 — fix: Handle colons in skill description frontmatter

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:** 
- Files: `packages/core/src/skills/skillLoader.ts`, `packages/core/src/skills/skillLoader.test.ts`
- LLxprt skillLoader.ts exists at same path but uses simpler YAML parsing
- LLxprt uses basic `yaml.load()` without fallback parser
- Diff adds `parseFrontmatter()` with YAML fallback to `parseSimpleFrontmatter()`

**Rationale:** LLxprt has the skill system and the same file exists. The current LLxprt implementation is vulnerable to colons in descriptions breaking YAML parsing. This fix adds robustness with a fallback simple parser.

**Conflicts expected:** YES — LLxprt skillLoader.ts has different structure (simpler, no `parseFrontmatter` function yet). The new functions need to be added.

**Partial applicability:** All files apply.

---

## d0bbc7f — refactor(core): harden skill frontmatter parsing

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Files: `packages/core/src/skills/skillLoader.ts`, `packages/core/src/skills/skillLoader.test.ts`
- Builds on previous commit (4848f42)
- Improves regex matching for name/description fields to handle indentation and missing spaces

**Rationale:** This hardening is valuable for robustness and should be picked together with 4848f42. Handles edge cases like indented fields and missing spaces after colons.

**Conflicts expected:** YES — Depends on 4848f42 being applied first. The `parseSimpleFrontmatter` function must exist.

**Partial applicability:** All files apply.

---

## 222b739 — feat(skills): conflict detection for skill overrides

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Files: `packages/core/src/skills/skillManager.ts`, `packages/core/src/skills/skillManager.test.ts`
- LLxprt skillManager.ts has different `addSkillsWithPrecedence()` implementation
- LLxprt version is simpler: just iterates and sets in Map
- Diff adds conflict detection with `coreEvents.emitFeedback()` for warnings

**Rationale:** LLxprt has skillManager but with different implementation. The conflict detection feature is valuable but requires adaptation. LLxprt skillManager has additional methods for builtin skill discovery via config.json that upstream doesn't have. Need to integrate conflict detection into LLxprt's version while preserving LLxprt-specific functionality.

**Conflicts expected:** YES — Different `addSkillsWithPrecedence()` implementations. LLxprt has `isBuiltin` property check that upstream adds in this commit.

**Partial applicability:** All files apply but need manual merge.

---

## 409f9c8 — feat(scheduler): add SchedulerStateManager

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `packages/core/src/scheduler/state-manager.ts`, `packages/core/src/scheduler/state-manager.test.ts` (NEW FILES)
- LLxprt scheduler only has `tool-executor.ts` and `types.ts`
- Diff adds 482 lines of reactive state management with MessageBus integration

**Rationale:** Per audit criteria, "LLxprt scheduler: only tool-executor.ts + types.ts (no state-manager, confirmation, policy, scheduler modules)". This is a significant new module that LLxprt doesn't have the infrastructure for. The state manager depends on confirmation-bus patterns that may differ. Recommend deferring until LLxprt scheduler architecture is aligned.

**Conflicts expected:** N/A — New files not in LLxprt

**Partial applicability:** None — Entire module is new infrastructure

---

## 53f5443 — chore(automation): enforce help wanted label

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `.github/scripts/backfill-pr-notification.cjs`, `.github/workflows/label-enforcer.yml`, `.github/workflows/pr-contribution-guidelines-notifier.yml`, `CONTRIBUTING.md`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". This is pure GitHub workflow automation not applicable to LLxprt's repository.

**Conflicts expected:** NO

**Partial applicability:** None — GitHub automation only

---

## 448fd3c — fix(core): resolve circular dependency tsconfig

**Verdict:** PICK
**Confidence:** MEDIUM
**Evidence:**
- File: `packages/core/tsconfig.json`
- Diff adds compilerOptions.paths to resolve circular dependencies

**Rationale:** This is a tsconfig fix that may help with build issues. LLxprt has the same package structure, so this could be beneficial. However, need to verify if LLxprt has the same circular dependency issues.

**Conflicts expected:** YES — LLxprt tsconfig.json likely has different configuration

**Partial applicability:** Single file applies directly

---

## b0c9db7 — chore(release): bump to nightly

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `package.json`, `package-lock.json`, multiple `packages/*/package.json`

**Rationale:** Per SKIP criteria: "version bumps". This is purely version number changes for upstream nightly release.

**Conflicts expected:** NO

**Partial applicability:** None

---

## a8631a1 — fix(automation): correct label matching

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `.github/scripts/pr-triage.sh`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". Shell script for PR triage.

**Conflicts expected:** NO

**Partial applicability:** None

---

## d545a3b — fix(automation): prevent label-enforcer loop

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `.github/workflows/label-enforcer.yml`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". Workflow fix for GitHub label automation.

**Conflicts expected:** NO

**Partial applicability:** None

---

## fa39819 — Add links to supported locations (docs)

**Verdict:** SKIP
**Confidence:** MEDIUM
**Evidence:**
- Files: `docs/changelogs/releases.md`, `docs/cli/custom-commands.md`, `docs/cli/index.md`, `docs/cli/model-routing.md`, `docs/cli/sandbox.md`, `docs/local-development.md`, `docs/troubleshooting.md`

**Rationale:** Documentation updates. While some docs may be relevant, the changes reference Google-specific locations and Gemini-specific features (model-routing). LLxprt docs may have diverged. Recommend reviewing individually if docs are synced.

**Conflicts expected:** YES — Docs likely have LLxprt-specific changes

**Partial applicability:** Potentially some docs, but likely outdated for LLxprt context

---

## f909c9e — feat(policy): add source tracking to policy rules

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Files: `packages/core/src/policy/types.ts`, `packages/core/src/policy/config.ts`, `packages/core/src/policy/toml-loader.ts`, `packages/cli/src/ui/commands/policiesCommand.ts`
- LLxprt policy/types.ts exists but doesn't have `source` field
- LLxprt policy system appears simpler (no `modes` field observed)

**Rationale:** LLxprt has the policy engine. Adding source tracking helps with debugging where rules come from. LLxprt policy/types.ts is simpler but the `source?: string` field addition should be straightforward to integrate.

**Conflicts expected:** YES — Different policy types structure between upstream and LLxprt

**Partial applicability:** All files apply but need adaptation for LLxprt policy structure

---

## 2b6bfe4 — feat(automation): enforce maintainer only label

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `.github/workflows/label-enforcer.yml`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". Label enforcement workflow.

**Conflicts expected:** NO

**Partial applicability:** None

---

## f7f38e2 — Make merged settings non-nullable

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Files: 59 files including `packages/cli/src/config/settings.ts`, `packages/cli/src/config/settingsSchema.ts`
- LLxprt settings.ts has different structure (no MergedSettings type)
- LLxprt uses custom `mergeSettings()` function with different logic
- Upstream adds `MergedSettings` type with non-nullable fields

**Rationale:** This is a significant refactor making settings types stricter. LLxprt settings implementation differs (has multi-provider support, different merge logic). The concept of non-nullable merged settings is good, but implementing requires adapting LLxprt's different settings architecture.

**Conflicts expected:** YES — Major differences in settings implementation between upstream and LLxprt

**Partial applicability:** Concept applies, but implementation differs significantly

---

## 6740886 — fix(core): prevent ModelInfo emission on aborted signal

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Files: `packages/core/src/core/client.ts`, `packages/core/src/core/client.test.ts`
- Diff adds `if (!signal.aborted)` check before yielding ModelInfo event

**Rationale:** Simple bug fix preventing event emission on aborted requests. LLxprt core client should have similar code structure. This is a defensive fix that improves reliability.

**Conflicts expected:** YES — LLxprt client.ts may have provider-specific differences

**Partial applicability:** All files apply

---

## 9e13a43 — Replace relative paths for website build

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `docs/cli/telemetry.md`

**Rationale:** Documentation fix for website build. Telemetry docs are likely Google-specific.

**Conflicts expected:** NO

**Partial applicability:** None — Google-specific telemetry docs

---

## 5ba6e24 — Restricting to localhost (a2a)

**Verdict:** PICK
**Confidence:** HIGH
**Evidence:**
- Files: `packages/a2a-server/src/http/app.ts`, `packages/a2a-server/src/http/app.test.ts`
- LLxprt has a2a-server with same file structure
- Diff adds `'localhost'` parameter to `expressApp.listen()`
- Also adds `Number()` conversion for port

**Rationale:** Security fix to bind only to localhost. LLxprt a2a-server exists with similar structure. The change is straightforward: the listen call changes from `listen(port, callback)` to `listen(port, 'localhost', callback)`. LLxprt app.ts currently doesn't have the localhost restriction.

**Conflicts expected:** YES — Minor conflict, LLxprt app.ts may have slight differences in main() function

**Partial applicability:** All files apply

---

## c8670f8 — fix(cli): add explicit dependency on color-convert

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `packages/cli/package.json`, `package-lock.json`

**Rationale:** Adding explicit dependency. LLxprt has different package.json structure and dependency tree. This is likely specific to upstream's dependency resolution issues.

**Conflicts expected:** YES — Different package.json

**Partial applicability:** None — Dependency management differs

---

## 48fdb98 — fix(automation): robust label enforcement

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `.github/workflows/label-enforcer.yml`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". Workflow modification.

**Conflicts expected:** NO

**Partial applicability:** None

---

## e77d7b2 — fix(cli): prevent OOM crash file search traversal

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Files: `packages/core/src/utils/filesearch/crawler.ts`, `packages/core/src/utils/filesearch/fileSearch.ts`, `packages/cli/src/ui/hooks/useAtCompletion.ts`, `packages/core/src/config/config.ts`, `packages/core/src/config/constants.ts`
- LLxprt crawler.ts exists but is simpler (no maxFiles option)
- LLxprt doesn't have the `maxFiles` or `searchTimeout` options
- Diff adds file count limiting and timeout to prevent OOM

**Rationale:** Important bug fix for OOM prevention. LLxprt has the filesearch infrastructure but without the limiting features. Need to add `maxFiles` option to crawler and integrate with Config. LLxprt crawler.ts is simpler, so adding the filter logic should be straightforward.

**Conflicts expected:** YES — Different crawler.ts implementation

**Partial applicability:** All files apply but need adaptation

---

## b0d2ec5 — docs: clarify workspace test in GEMINI.md

**Verdict:** SKIP
**Confidence:** MEDIUM
**Evidence:**
- File: `GEMINI.md`

**Rationale:** Documentation for GEMINI.md. LLxprt likely doesn't have this file or has LLXPRT.md instead. Context is Gemini-specific testing.

**Conflicts expected:** YES — File may not exist in LLxprt

**Partial applicability:** None

---

## 8a627d6 — fix(cli): safely handle /dev/tty on macOS

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Files: `packages/cli/src/ui/utils/commandUtils.ts`, `packages/cli/src/ui/utils/commandUtils.test.ts`
- LLxprt has same file at same location
- LLxprt `pickTty()` is synchronous, upstream converts to async Promise
- Diff adds timeout handling and error event handling for /dev/tty

**Rationale:** Important fix for macOS /dev/tty access. LLxprt has the same clipboard/OSC52 code but the implementation differs. The upstream change makes `pickTty()` async with proper error handling. This needs careful reimplementation to preserve LLxprt's behavior while adding the safety features.

**Conflicts expected:** YES — Different pickTty() implementation

**Partial applicability:** All files apply

---

## 1e8f87f — Add support for running commands before MCP servers load

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Files: `packages/cli/src/ui/hooks/slashCommandProcessor.ts`, `packages/cli/src/ui/hooks/useGeminiStream.ts`, `packages/core/src/config/config.ts`, `packages/core/src/tools/mcp-client-manager.ts`
- Adds `MCPDiscoveryState` tracking and blocks queries until MCP servers load
- LLxprt has MCP infrastructure but may differ in details

**Rationale:** This feature improves UX by handling MCP server initialization state. LLxprt has MCP support but the implementation may differ. The core concept (discovery state tracking, waiting for MCP init) applies, but need to verify LLxprt's MCP architecture.

**Conflicts expected:** YES — Different MCP client manager implementation

**Partial applicability:** Concept applies, implementation needs adaptation

---

## 655ab21 — feat(plan): experimental plan approval mode

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `packages/cli/src/config/config.ts`, `packages/core/src/policy/types.ts`, `docs/get-started/configuration.md`
- Adds `ApprovalMode.PLAN` for read-only mode

**Rationale:** Per SKIP criteria: "plan mode, plan.toml". LLxprt doesn't have the plan mode feature. This is a new approval mode that requires plan infrastructure which LLxprt doesn't have.

**Conflicts expected:** N/A

**Partial applicability:** None — Feature not in LLxprt

---

## f367b95 — feat(scheduler): add functional awaitConfirmation

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `packages/core/src/scheduler/confirmation.ts`, `packages/core/src/scheduler/confirmation.test.ts` (NEW FILES)

**Rationale:** Per SKIP criteria: "LLxprt scheduler: only tool-executor.ts + types.ts (no state-manager, confirmation, policy, scheduler modules)". This adds a new scheduler module that LLxprt infrastructure doesn't support.

**Conflicts expected:** N/A — New files not in LLxprt

**Partial applicability:** None

---

## 8dde66c — fix(infra): update maintainer rollup label

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `.github/scripts/sync-maintainer-labels.cjs`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". Infrastructure script for label management.

**Conflicts expected:** NO

**Partial applicability:** None

---

## 420a419 — fix(infra): GraphQL direct parents

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `.github/scripts/sync-maintainer-labels.cjs`, `.github/workflows/label-workstream-rollup.yml`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". Infrastructure for PR labeling.

**Conflicts expected:** NO

**Partial applicability:** None

---

## c6cf3a4 — chore(workflows): rename label-workstream-rollup

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `.github/workflows/label-workstream-rollup.yml`

**Rationale:** Per SKIP criteria: "GitHub automation (.github/)". Workflow rename.

**Conflicts expected:** NO

**Partial applicability:** None

---

## 4bb817d — skip simple-mcp-server.test.ts

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- File: `integration-tests/simple-mcp-server.test.ts`

**Rationale:** Test skip modification. LLxprt may not have this integration test or it may differ. Minor test infrastructure change.

**Conflicts expected:** YES — Test may not exist in LLxprt

**Partial applicability:** None

---

## a159785 — Steer outer agent to use expert subagents

**Verdict:** SKIP
**Confidence:** HIGH
**Evidence:**
- Files: `evals/subagents.eval.ts`, `evals/test-helper.ts`, `packages/core/src/agents/local-executor.ts`, `packages/core/src/agents/registry.ts`

**Rationale:** Per SKIP criteria: "upstream agent system (no a2a-client-manager, delegate-to-agent-tool, local-executor, generalist-agent)". LLxprt doesn't have the upstream agent/subagent architecture.

**Conflicts expected:** N/A

**Partial applicability:** None — Agent system not in LLxprt

---

## cfdc4cf — Fix race condition awaiting scheduleToolCalls

**Verdict:** REIMPLEMENT
**Confidence:** MEDIUM
**Evidence:**
- Files: `packages/cli/src/ui/hooks/useGeminiStream.ts`, `packages/cli/src/ui/hooks/useReactToolScheduler.ts`, `packages/cli/src/ui/hooks/useToolScheduler.test.ts`
- Changes `scheduleToolCalls` from sync void to async Promise<void>
- LLxprt has same hooks but implementation may differ

**Rationale:** Race condition fix is important. The change makes scheduling properly async. LLxprt has similar hook infrastructure but need to verify the exact implementation matches. The concept (awaiting tool scheduling) definitely applies.

**Conflicts expected:** YES — Hook implementations may differ

**Partial applicability:** All files apply with adaptation

---

## ce35d84 — cleanup: Organize key bindings

**Verdict:** REIMPLEMENT
**Confidence:** HIGH
**Evidence:**
- Files: `packages/cli/src/config/keyBindings.ts`, `docs/cli/keyboard-shortcuts.md`
- LLxprt keyBindings.ts has different Command enum values
- LLxprt uses different command names (e.g., `TOGGLE_TODO_DIALOG` vs `SHOW_FULL_TODOS`)
- LLxprt has additional commands like `REFRESH_KEYPRESS`, `TOGGLE_MOUSE_EVENTS`

**Rationale:** The reorganization of key bindings into categories is nice, but LLxprt has diverged with different command names and additional commands. LLxprt has `TOGGLE_TODO_DIALOG`, `TOGGLE_TOOL_DESCRIPTIONS`, `REFRESH_KEYPRESS`, `TOGGLE_MOUSE_EVENTS` that upstream doesn't have. The category reorganization could be adopted, but need to preserve LLxprt-specific commands.

**Conflicts expected:** YES — Major differences in Command enum

**Partial applicability:** Concept applies, but LLxprt has additional commands to preserve

---

## Summary Table

| # | SHA | Subject | Verdict | Confidence |
|---|-----|---------|---------|------------|
| 1 | 4848f42 | Handle colons in skill description frontmatter | PICK | HIGH |
| 2 | d0bbc7f | Harden skill frontmatter parsing | PICK | HIGH |
| 3 | 222b739 | Conflict detection for skill overrides | REIMPLEMENT | HIGH |
| 4 | 409f9c8 | Add SchedulerStateManager | SKIP | HIGH |
| 5 | 53f5443 | Enforce help wanted label | SKIP | HIGH |
| 6 | 448fd3c | Resolve circular dependency tsconfig | PICK | MEDIUM |
| 7 | b0c9db7 | Bump to nightly | SKIP | HIGH |
| 8 | a8631a1 | Correct label matching | SKIP | HIGH |
| 9 | d545a3b | Prevent label-enforcer loop | SKIP | HIGH |
| 10 | fa39819 | Add links to supported locations | SKIP | MEDIUM |
| 11 | f909c9e | Add source tracking to policy rules | REIMPLEMENT | HIGH |
| 12 | 2b6bfe4 | Enforce maintainer only label | SKIP | HIGH |
| 13 | f7f38e2 | Make merged settings non-nullable | REIMPLEMENT | MEDIUM |
| 14 | 6740886 | Prevent ModelInfo emission on aborted signal | PICK | HIGH |
| 15 | 9e13a43 | Replace relative paths for website build | SKIP | HIGH |
| 16 | 5ba6e24 | Restricting to localhost (a2a) | PICK | HIGH |
| 17 | c8670f8 | Add explicit dependency on color-convert | SKIP | HIGH |
| 18 | 48fdb98 | Robust label enforcement | SKIP | HIGH |
| 19 | e77d7b2 | Prevent OOM crash file search traversal | REIMPLEMENT | HIGH |
| 20 | b0d2ec5 | Clarify workspace test in GEMINI.md | SKIP | MEDIUM |
| 21 | 8a627d6 | Safely handle /dev/tty on macOS | REIMPLEMENT | HIGH |
| 22 | 1e8f87f | Commands before MCP servers load | REIMPLEMENT | MEDIUM |
| 23 | 655ab21 | Experimental plan approval mode | SKIP | HIGH |
| 24 | f367b95 | Add functional awaitConfirmation | SKIP | HIGH |
| 25 | 8dde66c | Update maintainer rollup label | SKIP | HIGH |
| 26 | 420a419 | GraphQL direct parents | SKIP | HIGH |
| 27 | c6cf3a4 | Rename label-workstream-rollup | SKIP | HIGH |
| 28 | 4bb817d | Skip simple-mcp-server.test.ts | SKIP | HIGH |
| 29 | a159785 | Steer outer agent to use expert subagents | SKIP | HIGH |
| 30 | cfdc4cf | Fix race condition awaiting scheduleToolCalls | REIMPLEMENT | MEDIUM |
| 31 | ce35d84 | Organize key bindings | REIMPLEMENT | HIGH |

---

## Recommendations

### High Priority PICKs (Clean Cherry-picks)
1. **4848f42 + d0bbc7f** — Skill frontmatter parsing fixes (apply together)
2. **6740886** — ModelInfo abort signal fix
3. **5ba6e24** — a2a localhost restriction (security)
4. **448fd3c** — tsconfig circular dependency fix (may help builds)

### REIMPLEMENT Priority Order
1. **e77d7b2** — OOM crash fix (stability)
2. **222b739** — Skill conflict detection (user-facing feature)
3. **8a627d6** — /dev/tty macOS fix (platform support)
4. **cfdc4cf** — Race condition fix (correctness)
5. **f909c9e** — Policy source tracking (debugging)
6. **f7f38e2** — Non-nullable settings (type safety, large effort)
7. **1e8f87f** — MCP initialization handling
8. **ce35d84** — Key bindings reorganization (lower priority, cosmetic)

### SKIP Rationale Summary
- **GitHub automation** (10 commits): `.github/` workflows and scripts
- **Version bumps** (1 commit): Nightly release
- **Upstream agent system** (2 commits): LLxprt doesn't have this architecture
- **Scheduler infrastructure** (2 commits): LLxprt has minimal scheduler
- **Plan mode** (1 commit): Feature not in LLxprt
- **Docs** (2 commits): Gemini/Google-specific

---

## Dependency Graph

```
4848f42 (skill colons) ──► d0bbc7f (harden parsing) ──► 222b739 (conflict detection)

f7f38e2 (non-nullable settings) ──► may affect other settings consumers

cfdc4cf (race condition fix) ──► may conflict with 1e8f87f (MCP init)
```

---

## Notes for Implementation

1. **Skill Loader Changes (4848f42, d0bbc7f, 222b739)**: Apply in order. The conflict detection (222b739) depends on `isBuiltin` property which needs to be added to LLxprt's skill types.

2. **Settings Refactor (f7f38e2)**: This is a large change (59 files). Consider deferring or breaking into smaller pieces. LLxprt's multi-provider settings (providerKeyfiles, oauthEnabledProviders) must be preserved.

3. **File Search OOM (e77d7b2)**: Requires adding `maxFiles` and `searchTimeout` to Config and crawler. Straightforward addition.

4. **a2a Localhost (5ba6e24)**: Simple security fix, highly recommended.

5. **Key Bindings (ce35d84)**: LLxprt has custom commands (`TOGGLE_TODO_DIALOG`, `TOGGLE_MOUSE_EVENTS`, `REFRESH_KEYPRESS`) that must be preserved if adopting the reorganization.
