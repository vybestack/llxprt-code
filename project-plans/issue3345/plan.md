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
| A3 | Every behavior gap found is cataloged, not only compile failures. | `p0-report.md`, "Additional inventory found by P0"; E3-E7, E9-E11, E14-E29 |
| A4 | The issue's P1 inventory is validated item by item, and items it missed are added. | `p0-report.md`, "Validation of the issue's five P1 inventory items" |
| A5 | **Partially met.** Both geometry APIs were shown to be live-layout relative and to omit preceding `<Static>` rows; upstream exposes no anchor API; the alternate-buffer layout structurally contains no `<Static>`; and the candidate derivations and their costs are recorded. PTY verification of the row-zero invariant remains open across entry, redraw, resize, clear, failure rollback, signals, and teardown. | `p0-report.md`, "Viewport anchor proof"; E16, E17, E19, E21; `selection-design-note.md`, "Recommendation and prototype acceptance" |
| A6 | Community viewport packages are evaluated, and if all are rejected the specific missing contracts are recorded. | `p0-report.md`, "Community viewport evaluation"; E18, E19 |
| A7 | Release selection is settled: whether any published release contains the required memory fixes. | `p0-report.md`, "Memory findings"; E1, E9-E12, E23-E28 |
| A8 | The selection port design note is delivered, covering hit testing, copy reconstruction, current coverage, highlight painting, and the public-surface prototype result. | `selection-design-note.md`; E29 |
| A9 | A conditional recommendation is made for the selection gate, with the prototype evidence and acceptance conditions that decide it. | `p0-report.md`, "Selection go/no-go recommendation"; `selection-design-note.md`, "Gate decision"; E29 |
| A10 | The limits of P0 are stated rather than implied. | `p0-report.md`, "What P0 did not cover" |

## Deliverables

| File | Contents |
| --- | --- |
| `p0-evidence.md` | Numbered raw evidence E0-E29. Measurements, source observations, and explicitly labeled interpretations. |
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

The recommendation changed to two tracks.

First, fix the static leak now on pinned fork 6.4.8 with the ten-line
vadimdemedes/ink#950 dependency patch. It matched upstream 7.1.1 in the remount
probe, requires no application API adaptation, and carries no regression risk
to selection, sticky-header, or scroll behavior (E27). Ink is inlined into the
normal published
bundle, so a build-time patch reaches that path. Forced source entry and
raw-package consumers still resolve the unpatched registry copy (E28). Delete
the patch when migration lands because upstream already ships the same reset.

This fix applies only to interactive sessions that explicitly opted out of
alternate buffer, excluding screen-reader and CI sessions. The schema default is
alternate buffer, and the default layout mounts no `<Static>`, so the default
configuration does not leak (E25). For the exposed population, history is
bounded, but each `refreshStatic()` remount re-emits and appends the complete
current history. Growth is superlinear while history fills. After the bound,
repeated refreshes add approximately one history's rendered output to the
unbounded accumulator each time (E26).

Second, use upstream as the migration destination. Fork 7.1.0 has had no
publication or push since 2026-06-24 and did not incorporate
vadimdemedes/ink#950 (E23). Upgrading to it without `<StaticRender>` leaves the
leak. Adopting `<StaticRender>` keeps the accumulator empty but measured 6.7x
write amplification for the per-item shape, 5.6 times the `<Static>` shape. Its
own documentation leaves growing-list invalidation unsolved (E24). Making it an
application dependency would extend reliance on an inactive fork-only API.

Sequence migration work **A, C, B, D**:

1. Group A is small, about 8 files, for `alternateBuffer` to `alternateScreen`
   plumbing and PTY proof of the row-zero invariant.
2. Group C is medium, about 4 to 6 production files. The application already
   owns scroll state, thumb geometry, hit testing, wheel routing, and dragging.
   E18 and E19 prove the clipping and translation design, leaving thumb painting
   as the missing renderer behavior.
3. Group B is medium-high for sticky-header parity, or small if maintainers
   approve dropping the pinned header.
4. Group D is very large and remains the selection gate.

Groups A, C, and B can each land while the project builds on the patched fork;
none depends on selection.

The selection gate is now conditional rather than NO-GO. Upstream's public
`DOMElement`, `measureElement`, and `Transform` surfaces were sufficient for a
public-only spike to walk the existing root, map a simple cell to a UTF-16
offset, and paint a simple range (E29). Private tree access is no longer the
objection. The gate now depends on parity across wrapping, nested text,
transforms, ANSI, clipping, Unicode widths, layout gaps, copy reconstruction,
and approximately 137 direct `Text` import sites. A bounded prototype against
upstream, scoped to the mounted viewport, decides Group D.

A5 remains partially met. PTY tests must verify the structurally forced row-zero
invariant across entry, redraw, resize, clear, failure rollback, signals, and
teardown before it can serve as acceptance proof.
