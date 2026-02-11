# Cherry-Pick Decisions: sync to gemini-cli v0.17.1

**Upstream range**: `v0.16.0..v0.17.1`
**LLxprt version**: 0.9.0 (unchanged)
**Total commits**: 45
**Branch**: `gmerge/0.17.1`

## Summary Counts

| Decision    | Count |
|-------------|-------|
| PICK        | 7     |
| SKIP        | 31    |
| REIMPLEMENT | 7     |

---

## Decision Notes

### Recurring themes

- **Release/version-bump commits**: 11 commits are pure release automation (nightly bumps, preview releases, stable release tags). All SKIP.
- **Gemini 3 launch (86828bb5)**: Massive 79-file commit. Most is Gemini-specific (routing, quota, fallback, Pro tier, experiments, branding). LLxprt doesn't have model routing, fallback handler, flash fallback, ProQuotaDialog, Banner, persistentState, or experiments. REIMPLEMENT to extract only: httpErrors.ts, editor.ts (Antigravity), detect-ide.ts (Antigravity), models.ts (resolveModel + isGemini2Model), settingsSchema.ts (previewFeatures), config.ts (preview getters), googleQuotaErrors.ts (ModelNotFoundError). Skip retry.ts (LLxprt's is already more advanced).
- **Mouse/selection/paste features**: After analysis, LLxprt's mouse system is fundamentally different. upstream's selection mode warning (ba15eeb5), mouse movement warning (ab6b2293), and paste timeout warning (d03496b7) all depend on an AppEvent/warning-message infrastructure LLxprt doesn't have. All SKIP.
- **Show model in history (ab11b2c2)**: Upstream depends on model router. LLxprt doesn't route. REIMPLEMENT as "show profile name on change in chat history" — more useful for multi-provider.
- **Extension tests (638dd2f6)**: Upstream uses ExtensionManager class; LLxprt uses standalone functions. REIMPLEMENT as new test suite for LLxprt's architecture plus `it.each` table-driven test refactoring.
- **Terminal mode cleanup (ba88707b)**: Upstream only mocks mouse in tests. LLxprt has known broader issue with terminal modes on exit. REIMPLEMENT with broader scope: test mocks + production cleanup.
- **Right-click paste (8877c852)**: Needs clipboardy dep, mouse handler in InputPrompt. REIMPLEMENT.
- **Multi-extension uninstall (7d33baab)**: Different extension architecture (standalone functions vs class). REIMPLEMENT.
- **v0.17.1 hotfix (1d51935f)**: Changes useAlternateBuffer default to false. LLxprt already uses `=== true` check and defaults to true with screen reader guard. SKIP entire commit.
- **Glob version (2f8b68df)**: LLxprt already at `^12.0.0`. SKIP.
- **Google auth / code_assist**: LLxprt has multi-provider auth. SKIP.
- **Experiments/flag infrastructure**: LLxprt doesn't use Google's experiments framework. SKIP.

---

## PICK Table (chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 1 | `555e25e63` | 2025-11-13 | cli | PICK | Minor formatting adjustment to ModelMessage — trivial, clean pick. | slightly adjust model message formatting (#13043) |
| 2 | `d683e1c0d` | 2025-11-14 | cli | PICK | Fix: exit CLI when trust save fails. Important UX/safety fix. | fix(cli): Exit CLI when trust save unsuccessful during launch (#11968) |
| 3 | `472e775a1` | 2025-11-14 | cli | PICK | Update /permissions to support modifying trust for other dirs. Useful feature. | feat: Update permissions command to support modifying trust for other… (#11642) |
| 4 | `9786c4dcf` | 2025-11-14 | cli, core | PICK | Check folder trust before allowing /add directory. Security improvement. | Check folder trust before allowing add directory (#12652) |
| 5 | `78a28bfc0` | 2025-11-16 | cli | PICK | Fix animated scrollbar renders black in NO_COLOR mode. LLxprt has same bug — NoColorTheme sets colors to ''. | Fix: Animated scrollbar renders black in NO_COLOR mode (#13188) |
| 6 | `8c78fe4f1` | 2025-11-17 | core | PICK WITH CONFLICTS | Rework MCP tool discovery/invocation. Removes mcpToTool() dependency, fixes $defs/$ref schema handling. LLxprt's mcp-client.ts matches upstream pre-rework state. Preserve DebugLogger calls. | rework MCP tool discovery and invocation (#13160) |
| 7 | `cc0eadffe` | 2025-11-20 | cli | PICK | Patch: setupGithubCommand improvements. We have this file. | fix(patch): cherry-pick 4adfdad (setupGithubCommand) (#13533) |

---

## SKIP Table (chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 1 | `0fcbff506` | 2025-11-13 | release | SKIP | Nightly version bump — release automation. | chore(release): bump version to 0.17.0-nightly (#13027) |
| 2 | `2c5e09e1c` | 2025-11-13 | core, telemetry | SKIP | ClearcutLogger updates. LLxprt removed ClearcutLogger. | Update comment and undo unnecessary logging (#13025) |
| 3 | `3174573b6` | 2025-11-13 | release | SKIP | Nightly version bump. | chore/release: bump version to 0.17.0-nightly (#13040) |
| 4 | `a591505bf` | 2025-11-15 | docs | SKIP | Deprecation doc cleanup. LLxprt docs diverge. | docs: remove references to deprecated flags (#12578) |
| 5 | `016b5b42e` | 2025-11-15 | docs | SKIP | More deprecation doc cleanup. | docs: remove references to deprecated --checkpointing flag (#12477) |
| 6 | `9d74b7c0e` | 2025-11-14 | cli, core | SKIP | Google ADC metadata server auth. LLxprt has multi-provider auth. | feat(auth): Add option for metadata server ADC without project override (#12948) |
| 7 | `6d83d3440` | 2025-11-14 | core, settings | SKIP | Compress threshold change. LLxprt doesn't have chatCompressionService. | Change default compress threshold to 0.7 for api key users (#13079) |
| 8 | `ce56b4ee1` | 2025-11-14 | core | SKIP | Google experiments flag name→id. LLxprt doesn't use experiments. | Change flag name to flag id for existing flags (#13073) |
| 9 | `ba15eeb55` | 2025-11-14 | cli | SKIP | Selection mode warning + clear fix. Console.clear fix already in LLxprt. Selection mode warning uses AppEvent.SelectionWarning infrastructure LLxprt doesn't have (uses /mouse off instead). | bug(ui) selection mode and fix clear issue (#13083) |
| 10 | `ab6b22930` | 2025-11-14 | cli | SKIP | Mouse movement warning fix. Fixes false-positive SelectionWarning. LLxprt doesn't have SelectionWarning. Already has `button` field in MouseEvent. | Only warn about mouse movement when mouse is down (#13101) |
| 11 | `d03496b71` | 2025-11-14 | cli | SKIP | Paste timeout + warning. Would need complex warning UI infrastructure. If paste timeout is ever an issue, a one-line bump of PASTE_TIMEOUT is sufficient. | Increase paste timeout + add warning (#13099) |
| 12 | `c6b6dcbe9` | 2025-11-15 | docs | SKIP | Upstream-specific docs. | Docs: Clarify Project-Scoped Behavior of Chat Sub-commands (#10458) |
| 13 | `e650a4ee5` | 2025-11-15 | core, tests | SKIP | Core package test refactoring. Upstream test structure diverges. | Refactored core package ut (#13139) |
| 14 | `cf8de02c6` | 2025-11-15 | release | SKIP | Nightly version bump. | chore/release: bump version to 0.17.0-nightly (#13154) |
| 15 | `394a7ea01` | 2025-11-17 | core, tests | SKIP | Tools test refactoring. Files diverged. | Refactored 3 files of tools package (#13231) |
| 16 | `1d1bdc57c` | 2025-11-18 | core, tests | SKIP | Tools test refactoring. smart-edit removed, others diverged. Patterns worth adopting independently (see test refactoring REIMPLEMENT). | Refactored 4 files of tools package (#13235) |
| 17 | `ecf8fba10` | 2025-11-18 | cli | SKIP | Tips on first request + phrase refactoring. LLxprt has different phrase system, not interested in tips feature. | feat: Show tip on first request and refactor phrases (#12952) |
| 18 | `2f8b68dff` | 2025-11-17 | deps | SKIP | Glob version update. LLxprt already at ^12.0.0 in all packages. Already done. | update glob version (#13242) |
| 19 | `78075c8a3` | 2025-11-18 | docs | SKIP | Upstream changelog. | Docs: Add changelog for v.0.15.0 (#13276) |
| 20 | `9e5e06e8b` | 2025-11-18 | release | SKIP | Release tag: 0.17.0-preview.0. | chore(release): 0.17.0-preview.0 |
| 21 | `dd1f8e12f` | 2025-11-20 | core | SKIP | Model router fix. LLxprt doesn't have modelRouterService. | fix(patch): model router fix (#13511) |
| 22 | `1a0e349cc` | 2025-11-20 | release | SKIP | Release tag: v0.17.0-preview.1. | chore(release): v0.17.0-preview.1 |
| 23 | `fbe8e9d7d` | 2025-11-20 | core | SKIP | Another model router fix. | fix(patch): model router fix (#13518) |
| 24 | `7a9da6360` | 2025-11-20 | release | SKIP | Release tag: v0.17.0-preview.2. | chore(release): v0.17.0-preview.2 |
| 25 | `d3bf3af4a` | 2025-11-20 | core, settings | SKIP | Compress threshold. LLxprt doesn't have chatCompressionService. | fix(patch): compress threshold (#13529) |
| 26 | `6e12a7a83` | 2025-11-20 | release | SKIP | Release tag: v0.17.0-preview.3. | chore(release): v0.17.0-preview.3 |
| 27 | `17f4718d9` | 2025-11-20 | release | SKIP | Release tag: v0.17.0-preview.4. | chore(release): v0.17.0-preview.4 |
| 28 | `d9c3b73bf` | 2025-11-20 | cli, settings | SKIP | Settings dialog fix. LLxprt's settings UI diverges. | fix(patch): settings dialog (#13536) |
| 29 | `7c684e36f` | 2025-11-20 | release | SKIP | Release tag: v0.17.0-preview.5. | chore(release): v0.17.0-preview.5 |
| 30 | `079dfef2f` | 2025-11-20 | release | SKIP | Release tag: v0.17.0. | chore(release): v0.17.0 |
| 31 | `1d51935fc` | 2025-11-21 | cli, settings | SKIP | v0.17.1 hotfix: changes useAlternateBuffer default to false. LLxprt already uses `=== true` pattern and defaults to true with screen reader guard. No applicable sub-changes. | fix(patch): v0.17.1 hotfix (#13625) |
| 32 | `6a27d5e8f` | 2025-11-22 | release | SKIP | Release tag: v0.17.1. | chore(release): v0.17.1 |

---

## REIMPLEMENT Table (chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 1 | `ab11b2c27` | 2025-11-13 | cli, core | REIMPLEMENT | Show model in history — upstream depends on model router (LLxprt doesn't have). Reimplement as "show profile name on change in chat history" which is more useful for multi-provider. The model is already visible in the Footer; the profile name is what changes between turns. | Show model in history (#13034) |
| 2 | `638dd2f6c` | 2025-11-13 | cli, tests | REIMPLEMENT | Extension test coverage — upstream tests ExtensionManager class; LLxprt uses standalone functions. Write new tests for LLxprt's disable/enable/link/list/uninstall commands + adopt `it.each` table-driven patterns. | Improve test code coverage for cli/command/extensions package (#12994) |
| 3 | `ba88707b1` | 2025-11-17 | cli, tests | REIMPLEMENT | Terminal mode cleanup — upstream only mocks mouse in tests. LLxprt has broader known issue: arrow keys / terminal modes wrong after exit. (1) Add mouse mocks to gemini.test.tsx, (2) Add comprehensive terminal mode restoration on exit (bracketed paste, focus reporting, cursor visibility). | Fix test to not leave terminal in mouse mode (#13232) |
| 4 | `8877c8527` | 2025-11-17 | cli | REIMPLEMENT | Right-click paste in alternate buffer — needs clipboardy dependency, mouse handler integration in InputPrompt, command rename. LLxprt's InputPrompt doesn't currently use useMouse hook. | Right click to paste in Alternate Buffer mode (#13234) |
| 5 | `7d33baabe` | 2025-11-18 | cli | REIMPLEMENT | Uninstall multiple extensions — upstream uses ExtensionManager class; LLxprt uses standalone uninstallExtension() function. Rewrite with loop + error collection over standalone function. | feat: uninstall multiple extensions (#13016) |
| 6 | `86828bb56` | 2025-11-18 | cli, core, settings | REIMPLEMENT | Gemini 3 launch (79 files). Extract ONLY: httpErrors.ts (ModelNotFoundError), editor.ts (Antigravity support), detect-ide.ts (Antigravity), models.ts (resolveModel + isGemini2Model), settingsSchema.ts (previewFeatures), config.ts (preview getters), googleQuotaErrors.ts (404 classification). Skip: retry.ts (LLxprt's is better), all routing/fallback/quota/banner/experiments/branding. | feat: launch Gemini 3 in Gemini CLI (#13287) |
| 7 | N/A | N/A | cli, tests | REIMPLEMENT | Test quality improvement (inspired by upstream 1d1bdc57c pattern). Refactor existing LLxprt tests to use `it.each` table-driven patterns where appropriate. Focus on extension command handler tests (most are missing or minimal). | LLxprt-originated: test refactoring |
