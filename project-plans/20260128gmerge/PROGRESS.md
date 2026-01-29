# Progress: v0.14.0 → v0.15.4 Sync

**Branch:** `20260128gmerge`
**Started:** 2026-01-28
**Completed:** 2026-01-28

---

## Batch Progress

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
|------:|------|-----------------|--------|---------------|-------|
| 1 | PICK | 054497c7a 475e92da5 ef4030331 5ff7cdc9e 331dbd563 4ab94dec5 3c9052a75 2136598e8 | [OK] DONE | 3e6b82caf | 7/8 applied; 3c9052a75 skipped (keyboard conflicts) |
| 2 | PICK | 5ba6bc713 51f952e70 fd59d9dd9 9116cf2ba c1076512d 2abc288c5 | [OK] DONE | 702623f43 | 2/6 applied; others already implemented or deferred |
| 3 | PICK | a0a682826 69339f08a | [OK] DONE | 19d8fed05 | GitHub private repo + listCommands endpoint |
| 4 | PICK+MANUAL | 4ef4bd6f0 + ink bump | [OK] DONE | c2f6fcefb | Hook runner + @jrichman/ink@6.4.8 |
| 5 | REIMPLEMENT | 9e4ae214a + c0b766ad7 |  DEFERRED | - | KeypressContext unified parser - 1000+ line change, separate PR |
| 6 | REIMPLEMENT | 37ca643a6 + 22b055052 | [OK] DONE | 474046c9a | Editor diff drift + tmux gradient crash fix |
| 7 | REIMPLEMENT | cc2c48d59 + b248ec6df | [OK] DONE | 63d161097 | Extension uninstall fix + blockGitExtensions |
| 8 | REIMPLEMENT | 47603ef8e + c88340314 + bafbcbbe8 | [OK] DONE | 089221942 | Memory refresh + toolset refresh + /extensions restart |
| 9 | REIMPLEMENT | e192efa1f | [OK] DONE | cc6e644ec | Animated scroll (200ms ease-in-out) |
| 10 | REIMPLEMENT | 6893d2744 | [OK] DONE | e0a541514 | Session resuming fix (--continue bug) |

---

## All LLxprt Commits (in order)

```
e0a541514 cherry-pick: upstream v0.14.0..v0.15.4 batch 10 (session restore fix)
cc6e644ec cherry-pick: upstream v0.14.0..v0.15.4 batch 9 (animated scroll)
089221942 cherry-pick: upstream v0.14.0..v0.15.4 batch 8 (extension lifecycle)
63d161097 cherry-pick: upstream v0.14.0..v0.15.4 batch 7 (extension fixes)
474046c9a cherry-pick: upstream v0.14.0..v0.15.4 batch 6 (reimplements)
c2f6fcefb cherry-pick: upstream v0.14.0..v0.15.4 batch 4 (hook runner + ink bump)
19d8fed05 cherry-pick: upstream v0.14.0..v0.15.4 batch 3 (2/2 commits)
702623f43 cherry-pick: upstream v0.14.0..v0.15.4 batch 2 (2/6 commits)
3e6b82caf cherry-pick: upstream v0.14.0..v0.15.4 batch 1 (7/8 commits)
```

---

## Documentation Status

| Document | Status |
|----------|--------|
| CHERRIES.md | [OK] DONE |
| SUMMARY.md | [OK] DONE |
| PLAN.md | [OK] DONE |
| PROGRESS.md | [OK] DONE |
| NOTES.md | [OK] DONE |
| AUDIT.md | [OK] DONE |

---

## Verification Runs

| Batch | Lint | Typecheck | Test | Build | Notes |
|-------|------|-----------|------|-------|-------|
| 1 | [OK] | [OK] | - | - | Quick verify only |
| 2 | [OK] | [OK] | [OK] | [OK] | Full verify |
| 3 | [OK] | [OK] | - | - | Quick verify only |
| 4 | [OK] | [OK] | [OK] | [OK] | Full verify |
| 5 | - | - | - | - | DEFERRED |
| 6 | [OK] | [OK] | - | - | Quick verify only |
| 7 | [OK] | [OK] | - | - | Quick verify only |
| 8 | [OK] | [OK] | [OK] | [OK] | Full verify |
| 9 | [OK] | [OK] | - | - | Quick verify only |
| 10 | [OK] | [OK] | [OK] | [OK] | Full verify |

---

## Deferred Items

### Batch 5: KeypressContext Unified ANSI Parser (9e4ae214a + c0b766ad7)

**Reason:** 1000+ line complex change affecting keyboard input handling. Requires dedicated PR with thorough testing.

**Plan file:** `9e4ae214a-c0b766ad7-plan.md`

**Recommendation:** 
- Keep Kitty protocol support (upstream didn't remove it, just simplified parsing)
- Adopt table-driven KEY_INFO_MAP dispatch pattern
- Add unified ANSI parser as improvement, not replacement
- Test thoroughly: ESC, arrow keys, paste, Kitty CSI-u, various terminals
