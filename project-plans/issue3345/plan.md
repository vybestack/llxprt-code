# Issue #3345 plan: P0 inventory, spike, and selection design note

## Scope

Issue #3345 proposes five phases. Only P0 is unblocked:

- P1 sits behind an explicit "Selection go/no-go gate" that maintainers open or
  close after P0 and the selection design note.
- P2, P3, and P4 sit behind P1.

P0 is also explicitly a no-code phase: "Build a spike branch against one pinned
upstream release ... catalog every compile failure and behavior gap, and publish
the list. **No mainline dependency change.**"

This effort therefore delivers P0 plus the gated selection design note, and
nothing else. No production source, manifest, lockfile, or dependency was
changed.

## Acceptance criteria

| # | Criterion | Where satisfied |
| --- | --- | --- |
| A1 | A spike is built against one pinned upstream release (7.1.1) with no mainline dependency change. | `p0-evidence.md` E0-E2, E8; `p0-spike-scripts.md` |
| A2 | Every compile failure against that release is cataloged, with the catalog's limits stated. | `p0-report.md`, "Compile-failure catalog"; E8 |
| A3 | Every behavior gap found is cataloged, not only compile failures. | `p0-report.md`, "Additional inventory found by P0"; E3-E7, E9-E11, E14-E22 |
| A4 | The issue's P1 inventory is validated item by item, and items it missed are added. | `p0-report.md`, "Validation of the issue's five P1 inventory items" |
| A5 | **Partially met.** Both geometry APIs were shown to be live-layout relative and to omit preceding `<Static>` rows; upstream exposes no anchor API; the alternate-buffer layout structurally contains no `<Static>`; and the candidate derivations and their costs are recorded. PTY verification of the row-zero invariant remains open across entry, redraw, resize, clear, failure rollback, signals, and teardown. | `p0-report.md`, "Viewport anchor proof"; E16, E17, E19, E21; `selection-design-note.md`, "Recommendation and conditions for reconsideration" |
| A6 | Community viewport packages are evaluated, and if all are rejected the specific missing contracts are recorded. | `p0-report.md`, "Community viewport evaluation"; E18, E19 |
| A7 | Release selection is settled: whether any published release contains the required memory fixes. | `p0-report.md`, "Memory findings"; E1, E9-E12 |
| A8 | The selection port design note is delivered, covering hit testing, copy reconstruction, current coverage, and highlight painting. | `selection-design-note.md` |
| A9 | A go/no-go recommendation is made for the selection gate, with the reasoning and the conditions that would reverse it. | `p0-report.md`, "Selection go/no-go recommendation"; `selection-design-note.md`, "Gate decision" |
| A10 | The limits of P0 are stated rather than implied. | `p0-report.md`, "What P0 did not cover" |

## Deliverables

| File | Contents |
| --- | --- |
| `p0-evidence.md` | Numbered raw evidence E0-E22. Measurements, source observations, and explicitly labeled interpretations. |
| `p0-spike-scripts.md` | The spike scripts and reproduction commands, inlined rather than committed as `.mjs` files. |
| `p0-report.md` | The published P0 inventory and spike report, including the go/no-go recommendation. |
| `selection-design-note.md` | The gated selection port design note. |

## Verification approach

This effort changes no executable code, so the behavioral evidence is the spike
itself. Every measured claim in `p0-report.md` and `selection-design-note.md`
carries an `E<n>` citation into `p0-evidence.md` or a file-and-line citation into
source that was read.

The repository verification cycle recorded for this work was run. The exact
commands and results were:

- `npm run format`: clean, with no changes.
- `npx prettier --check` on the documents in this directory: passed.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0 after repairing a stale local `@types/yauzl`
  installation that predated this work.
- `npm run test`: exit 0.
- `npm run build`: exit 0.
- `scripts/check-doc-placement.ts`: passed.
- Startup: `bun scripts/start.ts --version` returned `0.11.0` at exit 0.
- Smoke prompt: `bun scripts/start.ts --profile-load stepfun-37 "write me a
  haiku and nothing else"` loaded the profile and reached the provider, then
  failed with `API Error: 400 you have no active step plan subscription`. That
  is an account state on the StepFun side, not a code path this change touches.
  Startup, profile load, and request dispatch all succeeded.

OCR could not review the change because it excludes `.md` as an unsupported
extension; `ocr review --preview` reported all five files as `unsupported_ext`.
An independent content audit was run instead, and its findings were triaged and
applied.

## Outcome

The recommendation remains NO-GO on P1's interim selection port and on an
immediate switch to upstream 7.1.1. The preferred sequence remains "patch now,
then evaluate after the selection gate."

The corrected static-remount evidence changes the memory comparison. Upstream
7.1.1 resets old static output on every terminal resize, history trim or
compression, markdown toggle, and clear, while the fork never resets. Upstream is
therefore better for this application on the static-retention axis (E10). Within
one unchanged `<Static>` identity, both packages still accumulated 61,990
characters for the same computed 61,390-character workload, and P0 measured no
production session, so the size of upstream's workload-dependent advantage is
not quantified (E9, E10).

The overall recommendation did not change for two reasons:

1. Upstream 7.1.1 retains unbounded full-string measure and wrap caches. The fork
   bounds its full-string styled-character cache and has no full-string
   wrap-result cache, although its character-width `Map` is unbounded. The
   synthetic benchmark used one repeated ASCII string shape (E11).
2. Neither package exposes the live-region terminal anchor, and upstream exposes
   no selection, hit-test, or highlight API (E3, E13, E16, E17). The corrected
   community-package comparison also found no package that satisfies the current
   history viewport contracts without retaining substantial application work
   (E18, E19).

A5 remains partially met and is an open P0 obligation. PTY tests must verify the
structurally forced row-zero invariant across entry, redraw, resize, clear,
failure rollback, signals, and teardown before it can serve as acceptance
proof. The decision belongs to maintainers, and the report states the conditions
that would reverse the recommendation.
