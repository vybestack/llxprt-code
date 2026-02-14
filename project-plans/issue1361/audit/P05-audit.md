# P05 Audit: Core Types + Writer Implementation

## Plan Requirements
- Implement `SessionRecordingService` in `packages/core/src/recording/SessionRecordingService.ts` per pseudocode lines 40-212:
  - Class fields: queue/seq/filePath/materialized/active/draining/drainPromise/session fields/preContentBuffer
  - Constructor buffers `session_start`
  - `bufferPreContent`
  - `enqueue` with deferred materialization behavior
  - `materialize`
  - `scheduleDrain`
  - async `drain` with appendFile and ENOSPC handling
  - async `flush`
  - `isActive`, `getFilePath`, `getSessionId`, `initializeForResume`, `dispose`
  - Convenience methods: `recordContent`, `recordCompressed`, `recordRewind`, `recordProviderSwitch`, `recordSessionEvent`, `recordDirectoriesChanged`
- Satisfy REQ-REC-001..008 (envelope format, seven event types, sync enqueue + background writes, deferred materialization, flush guarantee, ENOSPC handling, monotonic seq, resume init).
- Ensure no deferred/stub placeholders (TODO/FIXME/empty returns).

## Pseudocode Compliance
- **Types (pseudocode lines 10-35):** Implemented in `types.ts` with the seven event discriminators and all payload interfaces (`SessionStartPayload`, `ContentPayload`, `CompressedPayload`, `RewindPayload`, `ProviderSwitchPayload`, `SessionEventPayload`, `DirectoriesChangedPayload`), plus envelope `SessionRecordLine` fields (`v/seq/ts/type/payload`).
- **Class fields (40-51):** Implemented. `projectHash` field from pseudocode is omitted as a persisted class field; value is still captured into `startPayload` in constructor.
- **Constructor (53-67):** Implemented correctly: stores `sessionId` and `chatsDir`, builds `startPayload`, buffers `session_start`.
- **bufferPreContent (69-79):** Implemented correctly.
- **enqueue (81-110):** Implemented correctly for active guard, first-content materialization, pre-content buffering, queue append, schedule drain.
- **materialize (112-118):** Implemented with timestamped filename, path join, directory creation.
- **scheduleDrain (120-124):** Implemented correctly.
- **drain (126-146):** Implemented core loop and appendFile batching; ENOSPC/EACCES sets inactive and returns. **Divergence:** pseudocode sets `draining=false` after loop; current code can return early on ENOSPC/EACCES without resetting `draining`.
- **flush (148-160):** Implemented as specified.
- **Accessors/init/dispose (162-185):** Implemented; `dispose` is async and flushes before deactivating (stronger than pseudocode).
- **Convenience methods (190-212):** Implemented correctly for all six methods.
- **Integration note about ENOSPC warning callback (pseudocode integration line 65):** Not implemented in this file (no injected callback or emitted warning).

## What Was Actually Done
- `packages/core/src/recording/types.ts`
  - Defines event discriminator union for all seven event types.
  - Defines envelope shape with `v`, `seq`, `ts`, `type`, `payload`.
  - Defines all event payload interfaces and service config.
  - Includes additional replay/session summary types beyond P05 scope.
- `packages/core/src/recording/SessionRecordingService.ts`
  - Implements buffered pre-content event strategy and defers file materialization until first `content` event (lines 104-119, 140-147).
  - Uses synchronous enqueue path and background async writer via `scheduleDrain` + `drain` (lines 156-160, 169-189).
  - Serializes each event as JSONL (`JSON.stringify(event) + '\n'`) and appends with `fs.appendFile` (lines 173-179).
  - Implements flush semantics waiting for active drain and draining leftovers (lines 199-211).
  - Handles resume by setting file path and sequence baseline (lines 254-259).
  - Provides convenience wrappers for all event kinds (lines 289-349).

## Gaps / Divergences
1. **`draining` flag not reset on ENOSPC/EACCES early return in `drain()`.**
   - In `catch`, code sets `active=false` then `return` (lines 181-183) without `draining=false`.
   - This leaves internal state inconsistent (`draining` may remain true permanently after disk-full/access failure).
2. **No ENOSPC warning callback/event emission despite pseudocode integration requirement.**
   - Pseudocode integration point explicitly calls for callback-based warning emission when ENOSPC is detected.
   - Implementation only disables recording; no user-facing warning pathway exists in this class.
3. **Minor filename prefix divergence from pseudocode.**
   - Pseudocode uses `sessionId.substring(0, 8)`; implementation uses `substring(0, 12)` (line 143).
   - Functional behavior still valid unless strict filename contract expected.
4. **Minor field-storage divergence from pseudocode class fields.**
   - Pseudocode lists `projectHash` class field; implementation does not persist it as a field (only uses constructor arg to build initial payload).
   - No functional defect observed for current behavior.

## Severity
- Gap 1: **MODERATE**
- Gap 2: **MODERATE** (could be **CRITICAL** if UI warning is required by upstream contracts in later phases)
- Gap 3: **MINOR**
- Gap 4: **MINOR**

## Summary Verdict
**PARTIAL**
