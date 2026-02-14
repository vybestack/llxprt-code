# P15 Audit: Session Cleanup Stub
## Plan Requirements
- Phase 15 expects a **stub-level implementation** for session cleanup support around JSONL files.
- Required behaviors/requirements listed:
  - `REQ-CLN-001`: scan `session-*.jsonl` files.
  - `REQ-CLN-002`: lock-aware deletion protection for active `.lock` sidecars.
  - `REQ-CLN-004`: delete orphaned `.lock` files.
- Strategy text says to modify existing cleanup utility with stubs, including:
  - `cleanupStaleLocks(chatsDir)` returning `Promise.resolve(0)` (stub).
  - `shouldDeleteSession(entry)` returning `'delete'` (stub/delegation).
  - `.jsonl` scan recognition as signature-level update.
- Marker requirement explicitly expects:
  - `@plan PLAN-20260211-SESSIONRECORDING.P15`
  - `@requirement REQ-CLN-001, REQ-CLN-002, REQ-CLN-004`

## What Was Actually Done
- Implemented file: `packages/core/src/recording/sessionCleanupUtils.ts`.
- This is **not stub-only**; it contains substantial functional logic:
  - `getAllJsonlSessionFiles(...)` scans `session-*.jsonl`, stats files, reads header line, builds metadata.
  - `shouldDeleteSession(...)` checks for sidecar lock, parses lock PID, checks PID liveness, returns `'delete' | 'skip' | 'stale-lock-only'`.
  - `cleanupStaleLocks(...)` scans `.lock` files, removes orphaned and stale lock files, returns cleanup count.
- Functional support exists for all three listed cleanup requirements at real implementation level.
- Plan/requirement annotations are present but tagged to **P17**, not P15:
  - File header: `@plan PLAN-20260211-SESSIONRECORDING.P17`
  - Function comments similarly use P17.

## Gaps / Divergences
1. **Phase marker mismatch (major traceability gap)**
   - Expected: P15 marker(s).
   - Actual: P17 marker(s).
   - Impact: auditability/completion checks for P15 may fail or become ambiguous.

2. **Implementation level mismatch (stub vs full)**
   - Expected in P15 plan: stubs/minimal signatures and safe placeholders.
   - Actual: fully implemented behavior with PID checks, lock parsing, lock cleanup side effects.
   - Impact: phase sequencing divergence; work appears to include later-phase behavior.

3. **Scope/file-target divergence (potentially acceptable but notable)**
   - Plan prioritizes CLI cleanup file updates (or optional core file creation if better placement).
   - Actual evidence provided is core utility file only; cannot confirm corresponding CLI integration from this single-file audit.

## Severity
- **Overall: Medium**
  - Functional requirements are implemented (positive), so user-facing behavior risk is low.
  - However, phase/plan conformance and traceability are materially off (P15 vs P17 markers; stub-vs-full execution), which is significant for process governance and milestone validation.

## Summary Verdict
Implementation is functionally strong and appears to satisfy the listed cleanup requirements, but it **does not conform to the stated P15 plan contract** (stub intent + P15 markers). This should be treated as **plan-phase divergence**: likely acceptable technically, but requires explicit documentation/reconciliation in phase tracking (or marker correction) to pass strict audit traceability.