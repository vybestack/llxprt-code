# Cherry-Pick Decisions: v0.13.0 to v0.14.0

**Upstream range:** `v0.13.0..v0.14.0`  
**Total commits:** 33  
**Analysis date:** 2026-01-26

## Summary Counts

| Decision | Count |
|----------|-------|
| PICK | 14 |
| SKIP | 17 |
| REIMPLEMENT | 2 |

---

## Decision Notes

### Recurring Themes

1. **Release/version bump commits** - SKIP all `chore(release)` commits as LLxprt has its own versioning
2. **GitHub workflow changes** - SKIP gemini-cli specific workflows (`gemini-automated-issue-triage.yml`, `release-patch-*`)
3. **Flash fallback changes** - SKIP commits related to flash fallback messaging/handling (LLxprt has FlashFallback disabled/slated for removal)
4. **Docs-only commits** - PICK if relevant to features we have; SKIP if gemini-specific (changelog for their releases)
5. **Integration test improvements** - PICK to help deflake our tests
6. **UI divergence** - LLxprt has reimplemented UI with advanced scrolling (batching, drag-and-drop); SKIP upstream UI commits
7. **Quota handling** - LLxprt uses different quota error handling (errorParsing.ts vs useQuotaAndFallback.ts); evaluate carefully
8. **Model configuration** - LLxprt has multi-provider architecture; SKIP Gemini-only ModelConfigService

### Research Findings (Per-Commit Analysis)

| SHA | Research Result | Notes |
|-----|-----------------|-------|
| `3937461` | **SKIP** | LLxprt has more advanced scrolling (batching, drag-drop, hit detection). Upstream would be a regression. |
| `21dd9bb` | **SKIP** | FlashFallback system doesn't exist in LLxprt |
| `b445db3` | **REIMPLEMENT** | Test structure differs; LLxprt already has `expectToolCallSuccess()` helper, just need to migrate test |
| `f51d745` | **PICK** | Adds ms parsing and message fallback - compatible with LLxprt's quota handling |
| `ca6cfaa` | **SKIP** | Upstream makes message LESS informative; LLxprt's current approach is better (shows token counts) |
| `fa93b56` | **PICK** | Critical extension enable/disable feature - needs careful conflict resolution |
| `c951f9f` | **SKIP** | LLxprt doesn't have useQuotaAndFallback.ts; uses errorParsing.ts with ERROR messages instead |
| `1d2f90c` | **SKIP** | LLxprt has completely different subagent architecture |
| `44b8c62` | **SKIP** | LLxprt doesn't have `readPathFromWorkspace` function; ignore handling done differently |
| `956ab94` | **SKIP** | Incompatible with multi-provider; assumes Gemini-only with @google/genai SDK types |
| `5f6453a` | **PICK** | Test refactor using helper function; improves test maintainability |
| `c585470` | **PICK** | Test structures identical; clean refactor to it.each pattern |

### High-Risk Commits (Need Extra Review)

- `fa93b56` - Extension reloading: Large change (24 files, 664 insertions) - CRITICAL feature, needs careful conflict resolution
- `f05d937` - Consistent param names: Touches many tools, may have branding conflicts

---

## PICK Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 1 | `f51d74586c` | 2025-11-05 | core, utils | PICK | Adds ms duration parsing and message fallback for retryInfo - compatible with our quota handling | refactor: parse string for retryInfo (#12586) |
| 2 | `16113647de` | 2025-11-05 | cli, core, services | PICK | Bug fix - Windows PTY crash fix | Fix/windows pty crash (#12587) |
| 3 | `f5bd474e51` | 2025-11-05 | core, policy, tools | PICK | Security fix - prevents server name spoofing in MCP | fix(core): prevent server name spoofing in policy engine (#12511) |
| 4 | `fa93b56243` | 2025-11-05 | cli, core, ui | PICK | CRITICAL - extension enable/disable and reloading | [Extension Reloading]: Update custom commands, add enable/disable command (#12547) |
| 5 | `9787108532` | 2025-11-05 | core, tools | PICK | Improvement - consistent tool ordering | List tools in a consistent order. (#12615) |
| 6 | `224a33db2e` | 2025-11-05 | cli, ui, debug | PICK | Improvement - better animated component tracking | Improve tracking of animated components. (#12618) |
| 7 | `0f5dd2229c` | 2025-11-05 | cli, policy | PICK | Cleanup - removes unused policy TOML files | chore: remove unused CLI policy TOML files (#12620) |
| 8 | `5f6453a1e0` | 2025-11-05 | core, policy | PICK | Test refactor - uses helper function for cleaner tests | feat(policy): Add comprehensive priority range validation tests (#12617) |
| 9 | `9ba1cd0336` | 2025-11-06 | core, tools | PICK | UX improvement - shows cwd in shell command description | feat(shell): include cwd in shell command description (#12558) |
| 10 | `c585470a71` | 2025-11-06 | cli, core, tests | PICK | Test refactor - clean it.each pattern, structures identical | refactor(cli): consolidate repetitive tests in InputPrompt using it.each (#12524) |
| 11 | `77614eff5b` | 2025-11-06 | integration-tests | PICK | Bug fix test - multiple string replacement | fix(#11707): should replace multiple instances of a string test (#12647) |
| 12 | `c13ec85d7d` | 2025-11-06 | cli, docs, extensions | PICK | UX improvement - friendlier keychain storage name | Update keychain storage name to be more user-friendly (#12644) |
| 13 | `f05d937f39` | 2025-11-06 | core, tools, docs | PICK | Refactor - consistent parameter naming across tools | Use consistent param names (#12517) |
| 14 | `c81a02f8d2` | 2025-11-06 | core, policy, tools | PICK | Feature - DiscoveredTool policy integration | fix: integrate DiscoveredTool with Policy Engine (#12646) |

---

## SKIP Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 1 | `3937461272` | 2025-11-04 | cli, ui | SKIP | LLxprt has more advanced scrolling (batching, drag-drop). Would be regression. | Scrollable support (#12544) |
| 2 | `21dd9bbf7d` | 2025-11-05 | core, config | SKIP | FlashFallback system doesn't exist in LLxprt | fix: allow user to set pro model even in fallback (#12566) |
| 3 | `c743631148` | 2025-11-05 | all packages | SKIP | Release commit - LLxprt has own versioning | chore(release): bump version to 0.14.0-nightly.20251104.da3da198 (#12564) |
| 4 | `400da30a8d` | 2025-11-05 | .github | SKIP | Gemini-specific workflow | fix(triage-workflow): Pass environment variables directly into prompt (#12602) |
| 5 | `ca6cfaaf4e` | 2025-11-05 | cli, hooks | SKIP | Makes message LESS informative; LLxprt's is better (shows token counts) | Update auto compression message. (#12605) |
| 6 | `c951f9fdcd` | 2025-11-05 | cli, ui | SKIP | LLxprt doesn't have useQuotaAndFallback.ts; different error handling | fix: add line breaks in quota/capacity msgs (#12603) |
| 7 | `1d2f90c7e7` | 2025-11-05 | core, agents | SKIP | LLxprt has completely different subagent architecture | Add compression mechanism to subagent (#12506) |
| 8 | `44b8c62db9` | 2025-11-05 | core, utils | SKIP | LLxprt doesn't have readPathFromWorkspace; ignore handling done differently | fix(core) Path reader method readPathFromWorkspace does not respect git/gemini ignore config. (#10073) |
| 9 | `fb0768f007` | 2025-11-05 | docs | SKIP | Gemini-specific changelog | Docs: Added newest changelog: v0.12.0 (#12611) |
| 10 | `956ab94452` | 2025-11-05 | core, docs, config | SKIP | Incompatible with multi-provider; assumes Gemini-only SDK types | feat(core): Add ModelConfigService. (#12556) |
| 11 | `31b34b11ab` | 2025-11-06 | cli, core, fallback | SKIP | FlashFallback messaging - LLxprt has this disabled | Let users know when falling back to flash, and update the error messa... (#12640) |
| 12 | `36feb73bfd` | 2025-11-06 | docs, cli, core | SKIP | WriteTodos revert - LLxprt already has todo_write with different approach | Revert "Enable WriteTodos tool by default (#12500)" (#12658) |
| 13 | `98055d0989` | 2025-11-06 | docs | SKIP | Gemini-specific /model docs - LLxprt has different model handling | Docs: Add /model documentation (#12654) |
| 14 | `1e42fdf6c2` | 2025-11-06 | cli, core, fallback | SKIP | Flash fallback error handling - LLxprt has this disabled | fix(cli): handle flash model errors gracefully (#12667) |
| 15 | `5f1208ad81` | 2025-11-06 | integration-tests | SKIP | Disables test we may want - evaluate separately | chore: disable flaky test (#12670) |
| 16 | `445a5eac33` | 2025-11-06 | .github, scripts | SKIP | Gemini-specific release workflow | fix(patch workflow): Ensure that the environment is listed on patch comments (#12538) |
| 17 | `83a17cbf42` | 2025-11-07 | all packages | SKIP | Release commit - LLxprt has own versioning | chore(release): v0.14.0-preview.0 |
| 18 | `5e7e72d476` | 2025-11-12 | all packages | SKIP | Release commit - LLxprt has own versioning | chore(release): v0.14.0 |

---

## REIMPLEMENT Table (Chronological)

| # | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
|---|-------------|------|-------|----------|-----------|---------|
| 1 | `b445db3d46` | 2025-11-05 | integration-tests | REIMPLEMENT | Test structure differs; LLxprt has expectToolCallSuccess() already, just migrate test to use it | fix(infra) - Make list dir less flaky (#12554) |

---

## Batch Plan Preview

Based on 14 PICK commits and 1 REIMPLEMENT:

- **Batch 1**: 5 PIcks (f51d745, 1611364, f5bd474, fa93b56, 9787108) - NOTE: fa93b56 is high-risk/critical
- **Batch 2**: 5 PIcks (224a33d, 0f5dd22, 5f6453a, 9ba1cd0, c585470)
- **Batch 3**: 4 PIcks (77614ef, c13ec85, f05d937, c81a02f) - NOTE: f05d937 is high-risk
- **Batch 4**: 1 REIMPLEMENT (b445db3 - list_directory test deflaking)

*Final batch schedule will be in PLAN.md after human review.*
