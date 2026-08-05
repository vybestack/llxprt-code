# Issue #3036 — Range-editor tools: trailing-newline loss, phantom line counts, false truncation banner

## Problem

`packages/tools/src/tools/{delete_line_range,insert_at_line,read_line_range}.ts` all treat the
result of `content.split('\n')` as "the lines of the file". For a POSIX file that ends in a
newline this yields a phantom trailing `''` element which *is* the final newline, not a line.
Five defects follow from that (plus one documentation mismatch):

1. `delete_line_range` consumes the phantom element — and therefore the file's final newline —
   whenever `end_line` exceeds EOF, so `delete(3,3)` and `delete(3,999)` on `aaa\nbbb\nccc\n`
   produce different files.
2. Bounds-error messages report `lines.length` (phantom included), so a 7-line file is described
   as having 8 lines.
3. `insert_at_line`'s tool description promises append-past-EOF; the implementation rejects it.
4. `read_line_range` prefixes every ordinary partial read with
   `IMPORTANT: The file content has been truncated.` plus an `Action:` line that suggests the
   exact call the caller just made.
5. `read_line_range` with `start_line` past EOF returns an inverted range
   (`Showing lines 15-14 of 14`) with empty content and no error.

## Accepted behaviour (acceptance criteria)

### AB1 — `delete_line_range` never changes the file's trailing-newline state

Line splitting must be newline-aware: a file's line count excludes the phantom element, and the
file's final-newline state is preserved across the edit.

| Given file content     | Call                | Expected file afterwards |
| ---------------------- | ------------------- | ------------------------ |
| `aaa\nbbb\nccc\n`      | delete(3, 3)        | `aaa\nbbb\n`             |
| `aaa\nbbb\nccc\n`      | delete(3, 999)      | `aaa\nbbb\n`             |
| `aaa\nbbb\nccc`        | delete(3, 3)        | `aaa\nbbb`               |
| `aaa\nbbb\nccc`        | delete(3, 999)      | `aaa\nbbb`               |
| `aaa\nbbb\nccc\n`      | delete(1, 999)      | `` (empty, no newline)   |
| `aaa\nbbb\nccc\n`      | delete(2, 2)        | `aaa\nccc\n`             |

- The deleted-content echo in `llmContent` contains exactly the real deleted lines (`ccc`), never
  a trailing phantom blank line.
- `returnDisplay` and the success `llmContent` report the *effective* (clamped) range and count —
  `delete(3, 999)` on a 3-line file reports 1 line deleted over lines 3-3, not 997 lines.
- `shouldConfirmExecute` computes its diff preview from the same newline-aware logic, so the
  preview matches the bytes `execute` writes.

### AB2 — Line counts in user-facing messages are real line counts

- `insert_at_line(line_number: 999)` on a 7-line newline-terminated file reports file length `7`.
- `delete_line_range(start_line: 100)` on an 8-line newline-terminated file reports file length `8`.
- A file whose content is `''` has 0 lines; a file whose content is `'\n'` has 1 (empty) line.
  Consequently `delete_line_range(1, 1)` on an empty file is an out-of-bounds error rather than a
  silent no-op.
- The `error.message` (the half that actually reaches the caller) carries the actionable guidance,
  not only `llmContent`: the insert error states the append position, e.g.
  `line_number 999 exceeds file length (7); use line_number <= 8 to append`.

### AB3 — `insert_at_line`'s description matches its behaviour

Resolution chosen: **correct the description, keep the bounds check.** Silently relocating content
to EOF when the caller passes a stale/incorrect line number risks writing content in the wrong
place with no signal; failing fast with an actionable message is the safer contract and matches the
project's fail-fast preference.

- The tool description (and `packages/core/src/prompt-config/defaults/tools/insert-at-line.md`,
  which mirrors it) no longer claims content is appended when `line_number` exceeds the total
  lines; it states the valid range is `1 .. totalLines + 1`, where `totalLines + 1` appends.
- `insert_at_line(line_number: totalLines + 1)` appends and preserves the trailing-newline state:
  on `aaa\nbbb\nccc\n` with content `ddd\n`, line 4 yields `aaa\nbbb\nccc\nddd\n`.
- `insert_at_line(line_number: totalLines + 2)` returns an error (it must not silently insert a
  spurious blank line, which is what the phantom element caused today).

### AB4 — `read_line_range` only reports truncation when content was actually truncated

- A partial range read that returns exactly the requested lines must not contain
  `has been truncated`, `--- FILE CONTENT (truncated) ---`, or the `Action: To read more…` line.
  It reports the range plainly, e.g. `Status: Showing lines 1-5 of 14 total lines.`
- A range whose end exceeds EOF is likewise not "truncated": lines 10-30 of a 14-line file report
  `Status: Showing lines 10-14 of 14 total lines.`
- Genuine truncation is still flagged: when an individual line was clipped to the maximum line
  length, the response says so. `ProcessedFileReadResult` gains an optional `linesShortened`
  boolean so `read_line_range` can distinguish this from range narrowing; `read-file`'s own banner
  is unchanged (out of scope).
- `showLineNumbers` and `showGitChanges` (legend, warning, marker column) keep working in the new
  plain format.

### AB5 — Reads that start past EOF return an error

- `read_line_range(start_line: 20, end_line: 30)` on a 14-line file returns an error result whose
  message reads `start_line 20 is beyond end of file (14 lines)`. No inverted `15-14` range and no
  empty success body.
- `read_line_range(start_line: 14, end_line: 30)` on a 14-line file still succeeds.

## Out of scope

- `read-file.ts`'s own truncation banner and any other tool that shares `processSingleFileContent`.
- CRLF normalisation, encoding handling, or any other newline concern not raised in the issue.
- `apply_patch` / `ast_edit` AX issues (#3033 and the sibling issue).

## Test plan (tests first)

New Bun test file `packages/tools/src/tools/line-range-tools-issue3036.bun.test.ts`, registered in
`scripts/bun-test-manifest-data-tools.ts`. Behavioural only: tests write a real temp file and run
the real tool against a fake `IToolHost`, asserting on the bytes on disk and on the `ToolResult`
the caller receives. No mock assertions. (The tool-description and prompt-config mirror assertions
inspect the tool's static text and read no temp file.)

Coverage: every row of the AB1 table (byte-exact file content assertions, including the
trailing-newline byte), the AB1 echo/report assertions and the confirm-preview equality, both AB2
count assertions plus the empty-file and `'\n'` cases and the actionable `error.message`, the AB3
append/reject pair plus a description assertion, the AB4 banner-absence/plain-status/line-shortened
trio with a `showLineNumbers` and a `showGitChanges` variant, and both AB5 cases.

Every test that asserts a reported defect must fail on `main` for the stated reason before the fix
lands; positive-boundary and regression tests exist to pin behaviour that must not change.

### Regression guard: zero-line file creation

`splitFileLines` models an empty file as zero lines with no trailing newline. Before issue #3036
the phantom trailing `''` from `content.split('\n')` guaranteed a newly created file was always
newline-terminated; removing the phantom line would otherwise have changed how a new/empty file is
created. A regression block pins that `insert_at_line` into a zero-line file (a non-existent file
being created, or a truly empty file) always writes a newline-terminated result, and that the
confirmation preview equals the bytes `execute` writes.
