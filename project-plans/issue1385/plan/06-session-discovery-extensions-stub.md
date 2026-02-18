# Phase 06: Session Discovery Extensions — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P06`

## Prerequisites
- Required: Phase 05a completed
- Verification: `test -f project-plans/issue1385/.completed/P05a.md`
- Expected files: `packages/core/src/recording/SessionDiscovery.ts` (existing)

## Requirements Implemented (Expanded)

### REQ-SB-005: Empty Session Filtering
**Full Text**: The system shall hide empty sessions from the browser list, where an empty session is defined as one containing no events beyond the `session_start` event.
**Behavior**:
- GIVEN: A JSONL file with only a `session_start` line
- WHEN: `SessionDiscovery.hasContentEvents(filePath)` is called
- THEN: Returns `false`
**Why This Matters**: Empty sessions clutter the browser and hide meaningful history.

### REQ-SB-008: Skipped Session Count
**Full Text**: When some session files have unreadable headers (corrupted), the system shall exclude those sessions from the list and display an inline notice: `Skipped N unreadable session(s).`
**Behavior**:
- GIVEN: Valid + corrupted session files
- WHEN: `SessionDiscovery.listSessionsDetailed(chatsDir, projectHash)` is called
- THEN: Returns `{ sessions, skippedCount }` where unreadable files contribute to `skippedCount`
**Why This Matters**: Maintains transparency when browser list is partial due to file corruption.

### REQ-PV-002 / REQ-PV-009 / REQ-PV-010: First Message Preview Extraction
**Full Text**: Preview extraction scans for first user content event, concatenates text parts only, truncates by max length, and tolerates malformed/unexpected lines.
**Behavior**:
- GIVEN: A session file with mixed event schemas and parts
- WHEN: `SessionDiscovery.readFirstUserMessage(filePath, maxLength?)` runs
- THEN: Returns safe preview text or `null` without throwing
**Why This Matters**: Supports resilient preview UX under real-world mixed or corrupted data.

## Implementation Tasks

### Files to Modify
- `packages/core/src/recording/SessionDiscovery.ts`
  - Add stub: `listSessionsDetailed(chatsDir, projectHash): Promise<{ sessions: SessionSummary[]; skippedCount: number }>`
  - Add stub: `hasContentEvents(filePath: string): Promise<boolean>`
  - Add stub: `readFirstUserMessage(filePath: string, maxLength?: number): Promise<string | null>`
  - Keep explicit method order in file and docs:
    1. `listSessionsDetailed(chatsDir, projectHash)`
    2. `hasContentEvents(filePath)`
    3. `readFirstUserMessage(filePath, maxLength?)`
  - Include markers:
    - `@plan PLAN-20260214-SESSIONBROWSER.P06`
    - `@requirement:REQ-SB-005, REQ-SB-008, REQ-PV-002`

- `packages/core/src/recording/index.ts`
  - Verify `SessionDiscovery` export remains intact.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20260214-SESSIONBROWSER.P06
 * @requirement REQ-SB-008
 * @pseudocode session-discovery-extensions.md lines 10-60
 */
static async listSessionsDetailed(
  chatsDir: string,
  projectHash: string,
): Promise<{ sessions: SessionSummary[]; skippedCount: number }>;

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P06
 * @requirement REQ-SB-005
 * @pseudocode session-discovery-extensions.md lines 65-91
 */
static async hasContentEvents(filePath: string): Promise<boolean>;

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P06
 * @requirement REQ-PV-002
 * @pseudocode session-discovery-extensions.md lines 95-165
 */
static async readFirstUserMessage(
  filePath: string,
  maxLength?: number,
): Promise<string | null>;
```

## Verification Commands
```bash
# Methods exist in expected sequence
rg -n "listSessionsDetailed|hasContentEvents|readFirstUserMessage" packages/core/src/recording/SessionDiscovery.ts

# Method signatures
rg -n "listSessionsDetailed\(chatsDir: string,\s*projectHash: string\)" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: listSessionsDetailed signature"
rg -n "hasContentEvents\(filePath: string\)" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: hasContentEvents signature"
rg -n "readFirstUserMessage\(filePath: string,\s*maxLength\?: number\)" packages/core/src/recording/SessionDiscovery.ts || echo "FAIL: readFirstUserMessage signature"

# Marker checks
rg -n "@plan PLAN-20260214-SESSIONBROWSER.P06" packages/core/src/recording/SessionDiscovery.ts
rg -n "@requirement:REQ-SB-005|@requirement:REQ-SB-008|@requirement:REQ-PV-002" packages/core/src/recording/SessionDiscovery.ts

# Compile and baseline tests
cd packages/core && npx tsc --noEmit
cd packages/core && npx vitest run src/recording
```

## Deferred Implementation Detection
```bash
# Stub phase allows stub returns but should not accumulate hidden placeholders
rg -n "TODO|FIXME|HACK|XXX|TEMPORARY|WIP" packages/core/src/recording/SessionDiscovery.ts
```

## Feature Actually Works
This phase is intentionally a compile-safe stub phase.

Manual command:
```bash
cd packages/core && npx tsc --noEmit
```
Expected: new signatures compile and are ready for TDD in P07.

### Semantic Verification Questions (YES required)
1. YES/NO — Are all three new methods present in the required order?
2. YES/NO — Does `listSessionsDetailed` explicitly return `{ sessions, skippedCount }`?
3. YES/NO — Does `readFirstUserMessage` include optional `maxLength` in signature?
4. YES/NO — Are method contracts aligned with analysis pseudocode line ranges?
5. YES/NO — Does the file compile without changing existing SessionDiscovery APIs?

## Integration Points Verified
- `useSessionBrowser` can depend on `listSessionsDetailed` for list + skipped count.
- `useSessionBrowser` can call `hasContentEvents(filePath)` for empty-session filtering.
- `useSessionBrowser` can call `readFirstUserMessage(filePath, maxLength?)` for preview enrichment.

## Success Criteria
- SessionDiscovery contains compile-safe stubs for all three methods.
- Signatures and markers match required contracts.
- Existing recording tests remain green.

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionDiscovery.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P06.md`
