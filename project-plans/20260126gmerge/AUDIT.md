# Cherry-Pick Audit: v0.13.0 to v0.14.0

**Branch:** `20260126gmerge`  
**Upstream range:** `v0.13.0..v0.14.0`

---

## Reconciliation Table

| # | Upstream SHA | Decision | LLxprt Commit(s) | Status | Notes |
|---|-------------|----------|------------------|--------|-------|
| 1 | `3937461272` | SKIPPED | - | DONE | LLxprt has more advanced scrolling |
| 2 | `21dd9bbf7d` | SKIPPED | - | DONE | FlashFallback not in LLxprt |
| 3 | `b445db3d46` | REIMPLEMENTED | - | TODO | Test deflaking - Batch 4 |
| 4 | `c743631148` | SKIPPED | - | DONE | Release commit |
| 5 | `f51d74586c` | PICKED | - | TODO | Batch 1 |
| 6 | `16113647de` | PICKED | - | TODO | Batch 1 |
| 7 | `f5bd474e51` | PICKED | - | TODO | Batch 1 |
| 8 | `400da30a8d` | SKIPPED | - | DONE | Gemini workflow |
| 9 | `ca6cfaaf4e` | SKIPPED | - | DONE | LLxprt message is better |
| 10 | `fa93b56243` | PICKED | - | TODO | Batch 1 - CRITICAL |
| 11 | `c951f9fdcd` | SKIPPED | - | DONE | Different quota handling |
| 12 | `1d2f90c7e7` | SKIPPED | - | DONE | Different subagent arch |
| 13 | `44b8c62db9` | SKIPPED | - | DONE | No readPathFromWorkspace |
| 14 | `9787108532` | PICKED | - | TODO | Batch 1 |
| 15 | `fb0768f007` | SKIPPED | - | DONE | Gemini changelog |
| 16 | `224a33db2e` | PICKED | - | TODO | Batch 2 |
| 17 | `0f5dd2229c` | PICKED | - | TODO | Batch 2 |
| 18 | `956ab94452` | SKIPPED | - | DONE | Incompatible multi-provider |
| 19 | `5f6453a1e0` | PICKED | - | TODO | Batch 2 |
| 20 | `9ba1cd0336` | PICKED | - | TODO | Batch 2 |
| 21 | `c585470a71` | PICKED | - | TODO | Batch 2 |
| 22 | `31b34b11ab` | SKIPPED | - | DONE | FlashFallback |
| 23 | `77614eff5b` | PICKED | - | TODO | Batch 3 |
| 24 | `36feb73bfd` | SKIPPED | - | DONE | WriteTodos - different impl |
| 25 | `c13ec85d7d` | PICKED | - | TODO | Batch 3 |
| 26 | `98055d0989` | SKIPPED | - | DONE | Gemini /model docs |
| 27 | `1e42fdf6c2` | SKIPPED | - | DONE | FlashFallback |
| 28 | `5f1208ad81` | SKIPPED | - | DONE | Flaky test disable |
| 29 | `f05d937f39` | PICKED | - | TODO | Batch 3 |
| 30 | `445a5eac33` | SKIPPED | - | DONE | Gemini workflow |
| 31 | `c81a02f8d2` | PICKED | - | TODO | Batch 3 |
| 32 | `83a17cbf42` | SKIPPED | - | DONE | Release commit |
| 33 | `5e7e72d476` | SKIPPED | - | DONE | Release commit |

---

## Summary

| Decision | Count | Status |
|----------|-------|--------|
| PICKED | 14 | 0 done |
| SKIPPED | 18 | 18 done |
| REIMPLEMENTED | 1 | 0 done |
| **Total** | **33** | **18 done** |

---

## Post-Completion Checklist

- [ ] All PICKED commits have LLxprt commit hashes recorded
- [ ] All REIMPLEMENTED commits have LLxprt commit hashes recorded
- [ ] All verification passes documented
- [ ] PR created and linked
- [ ] NOTES.md has all deviations documented
