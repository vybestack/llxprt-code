# Phase 27: Old System Removal

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P27`

## Prerequisites

### Hard Prerequisites
- Required: Phase 26 completed (full integration working)
- Verification: `test -f project-plans/issue1361/.completed/P26.md`
- All Phase 01-26 tests pass
- E2E smoke tests pass (recording is always-on, no feature flag)

### Mode Parity Matrix (Must Pass Before Removal Begins)

Before removing the old system, verify that the new recording system achieves feature parity across ALL execution modes:

| Capability | Interactive (gemini.tsx) | Non-Interactive (nonInteractiveCli.ts) | Subagent (task.ts) |
|---|---|---|---|
| Session start recorded | [OK] Phase 26 | [OK] Phase 14 (Sub-Task 14.7) | [OK] Phase 26 (inherited from parent) |
| Content events captured | [OK] Phase 14 (HistoryService events) | [OK] Phase 14 (same HistoryService) | [OK] Phase 26 (parent HistoryService) |
| Compression recorded | [OK] Phase 14 (compressionEnded) | [OK] Phase 14 (same events) | N/A (subagent sessions don't compress independently) |
| Turn-boundary flush | [OK] Phase 26 (submitQuery finally) | [OK] Phase 14 (runNonInteractive finally) | [OK] Phase 26 (parent flush covers) |
| Graceful shutdown flush | [OK] Phase 26 (registerCleanup) | [OK] Phase 14 (finally block) | [OK] Phase 26 (parent cleanup) |
| Signal-path flush | [OK] Phase 26 (SIGINT/SIGTERM) | [OK] Phase 14 (best-effort) | N/A (subagent doesn't own signals) |
| Session lock | [OK] Phase 26 | [OK] Phase 14 (Sub-Task 14.7) | N/A (parent lock covers) |
| Resume from JSONL | [OK] Phase 26 (replay engine) | [OK] Phase 26 (`--prompt --continue` resumes session, sends prompt, exits — per spec Exclusivity Matrix) | N/A |

**Verification**: All cells marked [OK] must have passing tests. N/A cells must be documented as intentionally unsupported.

### Rollout Safety Gate

Before any code removal, verify the new system is production-ready:

```bash
# 1. All recording + replay tests pass
cd packages/core && npx vitest run src/recording/

# 2. E2E smoke test
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: JSONL file created in chats directory

# 3. Resume smoke test
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --continue "write me another haiku"
# Expected: Previous session restored, new events appended

# 4. Non-interactive smoke test (--prompt mode)
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key --prompt "hello"
# Expected: JSONL file created and flushed

# 5. Verify no old system usage in new paths
grep -rn "SessionPersistenceService\|ChatRecordingService" packages/ --include="*.ts" | grep -v "test\|spec\|__tests__\|node_modules\|dist"
# Expected: Only references in old system files (to be removed in this phase)
```

## Requirements Implemented

### REQ-CLN-001: Remove SessionPersistenceService
**Full Text**: Delete `SessionPersistenceService` class and all direct references.

### REQ-CLN-002: Remove ChatRecordingService References
**Full Text**: Delete any `ChatRecordingService` stub references. Note: No actual ChatRecordingService class file exists — only stub references in `geminiChat.ts` (~line 2276) and test mocks.

### REQ-CLN-003: Remove Old Session File Formats
**Full Text**: Remove code that reads/writes the old JSON snapshot format.

### REQ-CLN-004: Remove Old Persistence Code Paths
**Full Text**: Recording is always-on. Remove old SessionPersistenceService code paths entirely.

### REQ-CLN-005: Update Configuration
**Full Text**: Remove old session-related configuration keys.

### REQ-CLN-006: Evaluate sessionTypes.ts
**Full Text**: Evaluate whether `sessionTypes.ts` types are still needed by the new system, or if they should be replaced by new recording types. Keep what's shared, remove what's vestigial.

## Implementation Tasks

### Task 27.1: Inventory Old System Files

Before removing anything, create a complete inventory:

```bash
# Find all old system files
grep -rn "SessionPersistenceService" packages/ --include="*.ts" -l
grep -rn "ChatRecordingService" packages/ --include="*.ts" -l
grep -rn "SessionPersistenceService\|PersistedSession\|PersistedUIHistory" packages/ --include="*.ts" -l

# Find old session format readers/writers
grep -rn "\.json\b.*session\|session.*\.json\b" packages/ --include="*.ts" -l

# Find old configuration keys
grep -rn "sessionPersistence\|chatRecording" packages/ --include="*.ts" -l
```

Document the full list before proceeding.

### Task 27.2: Remove SessionPersistenceService

- Delete the SessionPersistenceService class file(s)
- Remove imports referencing it
- Remove test files for the old service
- Update any barrel exports (index.ts files)

### Task 27.3: Remove ChatRecordingService References

The ChatRecordingService has no actual class file — only:
- Stub reference in `geminiChat.ts` (~line 2276) — remove the reference
- Any test mocks referencing it — remove

### Task 27.4: Remove Old Session Format Code

- Remove JSON snapshot read/write code
- Remove old session file path generation (e.g., `session-<id>.json`)
- Keep JSONL file path generation

### Task 27.5: Remove Old Persistence Code Paths

Recording is always-on (no feature flag). There is no `--session-recording` flag.
- Remove the old `SessionPersistenceService` code path entirely
- Recording activates automatically on every session start
- The only user-facing controls are `--continue`, `--list-sessions`, `--delete-session`

### Task 27.6: Evaluate sessionTypes.ts

Review `sessionTypes.ts` to determine:
- Which types are used by the new recording system → KEEP
- Which types are only used by the old system → REMOVE
- Which types need modification → UPDATE

### Task 27.7: Clean Up Configuration

- Remove old session-related config keys
- Update config schema if needed
- Remove old defaults

### Task 27.8: Update Documentation

- Remove references to old session format in any docs
- Update README/docs to reflect new recording system

### Task 27.9: Final Verification

```bash
# No references to old system remain
grep -rn "SessionPersistenceService" packages/ --include="*.ts" | grep -v "node_modules\|dist"
# Expected: 0 matches

grep -rn "ChatRecordingService" packages/ --include="*.ts" | grep -v "node_modules\|dist"
# Expected: 0 matches

# All tests still pass
npm run test

# TypeScript compiles
npm run typecheck

# Lint passes
npm run lint

# Build succeeds
npm run build

# Smoke test
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
```

## Verification Commands

```bash
# Mode parity matrix verification (run before removal)
cd packages/core && npx vitest run src/recording/

# Post-removal verification
npm run test
npm run typecheck
npm run lint
npm run build

# No old system references
grep -rn "SessionPersistenceService\|ChatRecordingService" packages/ --include="*.ts" | grep -v "node_modules\|dist"
# Expected: 0 matches

# Smoke test still works
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
```

## Success Criteria
- Mode Parity Matrix verified (all [OK] cells have passing tests)
- Rollout Safety Gate passed (all smoke tests succeed)
- No references to old SessionPersistenceService or ChatRecordingService
- All tests pass
- TypeScript compiles
- Build succeeds
- Smoke test works

## Failure Recovery
```bash
git checkout -- packages/
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P27.md`
