# Issue #3428 — Bound retained tool-result bodies and render-path inputs

## Summary

After #3386 (Ink cache bounds) and #3426 (pre-layout trim for the string render
path), the remaining unbounded memory term is honest retention: full
tool-result display bodies are kept in UI state for the life of the session,
and the object render path still hands full bodies to layout.

Concretely, in today's code:

1. **Display strings are created unbounded and retained in UI scrollback.**
   The turn-store history ledger (`packages/cli/src/ui/stores/turn/historyLedger.ts`)
   bounds the *total* scrollback (4 MiB / 400 items, issue #2852), but the
   per-result bound is whatever the total budget leaves — a single large
   result can retain megabytes until total pressure forces a trim. The issue
   asks for a fixed per-result cap "on the order of tens of KB".
2. **The replay path materializes fully prettified JSON.**
   `safeToolResultToString` in `packages/cli/src/ui/utils/iContentToHistoryItems.ts`
   runs `JSON.stringify(result, null, 2)` on tool-response results when a
   session is restored, building and retaining the whole prettified body for
   large JSON results.
3. **The object render path has no pre-layout budget.**
   `renderStringContent` applies `trimToVisibleTail` before `MaxSizedBox`
   layout (#3426), but `renderObjectContent` → `renderContentWithMetadata`
   passes the full `content` string of `{ content, metadata }` results to
   `MarkdownDisplay` with no bound, so a single render's layout cost still
   scales with input size.
4. **No on-demand expansion.** `ctrl-s` only lifts the height constraint on
   what is already in memory; once bodies are capped, the full text must come
   back from the on-disk session transcript (issue #854 point 1).

Model-facing content is out of scope and must not change (acceptance
criterion 5): the core `HistoryService` copy, `response.result`,
`response.llmContent`, and `response.responseParts` stay untouched. Only the
UI/display copies are capped.

## Chosen design

### A. One shared retention boundary module

New module `packages/cli/src/ui/utils/toolResultRetention.ts` owning the
per-result display retention boundary so the cap, the history ledger, and the
future #854 scrollback system share one implementation instead of three:

- `TOOL_RESULT_RETENTION_CAP_BYTES` — stated, small, per-result cap.
  64 KiB (32 KiB head + 32 KiB tail) fits "tens of KB per result" with room
  for a marker; the number must appear verbatim in the AC1 test.
- `boundResultDisplayForRetention(text: string): { text: string; wasCapped: boolean; originalLength: number }`
  — UTF-8-safe prefix + truncation marker + suffix, never splitting a code
  point. Extract the existing `previewText`/`takeUtf8`/`TRUNCATION_MARKER`
  logic out of `historyLedger.ts` into this module and have the ledger import
  it (single boundary; ledger keeps its total-budget trimming as the outer
  boundary).
- `stringifyForDisplay(value: unknown): string` — budgeted serializer with a
  depth cutoff and a size cutoff. Pretty-prints like today for anything that
  fits; beyond the depth/size budget it emits an explicit omission marker
  (e.g. `[... deeper levels omitted from display; full result is in the
  session transcript ...]`) instead of materializing the full body. Replaces
  the raw `JSON.stringify(result, null, 2)` in `safeToolResultToString`.

The truncation marker text says where the full body lives (session
transcript), matching the ledger's existing marker convention.

### B. Apply the cap at display-construction boundaries

Cap only what the UI retains, at the seams where display strings are created:

- `packages/cli/src/ui/hooks/toolMapping.ts` (`mapToDisplay`) — live path:
  cap string `resultDisplay` values as scheduler responses become display
  items.
- `packages/cli/src/ui/hooks/shellCommandProcessor.ts` — live shell path: cap
  `finalOutput` at commit into the history item.
- `packages/cli/src/ui/utils/iContentToHistoryItems.ts` — replay path:
  `safeToolResultToString` becomes cap-aware (strings capped, objects through
  `stringifyForDisplay`).
- `IndividualToolCallDisplay` (`packages/cli/src/ui/types.ts`) gains an
  optional, serializable `retention?: { capped: boolean; originalLength: number }`
  field set when capping, so the renderer knows a body is capped and can offer
  expansion. The marker text itself also tells the reader.

Live streaming accumulation (`accumulateLiveOutput`, pending items during
execution) is transient by construction — scheduler state is cleared when all
calls complete (`onAllToolCallsComplete` pushes `[]`) — so it is deliberately
not capped mid-flight; the cap lands at commit.

The ledger's existing per-item/total trimming stays as the outer boundary and
now imports the shared helpers.

### C. Pre-layout budget for the object render path

In `ToolResultDisplay.tsx`, `renderContentWithMetadata` applies the same
pre-layout treatment the string path got in #3426: when
`availableTerminalHeight` is defined, run the `content` string through
`trimToVisibleTail` and report hidden lines, so a large `{ content }` result
costs what its visible window costs to lay out.

`renderFileDiffContent`/`DiffRenderer` and `MarkdownDisplay` internals are
**not** touched: budgeting those full-buffer processors is issue #3431's
scope. This PR bounds the *input* handed into them, which is what #3428's
acceptance criterion 3 measures.

### D. Expansion loads from the transcript on demand, with forward purge

Acceptance criterion 2 requires the full body to come back when a capped
result is expanded, and to not be permanently re-retained.

- **Reader**: a small lookup (e.g. `readToolResultBody(sessionId, callId)`)
  that scans the session's recorded JSONL for the `tool_response` block with
  that `callId` and returns the raw result. The recording module already
  writes every tool response before the UI ever displays it, so the transcript
  is the source of truth. The scan is streaming/line-wise (bounded memory —
  parse one JSONL line at a time, stop at the match), not a full-file load.
- **UI**: capped results render a hint (consistent with existing
  `ShowMoreLines`/`ctrl-s` conventions — final wording per implementation,
  e.g. `[display capped at 64 KiB; press ctrl-s to load the full output from
  the session transcript]`). When height constraints are lifted (`ctrl-s`),
  capped items currently in view fetch their full bodies and render them;
  non-capped items behave exactly as today.
- **Forward purge**: expanded bodies live in a bounded expansion map keyed by
  `callId`; the map is purged when new history items are appended (the item
  has scrolled forward out of the tail), when the ledger trims the item, and
  is hard-capped to a small number of entries (e.g. the most recent 3). No
  permanent re-retention: after purge, the capped preview renders again.
- This establishes the seam #854 point 1 describes (scroll-back load,
  scroll-forward purge) at the same retention boundary module, without
  building #854's full scroll system or context-highlighting UI.

### E. Not adopted: Buffer/Uint8Array backing (goal 3, optional)

The issue allows external-memory backing only "if measured". #3425 measured
RSS on Bun 1.3.14 darwin-arm64 not visibly falling after freeing Buffers, so
this PR does not adopt it. Recorded here as a known follow-up requiring new
measurements first.

## Acceptance criteria (test-first mapping)

All tests are behavioral Bun tests (bun:test); no mock theater, no asserting
implementation details. Full rules in `dev-docs/RULES.md` and the
`typescript-test-writing` skill.

- **AC1 — stated per-result cap, bounded long session.** A test asserts the
  cap constant is small and literal (the number, not a derived expression),
  and a long synthetic session (many large results committed through the
  display-construction boundaries) retains bounded result-display bytes:
  every retained `resultDisplay` ≤ cap + marker overhead, and total retained
  display bytes grow with *result count*, not result sizes (double the body
  size, same retained bytes).
- **AC2 — expand-from-transcript + forward purge.** With a real session file
  recorded through the actual recording service, expanding a capped result
  returns the exact original body by `callId`; after the purge triggers (new
  appends / trim / map cap), the expanded body is gone from UI state and the
  capped preview renders again.
- **AC3 — object path renders under the same budget.** The
  `ToolResultDisplay.retention.behavior.test.tsx` JSC settled-heap harness is
  extended to `{ content }` object results: a single large object render's
  marginal retained heap no longer scales with input size (same measurement
  discipline the string-path tests use — settled heap after `gcAndSweep`,
  thresholds with documented headroom, sabotage-checked numbers recorded in
  the plan after measurement).
- **AC4 — tmux workload evidence.** A new fake-provider tmux script
  (patterned on `scripts/tmux-script.issue3386-memory-retention.fake.json`)
  drives many turns with large tool outputs, takes forced-GC checkpoint
  samples between turns, and the memory report shows retained-heap growth
  proportional to turn count, not to output volume (a run with 2× output per
  turn shows ~same retained-heap slope per turn). Run locally with the tmux
  harness + `scripts/memory/report.ts`; measured numbers recorded below.
  Documented as a harness (not CI) consistent with #3386's precedent.
- **AC5 — model context unchanged.** Tests assert the model-facing copies are
  untouched when capping fires: `response.result`/`llmContent` and the
  functionResponse parts assembled for the model still carry the full body;
  `HistoryService` content is byte-identical with and without the display
  cap in the path.

## Files expected to change

- `packages/cli/src/ui/utils/toolResultRetention.ts` (new) — shared boundary,
  cap, budgeted serializer.
- `packages/cli/src/ui/stores/turn/historyLedger.ts` — import shared helpers.
- `packages/cli/src/ui/hooks/toolMapping.ts` — cap at live display commit.
- `packages/cli/src/ui/hooks/shellCommandProcessor.ts` — cap at live commit.
- `packages/cli/src/ui/utils/iContentToHistoryItems.ts` — replay path cap +
  budgeted serialization.
- `packages/cli/src/ui/types.ts` — optional `retention` field.
- `packages/cli/src/ui/components/messages/ToolResultDisplay.tsx` — object
  path pre-layout trim + capped hint.
- Transcript reader (new, small) + expansion state with forward purge (wiring
  per D; exact files per implementation, likely a hook near the history
  render path).
- Tests: new `*.test.ts(x)` / behavior tests per ACs; extension of
  `ToolResultDisplay.retention.behavior.test.tsx`; tmux script + report run.
- `docs/memory-profiling.md` only if the tmux workload section needs the new
  script named.

## Verification

The full issue-workflow verification cycle (`npm run test`, `lint`,
`typecheck`, `format`, `build`, and the `zai-glm-flash` smoke test) runs
before commit/push, plus the AC4 tmux measurement below (measured
2026-09-17, Bun on darwin-arm64, forced-GC samples via the source
memprofile probe).

### AC4 tmux workload measurement (2026-09-17)

Artifacts:

- Fixture: `scripts/fixtures/issue3428-tool-result-retention.responses.jsonl`
  (34 lines = 17 fake turns; each workload turn is a `run_shell_command`
  tool call driving `scripts/memory/output-generator.ts`, followed by a
  marker/stop turn).
- Script: `scripts/tmux-script.issue3428-tool-result-retention.fake.json`
  (same launcher shape as the #3386 script: offline fake provider, fixed
  120x40 pane, memprofile launcher with periodic sampling disabled, clean
  `/quit` exit).
- Snapshot diagnostic pair:
  `scripts/fixtures/issue3428-tool-result-retention-snapshot.responses.jsonl`
  + `scripts/tmux-script.issue3428-tool-result-retention-snapshot.fake.json`
  (the 13-turn prefix of the same workload — phases through xlarge — with
  `--snapshots --max-heap-mb 1024`; the final checkpoint requests a heap
  snapshot instead of a sample).

Commands:

```bash
bun scripts/tmux-harness.ts \
  --script scripts/tmux-script.issue3428-tool-result-retention.fake.json \
  --out-dir tmp/verify3428/tmux3428 --assert
bun scripts/memory/report.ts tmp/verify3428/tmux3428/memprofile
# snapshot diagnostic:
bun scripts/tmux-harness.ts \
  --script scripts/tmux-script.issue3428-tool-result-retention-snapshot.fake.json \
  --out-dir tmp/verify3428/tmux3428snap --assert
bun scripts/memory/heapanalyze.ts \
  tmp/verify3428/tmux3428snap/memprofile/snapshots/snap-*.heapsnapshot \
  --top 25 --min-mb 2
```

Workload phases (tool result body sizes are pre-cap raw output; token
limiting reduces the model-facing copy of every 1-2 MiB body to a 31-byte
warn message, verified in the recorded session transcript):

| Phase    | Turns | Body/turn | Purpose |
| -------- | ----- | --------- | ------- |
| small    | 3     | ~4 KiB    | per-turn overhead baseline (first-use warmup included) |
| large    | 3     | ~1 MiB    | first encounter of 1 MiB bodies |
| xlarge   | 3     | ~2 MiB    | 2x bodies vs large phase |
| xlarge-repeat | 3 | ~2 MiB    | same size again: isolates steady-state slope from first-encounter effects |

Forced-GC checkpoints (`request-cli --wait`, gcAndSweep before each
sample), heap bytes / object count:

| Checkpoint | heap bytes | objects |
| ---------- | ----------:| -------:|
| CK_BASE (booted, 0 workload turns)  | 253,340,545  | 903,531 |
| CK_SMALL (after 3x4 KiB)            | 262,435,156  | 965,156 |
| CK_BIG (after 3x1 MiB)              | 280,013,651  | 1,027,686 |
| CK_HUGE (after 3x2 MiB)             | 297,116,860  | 1,029,999 |
| CK_HUGE2 (after 3 more x2 MiB)      | 298,500,212  | 1,036,761 |

Phase deltas (a first, shorter run the same day reproduced these within
noise: +9,253,196 / +18,243,853 / +16,791,951):

| Phase | heap delta | per turn | objects delta | strings delta |
| ----- | ----------:| --------:| -------------:| -------------:|
| small (3x4 KiB)         | +8.67 MB | ~2.9 MB | +61,625 | +3,255 |
| large (3x1 MiB)         | +16.76 MB | ~5.6 MB | +62,625 | +2,565 |
| xlarge (3x2 MiB)        | +16.31 MB | ~5.4 MB | +2,313 | +144 |
| xlarge-repeat (3x2 MiB) | +1.32 MB | ~0.44 MB | +6,762 | +3,085 |

Interpretation:

- Steady-state slope (xlarge-repeat): three more 2 MiB bodies (6 MiB of
  additional tool output) retained +1.32 MB total (~0.44 MB/turn,
  +3,085 strings). This is per-turn UI item/ledger/render overhead plus
  the 64 KiB capped display body; it does not track output volume.
- Doubling the body size did not double retention: large vs xlarge
  deltas are +16.76 vs +16.31 MB, and the xlarge delta carried almost no
  new strings (+144) or objects (+2.3K).
- The multi-MB first-encounter deltas are not retained output. The heap
  snapshot at CK_HUGE (281 MB heap, retainer paths proven) shows the
  growth lives in (a) `WebAssembly.Memory` instances of the token
  encoder (92.3 MiB across 6 ArrayBuffers, largest 44.3 MiB) —
  grow-only high-water that expands when a larger input is first encoded
  and saturates (why xlarge-repeat is flat) — and (b) one
  `BoundedCombinedCollector` holding `headBytes`+`tailBytes` Uint8Arrays
  of 2.0 MiB each: the singleton 4 MiB acquisition budget buffer, bounded
  by design. No large tool-output strings appear as retained objects
  anywhere in the snapshot.
- Transcript cross-check: the recorded `tool_response` for every 1-2 MiB
  turn is the 31-byte warn message (`{"output":"

(output exceeded
  token limit)"}`), and the 4 KiB turns record their full ~4.4 KiB
  output; the history/recording copy is bounded exactly as designed.

Verdict: AC4 demonstrated. Retained-heap growth at forced-GC checkpoints
is proportional to turn count (~0.4-0.5 MB/turn steady state with 2 MiB
bodies), not to result sizes or accumulated output bytes; first-encounter
growth is encoder WASM high-water expansion and first-use code paths, not
retained display bodies.

Operational notes:

- The 17-turn run completed all checkpoints but the CLI did not exit
  within the 30 s `waitForExit` budget after `/quit` (both 13-turn runs
  exited cleanly); the harness killed the session and exited nonzero.
  All five forced-GC samples were written before the quit step, so the
  measurement stands. Worth a look if the harness is used for longer
  workloads, but not chased here.
- Non-blocking observation for the issue thread: for outputs that exceed
  the token limit, the session transcript records only the warn message,
  so the design-D expand-from-transcript path cannot restore the original
  body for those results (the cap marker text should not promise the
  transcript has it in that case). Pre-existing limiter behavior, not a
  retention regression; flagged as follow-up, no code change made here.

## Out of scope

- #854's scrollback system beyond the shared seam (context highlight markers,
  summary expansion UI).
- #3431's MarkdownDisplay/DiffRenderer internal budgets.
- #3199 image history bounding.
- Buffer/Uint8Array backing (see E).
- Any change to what the model receives (AC5 guards this).

## Review remediation

Round 1 fixes for the two actionable findings from the compliance review:

1. **HIGH (lint gate)** — `ToolMessage.tsx`: the `ToolMessage` component
   arrow function was 83 lines, over the repo's `max-lines-per-function`
   limit of 80. Fixed by extracting the transcript-backed result rendering
   (`useExpandedResultDisplay` + `ToolResultDisplay` + the retention hint)
   into a `ToolMessageResultBody` sub-component in the same file; the
   component now passes the raw `callId`/`retention`/`resultDisplay`
   through `renderToolMessageContent`. Rendered output is identical; the
   existing `ToolMessage.test.tsx` / `ToolMessage.retention.test.tsx`
   suites were untouched and stay green.
2. **MEDIUM (byte budget)** — `toolResultRetention.ts`: `BoundedEmitter`
   accumulated UTF-16 code units against a limit derived from
   `TOOL_RESULT_RETENTION_CAP_BYTES`, so a CJK-heavy structured result could
   replay at ~3x the cap in UTF-8 bytes (measured 196,234 B vs the 65,536 B
   cap). Fixed by accounting the budget in UTF-8 bytes
   (`Buffer.byteLength` per pushed chunk, `SIZE_OMISSION_LINE` reserve now
   byte-derived); stop/refuse semantics and the trailing omission line are
   unchanged. New test
   `stringifyForDisplay > bounds a CJK-heavy structured result by UTF-8 bytes, not code units`
   fails at 196,234 B before the fix and passes after; ASCII output remains
   byte-identical to `JSON.stringify(value, null, 2)`.

Verified: targeted eslint clean on both files; the four affected suites
(ToolMessage, ToolMessage.retention, toolResultRetention,
iContentToHistoryItems) pass 80/80; `npm run typecheck` in packages/cli
exits 0. The remaining LOW findings from the review are documented as
follow-ups and were not addressed in this round.
