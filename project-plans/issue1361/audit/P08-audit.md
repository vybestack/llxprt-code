# P08 Audit: Replay Engine Implementation

## Plan Requirements
- **Met:** `ReplayEngine.ts` exists and includes plan marker (`@plan PLAN-20260211-SESSIONRECORDING.P08`) and pseudocode references.
- **Met:** Uses streaming replay via `fs.createReadStream` + `readline.createInterface` (no full-file `readFile` load).
- **Met:** Implements `replaySession()` and `readSessionHeader()` in the target file.
- **Met:** Handles core event types from plan (`session_start`, `content`, `compressed`, `rewind`, `provider_switch`, `directories_changed`, `session_event`, unknown/default).
- **Partially met:** 5% malformed warning implemented, but formula differs from plan requirement.
- **Not evidenced in file-only audit:** rate-limited warning logging behavior in console/debug path (plan mentions first-5 logging and summary logging; this file only maintains warning array).

## Pseudocode Compliance
Line-by-line compliance highlights:
- **Lines 10-22 (setup/streaming):** Compliant.
- **Line 28 (skip empty):** Compliant.
- **Lines 28b-28e (BOM strip first line):** Compliant.
- **Lines 31-41 (JSON parse + skip unparseable):** Compliant.
- **Lines 44-49 (seq tracking/warning):** Compliant.
- **Line 51 (eventCount increment after parse):** Compliant.
- **Session dispatch block (54+):** Mostly compliant with added stricter validation in several cases.
- **`session_start` (56-77):**
  - Compliant on required field check and project hash mismatch behavior.
  - Divergence: when `lineNumber !== 1`, pseudocode records warning but still processes; implementation warns then `break`s (skips processing that event).
- **`content`/`compressed`/`rewind`:** Compliant, with `compressed` additionally requiring `itemsCompressed !== undefined` (matches plan text).
- **`provider_switch`/`directories_changed`:** Generally compliant; implementation emits malformed warnings when payload invalid even if metadata absent.
- **`session_event` (122-126):** Collected to `sessionEvents`, not added to history (compliant policy). But implementation stores only `{ severity, message }` instead of including timestamp/seq described in plan algorithm.
- **Unknown events (133-136):** Compliant warning + skip.
- **Post-check metadata (146-151):** Compliant.
- **Bad-last-line silent discard (154-159):** Compliant.
- **Return shape (161-169):** Compliant for success path.

## What Was Actually Done
- Implemented a real streaming replay engine with resilient parsing and event reconstruction.
- Added corruption handling:
  - Unparseable JSON lines become warnings and are skipped.
  - Last-line parse failure warning is removed (silent crash-recovery behavior).
- Tracks `history`, `metadata`, `lastSeq`, `eventCount`, `warnings`, and `sessionEvents`.
- Enforces project hash match on `session_start` and returns `{ ok: false, error }` on mismatch.
- Handles rewind/reset semantics and compressed-history replacement.
- Implements header-only reader (`readSessionHeader`) with first-line + BOM handling.
- Adds malformed-rate warning, but computes rate using `(malformed + unparseable) / (eventCount + unparseable)`.

## Gaps / Divergences
1. **Malformed-rate denominator/numerator formula differs from plan.**
   - Plan specifies malformed **known** events only, excluding unknown + unparseable from denominator and excluding unknown/unparseable from numerator.
   - Implementation includes unparseable lines in both numerator and denominator and tracks unknown count but does not use it.
2. **`session_start` handling when not first line differs from pseudocode.**
   - Pseudocode: warn if not line 1, then continue processing payload.
   - Implementation: warn and `break` (skips metadata extraction for that event).
3. **`sessionEvents` payload detail is reduced vs plan algorithm text.**
   - Plan algorithm shows `{ message, severity, timestamp, seq }` collected.
   - Implementation collects only `{ severity, message }`.
4. **Plan marker format mismatch with strict grep example.**
   - Plan text says MUST include `@plan:PLAN-...`; file uses `@plan PLAN-...` (space, not colon). Functionally present, but strict grep from plan would fail.
5. **Error union includes `warnings` field on failure in implementation.**
   - Pseudocode union for `ok:false` is `{ ok:false; error:string }`; implementation returns `{ ok:false; error; warnings }` in multiple paths.

## Severity (CRITICAL/MODERATE/MINOR/NONE per gap)
1. Malformed-rate formula mismatch: **MODERATE** (affects diagnostics/threshold behavior).
2. Non-first `session_start` skip behavior: **MODERATE** (can alter replay outcome on malformed ordering).
3. Missing timestamp/seq in `sessionEvents`: **MINOR** (audit richness reduced).
4. Plan marker colon mismatch: **MINOR** (compliance/tooling check issue, not runtime logic).
5. Extra `warnings` on error result variant: **MINOR** (type-contract drift if strict consumers rely on exact union shape).

## Summary Verdict (COMPLETE / PARTIAL / MISSING)
**PARTIAL**

Core replay engine is implemented and largely aligned with plan/pseudocode, but there are meaningful divergences in malformed-rate computation and specific event-handling/type-contract details.