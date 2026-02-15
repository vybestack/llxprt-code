# Architecture Review #2

## Overall Assessment

I reviewed the issues (#1361–#1369), the plan docs (spec + overview + pseudocode + broad phase sampling), and the target source files. The plan is strong conceptually, but it is **not ready for implementation as-is** because several key assumptions are underspecified or conflict with real integration points in the current code paths.

## Critical Concerns

1. **HistoryService event contract is assumed, not pinned to concrete API details.**
   The plan repeatedly depends on `add` / `compress` events and exact payload shape, plus reliable re-subscription when chat/history instances rotate. This is high-risk unless exact emitter signatures and replacement lifecycle in `geminiChat.ts`, `client.ts`, and `useGeminiStream.ts` are locked in tests first.

2. **Turn-boundary durability hook is fragile.**
   Plan anchors durability to end-of-turn in stream lifecycle (`submitQuery` completion/finally semantics). In current architecture, turn completion, tool completion, cancellation, and error surfacing span multiple layers (hook + UI + core). Without a single authoritative "turn committed" callback in code, flush placement can be early/late and lose or mis-order events.

3. **Resume/replay coupling with UI reconstruction is under-specified for non-content UI items.**
   Plan says UI history is reconstructed from `IContent` and historical `session_event` is not re-rendered. Current UI flow includes richer transient items and status/error behaviors; dropping/reinterpreting them can change perceived behavior after resume.

4. **Locking semantics across creation/resume/cleanup are not operationally unified yet.**
   Plan expects pre-materialization lock ownership, resume lock before replay, and cleanup lock-awareness. If lock-file naming/ownership differs between pre-materialized and materialized states, deletion and session discovery can race.

5. **Migration/removal sequencing (#1368) is too optimistic.**
   Old persistence removal is planned late (good), but phase descriptions rely on complete parity before deletion without a crisp compatibility matrix for interactive, non-interactive, and continue flows.

## Architectural Risks

- **Event ordering race:** async writer queue + external concurrent event sources (provider switch, dir changes, session events, history events) can produce unexpected order unless all enqueue calls run through one serialized service boundary.
- **Compression + rewind replay correctness:** logic is defined, but correctness depends on exact semantics of what HistoryService stores post-compression and what rewind removes in current runtime.
- **Deferred materialization edge case:** sessions with metadata-only changes before first content can reorder or drop metadata unless buffer flushing order is formally tested.

## Integration Gaps

- Non-interactive CLI path coverage is weaker than interactive path despite requiring consistent recording semantics.
- Provider/model switch origin points are distributed; the plan assumes a single reliable hook.
- Directory change capture assumes all mutations funnel through one command pathway.

## Testing Blind Spots

- Insufficient end-to-end tests for:
  - cancel mid-tool + resume
  - crash with partial last line + subsequent append
  - concurrent second process trying `--continue` while first active
  - list/delete behavior with ambiguous prefixes and stale lock permutations
  - cross-mode parity (interactive vs non-interactive prompt mode)
- Replay fuzz/corruption tests should include malformed **known** event payloads, not just unknown type and bad JSON.

## Issue Alignment

- High-level intent aligns well with #1361 and sub-issues.
- Most required capabilities are represented (writer, replay, integration, continue, list/delete, locks, cleanup, removal).
- But issue-level acceptance confidence is reduced by the unresolved concrete integration details above.

## Execution Risks

- 28-phase sequence can produce local progress but still fail at system-level behavior if lifecycle hooks are wrong.
- Late discovery of hook mismatch would force rework across many phases (especially replay + integration + cleanup).

## Verdict

**FAIL**
