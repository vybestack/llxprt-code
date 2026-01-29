# Audit: v0.12.0 → v0.13.0 Reconciliation

## Summary

| Decision | Count |
|----------|-------|
| PICKED | 0 |
| REIMPLEMENTED | 0 |
| SKIPPED | 55 |
| PENDING | 71 |
| **Total** | 126 |

---

## PICKED Commits

| Upstream SHA | LLxprt Commit(s) | Subject | Notes |
|--------------|------------------|---------|-------|
| | | | |

---

## REIMPLEMENTED Commits

| Upstream SHA | LLxprt Commit(s) | Subject | Adaptations |
|--------------|------------------|---------|-------------|
| | | | |

---

## SKIPPED Commits

| Upstream SHA | Subject | Reason |
|--------------|---------|--------|
| `5d87a7f9` | Remove Todo Icon (#12190) | LLxprt different todo |
| `372b5887` | chore(release): bump version to 0.13.0-nightly.20251029.cca41edc | Version bump |
| `b31b786d` | refactor: Replace console.error with structured logging and feedback | LLxprt DebugLogger |
| `121732dd` | Hide collapsed Todo tray when they're all done. | LLxprt different todo |
| `2e003ad8` | refactor(todo): improve performance and readability of todo component | LLxprt different todo |
| `66e981ed` | feat(telemetry): Add auth_type to StartSessionEvent OTel logging | ClearcutLogger |
| `36207abe` | feat(telemetry): Add extensions to StartSessionEvent telemetry | ClearcutLogger |
| `6c8a48db` | feat(ui): Fix Todo item text color not propagating for custom themes | LLxprt different todo |
| `06035d5d` | feat(auth): improve API key authentication flow | Gemini-specific, LLxprt multi-provider |
| `167b6ff8` | chore: migrate console.error to debugLogger in useSlashCompletion | LLxprt DebugLogger |
| `42c79c64` | fix(core): Add rootDir to tsconfig.json to resolve TS5055 error | Reverted in next commit |
| `4d2a2de5` | Docs: add v.0.11.0 to changelog | Gemini-cli changelog |
| `2a3244b1` | Log extension ID with tool call/slash command invocation | ClearcutLogger |
| `054b4307` | Revert tsconfig rootDir change | Revert of reverted commit |
| `135d981e` | Create line change metrics | ClearcutLogger |
| `c6a7107f` | fixing minor formatting issues in quota-and-pricing.md | Gemini-specific doc |
| `643f2c09` | Enable model routing for all users | NO - LLxprt no model routing |
| `3332703f` | Make compression threshold editable in the UI | LLxprt ephemeral system |
| `59e00eed` | Remove context percentage in footer by default | LLxprt no context % |
| `c89bc30d` | Code review script for regressions | .gemini/ commands |
| `db37c715` | chore/release: bump version to 0.13.0-nightly.20251031.c89bc30d | Version bump |
| `f566df91` | feat: add dynamic run-names to patch release workflows | GitHub workflows |
| `e762cda5` | fix: Address silent failure in release-patch-1-create-pr workflow | GitHub workflows |
| `12472ce9` | refactor(core): Refactored and removed redundant test lines in teleme | ClearcutLogger tests |
| `236334d0` | feat(telemetry): Add extension name to ToolCallEvent telemetry | ClearcutLogger |
| `6f69cdcc` | chore: make clear that --model is for choosing model on startup | Minor clarification |
| `9da3cb7e` | fix(core): remove duplicate session_id in GCP log exporter | Google telemetry |
| `b31f6804` | chore: migrate console.error to debugLogger in usePromptCompletion | LLxprt DebugLogger |
| `11e1e980` | fix(core): ensure loop detection respects session disable flag | LLxprt ephemeral config |
| `d13482e8` | Mark model.compressionThreshold as requiring a restart | LLxprt ephemerals no restart |
| `31c5761e` | refactor: simplify daily quota error messages | Gemini-specific |
| `ab013fb7` | migrating console.error to debugger for installationManager | LLxprt DebugLogger |
| `e9c7a80b` | migrate console.error to coreEvents for mcp-client-manager | LLxprt DebugLogger |
| `35f091bb` | feat(telemetry) - Add metric for slow rendering | ClearcutLogger |
| `fd2cbaca` | fix(core): prevent model router from overriding explicit model choice | NO - LLxprt no model routing |
| `b3cc397a` | feat(triage): overhaul automated issue triage workflow | gemini-automated-issue-triage.yml |
| `59e0b10e` | Cap Thinking Budget to prevent runaway thought loops | LLxprt configurable reasoning |
| `265f24e5` | fix(ui): ensure model changes update the UI immediately | LLxprt different model handling |
| `1c185524` | Enforce timeout for subagents | LLxprt different subagent arch |
| `60973aac` | Grants subagent a recovery turn | LLxprt different subagent → Issue #1133 |
| `be1dc13b` | feat(core): Add support for listing experiments | ClearcutLogger |
| `7a515339` | Log recovery events (nudges) that happens inside the subagent | ClearcutLogger |
| `60d2c2cc` | Enable WriteTodos tool by default | LLxprt different todo |
| `1671bf77` | Alt buffer default | Handled in 4fc9b1cd |
| `f3759381` | feat(core): add timeout to llm edit fix | Smart Edit removed |
| `2b77c1de` | SI prompt nudge for the todo tool | LLxprt different todo |
| `b6524e41` | migrate console.error to coreEvents/debugger | LLxprt DebugLogger |
| `53c7646e` | enable codebase investigator by default for preview | Google preview |
| `da3da198` | feat(core): Integrate remote experiments configuration | Google experiments |
| `25d7a803` | chore(release): v0.13.0-preview.0 | Version bump |
| `13b443af` | chore(release): v0.13.0-preview.1 | Version bump |
| `37670fe6` | chore(release): v0.13.0-preview.2 | Version bump |
| `be36bf61` | fix(patch): cherry-pick todo settings fix | LLxprt different todo |
| `230056cc` | chore(release): v0.13.0-preview.3 | Version bump |
| `72e48451` | chore(release): v0.13.0 | Version bump |

---

## Pending Commits (63 PICK + 8 REIMPLEMENT)

*Will be updated as batches complete*
