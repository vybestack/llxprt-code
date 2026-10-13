# Issue #3599: read a single line longer than 2000 characters

## Problem

`read_file` and `read_line_range` clip each text line to 2000 characters
(`MAX_LINE_LENGTH_TEXT_FILE` in `packages/tools/src/utils/fileUtils.ts`) and give
no way to read the rest. For a one-line file the truncation note also told the
model to "use offset: 1", a line that does not exist
(`tmp/verify3599/repro.log`).

## Accepted scope

- `read_file` gains an optional `column_offset` (integer >= 0, default 0).
  Units are UTF-16 code units (JavaScript string indices), the same unit the
  existing clipping uses. It applies to every selected line, and each line
  window stays capped at 2000 characters.
- Clipped lines are reported in `ProcessedFileReadResult.clippedLines`
  (`lineNumber`, `lineLength`, `nextColumnOffset`). `linesShortened` is kept.
- A shared `formatClippedLineGuidance` (in `packages/tools/src/utils/clippedLineGuidance.ts`,
  kept out of `fileUtils.ts` to stay under its `max-lines` limit) produces the
  note used by both tools. It
  states the cap, the line number and length, and a JSON `read_file` call
  (`offset` = line - 1, `limit` 1, `column_offset` = next window start). It
  lists at most 10 clipped lines. When more are clipped, it says how many were
  left out and gives a `read_file` call (`offset`, `limit` covering exactly
  the omitted lines, same `column_offset`) whose result lists them with their
  own continuation calls.
- `read_file` suggests the next line `offset` only when `linesShown` ends before
  the last line.
- `read_line_range` keeps its parameters; its clipping note now carries the
  same `read_file` continuation.
- The optional `columnOffset` argument of `processSingleFileContent` selects
  continuation-aware clipping. `read_file` always passes it (its
  `column_offset`, default 0) and `read_line_range` passes 0, so both tools
  clip with the same windows. A continuation-aware window never ends inside a
  surrogate pair, so consecutive windows concatenate back to the exact source
  text. This includes the default window at `column_offset` 0: a pair that
  straddles character 2000 moves to the next window, so the first window is
  1999 characters long.
- Helper callers that omit `columnOffset` (for example `read-many-files`) keep
  the original clipping exactly: `line.substring(0, 2000)` plus
  `... [truncated]`, with no surrogate alignment and no continuation data. The
  same file read through the helper without a column offset and through
  `read_file` therefore differs only for a pair straddling character 2000.

## Out of scope

Duplicate `packages/core/src/utils/fileUtils.ts` (the registered tool uses the
`@vybestack/llxprt-code-tools` implementation), workflow, agent memory,
`.llxprt/`, lint or scanner configuration, dependencies.

## TDD sequence

Tests: `packages/tools/src/tools/read-file-column-offset.issue3599.bun.test.ts`,
real temp files, real tools, recommended calls parsed from the tool output and
executed.

1. RED: whole file written first, run against unmodified source
   (`tmp/verify3599/red-all.log`: 6 pass / 15 fail; the 6 passes are
   unchanged-behavior guards and boundaries that cannot fail before the change).
2. GREEN: implement `fileUtils.ts` windowing and metadata, `read-file.ts`
   parameter and guidance, `read_line_range.ts` note
   (`tmp/verify3599/green-all.log`).
3. RED for the later-added clipped-list bound: mutated cap to 100, test failed
   (`tmp/verify3599/red-list-cap.log`), restored, GREEN. The surrogate test was
   likewise added after the implementation and validated by disabling the
   guard (`tmp/verify3599/red-surrogate.log`). These two tests were not
   test-first and cannot be made so retroactively; this is disclosed, not
   hidden.
4. Review remediation, strictly test-first: tests for the helper default, the
   executable bounded-list narrowing, the nonzero window across lines and
   the annotated git placement were written and run against the candidate
   before the fixes (`tmp/verify3599/remediation/red.log`: 26 pass / 3 fail,
   the 3 failures being the helper default and the bounded-list narrowing at
   two column offsets). The other new tests pin behavior that already held, so
   they were confirmed by mutation instead
   (`tmp/verify3599/remediation/red-mutation-window-gitorder.log`). Then the
   fixes (`tmp/verify3599/remediation/green.log`).

## Review and triage

- OCR: review skipped per Andrew 2026-10-09. It was not run.
- Delegated review: a delegated reviewer completed an initial review of the
  candidate. Its findings were triaged as follows.
  - In-scope fix (1): the shared helper default clipped at 1999 instead of
    2000 for callers that omit the column offset.
  - In-scope fix (2): missing durable regression tests (column window across
    lines, annotated clipped continuation placement, executable bounded-list
    recovery, helper boundary).
  - In-scope fix (3): the new collection logic in `fileUtils.ts` mutated an
    external array with `push`.
  - In-scope fix (4): the evidence labelled the skipped OCR as the review.
  - Deferred: historical TDD provenance for the two late mutation-validated
    tests. They cannot become test-first after the fact; the disclosure stays
    and the remediation follows test-first.
  - Rejected: a broader paging subsystem, grapheme-cluster offsets, shifting
    arbitrary explicit positions automatically, and edits to the duplicate
    `packages/core` file utilities, dependencies, workflows, agent memory or
    rules.

## Verification

See `evidence.md`.
