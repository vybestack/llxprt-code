# Issue #3345 selection port design note

## Gate decision

**Recommendation: CONDITIONAL for an application-owned selection engine on
upstream Ink.** E29 removes private tree access as the blocking objection.
Upstream publicly exports `DOMElement`, `measureElement`, and `Transform`, and the
application already holds the alternate layout's root ref. A public-only
TypeScript spike walked that tree, mapped a terminal cell to a UTF-16 text
offset, and painted a simple inverse-video range (E29).

The gate remains conditional because the spike does not establish parity.
Upstream exposes no renderer-final fragment or cell map. An application engine
must still reproduce nested text squashing, transform ordering, ANSI token
boundaries, wrapping, truncation, clipping, layout gaps, UTF-16 endpoint mapping,
cell width, copy separators, and highlight interaction with ancestor transforms.
The repository has no shared `Text` wrapper, and approximately 137 files import
`Text` directly from Ink. `ink-gradient` can erase ANSI added by a descendant
selection transform (E29).

Use a bounded prototype against upstream to decide the gate. Scope it to the
mounted alternate-buffer viewport, which matches current coverage because mouse
selection is enabled only in that mode and history is windowed by
`VirtualizedList` (E21, E25, E29). The static leak is handled independently by
the ten-line vadimdemedes/ink#950 backport on the pinned fork until migration
lands (E27, E28). Selection should neither delay that fix nor make fork 7.1.0 the
destination.

## Current selection path

`useMouseSelection` is a renderer-backed adapter, not a self-contained selection
engine. Its current event flow is:

1. Convert the terminal's one-based mouse coordinates to zero-based `x` and `y`
   at `packages/cli/src/ui/hooks/useMouseSelection.ts:221-222`, then use those
   coordinates through line 233.
2. Find the smallest focused registered scrollable containing the point using
   `getBoundingBox` (`useMouseSelection.ts:117-142`).
3. Ignore the scrollbar column, search for a nested fork scroll box, and convert
   the visible point to logical content coordinates with effective scroll
   offsets (`useMouseSelection.ts:144-179`).
4. Call fork `hitTest` and receive a DOM text endpoint
   (`useMouseSelection.ts:239-258`).
5. Order anchor and focus with `comparePoints`, update a fork `Range`, and add it
   to the renderer's `Selection` (`useMouseSelection.ts:261-296`).
6. On left release, call `Selection.toString()` and copy the snapshot to the
   clipboard (`useMouseSelection.ts:301-319,322-377`).
7. The hook receives the renderer's `Selection` from `useApp()` and registers
   the mouse handler (`useMouseSelection.ts:380-426`).

The hook calls an optional, undeclared `notifyChange()` after mutating an
existing range (`useMouseSelection.ts:47-49,265-293`). The fork's public
`Selection` declaration exposes `onChange` but declares `notifyChange` private
(`node_modules/ink/build/selection.d.ts:25-44`). Current production code thus
already relies on one fork-private behavior in addition to the explicitly named
fork exports.

## What the fork supplies

| Fork surface | Exact contract used today | Evidence |
| --- | --- | --- |
| `DOMNode` | A renderer-tree node identity. Text nodes carry `nodeValue`; element nodes carry `childNodes`, `parentNode`, `style`, Yoga data, and optional scroll state. Range ordering and text reconstruction depend on parent and child relationships. | `node_modules/ink/build/dom.d.ts:5-67`; imported and stored by `useMouseSelection.ts:9-27` |
| `Range` | A mutable pair of `{container, offset}` endpoints. `setStart` and `setEnd` update collapsed and common-ancestor state. `toString()` lays out the common ancestor, maps endpoint nodes into the resulting character stream, slices styled characters, and joins their values. | `node_modules/ink/build/selection.d.ts:8-24`; `node_modules/ink/build/selection.js:149-244`; used at `useMouseSelection.ts:261-296` |
| `comparePoints` | Orders two node/offset endpoints by tree order. It compares offsets on the same node, handles ancestor endpoints against child indexes, and otherwise compares sibling branches under the lowest common ancestor. It returns `0` when nodes have no common root. | `node_modules/ink/build/selection.js:74-108`; used at `useMouseSelection.ts:270-285` |
| `hitTest` | Accepts coordinates relative to a selected DOM element. It collects selectable rendered text fragments, chooses an exact fragment or the nearest fragment by vertical then horizontal distance, computes an offset using the fragment's wrapping and cell widths, and maps the squashed offset back to a text node plus UTF-16 code-unit offset. | `node_modules/ink/build/measure-element.js:628-703`; called at `useMouseSelection.ts:239-255` |
| `useApp().selection` | The renderer creates one `Selection`, subscribes rendering to its change notifications, and passes it through `AppContext`. The hook uses range count, range removal/addition, string conversion, and change notification to control renderer highlighting. | `node_modules/ink/build/ink.js:60-94`; `node_modules/ink/build/components/App.js:37-46`; `useMouseSelection.ts:181-207,261-319,380-412` |
| `Selection.toString()` | Concatenates `Range.toString()` for every stored range with no added separator. This hook keeps at most one range, so clipboard text is that range's reconstructed plain text. | `node_modules/ink/build/selection.js:245-279`; `useMouseSelection.ts:283-293,301-319` |
| `getBoundingBox` | Walks Yoga ancestors, accumulating computed left/top, and subtracts effective fork scroll offsets for ancestors whose overflow mode is `scroll`. Its result is relative to the live layout root and does not include preceding `<Static>` rows. | `node_modules/ink/build/measure-element.js:41-71`; E16; used at `useMouseSelection.ts:80-142` |
| `internal_scrollState` reads | Supplies the renderer-calculated effective `scrollTop` and `scrollLeft`. The hook prefers those values, then style props, then zero. It adds the offsets when converting a visible cell into logical coordinates for nested scroll hit testing. | `node_modules/ink/build/dom.d.ts:40-57`; `useMouseSelection.ts:36-45,63-78,154-169` |

The renderer also supplies highlight painting. It computes a selection map before
rendering, then adds ANSI reverse-video styling to selected styled characters
unless a custom `selectionStyle` is configured
(`node_modules/ink/build/renderer.js:128-172`,
`node_modules/ink/build/render-node-to-output.js:472-504`). Selection changes
schedule a renderer pass (`node_modules/ink/build/ink.js:70-94`). No CLI text
component needs to know that it is selected.

Upstream 7.1.1 removes the `DOMNode`, `Range`, `Selection`, `comparePoints`,
`hitTest`, and `getBoundingBox` public exports. It also removes
`useApp().selection` (E3, E7).

## Hit testing without the fork

### Required contract

A replacement cannot stop at element rectangles. For every selectable terminal
cell in the current frame, it needs to resolve:

```text
terminal cell
  -> live-region cell using a proven terminal anchor
  -> viewport-local cell using application viewport geometry
  -> rendered text fragment after layout, wrapping, transforms, and clipping
  -> stable logical endpoint plus UTF-16 offset and edge affinity
```

The inputs are:

- a terminal-row anchor, which neither package reports (E16, E17);
- app-owned viewport rectangles and scroll translations; a negative-margin
  viewport makes upstream geometry reflect the translation (E18, E19);
- renderer-final fragment positions after Yoga layout and wrapping;
- the exact displayed character stream after nested text squashing, transforms,
  truncation, and ANSI tokenization;
- terminal cell widths for full-width and zero-width sequences;
- clipping and windowing state, including which logical items are mounted; and
- a stable endpoint identity that survives ordinary rerenders.

Upstream `measureElement` provides element boxes, and its public `DOMElement`
type exposes the child tree, text-node values, parent relationships, Yoga nodes,
styles, and transforms. `TextNode` and `DOMNode` are not entry-point exports, but
the public child union can be named as `DOMElement['childNodes'][number]` and
narrowed on `nodeName === '#text'`. The public-only E29 spike proves that element
geometry plus tree traversal can identify a simple cell's source text and UTF-16
offset. Upstream still exposes no renderer-final fragment, text-offset map, or
hit-test function, so parity requires reconstructing those renderer decisions.

### Where it must hook in

There are four practical hook points:

1. **Public root-tree traversal.** Walk the application's existing `rootUiRef`,
   use `measureElement` for boxes, derive displayed fragments from public node
   fields, and use public `Transform` for painting. This is feasible without
   private imports (E29). It must reproduce renderer behavior for nested text,
   transform order, ANSI, wrapping, truncation, clipping, layout gaps, Unicode
   widths, and copy separators. Approximately 137 direct `Text` import sites and
   ancestor transforms bound the integration problem.
2. **Renderer/frame boundary.** Ink produces a cell grid plus a per-cell logical
   text map before ANSI output. Mouse selection consumes the map, and the same
   boundary accepts a selected cell range for painting. This matches the shape
   recorded for vadimdemedes/ink#984 in issue #3345. Upstream 7.1.1 has no
   released public boundary of this kind (E13).
3. **Application text registry.** Every selectable text producer registers its
   source, transform, layout ref, wrapping policy, and logical ordering. A
   root-level selection provider combines the registrations into a frame map.
   This requires replacing or wrapping direct `Text` and `Transform` use across
   the UI, and it must duplicate Ink's renderer decisions.
4. **Terminal output boundary.** The custom stdout path parses complete and
   incremental ANSI output into a screen grid and injects highlight escapes.
   Raw terminal cells do not retain source node identity, so copy reconstruction
   still needs a parallel logical-text registry. Static output, cursor movement,
   clears, and terminal scroll also have to be interpreted (E17).

The first option is the prototype target because E29 proves access on public
surfaces. Its unresolved question is parity and integration scope, not access.

### Proposed port boundary if the gate later changes

Any approved implementation should first isolate the hook behind an
application interface:

```ts
interface SelectionFramePort {
  resolveCell(column: number, row: number): SelectionEndpoint | undefined;
  compare(a: SelectionEndpoint, b: SelectionEndpoint): number;
  textBetween(a: SelectionEndpoint, b: SelectionEndpoint): string;
  paint(a: SelectionEndpoint, b: SelectionEndpoint): void;
  clear(): void;
}
```

`SelectionEndpoint` needs a stable logical text identity, a UTF-16 offset, and
start/end affinity for full-width or multi-code-unit characters. The geometry
service should perform terminal-anchor and viewport conversion before
`resolveCell`. `useMouseSelection` would retain its press, move, release, copy,
and scrollbar-exclusion behavior, while losing all Ink imports except public
geometry and stdio hooks (`useMouseSelection.ts:322-426`).

The interface only defines the seam. Public upstream tree and geometry data can
support a prototype, as E29 demonstrates. Upstream does not supply the final
fragment map or parity semantics, so the prototype must prove that the seam can
be implemented without broad text-component conversion.

## Copy reconstruction and current coverage

### Current behavior by text feature

| Feature | What the fork does today | Port obligation and uncertainty |
| --- | --- | --- |
| Wrapping | Hit testing converts styled characters into wrapped or truncated lines using the text node's measured maximum width and `textWrap`, then maps cell width back to a code-unit offset (`node_modules/ink/build/measure-element.js:437-503`). `Range.toString()` slices the logical fragment text, so soft visual wraps are not inserted as clipboard newlines (`node_modules/ink/build/selection.js:197-213`; `node_modules/ink/build/measure-element.js:301-315`). | The replacement must use the same frame's wrapping decisions and preserve the current soft-wrap copy behavior. |
| Nested `Text` | Ink squashes nested text nodes while recording source-node spans. Hit testing maps a squashed offset back to the underlying text node; range reconstruction maps nested nodes into the common ancestor stream. | The replacement must preserve source-node identity and offset mapping through squashing so nested styling boundaries do not change hit testing or copied text (`node_modules/ink/build/squash-text-nodes.js:1-56`; `node_modules/ink/build/measure-element.js:546-618`; `node_modules/ink/build/selection.js:10-72,109-148`). |
| Transforms | Nested transforms are applied while text is squashed (`squash-text-nodes.js:46-51`). The offset map is recorded from source lengths before a nested transform is applied (`squash-text-nodes.js:27-50`), while hit-test fallback maps through source `nodeValue.length` (`measure-element.js:681-700`). | Current source shows no guarantee for length-changing transforms. An interim port must define whether endpoints refer to source or displayed text and test both length-preserving and length-changing transforms. P0 did not run such a test. |
| ANSI styling | Text is tokenized to styled characters, and copy joins each styled character's plain `value`, omitting style escape sequences (`selection.js:6-17,204-212`). Highlight adds reverse-video style to the styled character rather than rewriting its value (`render-node-to-output.js:472-504`). | The port must preserve displayed characters and existing styles while adding selection style, and clipboard text must omit styling escapes. |
| Wide and combining characters | Hit testing advances by `inkCharacterWidth(char.value)` but advances logical offsets by `char.value.length`; renderer highlighting also advances by the styled character's code-unit length (`measure-element.js:437-476`; `render-node-to-output.js:472-503`). | This is the current algorithm, not proof of all Unicode cases. P0 ran no behavioral selection test for wide or combining characters. A port needs cell-edge affinity so a click cannot split one displayed token. |
| Layout gaps and boundaries | Fork layout reconstruction inserts spaces and newlines for gaps between rendered fragments and orders fragments by visual `y` then `x` (`measure-element.js:194-340`; `layout.js:7-52`). | A port needs a defined copy separator across Boxes, text fragments, and clipped boundaries. Reusing source strings without layout data will differ. |

### Current virtualized and scrolled-off coverage

Current mouse selection is enabled only with the alternate buffer (E21,
`packages/cli/src/ui/mouseEventsEnabled.ts:17-22`). That mode renders a
terminal-sized root containing `ScrollableList` and `MainControls`, with no
`<Static>` history (`packages/cli/src/ui/layouts/DefaultAppLayout.tsx:274-320`).
The standard layout's `<Static>` output is therefore outside today's mouse-
selection mode (`DefaultAppLayout.tsx:323-359`).

`VirtualizedList` mounts only the calculated viewport range and represents the
rest with empty top and bottom spacers
(`packages/cli/src/ui/components/shared/VirtualizedList.hooks.tsx:621-639,
802-840`; `VirtualizedList.tsx:93-110`). The start calculation includes one
preceding range entry, and the end calculation reaches the first offset beyond
the viewport (`VirtualizedList.hooks.tsx:621-639`).

Consequences for today's implementation:

- Visible mounted text can be selected. Fork scroll offsets convert viewport
  cells to the logical coordinates used by `hitTest`
  (`useMouseSelection.ts:144-179,239-255`).
- A small amount of mounted boundary content can be outside the clipped viewport
  because of the range calculation. It exists in the renderer tree, but drag
  endpoints still originate from terminal mouse cells inside the viewport.
- Items outside the mounted range have no `DOMNode` and cannot be endpoints or
  contribute text to a renderer `Range`. The data array alone is never consulted
  by `useMouseSelection` (`VirtualizedList.hooks.tsx:374-403,802-840`;
  `useMouseSelection.ts:239-319`).
- The selection hook has no drag autoscroll behavior. It handles press, move, and
  release only, while scrolling is handled separately by `ScrollProvider`
  (`useMouseSelection.ts:322-377`; `ScrollProvider.tsx:251-447`).
- If scrolling changes the mounted window during a drag, endpoint nodes can be
  removed. P0 found no code that preserves a logical selection endpoint across
  that unmount, and it did not run a behavioral test. Behavior in that sequence
  remains unverified.
- A non-windowed fork scroll box can retain offscreen descendants in its DOM,
  but the current main history path is windowed. P0 does not claim selection of
  arbitrary scrolled-off history.

An interim port should preserve this current boundary unless maintainers approve
a feature expansion. Selection across all history would require a data-model
copy protocol and stable logical item positions, rather than a renderer-only
selection range.

## Highlight painting options

The present fork paints selection in the renderer, after layout and styling, so
no text-producing component changes (`renderer.js:128-172`,
`render-node-to-output.js:472-504`). The available replacements are:

| Option | How it works | Blast radius | Gate assessment |
| --- | --- | --- | --- |
| Public root-tree traversal and `Transform` painting | Walk `rootUiRef`, derive visible text fragments from public `DOMElement` fields and `measureElement`, then apply public transforms over selected UTF-16 ranges. | Selection engine, root provider, fragment reconstruction, transform integration, and parity tests. Direct `Text` imports may need adaptation if root-level painting cannot survive component transforms. | Prototype now. E29 proves simple mapping and painting on public surfaces; parity and integration scope decide the gate. |
| Released upstream frame controller | Use an upstream cell grid, call Ink-side selection painting, and subscribe to frame changes, as issue #3345 records for vadimdemedes/ink#984. Add vadimdemedes/ink#985's selectable/flow/boundary semantics if released. | Selection hook, geometry adapter, and tests. Text components change only where semantic boundaries are desired. | Preferred future path if the public-tree prototype does not meet parity. It is unavailable in a release; vadimdemedes/ink#984 is open and vadimdemedes/ink#985 is open draft (E13). |
| Maintained Ink patch | Port or adapt the fork renderer's selection map and reverse-video painting into the chosen upstream package. | Dependency patch, renderer tests, package-release maintenance, and license review. Application component changes stay limited. | Technically closest to current behavior. It retains package ownership work and needs explicit maintainer approval. |
| App-owned selectable text adapter | Replace direct `Text`/`Transform` use with components that register displayed cells and render selected spans. | Broad UI import and component changes. Nested styling and transforms need adapter support everywhere. | Reject under the issue's non-goal of avoiding a UI rewrite. |
| Root frame postprocessor | Parse rendered output, maintain a terminal cell grid, and inject reverse-video escapes over selected cells. | Custom stdout, incremental rendering, static output, cursor, clear, resize, alternate-screen, and platform acceptance. A separate source map remains necessary for copy. | Reject as an interim selection-only change. |
| Overlay rows | Render a selected copy over the same coordinates. | Requires reconstructing all underlying styled rows, clipping them exactly, and coordinating cursor and z-order behavior. | Equivalent to owning a frame renderer; no smaller than postprocessing. |
| No application highlight | Keep only copy state and rely on terminal-native selection. | Small code change, but loses current visible selection and conflicts with drag-selection acceptance in issue #3345. | Requires an explicit behavior reduction; not P1 parity. |

A maintained patch avoids rewriting every text-producing component, but it
changes the migration's ownership result. The package would still carry
selection code that upstream 7.1.1 lacks (E3, E13).

## Relationship to vadimdemedes/ink#984 and vadimdemedes/ink#985

As verified on 2026-08-26, vadimdemedes/ink#984 is open and not draft. vadimdemedes/ink#985 is open, draft, and
stacked on vadimdemedes/ink#984 (E13). Issue #3345 records their proposed division as a read-only
frame controller with cell-grid access, Ink-side `setSelection()` highlighting
and `subscribe()`, followed by copy semantics for selectable text, flows, and
boundaries. These are proposals, not a released dependency contract (E13).

An interim implementation would owe the following if those proposals land:

1. Keep all mouse event state behind `SelectionFramePort` or a comparable
   application interface. Do not spread interim node types through UI
   components.
2. Separate terminal-anchor and app-viewport translation from cell-to-text
   mapping. E19 shows that app-owned viewport translation can remain useful with
   an upstream frame bridge.
3. Define behavior tests in terms of visible selection and copied text, including
   wrapping, nesting, transforms, ANSI styles, wide and combining characters,
   item boundaries, and the current virtualized coverage. Tests should not
   encode private interim data structures.
4. Evaluate the shipped APIs rather than the proposal names. The final API or
   semantics may change while the pull requests are open (E13).
5. Remove the interim mapping and painting implementation when the released
   bridge passes parity. Carrying both implementations would violate the issue's
   long-term dual-implementation non-goal.
6. Preserve any application-specific geometry and virtualization policy that the
   upstream bridge does not own, especially the terminal row-zero invariant and
   mounted-window boundary (E16-E19).

Building a renderer-level interim bridge now would duplicate the same problem
space as the open upstream work. That duplication is only justified if
maintainers choose a maintained package patch and accept that it may later be
removed.

## Risk assessment

| Risk | Level | Mechanism | Required proof before approval |
| --- | --- | --- | --- |
| Cell-to-text mismatch | High | Public tree traversal is feasible, but upstream supplies no final text-fragment or offset map (E29). Reconstruction can diverge on wrap, transform, gaps, and Unicode. | Behavioral frame tests for every copy feature listed above. |
| Highlight mismatch | High | Public `Transform` can paint a simple range, but ancestor transforms such as `ink-gradient` can strip its ANSI output (E29). | Prototype proof that selection painting preserves existing styling and survives transform ordering. |
| Terminal anchor drift | High | Both geometry APIs omit static rows. Upstream's captured writes did not home or clear between the tested frames, while terminal cursor placement and final screen state remain unverified (E16, E17). | PTY proof of the forced row-zero invariant across lifecycle cases. |
| Virtualization invalidates endpoints | High | Off-window items are unmounted and selection stores renderer node identities (`VirtualizedList.hooks.tsx:621-639,802-840`; `useMouseSelection.ts:24-27`). | Tests for scroll during drag, resize during drag, data growth, and item-height correction, with an approved current-coverage policy. |
| Public-tree integration scope | High | The public tree is accessible, but the repository has approximately 137 direct `Text` import sites and no shared wrapper. Root-level transforms can interact with component transforms (E29). | A prototype inventory of changed production files and proof that broad text-component conversion is unnecessary or explicitly accepted. |
| Upstream proposal churn | Medium | vadimdemedes/ink#984 is open and vadimdemedes/ink#985 is draft (E13). | Adapter boundary and removal plan after a published release. |
| Performance and retained heap | Medium | A frame map or terminal parser adds per-render data; P0 measured only existing static and text caches (E9-E11). | Render latency and retained-heap regression tests under long output. |
| License and attribution | Medium | Copying fork selection or viewport implementation brings the source-origin review required by issue #3345. Relevant fork modules include `selection.js`, `scroll.js`, `layout.js`, and `vertical-gap.js`; they carry `Copyright 2025 Google LLC` and `SPDX-License-Identifier: Apache-2.0` headers inside an MIT-declared package, while upstream 7.1.1 ships no equivalent headers (E22). A migration could instead use upstream APIs, community code, or independently designed code. | License review before any copied algorithm enters application or patch source, covering attribution as well as license compatibility. |
| Platform behavior | High until tested | P0 ran on darwin with stream doubles, not PTYs or Windows/Linux (E0, E17). | PTY and platform acceptance from P3. |

## Recommendation and prototype acceptance

Proceed with a bounded selection prototype against upstream's public surface.
Do not make the final dependency switch until that prototype decides the
conditional gate. Keep the prototype scoped to the mounted alternate-buffer
viewport, which matches current behavior and excludes unmounted history (E21,
E29).

The prototype should use the existing `rootUiRef`, public `DOMElement` traversal,
public `measureElement`, and public `Transform`. It passes the gate only if it
demonstrates all of the following without private Ink imports:

1. Cell mapping and UTF-16 endpoint behavior for wrapped, nested, transformed,
   ANSI-styled, wide, and combining text.
2. Copy reconstruction across layout gaps, clipped boundaries, and mounted item
   boundaries, with the current soft-wrap behavior.
3. Highlight painting that preserves styles and survives ancestor transform
   ordering, including `ink-gradient`.
4. Stable behavior through rerender, resize, item-height correction, and scroll
   during drag.
5. A production-file scope that maintainers accept after accounting for the
   approximately 137 direct `Text` import sites.
6. Render latency and retained heap acceptance for the mounted viewport.

Terminal-anchor proof remains a separate acceptance condition. Preserve the
current terminal-sized, no-`<Static>` alternate layout and explicitly force its
terminal anchor to row zero (`DefaultAppLayout.tsx:274-320`, E16, E17, E21).
PTY tests must cover entry, redraw, resize, clear, failure rollback, signals, and
teardown.

If the prototype passes, continue Group D and the final upstream switch. If it
requires private renderer state, broad conversion of direct `Text` sites, or
cannot match current copy and highlight behavior, stop Group D and choose
between waiting for a released frame bridge or explicitly accepting a maintained
selection patch (E13). Groups A, C, and B can proceed on the patched fork while
this gate is evaluated.

Handle the static leak separately now with the ten-line
vadimdemedes/ink#950 dependency patch on pinned fork 6.4.8. It reaches the normal
published bundle path but not forced source-entry or raw-package consumers
(E27, E28). Remove it when the upstream migration lands.
