# Plan for #3597 — apply_patch duplicates file content when hunks arrive out of line order

## Root cause (verified against diff@8.0.4 source and reproduced locally)

`ApplyPatchTool.applyPatchToContent` passes the parsed patch straight to
`Diff.applyPatch`. In diff 8.0.4's `applyStructuredPatch`, hunks are applied
sequentially: each hunk is located with `toPos = hunk.oldStart +
prevHunkOffset - 1`, results are assembled by copying from the end of the
previous hunk's region (`minLine`) up to `toPos`, and after each hunk `minLine`
is *assigned* `hunkResult.oldLineLastI + 1` — it is never clamped forward. A
hunk that targets an earlier line than its predecessors therefore rewinds the
copy cursor, and the final tail-copy loop (`for i = minLine; i <
lines.length`) re-emits lines that earlier hunks already produced. The
operation reports success.

Reproduced with the issue's exact hunk shape (`@@ -268,2 +268,1 @@`,
`@@ -278,5 +277,2 @@`-style hunks at 268/278/308 followed by `@@ -208,1 +208,1 @@`)
against a 320-line synthetic Rust-like file: the result had 425 lines, three
distinctive markers each appeared twice, the `-208` replacement landed once
while the original line 208 text remained — reported as success (scratch repro
in `tmp/verify3597/repro.ts`, not part of the deliverable).

## Fix (fail fast)

Reject the patch before any file read or write when hunk `oldStart` values are
not strictly increasing (next `oldStart` must be greater than the previous;
equal anchors are rejected too, since ordering between them is ambiguous).

- `packages/tools/src/tools/apply-patch-analysis.ts`: new pure helper
  `validateHunkOrder(patch)` returning a `ToolResult | null` rejection built in
  the existing message style — llmContent names hunk numbers, both old-start
  line numbers, the full received order, and the remedy (send hunks in
  ascending order of the original file's line numbers, or split into separate
  apply_patch calls); error type `INVALID_TOOL_PARAMS`.
- `packages/tools/src/tools/apply-patch.ts`:
  - `execute`: run the check after header/target validation, before the size
    gate and content read, so nothing is touched on rejection (atomic).
  - `shouldConfirmExecute`: run the same check and return `false` (no preview)
    so confirmation and execution stay in lockstep; `execute` emits the
    actionable error.

Single-hunk, creation (`--- /dev/null`), and deletion (`+++ /dev/null`) patches
are structurally unaffected: the check only compares consecutive hunks and a
one-hunk patch has nothing to compare. Ascending multi-hunk patches are
unchanged.

## Test-first sequence

1. RED — new `packages/tools/src/__tests__/apply-patch-hunk-order.bun.test.ts`
   (bun test, 2026 copyright, real `ApplyPatchTool` via
   `validateBuildAndExecute` against a real temp dir; no mocks of the tool):
   - rejects the 268/278/308/208 ordering with `INVALID_TOOL_PARAMS`, message
     naming the offending hunks/lines and the remedy, target file byte-identical
     on disk.
   - same four hunks reordered ascending (208/268/278/308) apply cleanly, no
     duplicated content.
   - rejects two hunks anchored at the same original line (pins the "strictly
     increasing" boundary).
   - single-hunk patch, `/dev/null` creation, and `/dev/null` deletion still
     succeed.
   - `shouldConfirmExecute` produces no confirmation for the non-monotonic
     patch in default approval mode (confirmation parity with execute).
2. GREEN — implement the two file changes above; new test and the two existing
   apply-patch suites must pass.
3. Full verification cycle: targeted tests → `npm run test` → lint → typecheck
   → format → build → zai-glm-flash smoke (all long steps detached under
   `tmp/verify3597/` per the watchdog constraint).

## Results

Complete. The implementation matches the plan exactly:

- `validateHunkOrder` in `apply-patch-analysis.ts` rejects any patch whose
  consecutive hunk `oldStart` values are not strictly increasing (equal
  anchors included), returning an `INVALID_TOOL_PARAMS` `ToolResult` whose
  llmContent names the offending hunk numbers, both line numbers, the full
  received order, and the remedy. It is a pure function in the file's existing
  message style.
- `apply-patch.ts` `execute` runs the check after header/target validation and
  before the size gate, content read, backup, or write — rejection is atomic
  (target file byte-identical on disk, verified by the new tests).
- `apply-patch.ts` `shouldConfirmExecute` runs the same check and returns
  `false` (no preview), keeping confirmation and execution in lockstep; the
  actionable error comes from `execute`.
- Creation (`--- /dev/null`) and deletion (`+++ /dev/null`) patches are
  structurally unaffected (a one-hunk patch has no consecutive pair to
  compare); ascending multi-hunk, single-hunk, create, and delete paths are
  all covered by passing tests.
- One cosmetic touch-up during final review: the new execute-step comment was
  relabeled `5c` → `5a` so the sequence reads 5, 5a, 5b (comment-only, no
  behavior change).

## Verification log

- Targeted `bun test` (apply-patch.test.ts, apply-patch-ax.bun.test.ts,
  apply-patch-hunk-order.bun.test.ts): PASS — 54 pass, 0 fail, 207 expect()
  calls across 3 files (`tmp/verify3597/targeted.log`).
- `npm run test`: PASS — full suite completed successfully in the prior
  session (`tmp/verify3597/test.log`); not re-run this session because no
  source behavior changed after it.
- `npm run lint`: PASS — re-run to completion this session; 18/18 packages,
  zero error markers in the log (`tmp/verify3597/lint.log`).
- `npm run typecheck`: PASS — re-run to completion this session (the prior
  session's run was cut off); 18 package typecheck invocations, zero `error
  TS` lines (`tmp/verify3597/typecheck.log`).
- `npm run format`: PASS — completed; `git status` after formatting showed
  only issue-relevant files modified, nothing unrelated to revert
  (`tmp/verify3597/format.log`).
- `npm run build`: PASS — completed with the final registry-coherence
  verification line and zero error markers (`tmp/verify3597/build.log`).
- Smoke (`zai-glm-flash`): PASS — `bun scripts/start.ts --profile-load
  zai-glm-flash "write me a haiku and nothing else"` booted the CLI, loaded
  the profile (glm-5.3-flash), and returned a three-line haiku
  (`tmp/verify3597/smoke.log`).

All long steps ran detached under `tmp/verify3597/` per the watchdog
constraint.

## Known follow-ups / open questions

- Overlapping hunks with *increasing* old-start values (e.g. `@@ -10,5 @@`
  then `@@ -12,3 @@`) are not rejected by this change; jsdiff's sequential
  search handles or fails on them per its own rules. No incident reported;
  left out of scope to keep the fix exactly on the reported failure mode.
- The tool description string in `apply-patch.ts` was not updated to state the
  ascending-order rule; the rejection message itself carries the guidance the
  model needs at failure time. Updating the description would change the
  schema text all agents see — worth doing only if mis-ordered hunks recur.
