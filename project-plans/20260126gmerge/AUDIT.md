# Cherry-Pick Audit: v0.13.0 to v0.14.0

**Branch:** `20260126gmerge`  
**Upstream range:** `v0.13.0..v0.14.0`  
**Completed:** 2026-01-26

---

## Reconciliation Table

| # | Upstream SHA | Decision | LLxprt Commit(s) | Status | Notes |
|---|-------------|----------|------------------|--------|-------|
| 1 | `3937461272` | SKIPPED | - | DONE | LLxprt has more advanced scrolling |
| 2 | `21dd9bbf7d` | SKIPPED | - | DONE | FlashFallback not in LLxprt |
| 3 | `b445db3d46` | REIMPLEMENTED | `064ceff8e` | DONE | Test deflaking - Batch 4 |
| 4 | `c743631148` | SKIPPED | - | DONE | Release commit |
| 5 | `f51d74586c` | SKIPPED | - | DONE | Batch 1 - Already present (empty merge) |
| 6 | `16113647de` | SKIPPED | - | DONE | Batch 1 - Already present (empty merge) |
| 7 | `f5bd474e51` | PICKED | `8dee84781` | DONE | Batch 1 - Policy server name spoofing |
| 8 | `400da30a8d` | SKIPPED | - | DONE | Gemini workflow |
| 9 | `ca6cfaaf4e` | SKIPPED | - | DONE | LLxprt message is better |
| 10 | `fa93b56243` | REIMPLEMENTED | `70a48a815`, `aff32d409`, `f15a1e2f1` | DONE | Extension Reloading - TDD impl |
| 11 | `c951f9fdcd` | SKIPPED | - | DONE | Different quota handling |
| 12 | `1d2f90c7e7` | SKIPPED | - | DONE | Different subagent arch |
| 13 | `44b8c62db9` | SKIPPED | - | DONE | No readPathFromWorkspace |
| 14 | `9787108532` | PICKED | `5c505bf63` | DONE | Batch 1 - Tool ordering |
| 15 | `fb0768f007` | SKIPPED | - | DONE | Gemini changelog |
| 16 | `224a33db2e` | PICKED | `18d8a445a` | DONE | Batch 2 - Animated components |
| 17 | `0f5dd2229c` | SKIPPED | - | DONE | Batch 2 - Files already removed |
| 18 | `956ab94452` | SKIPPED | - | DONE | Incompatible multi-provider |
| 19 | `5f6453a1e0` | PICKED | `0b5ef0274` | DONE | Batch 2 - Policy tests |
| 20 | `9ba1cd0336` | PICKED | `1f2c6a441` | DONE | Batch 2 - Shell cwd |
| 21 | `c585470a71` | PICKED | `6610f7915` | DONE | Batch 2 - InputPrompt it.each |
| 22 | `31b34b11ab` | SKIPPED | - | DONE | FlashFallback |
| 23 | `77614eff5b` | PICKED | `bfafeec5f` | DONE | Batch 3 - Multi-replace test |
| 24 | `36feb73bfd` | SKIPPED | - | DONE | WriteTodos - different impl |
| 25 | `c13ec85d7d` | REIMPLEMENTED | `965d4a804`, `784dcf88f`, `e67a27bea`, `aa9866c14`, `d0ecb81a5` | DONE | Extension Settings - TDD impl |
| 26 | `98055d0989` | SKIPPED | - | DONE | Gemini /model docs |
| 27 | `1e42fdf6c2` | SKIPPED | - | DONE | FlashFallback |
| 28 | `5f1208ad81` | SKIPPED | - | DONE | Flaky test disable |
| 29 | `f05d937f39` | REIMPLEMENTED | `b3698d634`, `e95318659`, `18db6603b` | DONE | Consistent Params - TDD impl |
| 30 | `445a5eac33` | SKIPPED | - | DONE | Gemini workflow |
| 31 | `c81a02f8d2` | PICKED | `cd8ad1e3f` | DONE | Batch 3 - DiscoveredTool policy |
| 32 | `83a17cbf42` | SKIPPED | - | DONE | Release commit |
| 33 | `5e7e72d476` | SKIPPED | - | DONE | Release commit |

---

## Summary

| Decision | Count | Status |
|----------|-------|--------|
| PICKED | 8 | 8 done |
| SKIPPED | 21 | 21 done |
| REIMPLEMENTED | 4 | 4 done |
| **Total** | **33** | **33 done** |

---

## LLxprt Commits Created

| LLxprt Commit | Upstream SHA | Description |
|---------------|--------------|-------------|
| `8dee84781` | `f5bd474e51` | fix(core): prevent server name spoofing in policy engine |
| `5c505bf63` | `9787108532` | List tools in a consistent order |
| `18d8a445a` | `224a33db2e` | Improve tracking of animated components |
| `0b5ef0274` | `5f6453a1e0` | feat(policy): Add comprehensive priority range validation tests |
| `1f2c6a441` | `9ba1cd0336` | feat(shell): include cwd in shell command description |
| `6610f7915` | `c585470a71` | refactor(cli): consolidate repetitive tests in InputPrompt using it.each |
| `d20155a4a` | N/A | fix: post-batch 2 - semantic-colors.ts export structure |
| `173e16f71` | N/A | chore: format changes from batch 2 |
| `bfafeec5f` | `77614eff5b` | fix(#11707): should replace multiple instances of a string test |
| `cd8ad1e3f` | `c81a02f8d2` | fix: integrate DiscoveredTool with Policy Engine |
| `064ceff8e` | `b445db3d46` | reimplement: make list dir test less flaky |
| `70a48a815` | `fa93b56243` | feat(extensions): add SettingScope.Session for runtime-only enable/disable |
| `aff32d409` | `fa93b56243` | feat(extensions): filter extension commands based on enabled state |
| `f15a1e2f1` | `fa93b56243` | feat(extensions): tab completion filters based on extension enabled state |
| `b3698d634` | `f05d937f39` | feat(tools): use absolute_path as primary param in write-file and edit |
| `e95318659` | `f05d937f39` | feat(tools): use dir_path as primary param in glob, grep, ls |
| `18db6603b` | `f05d937f39` | feat(tools): use dir_path as primary param in shell |
| `965d4a804` | `c13ec85d7d` | feat(extensions): add ExtensionSettingSchema for extension settings |
| `784dcf88f` | `c13ec85d7d` | feat(extensions): add ExtensionSettingsStorage for secure storage |
| `e67a27bea` | `c13ec85d7d` | feat(extensions): add maybePromptForSettings for extension settings prompts |
| `aa9866c14` | `c13ec85d7d` | feat(extensions): add extension settings integration layer |
| `d0ecb81a5` | `c13ec85d7d` | feat(extensions): add keychain integration for sensitive settings |

---

## Post-Completion Checklist

- [x] All PICKED commits have LLxprt commit hashes recorded
- [x] All REIMPLEMENTED commits have LLxprt commit hashes recorded
- [x] All verification passes documented
- [ ] PR created and linked
- [x] NOTES.md has all deviations documented
