# Cherry-Pick Decisions: v0.22.0 -> v0.23.0 (AUDIT-REVISED)

**Total commits in range:** 70
**Decision counts:** PICK 20 (29%) . SKIP 33 (47%) . REIMPLEMENT 13 (18%) . NO_OP 4 (6%)

---

## Decision Notes

### 1. Release / CI / Version Bumps (11 SKIP)
4 nightly version bumps, 7 preview releases, and the final v0.23.0 release commit. Version-only changes with no functional code.

### 2. Gemini 3 Flash Launch + Model Infrastructure (5 SKIP)
`bf90b599` is the Gemini 3 Flash launch (65 files) with model availability, routing, fallback, default model configs, policy catalog, and Gemini-specific UI. Dependent commits: `b465e127` (remove availability toggle), `de7e1937` (late-resolve GenerateContentConfig), `a6d1245a` (previewFeatures remote flag), `bf6d0485` (remove legacy fallback flags). LLxprt has none of this infrastructure.

### 3. FlashFallback / Quota Fallback (1 SKIP)
`42a36294` patches `useQuotaAndFallback` and `flashFallback.test.ts`, both of which were already removed from LLxprt.

### 4. ClearcutLogger / Google Telemetry (2 SKIP)
`5d131459` (Code Assist accept/reject telemetry) and `b9236046` (clearcut logging for hooks). All ClearcutLogger code is excluded per telemetry policy.

### 5. Gemini-Specific Docs/Commands (3 SKIP)
`088f48d6` adds `.gemini/commands/core.toml` (Gemini-specific command file). `b828b475` documents `GEMINI_SYSTEM_MD`. `c28ff3d5` is the Gemini changelog.

### 6. Agent Framework Divergence (3 SKIP)
`d02f3f68` (executor rename + remote agent infrastructure), `2b426c1d` (agent TOML parser), `edab9799` (remove unused code depending on executor rename). Upstream agent framework is incompatible with LLxprt SubagentOrchestrator architecture. Tracked as future issue for A2A remote agents.

### 7. Introspection Agent (1 SKIP)
`10ba348a` adds a demo introspection agent with `get-internal-docs` tool and build script changes to bundle Gemini documentation. Gemini-specific demo.

### 8. Seasonal Feature (1 SKIP)
`bc40695c` patches snowfall/header seasonal holiday feature.

### 9. Sensitive Keywords (1 SKIP)
`60f0f19d` adds "3.0" to the Gemini-specific sensitive keyword linter in `scripts/lint.js`.

### 10. GitHub Workflow (1 SKIP)
`18698d69` automated PR labeller specific to the gemini-cli repository.

### 11. Google-Internal Telemetry (2 SKIP)
`5e21c8c0` adds Code Assist service metrics (Google-internal telemetry). `7b772e9d` patches startupProfiler.ts which does not exist in LLxprt.

### 12. Auth Logout (1 SKIP)
`80c42252` adds `/auth logout` command. LLxprt already has a superior multi-provider `/auth logout` implementation.

### 13. Security: Hook Injection Fix (CRITICAL REIMPLEMENT)
`41a1a3ee` sanitizes hook command expansion to prevent command injection via `$LLXPRT_PROJECT_DIR`. Reimplemented because the hook infrastructure has diverged but the vulnerability exists in LLxprt.

### 14. Security: Permanent Tool Approval Gate (PICK)
`419464a8` gates the "save to policy" / "Allow for all future sessions" feature behind an opt-in setting (off by default). LLxprt currently has this dangerous feature ungated.

### 15. Already Done in LLxprt (4 NO_OP)
`ba100642` (ACP SDK -- already migrated to v0.14.1), `9e6914d6` (429 handling -- already have identical implementation), `7da060c1` (hooks docs -- our api-reference.md is already more comprehensive at 623 vs 168 lines), `8feeffb2` (relaunch loop -- LLxprt uses exit code 75 + LLXPRT_CODE_NO_RELAUNCH guard so the bug does not apply).

---

## PICK (20 commits)

| # | SHA | Date | Areas | Rationale | Subject |
|---|-----|------|-------|-----------|---------|
| 1 | `db643e9166` | 2025-12-16 | cli/themes | Remove hardcoded foreground colors for terminal compat | Remove foreground for themes other than shades of purple and holiday. |
| 2 | `26c115a4fb` | 2025-12-16 | cli/ui | Remove repo-specific tips | chore: remove repo specific tips |
| 3 | `3e9a0a7628` | 2025-12-16 | cli/ui | Remove redundant debug footer message | chore: remove user query from footer in debug mode |
| 4 | `7f2d33458a` | 2025-12-16 | eslint, cli, core | Code quality: no-return-await rule | Disallow unnecessary awaits. |
| 5 | `da85aed5aa` | 2025-12-17 | cli/ui | Settings dialog flicker fix (DIALOG_PADDING 4->5) | Add one to the padding in settings dialog to avoid flicker. |
| 6 | `948401a450` | 2025-12-17 | a2a-server | Dependency update @a2a-js/sdk 0.3.2->0.3.7 | chore: update a2a-js to 0.3.7 |
| 7 | `3d486ec1bf` | 2025-12-17 | cli/utils | Windows clipboard image + Alt+V paste | feat(ui): add Windows clipboard image support and Alt+V paste workaround |
| 8 | `bc168bbae4` | 2025-12-17 | cli/ui | New shared Table component; fixes layout with long model names | Change detailed model stats to use a new shared Table class to resolve robustness issues. |
| 9 | `0c4fb6afd2` | 2025-12-18 | package.json | Remove unnecessary dependencies | Remove unnecessary dependencies |
| 10 | `1e10492e55` | 2025-12-18 | cli/ui | Bug fix: infinite loop in prompt completion | fix: prevent infinite loop in prompt completion on error |
| 11 | `e0f1590850` | 2025-12-18 | cli/ui | Simplify tool confirmation labels | feat: simplify tool confirmation labels for better UX |
| 12 | `419464a8c2` | 2025-12-19 | cli/ui, schemas | SECURITY: gate "save to policy" behind opt-in setting | feat(ui): Put "Allow for all future sessions" behind a setting off by default. |
| 13 | `181da07dd9` | 2025-12-19 | cli/ui | Shell mode input placeholder | fix(cli): change the placeholder of input during the shell mode |
| 14 | `9383b54d50` | 2025-12-19 | core/mcp | Security: validate OAuth resource matches MCP URL | Validate OAuth resource parameter matches MCP server URL |
| 15 | `db67bb106a` | 2025-12-19 | core/utils | More robust bash command parsing debug logs | more robust command parsing logs |
| 16 | `8ed0f8981f` | 2025-12-19 | cli/config | Security: validate trusted folder level | fix(folder trust): add validation for trusted folder level |
| 17 | `6084708cc2` | 2025-12-19 | cli/ui | Fix right border overflow in trust dialogs | fix(cli): fix right border overflow in trust dialogs |
| 18 | `e64146914a` | 2025-12-19 | core/tools | Fix accepting-edits policy bug (skip smart-edit.ts -- removed in LLxprt) | fix(policy): fix bug where accepting-edits continued after it was turned off |
| 19 | `703d2e0dcc` | 2025-12-26 | core/policy, tools | Patch: policy persistence, confirmation-bus, shell fixes | fix(patch): cherry-pick 37be162 ... version 0.23.0-preview.3 |
| 20 | `17fb758664` | 2026-01-06 | core, eslint | Patch: token calculation + eslint + client fix | fix(patch): cherry-pick c31f053 ... version 0.23.0-preview.5 |

---

## SKIP (33 commits)

| # | SHA | Date | Areas | Rationale | Subject |
|---|-----|------|-------|-----------|---------|
| 1 | `5e21c8c03c` | 2025-12-16 | core | SKIP: Google-internal Code Assist telemetry | Code assist service metrics |
| 2 | `e79b149985` | 2025-12-16 | release | SKIP: Nightly version bump | chore/release: bump version to 0.21.0-nightly.20251216 |
| 3 | `d02f3f6809` | 2025-12-17 | core/agents | SKIP: Incompatible agent framework; filed as future A2A issue | feat(core): introduce remote agent infrastructure and rename local executor |
| 4 | `80c4225286` | 2025-12-18 | cli/ui | SKIP: LLxprt already has superior multi-provider /auth logout | feat(cli): Add /auth logout command to clear credentials and auth state |
| 5 | `18698d6929` | 2025-12-17 | .github | SKIP: Gemini-cli GitHub workflow | Automated pr labeller |
| 6 | `bf90b59935` | 2025-12-17 | cli, core, docs | SKIP: Gemini 3 Flash launch (65 files, Gemini-specific) | feat: launch Gemini 3 Flash in Gemini CLI |
| 7 | `b465e12747` | 2025-12-17 | cli, core, schemas | SKIP: Gemini model availability toggle | chore(core): remove redundant isModelAvailabilityServiceEnabled |
| 8 | `de7e1937f6` | 2025-12-17 | core | SKIP: Gemini-specific GenerateContentConfig | feat(core): Late resolve GenerateContentConfig |
| 9 | `a6d1245a54` | 2025-12-17 | core/config | SKIP: Gemini-specific remote flags | Respect previewFeatures value from the remote flag if undefined |
| 10 | `bf6d0485ce` | 2025-12-17 | core, docs | SKIP: FlashFallback already removed from LLxprt | chore(core): remove legacy fallback flags and migrate loop detection |
| 11 | `c28ff3d5a5` | 2025-12-17 | docs | SKIP: Gemini changelog | Docs: Update Changelog for Dec 17, 2025 |
| 12 | `5d13145995` | 2025-12-17 | cli, core | SKIP: ClearcutLogger telemetry | Code Assist backend telemetry for user accept/reject |
| 13 | `124a6da743` | 2025-12-17 | release | SKIP: Nightly version bump | chore/release: bump version to 0.21.0-nightly.20251218 |
| 14 | `2b426c1d91` | 2025-12-17 | cli, core, schemas | SKIP: Incompatible agent framework; depends on skipped executor rename | feat: add agent toml parser |
| 15 | `088f48d60f` | 2025-12-18 | .gemini | SKIP: Gemini-specific command file | Add core tool that adds all context from the core package. |
| 16 | `60f0f19d76` | 2025-12-18 | scripts | SKIP: Gemini-specific lint | add 3.0 to allowed sensitive keywords |
| 17 | `edab979970` | 2025-12-18 | cli, core | SKIP: Depends on skipped executor rename + Gemini-specific parts | Remove unused code |
| 18 | `10ba348a3a` | 2025-12-19 | core/agents, scripts | SKIP: Gemini-specific introspection agent demo | Introspection agent demo |
| 19 | `b828b47547` | 2025-12-19 | docs | SKIP: GEMINI_SYSTEM_MD documentation | docs(cli): add System Prompt Override (GEMINI_SYSTEM_MD) |
| 20 | `3c92bdb1ad` | 2025-12-19 | release | SKIP: Nightly version bump | chore/release: bump version to 0.21.0-nightly.20251219 |
| 21 | `b923604602` | 2025-12-20 | core/telemetry | SKIP: ClearcutLogger for hooks | feat(telemetry): add clearcut logging for hooks |
| 22 | `8643d60b88` | 2025-12-20 | release | SKIP: Nightly version bump | chore/release: bump version to 0.21.0-nightly.20251220 |
| 23 | `ef1e18a85a` | 2025-12-22 | release | SKIP: Preview release | chore(release): v0.23.0-preview.0 |
| 24 | `7b772e9dfb` | 2025-12-22 | core/telemetry | SKIP: startupProfiler.ts doesn't exist in LLxprt | fix(patch): cherry-pick 0843d9a ... version 0.23.0-preview.1 |
| 25 | `646dc31548` | 2025-12-22 | release | SKIP: Preview release | chore(release): v0.23.0-preview.1 |
| 26 | `bc40695ce4` | 2025-12-26 | cli/ui | SKIP: Seasonal snowfall/header feature | fix(patch): cherry-pick 9cdb267 ... version 0.23.0-preview.2 |
| 27 | `7d8ab08adb` | 2025-12-26 | release | SKIP: Preview release | chore(release): v0.23.0-preview.2 |
| 28 | `dbcad90661` | 2025-12-27 | release | SKIP: Preview release | chore(release): v0.23.0-preview.3 |
| 29 | `518cc1ab63` | 2025-12-30 | release | SKIP: Preview release | chore(release): v0.23.0-preview.4 |
| 30 | `ecbab46394` | 2026-01-06 | release | SKIP: Preview release | chore(release): v0.23.0-preview.5 |
| 31 | `42a36294a8` | 2026-01-06 | cli, core | SKIP: Patches FlashFallback (removed from LLxprt) | fix(patch): cherry-pick 788bb04 |
| 32 | `3ff055840e` | 2026-01-07 | release | SKIP: Preview release | chore(release): v0.23.0-preview.6 |
| 33 | `2519a7850a` | 2026-01-07 | release | SKIP: Final release | chore(release): v0.23.0 |

---

## REIMPLEMENT (13 commits)

| # | SHA | Date | Areas | Rationale | Subject |
|---|-----|------|-------|-----------|---------|
| 1 | `cc52839f19` | 2025-12-17 | docs | Update hooks docs to use snake_case tool names (write_file, replace, etc.) | Docs (#15103) |
| 2 | `bb8f181ef1` | 2025-12-17 | core/tools | Migrate 2 console.error calls to debugLogger in ripGrep.ts (line numbers diverged) | Refactor: Migrate console.error in ripGrep.ts to debugLogger |
| 3 | `6ddd5abd7b` | 2025-12-17 | cli/ui | Fix eager slash completion hiding siblings; our useSlashCompletion.tsx diverged | fix(ui): Prevent eager slash command completion hiding sibling commands |
| 4 | `739c02bd6d` | 2025-12-17 | cli/ui, core | Replace magic number 2 with INITIAL_HISTORY_LENGTH constant; verify our actual count | fix(cli): correct initial history length handling for chat commands |
| 5 | `54466a3ea8` | 2025-12-18 | cli, core, schemas | Add name/description to hook config; update registry, planner, UI | feat(hooks): add support for friendly names and descriptions |
| 6 | `322232e514` | 2025-12-18 | cli/themes, utils | Auto-detect terminal background color for theme; reimplement detection without 28-file refactor | feat: Detect background color |
| 7 | `2515b89e2b` | 2025-12-18 | core/services | Add GitHub Actions env vars to shell sanitization whitelist; adapt to our sanitizeEnvironment() | feat: Pass additional environment variables to shell execution |
| 8 | `70696e364b` | 2025-12-18 | cli/ui | Show suggestions on perfect match + sort; our useSlashCompletion.tsx structure differs | fix(ui): show command suggestions even on perfect match and sort them |
| 9 | `402148dbc4` | 2025-12-18 | core/hooks | Add coreEvents.emitFeedback() for hook failures (infra exists); skip log-level changes | feat(hooks): reduce log verbosity and improve error reporting in UI |
| 10 | `2e229d3bb6` | 2025-12-19 | cli, core | JIT context memory loading via ContextManager; adapt for .llxprt/LLXPRT.md | feat(core): Implement JIT context memory loading and UI sync |
| 11 | `41a1a3eed1` | 2025-12-19 | core/hooks | CRITICAL SECURITY: Sanitize hook command expansion, prevent injection via $LLXPRT_PROJECT_DIR | fix(core): sanitize hook command expansion and prevent injection |
| 12 | `58fd00a3df` | 2025-12-22 | core/tools, utils | .llxprtignore support for SearchText/ripgrep tool (adapt from .geminiignore) | fix(core): Add .geminiignore support to SearchText tool |
| 13 | `b7ad7e1035` | 2025-12-30 | core/utils | Improve quota retry: make retryDelayMs optional, use exponential backoff when no explicit delay | fix(patch): cherry-pick 07e597d |

---

## NO_OP (4 commits)

| # | SHA | Date | Areas | Rationale | Subject |
|---|-----|------|-------|-----------|---------|
| 1 | `ba100642e3` | 2025-12-17 | cli, zed | Already migrated to ACP SDK v0.14.1 | Use official ACP SDK and support HTTP/SSE based MCP servers |
| 2 | `9e6914d641` | 2025-12-18 | core/utils | Already have identical 429 handling | Handle all 429 as retryableQuotaError |
| 3 | `7da060c149` | 2025-12-18 | docs | Our api-reference.md is already more comprehensive (623 vs 168 lines) | (docs): Add reference section to hooks documentation |
| 4 | `8feeffb29b` | 2025-12-20 | cli/utils | LLxprt uses exit code 75 + LLXPRT_CODE_NO_RELAUNCH guard; bug doesn't apply | fix: prevent infinite relaunch loop when --resume fails |
