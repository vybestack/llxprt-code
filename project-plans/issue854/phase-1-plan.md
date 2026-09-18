# Plan: Issue 854 File-Driven Scrollback — Phase 1 (Foundation)

Plan ID: PLAN-20260917-ISSUE854
Generated: 2026-09-17
Total Phases: 1 (of the 5-phase design in issue-854-design.md; this plan covers Phase 1 only)
Requirements: REQ-854-001, REQ-854-002, REQ-854-003, REQ-854-004, REQ-854-005

Design source of truth: `project-plans/issue854/issue-854-design.md` (PDF twin:
`issue-854-design.pdf`). Phase 1 is purely additive: it lands the on-disk
writer, the correlation stamps, and the core context-range API. No UI behavior
changes, no eviction, no paging. Every piece is reachable and observable but
nothing consumes the data yet (consumers arrive in phases 2–4).

## Critical Reminders

1. Phase 0.5 preflight MUST be completed before any implementation.
2. TDD is mandatory: failing test first, then code. bun:test only, no new .js
   files, no vitest.
3. Behavioral tests only — real filesystem in temp dirs, real HistoryService
   instances. No mock theater (see typescript-test-writing skill /
   dev-docs/RULES.md).
4. Every function/class/test carries `@plan:PLAN-20260917-ISSUE854.P01` and
   `@requirement:REQ-854-XXX` markers.

## Phase 0.5: Preflight Verification

Verify ALL assumptions before writing code. Fill this table during execution
and do not proceed with any unchecked box.

### Dependency / Type / Call-Path Verification

| Assumption | What to verify | Evidence to capture |
|------------|----------------|---------------------|
| Journal can derive its file base name from the active recording | How the CLI learns the active session journal path at runtime (SessionRecordingService / RecordingIntegration accessor) | grep output with file:line |
| `HistoryItem` base shape is where optional stamps belong | `HistoryItemBase` in `packages/cli/src/ui/types.ts` (~L240) | actual interface text |
| `chronology` seq is present on replayed IContent | `iContentToHistoryItems.ts` input type and `historyChronology.ts` stamping | file:line |
| Core event plumbing supports a new payload type | `historyEventTypes.ts` union + how HistoryService emits (HistoryEvents.ts emitter pattern) | file:line |
| Settings schema + merge produces new keys | `schema-ui.ts` pattern near `ui.historyMaxItems` (L298–315) and `getSchemaDefaults()` in settingsMerge.ts L88 | file:line |
| turnStore addItem/updateItem are the journal hook points | `turnStore.ts` addItem/updateItem signatures; `useHistoryManager.ts` wiring | file:line |
| `sb-` prefix collides with nothing | All chatsDir globs are `session-*.jsonl` exact (SessionDiscovery.ts L118/L377, sessionScanner.ts L121, sessionCleanupUtils.ts L147); media reclamation keeps `.jsonl` (mediaReclamation.ts L124–126) | already verified 2026-09-17 |

### Blocking Issues Found

(None known at plan time. Preflight may add some; stop and update this plan
before implementing if any appear.)

## Phase 01: Foundation (writer, index, stamps, range API)

### Requirements Implemented

#### REQ-854-001: UI scrollback journal

**Full text**: Every committed UI history item MUST be appended to a per-session
append-only JSONL scrollback journal at the moment it is committed to the turn
store, so that the full UI transcript (including UI-only info/error boxes that
the model journal never sees) is durable and re-readable without holding it in
memory.

**Behavior**:
- GIVEN: an active session with recording enabled and `ui.scrollbackJournalEnabled` true (default)
- WHEN: a UI item is committed (addItem for one-shot UI-only items; updateItem at commit points for streamed items — turn end / tool completion)
- THEN: one journal record `{v:1, uiSeq, ts, kind, itemId, chronologySeq?, seqSpan?, payload}` is appended to `<chatsDir>/sb-<sessionFileBase>.jsonl`, uiSeq strictly monotonic per session, and the file is NOT read back into memory by this phase

**Why this matters**: this is the disk half of the file-driven scrollback; it
also fixes lossy resume (today UI-only items vanish on resume).

#### REQ-854-002: Offset index with crash-parity rebuild

**Full text**: A sidecar index `<chatsDir>/sb-<sessionFileBase>.idx.jsonl` MUST
record `{uiSeq, byteOffset, byteLen, kind, chronologySeq?}` per journal record,
and reopening after a crash (index shorter than journal) MUST rebuild only the
unindexed suffix by scanning it, without re-reading indexed lines.

**Behavior**:
- GIVEN: a journal with N records and a valid index
- WHEN: the journal is reopened and a page [a..b] is requested by uiSeq
- THEN: records a..b are read via seek to byteOffset + bounded read, payloads identical to what was appended
- GIVEN: an index truncated to k < N entries (simulated crash)
- WHEN: reopened
- THEN: entries k+1..N are rebuilt by scanning only the journal suffix from the last known offset, and existing index entries are not rewritten

**Why this matters**: random access without full-file parse is what makes
scroll-back paging cheap in phase 2; suffix-only rebuild keeps startup O(tail).

#### REQ-854-003: Chronology correlation stamps on UI items

**Full text**: HistoryItem MUST grow optional `chronologySeq?: number` and
`seqSpan?: readonly [number, number]`, stamped at creation wherever a UI item
represents model-context entries: committed assistant items (contentEventProcessor),
user echo (queryPreparer), tool groups (2-entry adjacent span: ai tool_call entry
+ tool response entry, verified), and the resume fallback converter
(iContentToHistoryItems, using the chronology seq already present on replayed
IContent).

**Behavior**:
- GIVEN: a committed assistant item derived from an IContent with chronology.seq = S
- WHEN: the item is added
- THEN: item.chronologySeq === S
- GIVEN: a tool_group UI item built from an ai tool_call entry (seq S) and its tool response entry (seq S+1)
- WHEN: the group is committed
- THEN: item.seqSpan deep-equals [S, S+1] and item.chronologySeq is undefined (span, not point)
- GIVEN: a UI-only info item
- WHEN: added
- THEN: both stamps are undefined

**Why this matters**: this is the join key for in-context marking (issue item 2)
and for aligning UI scrollback with the model journal.

#### REQ-854-004: Core context-range API and event

**Full text**: HistoryService MUST expose `getContextRange(): {firstSeq, lastSeq, totalEntries}` (first/last = chronology seq of the first/last entry of the curated in-memory history, the exact array the model sees) and `getContextSummaries(): Array<{seq, replacedFromSeq, replacedToSeq, itemCount, text}>` (from isSummary entries' chronologyReplaced), and MUST emit `contextRangeChanged` with that payload after every mutation that moves the boundary: compression replaceAll, history mutations (commitHistoryMutation), rewind, and clear.

**Behavior**:
- GIVEN: real HistoryService with 5 added entries
- WHEN: getContextRange()
- THEN: {firstSeq: seq of entry 1, lastSeq: seq of entry 5, totalEntries: 5}
- GIVEN: compression replaces entries 1–4 with a summary entry (seq 6, chronologyReplaced {fromSeq: 1, toSeq: 4})
- WHEN: the compression commits
- THEN: a contextRangeChanged event is observed with firstSeq = 6 and getContextSummaries() has one element {seq: 6, replacedFromSeq: 1, replacedToSeq: 4, itemCount: 4, text: summary text}
- GIVEN: rewind or clear removes entries
- WHEN: the mutation commits
- THEN: contextRangeChanged fires with the new firstSeq (or totalEntries 0 for empty)

**Why this matters**: the UI cannot mark "what the model knows" without a
truthful boundary signal; polling is racy, so the event is first-class.

#### REQ-854-005: Settings flag

**Full text**: A `ui.scrollbackJournalEnabled` boolean setting (schema default true, showInDialog false) MUST gate journal writes; when false, no journal or index file is created and behavior is byte-identical to today.

**Behavior**:
- GIVEN: default settings
- WHEN: merged settings are materialized
- THEN: `settings.merged.ui.scrollbackJournalEnabled === true`
- GIVEN: setting false and an active session
- WHEN: items are committed
- THEN: no sb-*.jsonl / sb-*.idx.jsonl files exist in chatsDir

**Why this matters**: escape hatch for users who object to the extra files; also
the A/B lever while the feature bakes.

### Implementation Tasks

#### Files to Create

- `packages/cli/src/services/scrollback/scrollbackRecords.ts`
  Record + index-entry types, version constant, zod-free plain validators
  (match repo style; follow historyEventTypes.ts payload conventions).
- `packages/cli/src/services/scrollback/ScrollbackJournal.ts`
  Class: `open({chatsDir, sessionFileBase, enabled})`, `append(item, meta?)`,
  `appendRevision(itemId, item)`, `appendControl(record)`, `flush()`, `close()`;
  uiSeq counter seeded from index tail on reopen. Synchronous-enough appends
  (Bun file I/O) with explicit flush at commit points.
- `packages/cli/src/services/scrollback/scrollbackIndex.ts`
  Index writer/reader: append entry after each journal append; `open()` validates
  entry count + last byteOffset against journal size, rebuilds suffix only;
  `pageRead(a, b)` via bounded reads; `getRangeMeta()` for timeline length.
- Tests co-located (all bun:test, real FS in `fs.mkdtemp` dirs, shared
  `useTempChatsDir()` helper registered once per describe):
  - `scrollbackRecords.test.ts` (schema validation round trip)
  - `ScrollbackJournal.test.ts` (REQ-854-001: append/order/monotonic uiSeq;
    revision last-wins read-back; clear + compressed control records)
  - `scrollbackIndex.test.ts` (REQ-854-002: page reads match appends;
    suffix-only rebuild after truncated index; empty journal open)
- `packages/core/src/services/history/contextRange.test.ts`
  REQ-854-004 behavioral tests against a real HistoryService (add, compress,
  rewind, clear, event payloads). Follow compression-locking.test.ts setup
  patterns.

#### Files to Modify

- `packages/core/src/services/history/HistoryServiceCore.ts`
  Add `getContextRange()`, `getContextSummaries()`; compute from curated
  `this.history` + chronology. Markers on both.
- `packages/core/src/services/history/historyEventTypes.ts`
  Add `contextRangeChanged` payload type.
- `packages/core/src/services/history/HistoryService.ts` (and the exact
  mutation sites identified in preflight: replaceAll/compression commit,
  commitHistoryMutation, rewind, clear)
  Emit `contextRangeChanged` after each boundary-moving commit.
- `packages/cli/src/ui/types.ts` (~L240 HistoryItemBase)
  Add `chronologySeq?: number; seqSpan?: readonly [number, number];`
- `packages/cli/src/ui/hooks/agentStream/contentEventProcessor.ts`
  Stamp chronologySeq on committed adds (L102 committedId path; L156/L163
  final-state adds).
- `packages/cli/src/ui/hooks/agentStream/queryPreparer.ts`
  Stamp user echo with the entry seq assigned for the user IContent.
- `packages/cli/src/ui/utils/iContentToHistoryItems.ts`
  Carry replayed IContent chronology.seq onto produced items (extend existing
  `iContentToHistoryItems.test.ts`).
- `packages/cli/src/config/settings-schema/schema-ui.ts` (near L298)
  Add `ui.scrollbackJournalEnabled` per REQ-854-005.
- `packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts`
  Construct ScrollbackJournal when recording is active and the flag is true;
  wire turnStore addItem/updateItem commit points through it (write-only; no
  reads, no eviction in this phase).

#### Required Code Markers

```typescript
/**
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-001
 */
```

(REQ id varies per file/function; every created or touched function/test gets
one.)

### Verification Commands

```bash
bun test packages/cli/src/services/scrollback/
bun test packages/core/src/services/history/contextRange.test.ts
bun test packages/cli/src/ui/utils/iContentToHistoryItems.test.ts
npm run test && npm run lint && npm run typecheck && npm run format && npm run build
bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"
# then: ls <chatsDir from smoke session> — expect sb-*.jsonl + sb-*.idx.jsonl
bun scripts/test-audit/scan.ts tmp/scan-854  # diff vs main baseline; no new findings on touched files
grep -r "@plan:PLAN-20260917-ISSUE854.P01" packages | wc -l   # expect >= 20
grep -r "@requirement:REQ-854-00" packages | wc -l            # expect >= 20
```

Smoke expectation: session runs normally (no behavior change), scrollback
sidecars appear next to session-*.jsonl, sizes grow during the session.

### Structural + Semantic Checklists

Follow PLAN-TEMPLATE.md checklists verbatim. Semantic gates specific to this
phase:
- [ ] Deleting ScrollbackJournal.ts makes every journal test fail (no mock theater)
- [ ] A page read returns payloads that byte-match what was appended (derived assertion, not echo)
- [ ] contextRangeChanged fires exactly once per boundary-moving commit (not per add)
- [ ] Flag false → zero sb-* files (assert on directory listing)

### Success Criteria

- All verification commands green; smoke test shows sidecar files and normal UI.
- No UI behavior change observable by a user (rendering untouched).
- Deferred-implementation detection clean (no TODO/STUB/placeholder comments).

### Failure Recovery

```bash
git checkout -- packages/cli/src/ui/types.ts packages/cli/src/config/settings-schema/schema-ui.ts
git checkout -- packages/core/src/services/history/
rm -rf packages/cli/src/services/scrollback/
```

Phase 1 does not gate on phases 2+; a rollback here leaves main behavior
untouched.

### Phase Completion Marker

Create `project-plans/issue854/.completed/P01.md` per template after semantic
verification passes.

## Execution Tracker

See `project-plans/issue854/execution-tracker.md`.

## Preflight Results (completed)

Completed 2026-09-17 on branch `issue854` (HEAD cbe79ada8). Evidence logs:
`tmp/verify854/preflight-grep*.log`.

### Dependency / Type / Call-Path Verification

| Assumption | What to verify | Result | Evidence (file:line) |
|------------|----------------|--------|----------------------|
| Journal can derive file base name from active recording | RecordingIntegration / SessionRecordingService accessor | OK — `getFilePath()` returns the `session-*.jsonl` path; dirname = chatsDir, basename minus `.jsonl` = base. Reached via `useRecordingInfrastructure` refs (`recordingServiceRef`) in AppContainer. | packages/core/src/recording/SessionRecordingService.ts:502; packages/cli/src/ui/containers/AppContainer/hooks/useRecordingInfrastructure.ts:47-53 |
| `HistoryItemBase` is where optional stamps belong | Interface in `packages/cli/src/ui/types.ts` | OK — `interface HistoryItemBase { text?: string }` at L82 (plan said ~L240; actual L82). | packages/cli/src/ui/types.ts:82 |
| chronology seq present on IContent | stamper + `metadata.chronology.seq` | OK — `ChronologyStamper.stamp` writes `content.metadata.chronology` with monotonic never-reset `nextSeq`. | packages/core/src/services/history/historyChronology.ts:92,97,139 |
| **Live CLI path can obtain the seq for stamping** | ServerContentEvent payload | **FAILS** — `ServerContentEvent = { type, value: string }`; content deltas are plain strings. No IContent, no chronology seq reaches `contentEventProcessor` / `queryPreparer` / live tool-group assembly. Zero `chronology` references exist in `packages/cli/src` today. Live stamping needs new core→CLI plumbing that does not exist and is not in this phase's file list. | packages/core/src/core/turn.ts:146-150; grep chronology packages/cli/src → no matches (tmp/verify854/preflight-grep7.log) |
| Core event plumbing supports new payload type | typed emitter overloads | OK — `HistoryServiceEventEmitter` uses per-event `on`/`emit`/`off` overloads; add `contextRangeChanged` overloads the same way. | packages/core/src/services/history/historyEventTypes.ts:20-63 |
| Settings schema + merge produces new keys | schema-ui near historyMaxItems + getSchemaDefaults | OK — `historyMaxItems` L298 pattern; `getSchemaDefaults()` auto-extracts schema defaults (L88), so a new `ui.*` key flows into merged settings with no merge-code change. | packages/cli/src/config/settings-schema/schema-ui.ts:298; packages/cli/src/config/settingsMerge.ts:88-92 |
| turnStore addItem/updateItem are journal hook points | signatures + wiring | OK — `createTurnHistoryCommands` addItem (L166) / updateItem (L181); `useHistoryManager` exposes `commands.addItem`/`commands.updateItem` (L81-82). | packages/cli/src/ui/stores/turn/turnStore.ts:166,181; packages/cli/src/ui/hooks/useHistoryManager.ts:81-82 |
| `sb-` prefix collides with nothing | session globs | OK — janitor/session tooling matches `session-*.jsonl`; those live under `packages/core/src/recording/` (plan cited `packages/cli/src/services/`, stale path but same semantics). | packages/core/src/recording/SessionDiscovery.ts; packages/core/src/recording/janitor/sessionScanner.ts; packages/core/src/recording/janitor/mediaReclamation.ts |
| Real HistoryService usable in tests | setup pattern | OK — `new HistoryService()` with `add({speaker, blocks})` works; compression via `startCompression()`/`replaceHistory(transform)`. | packages/core/src/services/history/compression-locking.test.ts:49-52,60-64 |

### Blocking Issues Found

1. **REQ-854-003 live stamping (partial blocker):** the live paths named in the
   requirement (`contentEventProcessor` committed adds, `queryPreparer` user
   echo, live tool-group assembly) have no truthful source for
   `chronologySeq` — `ServerContentEvent` carries only a string delta
   (packages/core/src/core/turn.ts:146) and history recording (where
   `historyChronology.ts` assigns the seq) happens later inside core. Phase 1
   therefore stamps the seq only where it is truthfully available:
   `iContentToHistoryItems` (resume/replay path, from
   `IContent.metadata.chronology.seq`). Implementing live stamping anyway
   would require inventing a seq value with no correlation to the real
   chronology, which would corrupt the join key this design exists to create.
   Live stamping needs a core→CLI chronology feed (e.g. `contentAdded`-derived
   seq plumbing) and should be a follow-up phase or plan amendment.

### Verification Gate

- [x] All dependencies verified
- [x] Types match expectations (with L-number corrections noted)
- [x] Call paths are possible
- [x] Test infrastructure ready
- [ ] REQ-854-003 live stamping: blocked as described above (replay-path
      stamping proceeds; live stamping deferred per blocking issue 1)
