# P27 Audit

## Plan Requirements
- Read and validate Phase 27 plan (`27-old-system-removal.md`) for old-system removal criteria.
- Confirm deletion of these files:
  - `packages/core/src/storage/SessionPersistenceService.ts`
  - `packages/core/src/storage/SessionPersistenceService.test.ts`
  - `packages/core/src/services/chatRecordingService.ts`
- Confirm no remaining TypeScript/TSX references to:
  - `SessionPersistenceService`
  - `PersistedSession`
  - `PersistedUIHistoryItem`
  - `PersistedToolCall`
  - `ChatRecordingService`
  - `restoredSession`
  - `chatRecordingService`
- Run grep command exactly as provided in the audit instructions.
- Verify new recording types are exported from `packages/core/src/index.ts`.

## What Was Actually Done
1. Read plan file: `project-plans/issue1361/plan/27-old-system-removal.md`.
2. Checked file existence for all three expected-deleted files:
   - `SessionPersistenceService.ts` → does not exist
   - `SessionPersistenceService.test.ts` → does not exist
   - `chatRecordingService.ts` → does not exist
3. Ran instructed grep command across `packages/**` TypeScript/TSX files.
4. Reviewed `packages/core/src/index.ts` exports.

## Gaps
- Grep results show remaining references to **`restoredSession`** in:
  - `packages/cli/src/ui/hooks/useSessionRestore.test.ts` (multiple lines)
- No matches were returned for:
  - `SessionPersistenceService`
  - `PersistedSession`
  - `PersistedUIHistoryItem`
  - `PersistedToolCall`
  - `ChatRecordingService`
  - `chatRecordingService`
- New recording exports are present in `packages/core/src/index.ts`:
  - `export * from './recording/index.js';`
  - This indicates the recording module is exported, but explicit named type exports were not separately validated beyond this module-level export.

## Severity
- **Medium**
  - Core old-system files are removed and key old identifiers are absent.
  - However, requirement wording said these references “should ALL be gone,” and `restoredSession` still appears (in tests).

## Summary Verdict
**Partial pass / needs follow-up.**

Old-system files and major old persistence/service identifiers appear successfully removed. The audit still found `restoredSession` references in `useSessionRestore.test.ts`, so the strict “all gone” condition is not fully met. Recording exports are present via `./recording/index.js` in `packages/core/src/index.ts`.
