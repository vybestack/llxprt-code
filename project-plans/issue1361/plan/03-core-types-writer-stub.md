# Phase 03: Core Types + Writer Stub

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P03`

## Prerequisites
- Required: Phase 02a completed
- Verification: `test -f project-plans/issue1361/.completed/P02a.md`
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### REQ-REC-001: Event Envelope
**Full Text**: All session recording events follow a common envelope format with schema version, monotonic sequence number, ISO-8601 timestamp, event type discriminator, and type-specific payload.
**Behavior**:
- GIVEN: Any event type and payload
- WHEN: The event is serialized
- THEN: The resulting JSON has `v`, `seq`, `ts`, `type`, and `payload` fields
**Why This Matters**: A consistent envelope enables forward-compatible replay and debugging.

### REQ-REC-002: Event Types
**Full Text**: Seven event types are defined: session_start, content, compressed, rewind, provider_switch, session_event, directories_changed.
**Behavior**:
- GIVEN: The type system
- WHEN: An event type is referenced
- THEN: It must be one of the seven defined types with corresponding payload interface
**Why This Matters**: Type safety prevents invalid events from being recorded.

### REQ-REC-003: SessionRecordingService Skeleton
**Full Text**: SessionRecordingService provides synchronous enqueue, async flush, deferred materialization, and ENOSPC handling.
**Behavior**:
- GIVEN: A new SessionRecordingService instance
- WHEN: Methods are called
- THEN: Stubs compile and throw NotYetImplemented or return empty values
**Why This Matters**: The stub establishes the public API surface that all other components depend on.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/types.ts` — All type definitions
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P03`
  - Types: SessionRecordLine, SessionEventType, all payload interfaces, SessionMetadata, ReplayResult, SessionSummary
  - These are COMPLETE types, not stubs

- `packages/core/src/recording/SessionRecordingService.ts` — Service stub
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P03`
  - Constructor accepting SessionRecordingServiceConfig (includes sessionId, projectHash, chatsDir, workspaceDirs, provider, model)
  - NOTE: `projectHash` is obtained at the integration point (Phase 26) via `getProjectHash(projectRoot)` from `packages/core/src/utils/paths.ts`, NOT from a Config method. `chatsDir` is constructed as `path.join(config.getProjectTempDir(), 'chats')`.
  - enqueue(): throws NotYetImplemented
  - flush(): returns Promise.resolve()
  - isActive(): returns false
  - getFilePath(): returns null
  - getSessionId(): returns this.sessionId
  - initializeForResume(): throws NotYetImplemented
  - dispose(): no-op
  - Convenience methods (recordContent, recordCompressed, etc.): delegate to enqueue

- `packages/core/src/recording/index.ts` — Barrel export
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P03`

### Files to Modify
- `packages/core/src/index.ts`
  - ADD: Export from `./recording/index.js`

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P03
 * @requirement REQ-REC-001, REQ-REC-002, REQ-REC-003
 */
```

## Verification Commands

### Automated Checks
```bash
# Files exist
test -f packages/core/src/recording/types.ts || echo "FAIL"
test -f packages/core/src/recording/SessionRecordingService.ts || echo "FAIL"
test -f packages/core/src/recording/index.ts || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P03" packages/core/src/recording/ | wc -l
# Expected: 3+ files

# TypeScript compiles
cd packages/core && npx tsc --noEmit

# No TODO comments
grep -r "TODO" packages/core/src/recording/ && echo "FAIL: TODO found"

# No V2 or duplicate files
find packages/core/src/recording -name "*V2*" -o -name "*New*" && echo "FAIL: Duplicates"

# Tests don't expect NotYetImplemented (there shouldn't be tests yet)
grep -r "NotYetImplemented" packages/core/src/recording/*.test.ts 2>/dev/null && echo "FAIL: Reverse testing"
```

### Semantic Verification Checklist
1. **Types are complete** (not stubs): [ ] — All 7 event payload types defined
2. **SessionRecordingService has correct API surface**: [ ] — enqueue, flush, isActive, getFilePath, getSessionId, initializeForResume, dispose, convenience methods
3. **Types use IContent correctly**: [ ] — ContentPayload references IContent from history module

## Success Criteria
- All files compile with `npm run typecheck`
- Types are complete and correct
- Service stub has correct method signatures
- Barrel export works

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/
rm -rf packages/core/src/recording/
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P03.md`


---

## Addendum: Schema Version Governance — SessionStartPayload Correction

**Per the Schema Version Governance resolution in specification.md:**

`SessionStartPayload` MUST NOT include a `v`, `version`, or `schemaVersion` field. The schema version lives exclusively in the envelope's `v` field.

The correct `SessionStartPayload` type definition is:

```typescript
interface SessionStartPayload {
  sessionId: string;
  projectHash: string;
  workspaceDirs: string[];
  provider: string;
  model: string;
  startTime: string;  // ISO-8601
  // NOTE: No 'v' or 'schemaVersion' field. Schema version is the envelope's 'v'.
}
```

Issue #1362's description mentions "schema version" in the `session_start` payload list. This refers to the envelope `v` field, NOT a payload field. The parent issue (#1361) explicitly states: "The session_start payload does NOT duplicate the schema version — v lives only in the envelope." The envelope is authoritative.

**Verification:** After implementation, run:
```bash
grep -n "schemaVersion\|schema_version" packages/core/src/recording/types.ts
# Expected: 0 matches inside SessionStartPayload
```

