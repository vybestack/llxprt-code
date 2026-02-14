# P17 Audit: Session Cleanup Implementation
## Plan Requirements
- Plan expects implementation in `packages/cli/src/utils/sessionCleanup.ts` with explicit P17 markers and pseudocode line mapping.
- Required functional areas:
  - `getAllSessionFiles` behavior (scan `session-*.jsonl`, ENOENT handling, header parse, entry construction).
  - `shouldDeleteSession` lock-aware behavior (`delete` / `skip` / `stale-lock-only`).
  - `cleanupStaleLocks` behavior (orphan and stale lock cleanup).
  - startup cleanup integration: call stale-lock cleanup before retention cleanup in `cleanupExpiredSessions`.
- Plan correction explicitly forbids stale-lock status from forcing data-file deletion.

## Pseudocode Compliance
- `getAllJsonlSessionFiles` in implementation matches pseudocode intent for lines 13–38:
  - reads directory,
  - returns `[]` on ENOENT,
  - filters `session-*.jsonl`,
  - stats file + reads header,
  - emits session entry with current-session flag.
- `shouldDeleteSession` matches corrected pseudocode contract:
  - checks `.lock` existence,
  - no lock => `delete`,
  - live PID => `skip`,
  - missing/dead/unreadable PID => `stale-lock-only`.
- `cleanupStaleLocks` matches pseudocode intent lines 85–130:
  - scans `.lock` files,
  - removes orphaned lock files,
  - removes stale locks while preserving corresponding data files.
- Corrected stale-lock policy is honored in utility logic (no stale-lock-triggered JSONL deletion path present in this file).

## What Was Actually Done
- Implemented a new utility module at:
  - `packages/core/src/recording/sessionCleanupUtils.ts`
- Added:
  - `readSessionHeader` (first-line parse of JSONL header)
  - lock PID read + PID liveness check helpers
  - exported `getAllJsonlSessionFiles`
  - exported `shouldDeleteSession`
  - exported `cleanupStaleLocks`
- Included metadata tags:
  - `@plan PLAN-20260211-SESSIONRECORDING.P17`
  - `@pseudocode session-cleanup.md`
- Requirements tag includes REQ-CLN-001/002/004 (REQ-CLN-003 not explicitly tagged in header comment).

## Gaps / Divergences
1. **File location divergence (major process divergence)**
   - Plan explicitly says to modify `packages/cli/src/utils/sessionCleanup.ts`.
   - Actual implementation is in `packages/core/src/recording/sessionCleanupUtils.ts`.
   - This may still be architecturally valid if CLI now consumes core utility, but that integration is not shown in the audited file.

2. **Startup integration not evidenced in audited implementation**
   - Plan requires `cleanupExpiredSessions` to call stale-lock cleanup first.
   - The audited file is utilities only; no `cleanupExpiredSessions` integration present here.
   - Cannot confirm requirement satisfaction without inspecting call sites.

3. **Error handling nuance divergence in stale-lock cleanup**
   - Pseudocode specifies ENOENT-specific handling for some scans.
   - `cleanupStaleLocks` currently catches all `readdir` errors and returns `0`.
   - Behavior is robust but broader than pseudocode; may mask permission/config problems.

4. **Pseudocode dependency divergence**
   - Pseudocode references `SessionLockManager` methods.
   - Implementation uses direct filesystem + PID helpers, functionally equivalent but different architecture.

5. **Requirement traceability gap**
   - Header omits explicit `REQ-CLN-003` tag, though corrected stale-lock policy behavior appears respected.

## Severity
- **Functional compliance (within this utility):** Medium-High positive (core behavior appears correctly implemented).
- **Plan/process compliance:** **Medium risk** due to location + missing visible integration proof.
- **Potential runtime risk:** **Medium** until call-site wiring confirms stale-lock cleanup is executed before retention deletion.

## Summary Verdict
**Partial pass.**

The audited utility implementation substantially matches the pseudocode’s core lock-aware cleanup behavior, including the critical stale-lock policy correction. However, it diverges from the plan’s specified target file and does not itself demonstrate required startup-flow integration (`cleanupExpiredSessions` ordering). Final acceptance depends on verifying that CLI/session cleanup entrypoints actually invoke these utilities in the mandated sequence.