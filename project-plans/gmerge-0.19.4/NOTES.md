# NOTES.md — gmerge-0.19.4

Running notes during batch execution.

---

## Pre-Execution Notes

- Branch: `gmerge/0.19.4` created from `main`
- Range: upstream v0.18.4 → v0.19.4 (71 commits)
- Decisions: 22 PICK, 47 SKIP, 2 REIMPLEMENT
- Session-related skips tracked by #1385 (blocked on #1361)
- MCP SDK 1.23.0 update (`d2a6cff4`) moved to SKIP — evaluate independently due to package-lock conflict risk
- Release-branch patches (6169ef04, 95f9032b, ee6b01f9, 93511487) skipped — underlying fixes arrive via main-branch originals in future ranges
- `readStdin.ts` 1-line bug fix from 95693e26 (big test commit) — consider taking standalone if not already covered

---

<!-- Append per-batch notes below -->
