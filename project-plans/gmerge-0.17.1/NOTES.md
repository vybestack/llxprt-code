# Running Notes: gmerge/0.17.1

Notes appended after each batch during execution.

---

## Batch 1 — PICK (5 commits)

**Commits landed:**
- `555e25e63` — SKIPPED (ModelMessage.tsx doesn't exist in LLxprt)
- `d683e1c0d` — LANDED as `e288fe9e4` (exit on trust save fail)
- `472e775a1` — NOT LANDED — 10+ conflict files, too divergent for PICK. Reclassified as REIMPLEMENT (new Batch 10).
- `9786c4dcf` — NOT LANDED — depends on 472e775a1 changes, same divergence. Reclassified as REIMPLEMENT (new Batch 11).
- `78a28bfc0` — LANDED as `f412ee16c` (NO_COLOR scrollbar fix, conflicts resolved by keeping LLxprt UI components)

**Fix commit:** `cbf986497` — adapted GradientRegression.test.tsx types for LLxprt (FooterProps, SessionStatsState, tokenTracking), fixed useFolderTrust.ts useCallback missing dep.

**Deviation:** 2 of 5 commits reclassified from PICK to REIMPLEMENT due to massive conflict count. Added as Batch 10 and 11.
