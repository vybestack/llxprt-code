# Deep Architecture Review

## Overall Assessment
CONDITIONAL PASS — the plan is mature and implementable, but there are a few high-risk integration assumptions that must be pinned down before execution starts (especially HistoryService instance replacement, non-interactive flush semantics, and resume/continue/resume-flag interactions).

## Critical Concerns
- **HistoryService replacement coupling is still the top failure mode.** The plan correctly recognizes compression can replace the `HistoryService` instance, but successful implementation depends on a reliable rebinding signal. If this is implemented with polling or weak heuristics, dropped `content`/`compressed` events are likely.
- **Deferred materialization + lock lifecycle has edge risk.** The lock-before-file pattern is sound in theory, but implementation needs deterministic lock naming and migration from pre-materialization lock path to file lock path (or unified path strategy) to avoid orphan/duplicate lock behavior.
- **Turn-end flush point may miss non-interactive paths.** Anchoring primarily on `useGeminiStream` lifecycle is correct for interactive UI, but command paths like `--prompt` and potentially `--resume` flows must explicitly flush on completion or they can violate expected durability.

## Architectural Risks
- **Module boundary (`packages/core/src/recording/`) is mostly correct**, but some concerns are CLI-owned:
  - session discovery/list/delete UX formatting and argument resolution should remain in CLI layer;
  - file parser/replayer/writer belongs in core.
  Risk is accidental cross-layer coupling if CLI presentation concerns leak into core service APIs.
- **Event subscription model practicality:** if `geminiChat` reconstructs internals during compression/provider changes, recording integration should hook at a stable abstraction boundary (client/chat lifecycle), not only direct `HistoryService` instance references.
- **Replay scalability risk:** full linear replay is acceptable now, but large files + frequent malformed line warnings can degrade startup UX. Not a blocker, but warn-level logging should be rate-limited/summarized.

## Integration Gaps
- **`--prompt` mode:** plan should explicitly state when recording is enabled, flushed, and finalized in non-interactive one-shot runs.
- **`--resume` interaction:** requested review scope includes this; the plan should explicitly document precedence/exclusivity matrix among `--continue`, `--resume`, `--prompt`, `--list-sessions`, `--delete-session`.
- **Legacy `.json` coexistence:** migration behavior for users with old session files and new `.jsonl` should be explicit (ignored? fallback import? one-time conversion? clear messaging).
- **Session event replay policy is clear in spec**, but implementation phases should ensure historical `session_event`s are retained for auditing while excluded from reconstructed UI list.

## Testing Blind Spots
- Missing explicit tests for:
  - interactive cancellation mid-turn + guaranteed flush in finally path;
  - `--prompt` completion flush and process exit cleanup;
  - stale lock recovery under PID reuse edge case;
  - lockfile behavior when session file never materializes;
  - mixed old/new session artifact directories;
  - ambiguity resolution conflict cases (prefix vs numeric index-like IDs).
- Integration phases (P24–P26) should include at least one end-to-end crash-recovery simulation with truncated last line and one mid-file corruption scenario.

## Issue Alignment
- Overall alignment with #1361–#1369 is strong: event types, replay semantics, locking, session discovery, cleanup adaptation, and old-system removal are all represented.
- Potential drift to check:
  - avoid over-expanding core API surface beyond issue intent (keep minimal recording contract);
  - ensure list/delete behavior remains project-scoped exactly as specified.

## Execution Risks
- Some phases are implementation-dense (notably recording integration and resume implementation) and can hide dependency surprises.
- Ordering is generally sound, but concurrency/lifecycle assumptions should be validated with lightweight spike tests before deep TDD phases to avoid late rework.
- Verification phases are strong structurally; risk is false confidence if they over-mock history lifecycle instead of exercising real replacement behavior.

## Recommendations
1. **Add a pre-flight design note** defining the exact stable rebinding signal for `HistoryService` replacement (owner component + callback contract).
2. **Add explicit CLI mode matrix** for `--continue` / `--resume` / `--prompt` / session-management flags.
3. **Add non-interactive durability tests** (`--prompt`, scripted exit, signal best-effort behavior).
4. **Codify lock naming/state transitions** for deferred materialization (single canonical lock path preferred).
5. **Add migration note for legacy `.json` files** to reduce operator confusion.
6. **Strengthen integration tests** with corruption and crash scenarios using real file IO and minimal mocks.

## Verdict
CONDITIONAL PASS (confidence: medium-high). The blueprint is fundamentally solid and likely to succeed if the identified integration details are clarified before implementation begins.