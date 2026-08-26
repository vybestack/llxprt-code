# Issue #3345 P0 inventory and spike report

## Decision summary

**Recommendation: fix the leak now on the pinned fork, and commit to upstream
Ink as the migration destination. The selection gate is conditional on a bounded
public-surface prototype.**

The immediate fix is the ten-line vadimdemedes/ink#950 backport as a dependency
patch on pinned fork 6.4.8. The measured patch resets `fullStaticOutput` exactly
as upstream 7.1.1 does, needs no application API adaptation, and carries no
regression risk to selection, sticky-header, or scroll behavior (E27). Because
Ink is inlined into
the published bundle, the patch reaches the normal published-bin path. The
source-entry fallback and raw-package consumers still resolve the unpatched
registry package, so those paths remain a stated distribution gap (E28). The
patch was also shown to survive a real `bundle:cli` build (E31), and its anchors
applied unchanged to fork 7.1.0, so it survives a fork version bump (E30). What
it has not been shown to do is preserve terminal behavior: the full-clear replay
path, standard-buffer resize and clear, and screen-reader mode are all untested
and are prerequisites before the patch ships (E32).

The leak does not affect the default configuration. Schema defaults select
`AlternateBufferLayout`, which has no `<Static>`. The exposed population is
interactive users who explicitly opt out of alternate buffer, excluding
screen-reader and CI sessions (E25). For that population, bounded history is
re-emitted in full on each `refreshStatic()` remount and appended to an
unbounded accumulator. Growth is superlinear while history fills, and repeated
refreshes after the bound add approximately one history's output each time
(E26).

Do not adopt fork 7.1.0 as the destination. It has had no publication or
repository push since 2026-06-24, and it did not take vadimdemedes/ink#950 (E23).
Upgrading to fork 7.1.0 without changing components leaves the static leak.
Its fork-only `<StaticRender>` avoids `fullStaticOutput`, but the measured
per-history-item shape writes 6.7 times its workload, 5.6 times the `<Static>`
shape's amplification. Its own documentation says array input is unsupported
and incremental invalidation for continuously growing lists remains unsolved
(E24). Adopting that API would add dependence on an inactive fork.

Sequence the migration **A, C, B, D**. Group A renames and validates alternate
screen plumbing. Group C replaces fork scroll rendering while retaining the
application's existing viewport state and input behavior. Group B resolves
sticky-header parity or an approved behavior reduction. Group D is selection
and remains the gate. A, C, and B can land while the project still builds on the
patched fork because none depends on selection.

E29 changes the selection conclusion. Upstream's public `DOMElement`,
`measureElement`, and `Transform` surfaces are sufficient to walk the mounted
tree, resolve a simple cell to a UTF-16 endpoint, and paint a simple range. A
tree port does not inherently require private Ink internals. The unresolved
work is behavioral parity across text squashing, transforms, ANSI, wrapping,
clipping, Unicode cell widths, layout gaps, and copy reconstruction, plus
approximately 137 direct `Text` import sites (E29). A bounded prototype against
upstream, scoped to the mounted alternate-buffer viewport, decides the
conditional gate.

## Spike configuration

The spike was collected on 2026-08-26 on darwin arm64 with Node v25.2.1 (E0). It
compared the repository's pinned `@jrichman/ink@6.4.8` with upstream
`ink@7.1.1`, the newest published upstream release on that date (E0, E1, E2).
Upstream was installed out of tree at `tmp/issue3345/spike/node_modules/ink`.
The typecheck redirected only the `ink` TypeScript path to that installation
(E8). The scripts and reproduction commands are preserved in
`project-plans/issue3345/p0-spike-scripts.md`.

No mainline manifest, lockfile, dependency, or `node_modules` change was made
(E0, `project-plans/issue3345/p0-spike-scripts.md:3-14`).

## Compile-failure catalog

Compiling `packages/cli` against the fork produces no errors. Redirecting only
the `ink` TypeScript path to upstream 7.1.1 produces **26 errors across 11
files**, every one attributable to the package swap (E8).
`p0-spike-scripts.md` publishes the exact configuration generation and the two
`tsc` invocations that produce the two listings.

| File | Spike-only diagnostics | Cause |
| --- | ---: | --- |
| `src/ui/hooks/useMouseSelection.ts` | 13 | Five missing exports: `DOMNode`, `Range`, `comparePoints`, `getBoundingBox`, and `hitTest`; six uses of missing `useApp().selection`; two impossible comparisons with `overflowY="scroll"` |
| `src/session/interactiveUI.tsx` | 3 | Missing `RenderOptions.alternateBuffer` in calls and diagnostics |
| `src/ui/components/StickyHeader.tsx` | 2 | Missing `sticky` and `opaque` Box props |
| `src/ui/contexts/ScrollProvider.tsx` | 1 | Missing `getBoundingBox` |
| `src/ui/hooks/useMouseClick.ts` | 1 | Missing `getBoundingBox` |
| `src/ui/hooks/useMouseClick.test.ts` | 1 | Missing `getBoundingBox` |
| `src/ui/components/shared/VirtualizedList.tsx` | 1 | `overflowY="scroll"` is outside the upstream union |
| `src/ui/inkRenderOptions.ts` | 1 | Missing `alternateBuffer` |
| `src/ui/mouseEventsEnabled.ts` | 1 | `alternateBuffer` is not a `RenderOptions` property |
| `src/ui/App.tsx` | 1 | Propagated `mouseEventsEnabled` signature failure |
| `src/cli.renderOptions.test.tsx` | 1 | Missing `alternateBuffer` |
| **Total** | **26** | **11 files** |

TypeScript under-reports JSX incompatibilities. It stops checking an element
after the first incompatible attribute, so the `VirtualizedList` element reports
only `overflowY` even though `scrollTop` and `scrollbarThumbColor` are also
absent. `StickyHeader` similarly does not produce an independent diagnostic for
`stickyChildren` on the element already rejected for `sticky`. The type-level
absence lists in E3, E4, and E5 are authoritative; the compiler catalog is a
lower bound (E8).

The spike typecheck did not include `packages/cli/test-utils`, so it did not
check `real-ink.ts`, `ink-stub.ts`, or `ink-testing-library.ts` (E8).

## Validation of the issue's five P1 inventory items

| P1 item | Result | Findings |
| --- | --- | --- |
| Selection model and hit testing | **CONFIRMED WITH CORRECTION** | Upstream lacks the fork's `Selection`, `Range`, `comparePoints`, `hitTest`, and `useApp().selection` surfaces (E3, E7). It does publicly export `DOMElement`, `measureElement`, and `Transform`. E29 used only public surfaces to traverse the existing root ref, resolve a simple cell to a UTF-16 offset, and paint a simple selection. The production hook still depends on the removed fork APIs for parity across point resolution, range ordering, renderer notification, highlight state, and clipboard reconstruction (`packages/cli/src/ui/hooks/useMouseSelection.ts:239-319,380-424`). The package-swap spike reports 13 diagnostics in this file (E8). |
| Sticky headers | **CONFIRMED** | `sticky`, `stickyChildren`, and `opaque` are fork-only Box props (E5). The component passes all three at `packages/cli/src/ui/components/StickyHeader.tsx:29-60`, and tool messages use that component at `packages/cli/src/ui/components/messages/ToolMessage.tsx:229-268`. The compiler reports only `sticky` and `opaque` because of per-element under-reporting (E8). |
| Scroll plumbing | **CONFIRMED** | Upstream removes `scrollTop`, `scrollLeft`, `scrollbarThumbColor`, and the `scroll` overflow value (E4). `VirtualizedList` passes `overflowY="scroll"`, `scrollTop`, and `scrollbarThumbColor` to the fork at `packages/cli/src/ui/components/shared/VirtualizedList.tsx:93-110`. An app-owned negative-margin viewport works on upstream (E18, E19), but the surrounding behavior remains application code. |
| Coordinates | **CONFIRMED WITH CORRECTION** | Both geometry APIs are live-region relative and omit preceding `<Static>` lines; the fork's only extra behavior is subtracting fork scroll-box offsets (E16). Under an app-owned negative-margin viewport, upstream `measureElement` already reports scroll-translated child coordinates, so a replacement should not subtract the app scroll offset a second time (E19). The terminal-row anchor remains unavailable from either public geometry API (E16, E17). |
| Render-mode plumbing | **CONFIRMED WITH CORRECTION** | `alternateBuffer` becomes `alternateScreen`; the other production options remain present (E7). The captured writes differ beyond a field rename: the fork emits home and clear sequences on each tested alternate-buffer frame, while upstream emits no home or clear between the tested frames, appends static output inline, and emits erases for prior live lines (E17). Startup, redraw, resize, clear, and teardown acceptance therefore must test screen position as well as lifecycle. |

### Additional inventory found by P0

These are package-surface differences. Items without a compiler failure are not
new production blockers in the typecheck scope, but they belong in migration
review.

| Surface omitted from the issue's P1 list | Finding | Current impact |
| --- | --- | --- |
| `Text` cursor props | `terminalCursorFocus` and `terminalCursorPosition` are fork-only (E6). | No `packages/*/src` use was found in E6. |
| `useApp().rerender` | Fork `AppContext` has `rerender`; upstream removes it and adds `waitUntilRenderFlush` and `suspendTerminal` (E7). | E7 found no non-test use of Ink's hook-level `rerender`. |
| Render `Instance` methods | Fork `recalculateLayout` and `getSelection` are absent upstream; upstream adds `waitUntilRenderFlush` (E7). | No compile failure appeared in the spike scope (E8). |
| `textWrap` union | Upstream removes fork values `end` and `middle`, and adds `hard`; both retain the other listed wrap/truncate values (E4). | No compile failure appeared in the spike scope (E8). |
| `userSelect` | The fork's `auto | none | text | all` style property is absent upstream (E4). | It is part of the fork's renderer selection semantics even though the spike found no production type failure (E4, E8). |
| Node engine | Upstream 7.1.1 requires Node `>=22`; the fork declares `>=20` (E2). | Runtime and packaging acceptance must retain the issue's Bun and supported-launch checks. |
| DOM and text exports | `ResizeObserver`, `ResizeObserverEntry`, `getPathToRoot`, `StyledChar`, `clearStringWidthCache`, and `setStringWidthFunction` are fork-only public exports (E3). | No compile failure appeared in the spike scope (E8). |
| Other geometry, scroll, and text exports | `getInnerWidth`, `getInnerHeight`, both scrollbar bounding-box functions and their type, `getText`, `getTextOffset`, `findNodeAtOffset`, `getScrollHeight`, and `getScrollWidth` are fork-only (E3). | No compile failure appeared outside the already cataloged selection and geometry imports (E8). |
| Upstream additions | Upstream adds `renderToString`, paste/cursor/animation/window/box-metrics hooks, cursor and element metric types, terminal suspension, and Kitty keyboard exports (E3). It also adds `concurrent`, `interactive`, and `kittyKeyboard` render options (E7). | Additions do not cause the spike failures, but option defaults matter to the real-renderer harness (E15). |

The installed ecosystem packages' Ink peer ranges already admit Ink 7, and
`ink-select-input` has no source import (E20). That metadata result does not
replace P2 runtime and React 19.2 compatibility testing.

## Viewport anchor proof

### What the APIs report

Neither upstream 7.1.1 nor the fork exposes a terminal viewport-anchor API. In
the probe with two `<Static>` lines and one live header line above the measured
box, both APIs returned `{x:0, y:1, width:40, height:4}`. The `y` value counted
the live header but not either static line (E16). Both APIs therefore report
coordinates relative to the live layout root.

The current selection hook converts terminal mouse coordinates directly to
zero-based coordinates at
`packages/cli/src/ui/hooks/useMouseSelection.ts:221-222` and compares them with
`getBoundingBox` output through line 233. It uses `x = event.col - 1` and
`y = event.row - 1`, so it assumes the live region begins at terminal row 0.
There is no measured offset correction.

Mouse handling is currently enabled only with `alternateBuffer=true` (E21,
`packages/cli/src/ui/mouseEventsEnabled.ts:17-22`). The actual alternate-buffer
layout has a terminal-sized root and a virtualized list, with no `<Static>`
component (`packages/cli/src/ui/layouts/DefaultAppLayout.tsx:274-320`). The
standard-buffer layout does use `<Static>`, but mouse selection is disabled in
that render mode (`packages/cli/src/ui/layouts/DefaultAppLayout.tsx:323-359`,
E21).

The package redraw strategies still matter. The fork's captured writes contain
home and clear sequences on every tested alternate-buffer frame, followed by
`fullStaticOutput + output`. Upstream's captured writes did not contain home or
clear sequences between the tested frames; they appended static output inline
and emitted erases for previous live lines. Both still reported live geometry at
`y=0` (E17). The stream double did not prove cursor placement, terminal
scrolling, or final screen state. Terminal scrolling
as output exceeds the terminal height is an untested expectation that requires a
PTY. Geometry therefore cannot reveal where the live row sits on the terminal.

### Candidate derivations

| Candidate | How the anchor would be obtained | Cost and failure modes | Assessment |
| --- | --- | --- | --- |
| Structurally force row 0 | Keep mouse selection confined to a terminal-sized alternate-screen layout with no `<Static>`. On entry, the application would explicitly establish home row 0 and preserve the invariant that no output is inserted above the live root. | Terminal entry, failure rollback, resize, external writes, renderer clears, and teardown must all preserve the invariant. PTY tests are required because P0 used stream doubles. This builds on the current alternate layout shape (`DefaultAppLayout.tsx:274-320`) and avoids an inferred offset. | Best candidate. It turns the missing query into an invariant, but P0 has not proved it in a PTY. |
| Count application-owned static rows | Measure or calculate every static item's rendered height and add it to live-relative geometry. | Wrapping, width changes, keyed remounts, full clears, possible terminal scrolling, and renderer write timing can affect the terminal row. E16 proves the geometry API itself omits the rows. E17 proves that upstream emitted no home or clear between the tested frames, but terminal position remains unverified. | Insufficient by itself. |
| Track terminal cursor and writes | Put a stateful terminal-output tracker in the stdout path and interpret cursor movement, erase, alternate-screen, wrap, and scroll sequences to maintain the live anchor. | This is a terminal-emulation subsystem. It must cover incremental rendering, external writes, custom stdout proxies, and platform-specific terminal behavior. | Disproportionate for geometry alone. |
| Patch or use private Ink renderer state | Add an anchor callback to Ink or inspect renderer output accounting. | This retains a package patch or private-internal dependency, which recreates part of the fork ownership cost. Upstream 7.1.1 exposes no such public field (E3, E16). | Reject for an application-owned migration unless maintained as an explicit dependency patch. |
| Disable selection when the invariant is unavailable | Permit in-app selection only in the structurally fixed alternate-screen path. | Preserves today's mode gate, but does not provide selection for inline mode. Today's gate already has this restriction (E21). | Acceptable current-coverage boundary. |

P0 therefore cannot derive the anchor from an Ink API. The viable app-owned
answer is to force it to zero and verify that invariant in PTY acceptance. Any
design that promises inline selection below `<Static>` needs an additional
terminal-position source that neither package currently supplies (E16, E17).

## Community viewport evaluation

All three inspected releases declare an Ink 7-compatible peer range. Their npm
metadata and distributed source were captured on 2026-08-26 (E18). Download
counts are volatile.

### `ink-scroll-view@0.3.7`

Last published 2026-05-08, with 524,958 downloads in the captured month (E18).
It supplies both an uncontrolled `ScrollView` and parent-controlled
`ControlledScrollView`. Both clip with `overflow="hidden"`, translate with a
negative top margin, measure every child, track variable per-item heights and
offsets, and expose item positions. The uncontrolled ref also provides
`scrollTo`, `scrollBy`, top and bottom scrolling, offset and size queries, and
remeasurement methods (E18). The upstream probe confirmed clipping and
translation, and E19 confirmed scroll-translated child geometry.

Residual repository contracts are:

- It renders every child rather than windowing the mounted range. The repository
  mounts only a computed range and preserves geometry with spacers
  (`VirtualizedList.hooks.tsx:621-639,802-840`; E18).
- Its measured positions can help an adapter, but it does not own the
  repository's `{index, offset}` anchor or preserve that anchor as measured
  heights change (`VirtualizedList.hooks.tsx:71-181,675-699`). It also does not
  implement growth and resize stick-to-bottom behavior
  (`VirtualizedList.hooks.tsx:183-264`).
- Its ref covers part of the imperative contract, but not the repository's
  `scrollToIndex` and `scrollToItem` parameters or `getScrollIndex` shape
  (`VirtualizedList.hooks.tsx:432-615`; `VirtualizedList.types.ts:21-40`).
- It supplies no timed smooth-scroll policy, focus-gated keyboard handling,
  pointer-targeted wheel routing, animated scrollbar, or track and thumb drag
  behavior (`ScrollableList.tsx:66-189,219-264`;
  `ScrollProvider.tsx:95-186,251-405`).
- Its live-layout geometry does not supply the terminal row anchor required by
  mouse coordinates (`useMouseSelection.ts:221-233`; E16, E19).

**Verdict: reject as the repository viewport abstraction.** Variable-height
measurement and imperative offset methods are useful, but rendering all history
conflicts with the current windowing contract. Layering the missing anchor,
windowing, input, and scrollbar behavior around it would duplicate much of the
repository's existing list state. Retain the measured clip-and-translate
technique rather than adding this dependency.

### `ink-scroll-list@0.4.1`

Last published 2026-01-03, with 324,368 downloads in the captured month (E18).
It extends `ink-scroll-view` with a parent-owned `selectedIndex`, automatic
scroll-into-view, and `auto`, `top`, `bottom`, or `center` alignment. Its ref
extends `ScrollViewRef`, so it inherits variable-height measurement, item
positions, and the uncontrolled imperative methods (E18).

Residual repository contracts are:

- It inherits `ink-scroll-view`'s render-all-children model rather than the
  repository's mounted-range windowing
  (`VirtualizedList.hooks.tsx:621-639,802-840`; E18).
- A selected index does not preserve the repository's intra-item
  `{index, offset}` anchor as heights change, and it does not supply the current
  stick-to-bottom behavior for data growth and container changes
  (`VirtualizedList.hooks.tsx:71-264,675-699`).
- Selection alignment supplies one index-scrolling path, but the repository still
  needs its item/object methods with view offsets, smooth page movement, and
  scroll-state queries (`VirtualizedList.hooks.tsx:432-615`;
  `VirtualizedList.types.ts:21-40`; `ScrollableList.tsx:66-189`).
- Keyboard state updates, focused wheel routing, animated scrollbar rendering,
  and track or thumb dragging remain application work
  (`ScrollableList.tsx:137-189,219-264`;
  `ScrollProvider.tsx:95-186,251-405`).
- It does not supply the terminal row anchor (`useMouseSelection.ts:221-233`;
  E16, E19).

**Verdict: reject as the repository viewport abstraction.** Its selected-index
alignment is useful for menu-style lists, but it neither windows history nor
matches the history viewport's pixel and intra-item anchor contract. Building on
it would retain the same missing input and scrollbar work as `ink-scroll-view`.

### `ink-virtual-list@0.3.0`

Last published 2026-08-07, with 492 downloads in the captured month (E18). It
genuinely windows with `items.slice(...)`, follows a selected index, supports
index alignment through `scrollToIndex`, exposes viewport and remeasurement
methods, reads terminal size through `useStdout`, provides overflow indicators,
and accepts viewport-change and scrollbar render callbacks (E18).

Residual repository contracts are:

- It uses one fixed `itemHeight`. The repository starts with estimated heights,
  measures rendered item heights, and recomputes offsets and total height
  (`VirtualizedList.hooks.tsx:116-158,339-371`; E18).
- Its item-count viewport offset and selected-index driver do not expose the
  repository's pixel offset, intra-item anchor, `scrollBy`, `scrollTo`,
  `scrollToEnd`, `scrollToItem`, or scroll-height state
  (`VirtualizedList.hooks.tsx:71-181,432-615`;
  `VirtualizedList.types.ts:21-40`; E18).
- It does not supply the current stick-to-bottom correction under growth, resize,
  and measured-height changes (`VirtualizedList.hooks.tsx:183-264`).
- A scrollbar render prop provides a paint slot, but the repository's animated
  color, wheel routing, keyboard and smooth scrolling, and track or thumb drag
  behavior remain application contracts (`ScrollableList.tsx:66-189,219-264`;
  `ScrollProvider.tsx:95-186,251-405`).
- It does not supply the terminal row anchor (`useMouseSelection.ts:221-233`;
  E16, E19).

**Verdict: reject as the history viewport abstraction.** It is the only inspected
package that supplies actual windowing and a scrollbar render hook, but its
fixed-height, selected-index model conflicts with the repository's measured
variable-height and intra-item anchor behavior. Adoption would require an
approved behavior reduction or substantial changes to the package.

The corrected comparison does not support adopting or building on any of the
three packages for the current history viewport. It does support reusing the
clip-and-negative-margin technique measured with `ControlledScrollView` (E18,
E19). If implementation copies source rather than the technique, P2 must perform
the issue's license and attribution review. E22 records the headers on relevant
fork modules without asserting that those exact modules must be reimplemented.

## Memory findings

### Renderer-level static retention

Upstream 7.1.1 still has `fullStaticOutput` and the same append/replay pattern as
the fork. In the 300-item synthetic run, both packages retained a
`fullStaticOutput.length` of **61,990** for the same computed workload size of
61,390 characters. The script did not measure renderer output bytes. Both
packages accumulated the same amount for the same workload, so their rates are
the same while the `<Static>` identity remains unchanged (E9).

Upstream's vadimdemedes/ink#950 reset occurs when the `<Static>` node identity changes. In the
remount probe, both packages retained 20,790 characters after 100 items. Changing
the key reset upstream to 0 while the fork stayed at 20,790. After 10 more items,
upstream retained 2,070 and the fork retained 22,860 (E10).

This application increments `staticKey` through `refreshStatic()`. Production
call sites cover terminal resize, history trim or compression, markdown toggle,
and clear. Resize refresh is debounced while idle or flushed when streaming
returns to idle. The standard layout applies that key to `<Static>`
(`DefaultAppLayout.tsx:323-348`, E10).

The settings trace bounds who encounters this behavior. The schema default is
`ui.useAlternateBuffer=true`, and merged defaults materialize that value. The
default interactive layout has no `<Static>`, so the default configuration does
not leak. Screen-reader and CI renderer branches do not accumulate, and
non-interactive and ACP paths do not render Ink. The exposed population is
interactive sessions that explicitly opted out of alternate buffer, excluding
screen-reader and CI sessions (E25).

History itself is bounded by default to 100 items and 1 MiB. `staticItems` adds
the header, but each remount re-emits all current items. The unpatched fork
appends that complete output again without clearing the previous accumulator.
Repeated refreshes therefore add approximately one history's rendered output per
remount, despite bounded application history (E26).

The ten-line vadimdemedes/ink#950 backport clears the pinned fork's accumulator
on the same identity change. In the measured probe, the patched fork and
upstream 7.1.1 both moved from 20,790 characters to zero on remount and then to
2,070 after ten new items (E27). This patch changes no application API and no
selection, sticky-header, or scroll implementation. The normal published path
uses a bundle with Ink inlined, so a build-time dependency patch reaches that
path. The source-entry fallback and raw-package consumers still receive the
unpatched registry copy (E28).

### Text caches

The fork's full-string styled-character cache is bounded by
`DataLimitedLruMap(10_000, 1_000_000)`, and the fork has no full-string
wrap-result cache. Its character-width `Map`, keyed by single characters, is
unbounded. Upstream 7.1.1 has unbounded full-string measure and wrap caches (E11).
In the isolated synthetic benchmark:

| Distinct approximately 230-byte strings | Upstream 7.1.1 heap growth | Fork 6.4.8 heap growth |
| ---: | ---: | ---: |
| 20,000 | 21.9 MB | 126.9 MB |
| 50,000 | 55.6 MB | 126.9 MB |

Across these samples, upstream grew at approximately 1.11 KB per distinct string
while the fork remained at the same measured heap growth. A linear extrapolation
crosses the fork's measured plateau near 115,000 distinct strings (E11). The
benchmark used one repeated ASCII string shape with a varying numeric prefix. It
is not a production heap forecast.

The upstream cache fix, commit `ad9e3ea`, changes both full-string caches to a
4,096-entry `QuickLRU`. It is on upstream master but in no published release as
of the P0 capture; PR vadimdemedes/ink#987 was closed without merge and the commit landed
separately (E1, E12, E13).

### Effect on the issue rationale

The static leak has a measured fix independent of migration. Carry the ten-line
vadimdemedes/ink#950 backport on pinned fork 6.4.8 now, for the
standard-buffer population identified in E25. It matches upstream's reset in the
remount probe and preserves the fork APIs used by selection, sticky headers, and
scrolling (E27). Remove the patch when migration reaches upstream, where the
same reset already ships.

The build-time patch reaches the normal published bundle path. It does not cover
the forced source-entry fallback or a consumer that imports the raw package, so
the fix must not be described as universal across all entry paths (E28).

Fork 7.1.0 does not provide a better destination. It was last published and
pushed on 2026-06-24, and it omitted vadimdemedes/ink#950 (E23). Without a
component change, upgrading to it leaves the leak. Its `<StaticRender>` avoids
the accumulator by using another renderer node type, but the measured per-item
shape amplified stdout writes 6.7 times over its workload, versus 1.2 times for
`<Static>`. Its documentation also leaves continuously growing list invalidation
unsolved (E24). Using that API would tie the application to a fork-only contract
without resolving the history update model.

Upstream 7.1.1 still has unbounded full-string measure and wrap caches. The
published release is not a complete bounded-memory fix (E11, E12). That release
fact affects migration acceptance, but it no longer blocks fixing the static
accumulator now. Upstream remains the destination because it already contains
the static reset, its master contains the cache fix, and adopting fork 7.1.0
would extend dependence on an inactive line (E12, E23).

## Subjective maintainer tradeoff summary

The 1-to-5 scores below are maintainer-facing judgments, not measurements or a
weighted decision model. A higher score is more favorable. "Memory" combines the
measured static behavior and known cache bounds. "Feature" rates preservation of
selection, viewport, sticky, and render-mode contracts. "Evidence" rates how much
of the path P0 exercised. "Ownership" rates reduction of fork or patch
maintenance. "Scope" favors a smaller change. The scores cannot establish that
one alternative dominates another.

| Alternative from issue #3345 | Memory | Feature | Evidence | Ownership | Scope | P0 reading |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Backport vadimdemedes/ink#950 to pinned fork 6.4.8 | 4 | 5 | 5 | 2 | 5 | The ten-line patch matched upstream's remount reset and leaves the application-facing fork APIs unchanged. It reaches the normal published bundle but not source-entry or raw-package paths (E27, E28). |
| Upgrade to fork 7.1.0 without `<StaticRender>` | 3 | 5 | 4 | 1 | 3 | The styled-character cache ceiling is smaller, but the static reset is still absent. The fork has had no publication or push since 2026-06-24 (E23). |
| Upgrade to fork 7.1.0 and adopt `<StaticRender>` | 3 | 4 | 4 | 1 | 2 | The accumulator stays empty, but the per-item shape amplified writes 5.6 times over `<Static>`, and growing-list invalidation remains unsolved (E24). |
| Migrate to upstream through groups A, C, B, D | 3 | 4 | 4 | 5 | 1 | Upstream removes fork ownership and contains the static reset. Groups A, C, and B are bounded. Selection parity remains the conditional gate, and released 7.1.1 still has unbounded full-string caches (E11, E12, E29). |
| Wait for upstream selection proposals before migration work | 2 | 5 | 3 | 3 | 5 | Avoids the selection prototype but delays independent render-mode, scroll, and sticky work. vadimdemedes/ink#984 remains open and vadimdemedes/ink#985 remains draft (E13). |

The recommended two-track sequence uses the backport as a temporary fix and
upstream as the destination. It avoids making `<StaticRender>` a new fork-only
application contract and lets migration work proceed independently of the
static leak.

## Migration sequence and sizing

Use the sequence **A, C, B, D**:

1. **Group A, render-mode plumbing: small, about 8 files.** Replace
   `alternateBuffer` with upstream's `alternateScreen` contract and retain the
   existing mode gate. PTY acceptance must prove the terminal-sized live root
   stays at row zero across entry, redraw, resize, clear, failure rollback,
   signals, and teardown because stream doubles cannot establish terminal state
   (E7, E16, E17, E21).
2. **Group C, scroll plumbing: medium, about 4 to 6 production files.** E18 and
   E19 prove clipping plus negative-margin translation and show that upstream
   geometry already reflects translated child coordinates. The application
   already owns scroll state, thumb geometry, hit testing, wheel routing, and
   dragging. Only thumb painting is absent after the fork style props are
   removed. Retain the current variable-height, windowing, anchor, and input
   contracts rather than adopting one of the evaluated viewport packages.
3. **Group B, sticky headers: medium-high for parity, or small if maintainers
   approve dropping the pinned header.** Upstream has no `sticky`,
   `stickyChildren`, or `opaque` Box props (E5). Preserve current behavior with
   an app-owned pinned-header design, or record the behavior reduction before
   removing it.
4. **Group D, selection: very large and the conditional gate.** E29 proves that
   a public-surface tree prototype is feasible. It does not prove parity. Scope
   the prototype to the mounted viewport and decide the gate from behavior and
   performance evidence.

Groups A, C, and B can each land while the project still builds on the patched
fork. None depends on the selection implementation. This ordering isolates
smaller migration contracts before the selection decision and permits the
backport to be deleted when the final upstream dependency lands.

## Selection go/no-go recommendation

**CONDITIONAL for an application-owned selection engine against upstream.** E29
removes private tree access as a blocker. Upstream publicly exports `DOMElement`,
`measureElement`, and `Transform`; the application already owns the alternate
layout root ref. A public-only TypeScript spike walked that tree, mapped a cell
to a UTF-16 endpoint, and painted a simple range (E29).

The remaining gate is parity scope. Upstream does not expose a renderer-final
fragment or cell map. The application must reproduce nested text squashing,
transform ordering, ANSI token boundaries, wrapping and truncation, clipping,
layout gaps, UTF-16 endpoint mapping, cell width, copy separators, and highlight
interaction with ancestor transforms. Approximately 137 files import `Text`
directly from Ink, and there is no shared wrapper. `ink-gradient` can strip a
descendant selection transform's ANSI escapes (E29).

Run a bounded public-surface prototype against upstream before approving Group D.
Limit it to the mounted alternate-buffer viewport, which matches current
selection coverage because `VirtualizedList` does not mount the full history
(E21, E29). The prototype should decide the gate by demonstrating:

1. cell-to-endpoint mapping and range ordering for wrapped, nested,
   transformed, ANSI-styled, wide, and combining text;
2. copy reconstruction across layout gaps, clipped boundaries, and mounted item
   boundaries;
3. highlight painting that survives ancestor transforms and preserves existing
   styles;
4. endpoint behavior during rerender, resize, item-height correction, and scroll
   during drag;
5. PTY proof of the row-zero invariant across the lifecycle cases listed under
   Group A; and
6. acceptable render latency and retained heap for the mounted viewport.

If the prototype passes, proceed with Group D and the final upstream dependency
change. If it requires private renderer state, broad conversion of the direct
`Text` sites, or cannot meet current copy and highlight behavior, stop Group D
and reassess the bridge. A released upstream frame controller remains an
alternative if vadimdemedes/ink#984 and vadimdemedes/ink#985 later ship (E13).

## Test-harness and package observations

Both packages restrict bare `ink/build/...` imports through the same exports-map
shape. The repository's real-renderer helpers use relative filesystem paths, and
all 14 paths in `real-ink.ts` existed in upstream 7.1.1 (E2, E14,
`packages/cli/test-utils/real-ink.ts:12-25`). Supported imports are still the
P2 target because those relative paths are package internals.

The test `Stdout` has `columns` but no `isTTY`
(`packages/cli/test-utils/ink-testing-library.ts:11-25`). Upstream therefore
resolves it as non-interactive unless `interactive` is explicitly set. The
current shim emits frames because it passes `debug: true`; without debug it
emitted no frame before unmount in the probe. A true interactive harness must
await `waitUntilRenderFlush()` after rerender (E15).

Most Bun tests redirect `ink` and `ink-testing-library` to local shims through
both a resolver plugin and TypeScript paths
(`packages/cli/bun-test-setup.ts:109-129`,
`packages/cli/tsconfig.bun.json:1-8`, E20). They do not constitute replacement-
package acceptance.

## What P0 did not cover

- No PTY run was performed. Stream doubles captured control sequences, but did
  not validate terminal cursor position, scrolling, entry, restoration, or
  signals (E17).
- No Windows or Linux run was performed. The measured environment was darwin
  arm64 (E0).
- P0 did not run a behavioral test of the fork's production scroll rendering.
  It inspected current code and tested the upstream community viewport
  primitive (E18, E19).
- The memory test was synthetic. The static probe read the renderer accumulator,
  and the text-cache microbenchmark used one repeated approximately 230-byte
  ASCII string shape with a varying numeric prefix. Neither is a production
  session heap profile (E9, E11).
- `packages/cli/test-utils` was outside the spike typecheck. E14 and E15 probed
  selected harness behavior, but there was no complete test-utils typecheck or
  suite against upstream (E8, E14, E15).
- P0 inspected fork 7.1.0's distributed source and ran the focused
  `<StaticRender>` probe. It did not run the repository application or full test
  suite against fork 7.1.0 (E23, E24).
- P0 ran a simple public-surface selection spike, but did not implement or test
  selection parity. It also did not implement sticky-header, alternate-screen,
  or app-owned scrollbar replacements. Those remain migration acceptance work
  (E29).
- The vadimdemedes/ink#950 backport was measured only against the renderer
  accumulator and a bundle build. Terminal behavior after a reset, standard-buffer
  resize and clear, and screen-reader mode were not tested. The patched fork
  matches upstream 7.1.1's structure and reset semantics rather than introducing
  new ones, but that is an argument from equivalence, not a measurement (E27,
  E31, E32).
