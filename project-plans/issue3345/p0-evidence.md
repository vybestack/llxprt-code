# Issue #3345 P0: raw evidence pack

Every claim in `p0-report.md` and `selection-design-note.md` traces to a numbered
item here. Each item records what was run, what source was inspected, and what
came back. Interpretations retained in this pack are labeled explicitly; other
inference lives in the report.

Collected 2026-08-26 on darwin (arm64), Node v25.2.1, against:

- pinned fork: `node_modules/ink` = `@jrichman/ink@6.4.8` (root `package.json:337`,
  `packages/cli/package.json:89`)
- spike target: upstream `ink@7.1.1`, installed out-of-tree at
  `tmp/issue3345/spike/node_modules/ink` (no mainline manifest was modified)

The spike scripts referenced below ran in `tmp/issue3345/spike/` (gitignored) and
are reproduced in `p0-spike-scripts.md` so the runs can be repeated after the
scratch tree is gone.

---

## E0. Capture environment and change boundary

The evidence was captured on 2026-08-26 on darwin arm64 with Node v25.2.1. The
repository package was the pinned `@jrichman/ink@6.4.8`, and the spike target was
the out-of-tree `ink@7.1.1` installation described above.

No mainline manifest, lockfile, dependency, or `node_modules` change was made.
The scratch installation was under the gitignored
`tmp/issue3345/spike/node_modules` tree.

## E1. Upstream release inventory

```
npm view ink dist-tags   ->  { next: "3.0.0-7", latest: "7.1.1" }
npm view ink time        ->  7.1.0: 2026-06-17, 7.1.1: 2026-07-16
```

`7.1.1` is the newest published upstream release as of 2026-08-26. There is no
release later than the issue's spike target.

## E2. Upstream package metadata (7.1.1)

```
exports:          {"types":"./build/index.d.ts","default":"./build/index.js"}
peerDependencies: {"@types/react":">=19.2.0","react":">=19.2.0",
                   "react-devtools-core":">=6.1.2"}
engines:          {"node":">=22"}
```

The fork 6.4.8 exports map is byte-identical in shape
(`{"types":"./build/index.d.ts","default":"./build/index.js"}`); fork `engines`
is `{"node":">=20"}`.

Consequence recorded at E14: neither package permits bare deep specifiers such as
`ink/build/instances.js`.

## E3. Public export diff (`build/index.d.ts`)

Present in fork 6.4.8, absent from upstream 7.1.1:

| Export | Kind |
| --- | --- |
| `getBoundingBox` | function |
| `getInnerWidth`, `getInnerHeight` | function |
| `getVerticalScrollbarBoundingBox`, `getHorizontalScrollbarBoundingBox` | function |
| `ScrollbarBoundingBox` | type |
| `getText`, `getTextOffset`, `findNodeAtOffset`, `hitTest` | function |
| `getScrollHeight`, `getScrollWidth` | function |
| `clearStringWidthCache`, `setStringWidthFunction` | function |
| `DOMNode`, `getPathToRoot` | type / function |
| `StyledChar` | type (re-export of `@alcalzone/ansi-tokenize`) |
| `ResizeObserver`, `ResizeObserverEntry` | class |
| `Selection`, `Range`, `comparePoints` | class / class / function |

Present in upstream 7.1.1, absent from fork 6.4.8:

`renderToString`, `RenderToStringOptions`, `usePaste`, `useCursor`,
`useAnimation` (+`AnimationResult`), `useWindowSize` (+`WindowSize`),
`useBoxMetrics` (+`BoxMetrics`, `UseBoxMetricsResult`), `CursorPosition`,
`ElementMetrics`, `SuspendTerminal`, `TerminalSuspension`, `kittyFlags`,
`kittyModifiers`, `KittyKeyboardOptions`, `KittyFlagName`. `StdinProps` is
re-exported from `PublicProps` rather than `Props`.

## E4. `Styles` diff (`build/styles.d.ts`)

Fork-only style props (all removed upstream):

- `scrollTop`, `scrollLeft`, `scrollbarThumbColor`
- `userSelect: 'auto' | 'none' | 'text' | 'all'`
- `overflow` / `overflowX` / `overflowY` accept `'scroll'` in the fork; upstream
  accepts only `'visible' | 'hidden'`
- `textWrap` fork union is `'wrap' | 'end' | 'middle' | 'truncate-end' |
  'truncate' | 'truncate-middle' | 'truncate-start'`; upstream replaces
  `'end' | 'middle'` with `'hard'`

Upstream-only style props: `position: 'static'`, `top`/`right`/`bottom`/`left`,
`alignContent`, `aspectRatio`, `alignItems: 'baseline'`,
`alignSelf: 'stretch' | 'baseline'`, and the five `border*BackgroundColor` props.

## E5. `Box` props diff (`build/components/Box.d.ts`)

Fork-only `Box` props beyond the `Styles` deltas above: `opaque`, `sticky`,
`stickyChildren`. None exist upstream.

## E6. `Text` props diff (`build/components/Text.d.ts`)

Fork-only: `terminalCursorFocus`, `terminalCursorPosition`.

Repository usage check:

```
grep -rn "terminalCursorFocus|terminalCursorPosition" packages/*/src   ->  0 hits
```

## E7. `RenderOptions` diff (`build/render.d.ts`)

| Field | Fork 6.4.8 | Upstream 7.1.1 | Used in `packages/*/src` (non-test) |
| --- | --- | --- | --- |
| `stdout`, `stderr`, `stdin`, `debug`, `exitOnCtrlC`, `patchConsole`, `onRender`, `maxFps`, `isScreenReaderEnabled`, `incrementalRendering` | yes | yes | yes for the ones we set |
| `alternateBuffer` | yes | no (renamed `alternateScreen`) | yes |
| `alternateBufferAlreadyActive` | yes | no | 0 hits |
| `debugRainbow` | yes | no | 0 hits |
| `selectionStyle` | yes | no | 0 hits |
| `standardReactLayoutTiming` | yes | no | 0 hits |
| `alternateScreen` | no | yes | n/a |
| `concurrent` | no | yes | n/a |
| `interactive` | no | yes | n/a |
| `kittyKeyboard` | no | yes | n/a |

`incrementalRendering` (9 non-test hits) and `isScreenReaderEnabled` (12 hits)
exist in both, so only `alternateBuffer` needs renaming.

`AppContext` (`useApp()`) diff: fork exposes `exit`, `rerender`, `selection`;
upstream exposes `exit`, `waitUntilRenderFlush`, `suspendTerminal`. Both
`rerender` and `selection` are gone upstream. Repository usage of Ink's
`useApp().rerender`: 0 non-test hits (all `rerender` matches are
`renderHook`/testing-library locals).

`Instance` diff: upstream adds `waitUntilRenderFlush` and keeps `rerender`,
`unmount`, `waitUntilExit`, `cleanup`, `clear`. The fork's `recalculateLayout`
and `getSelection` are gone.

## E8. Compile-failure catalog

Method: generated `packages/cli/tsconfig.spike3345.json` by reading
`packages/cli/tsconfig.json`, stripping its `//` comment lines, and merging the
out-of-tree 7.1.1 `build/index.d.ts` into `compilerOptions.paths.ink`. The
generator also set `noEmit: true` and `incremental: false` and deleted
`tsBuildInfoFile`. It ran `tsc --noEmit` against both configs and diffed the
outputs. `p0-spike-scripts.md`, "Reproduce the compile spike," records the exact
commands.

Baseline (`tsconfig.json`, against the fork): **0 errors**. Spike
(`tsconfig.spike3345.json`, against upstream 7.1.1): **26 errors across 11
files**, all attributable to the package swap.

The first capture of this run reported 3 additional errors on both sides, in
`src/utils/zipExtract.ts` (`yauzl` typings). Those came from a stale local
install in which `@types/yauzl` resolved to 2.10.3 while both the manifest and
`package-lock.json` specify 3.4.0. After repairing the install, both sides were
recaptured and the baseline is clean. The spike count is unchanged either way,
because the 3 errors appeared identically in both listings.

| File | Diagnostics | Cause |
| --- | --- | --- |
| `src/ui/hooks/useMouseSelection.ts` | 13 | `DOMNode`, `Range`, `comparePoints`, `getBoundingBox`, `hitTest` not exported (5); `useApp().selection` missing (6); `overflowY === 'scroll'` comparisons have no overlap (2) |
| `src/session/interactiveUI.tsx` | 3 | `RenderOptions.alternateBuffer` |
| `src/ui/components/StickyHeader.tsx` | 2 | `sticky`, `opaque` Box props |
| `src/ui/contexts/ScrollProvider.tsx` | 1 | `getBoundingBox` |
| `src/ui/hooks/useMouseClick.ts` | 1 | `getBoundingBox` |
| `src/ui/hooks/useMouseClick.test.ts` | 1 | `getBoundingBox` |
| `src/ui/components/shared/VirtualizedList.tsx` | 1 | `overflowY="scroll"` |
| `src/ui/inkRenderOptions.ts` | 1 | `alternateBuffer` |
| `src/ui/mouseEventsEnabled.ts` | 1 | `Pick<RenderOptions,'alternateBuffer'>` |
| `src/ui/App.tsx` | 1 | propagated from `mouseEventsEnabled` signature |
| `src/cli.renderOptions.test.tsx` | 1 | `alternateBuffer` |

**The catalog under-reports.** TypeScript stops after the first incompatible
attribute on a JSX element, so `VirtualizedList.tsx` reports only `overflowY`
even though the same element also passes `scrollTop` and `scrollbarThumbColor`,
both of which E4 shows are absent upstream. The catalog is a floor, not a
ceiling. The type-level absence in E3/E4/E5 is the authoritative list.

Scope note: `packages/cli/tsconfig.json` does not `include` `packages/cli/test-utils/`,
so `real-ink.ts`, `ink-stub.ts`, and `ink-testing-library.ts` were not covered by
this run. They are covered separately at E14/E15.

## E9. `fullStaticOutput` still exists and still accumulates upstream

Source, upstream 7.1.1 `build/ink.js`: field declared (line 162), initialised to
`''` (249), appended in the debug path (354) and the interactive path (416),
replayed at 359, 444, 472, and in the full-clear frame at 768. The fork has the
same field and the same append/replay pattern.

Measured with `static-retention.mjs` (renders a `<Static>` list growing to 300
items of ~205 bytes each, interactive, then reads the renderer's accumulator via
the `instances` WeakMap):

| Package | Computed workload size from item text lengths plus one per item | `fullStaticOutput.length` after |
| --- | --- | --- |
| upstream 7.1.1 | 61,390 | **61,990** |
| fork 6.4.8 | 61,390 | **61,990** |

Both packages accumulated the identical amount, 61,990 characters, for the
identical computed workload size of 61,390 characters. Their accumulation rates
for this workload are the same. The script did not measure renderer static-output
bytes.

## E10. What vadimdemedes/ink#950 actually changes

Upstream 7.1.1 `build/ink.js:324-327` adds `handleStaticChange()` which sets
`fullStaticOutput = ''`; `build/reconciler.js:98-103` fires it when
`rootNode.staticNode !== rootNode.previousStaticNode`, i.e. on `<Static>`
identity change.

Measured with `static-remount.mjs`, which mirrors
`packages/cli/src/ui/layouts/DefaultAppLayout.tsx:345` (`<Static key={staticKey}>`):

| Phase | upstream 7.1.1 | fork 6.4.8 |
| --- | --- | --- |
| after 100 items under key 0 | 20,790 | 20,790 |
| after remount to key 1, before new items | **0** | **20,790** |
| after 10 further items under key 1 | 2,070 | 22,860 |

`staticKey` is owned by
`packages/cli/src/ui/containers/AppContainer/hooks/useAppDialogs.ts:62`.
`refreshStatic()` increments it at lines 84-86. Production calls to
`refreshStatic()` occur at six sites:

1. `packages/cli/src/ui/containers/AppContainer/hooks/useClearScreenAction.ts:29-34`,
   in the clear-screen action.
2. `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts:214-219`, in the
   slash-command `ui.clear()` path.
3. `packages/cli/src/ui/containers/AppContainer/hooks/useStaticRefreshManager.ts:65-82`,
   in a 300 ms debounced effect for terminal width or height changes. It refreshes
   while streaming is idle and otherwise sets a pending flag.
4. `packages/cli/src/ui/containers/AppContainer/hooks/useStaticRefreshManager.ts:84-92`,
   which flushes that pending flag when streaming returns to idle.
5. `packages/cli/src/ui/hooks/useStaticHistoryRefresh.ts:28-49`, when history
   shrinks because its length decreases, its first id is cleared, or its first id
   increases.
6. `packages/cli/src/ui/containers/AppContainer/hooks/useKeybindings.ts:189-192`,
   for the `TOGGLE_MARKDOWN` keybinding.

These source locations establish that upstream's identity-change reset is
triggered by terminal resize, history trim or compression, markdown toggle, and
clear paths. The fork did not reset in the measured remount probe. The frequency
of resets in a production session depends on the workload; P0 did not measure a
production session.

## E11. Text cache source and isolated heap measurements

Source:

- fork 6.4.8 `build/measure-text.js`: `toStyledCharactersCache = new
  DataLimitedLruMap(10_000, 1_000_000)`. It is bounded by both entry count and
  data size. The fork has no full-string wrap-result cache. Its `widthCache` is
  an unbounded `Map` keyed by single characters.
- upstream 7.1.1 `build/measure-text.js`: `const cache = new Map()`, with no
  eviction. `build/wrap-text.js`: `const cache = {}`, with no eviction. Both are
  keyed by full-string operations.

Measured with `text-cache-isolated.mjs`, which calls the text helpers directly
(bypassing renderer and React retention) on N distinct ~230-byte strings and
samples `heapUsed` after forced GC:

| N distinct strings | upstream 7.1.1 heap growth | fork 6.4.8 heap growth |
| --- | --- | --- |
| 20,000 | 21.9 MB | 126.9 MB |
| 50,000 | 55.6 MB | 126.9 MB |

**Interpretation:** Across these two samples, upstream growth was linear while
the fork stayed at the same measured heap growth. The fork's measured plateau is
high because each full-string cache entry is an array of `StyledChar` objects.
Using the measured upstream rate of approximately 1.11 KB per distinct string,
a linear extrapolation crosses the fork's measured plateau at roughly 115,000
distinct strings.

The benchmark used one repeated ASCII string shape with a varying numeric prefix.
**Interpretation:** The source establishes the cache bounds described above, but
the heap samples are not a production memory forecast.

## E12. The cache fix is on upstream master and in no release

```
gh api repos/vadimdemedes/ink/commits/ad9e3ea
  -> ad9e3ea430acd3411be1c7578a2859f810a848ec, 2026-08-11, "Fix unbounded text caches"
     files: package.json, src/measure-text.ts, src/wrap-text.ts, tests
gh api repos/vadimdemedes/ink/compare/ad9e3ea...master
  -> status=ahead ahead_by=1 behind_by=0     (ad9e3ea is an ancestor of master)
```

`src/measure-text.ts` on master: `new QuickLRU<string, Output>({maxSize: 4096})`.
`src/wrap-text.ts` on master: `new QuickLRU<string, string>({maxSize: 4096})`.

PR vadimdemedes/ink#987 itself reports `merged=false, state=closed`. The change landed as
`ad9e3ea` rather than through that PR. Either way it is post-7.1.1 and, per E1,
unreleased.

## E13. Upstream PR/issue status, verified 2026-08-26

| Number | Kind | State | Note |
| --- | --- | --- | --- |
| vadimdemedes/ink#984 `getFrameController()` for application-owned text selection | PR | open | not draft |
| vadimdemedes/ink#985 selection semantics: flows, boundaries, semantic `Text` props | PR | open | draft |
| vadimdemedes/ink#986 unbounded text caches | issue | closed | |
| vadimdemedes/ink#987 bound caches (LRU) | PR | closed, **not merged** | see E12 |
| vadimdemedes/ink#973 tall `<Static>` overwrites its own last line | issue | **open** | |
| vadimdemedes/ink#968 `measureElement()` returns coordinates | PR | merged 2026-07-16 | in 7.1.1 |
| vadimdemedes/ink#950 drop stale `<Static>` output on identity change | PR | merged 2026-05-13 | in 7.0.3 |
| vadimdemedes/ink#974 preserve last `<Static>` line after full clear | PR | merged 2026-07-16 | in 7.1.1 |

## E14. Deep imports and the exports map

Bare deep specifier `import instances from 'ink/build/instances.js'` fails on
upstream with `ERR_PACKAGE_PATH_NOT_EXPORTED`. A relative filesystem path
(`./node_modules/ink/build/instances.js`) succeeds.

The repository's `test-utils/real-ink.ts` and `test-utils/ink-testing-library.ts`
already use relative filesystem paths (`../../../node_modules/ink/build/...`),
so they are not blocked. Per E2 the fork's exports map is equally restrictive, so
this is not a migration regression.

All 14 deep paths in `real-ink.ts` resolve to files that exist in upstream 7.1.1:

```
build/components/{Box,Newline,Spacer,Static,Text,Transform}.js
build/hooks/{use-app,use-focus,use-focus-manager,use-input,
             use-is-screen-reader-enabled,use-stderr,use-stdin,use-stdout}.js
```

## E15. How upstream treats the repository's test `Stdout` double

Upstream resolves interactivity as `interactive ?? (!isInCi &&
Boolean(stdout.isTTY))` (`build/ink.js:707`). The repository's test double
(`packages/cli/test-utils/ink-testing-library.ts`) exposes `columns` but no
`isTTY`, so upstream resolves `interactive === false`.

Measured with `harness-probe.mjs` using that exact double:

| Options | resolved `interactive` | frames before unmount | `lastFrame()` after first render | after rerender |
| --- | --- | --- | --- | --- |
| `{debug: true}` (what the shim passes today) | false | 4 | `"first"` | `"second"` |
| `{}` | false | 0 | undefined | undefined |
| `{interactive: true}` | true | 2 | `"first\n"` | `"first\n"` |

Findings:

1. The shim keeps working on upstream **because it passes `debug: true`**, and
   upstream's `debug` branch runs before the `!interactive` branch
   (`build/ink.js:358` precedes `362`).
2. Dropping `debug` yields no frames at all until unmount.
3. `interactive: true` emits real ANSI erase sequences and defers the rerender
   frame. `lastFrame()` after `rerender()` still shows `"first"`. Any harness
   using it must await `waitUntilRenderFlush()`.
4. Upstream writes a final frame at unmount (`lastFrame()` becomes `"\n"` in the
   debug case), which the fork does not.

## E16. Geometry: fork `getBoundingBox` vs upstream `measureElement`

Source comparison. Both walk `parentNode` accumulating
`getComputedLeft`/`getComputedTop`. The **only** functional difference is that
the fork additionally subtracts `getScrollTop`/`getScrollLeft` for ancestors
whose `overflowY`/`overflowX` is `'scroll'`.

Both are **live-region relative**. Measured with `viewport-probe.mjs`
(upstream) and `anchor-probe-fork.mjs` (fork), on a tree with a 2-line
`<Static>` above a `header-line` above the probed box:

| Package | API | result |
| --- | --- | --- |
| upstream 7.1.1 | `measureElement(box)` | `{x:0, y:1, width:40, height:4}` |
| fork 6.4.8 | `getBoundingBox(box)` | `{x:0, y:1, width:40, height:4}` |

`y = 1` counts only the live region (`header-line` is live row 0). The two
`<Static>` lines above are not counted by either package.

`packages/cli/src/ui/hooks/useMouseSelection.ts:221-222` converts mouse input as
`x = event.col - 1; y = event.row - 1` and compares directly against
`getBoundingBox` output, i.e. it assumes the live-region anchor is terminal row 0.

## E17. Alternate-screen `<Static>` lifecycle differs between the packages

Measured with `altscreen-probe.mjs` using a stream double configured with 40
columns and 10 rows, three static items, then a fourth appended. Control
sequences are shown symbolically.

Fork 6.4.8 (`alternateBuffer: true`), per frame:

```
<ESC[?1049h><ESC[?7l><ESC[?25l><ESC[?2026h><ESC[1;1H><ESC[2J>s-1 s-2 s-3
  live-first-line live-second-line <ESC[?2026l>
<ESC[?25l><ESC[?2026h><ESC[1;1H><ESC[2J>s-1 s-2 s-3 s-4
  live-first-line live-second-line <ESC[?2026l>
```

The fork's captured writes contain cursor-home and screen-clear sequences
(`ESC[1;1H`, `ESC[2J`) on every frame, followed by
`fullStaticOutput + output`. The stream double did not verify the terminal's
resulting cursor or screen state.

Upstream 7.1.1 (`alternateScreen: true`):

```
<ESC[?1049h><ESC[?25l><ESC[?2026h>s-1 s-2 s-3 <ESC[?25l>live-first-line
  live-second-line <ESC[?2026l>
<ESC[?2026h><ESC[2K><ESC[1A><ESC[2K><ESC[1A><ESC[2K><ESC[G>s-4
  live-first-line live-second-line <ESC[?2026l>
```

Upstream's captured writes do not contain home or clear sequences between the
tested frames. They append static output inline and emit erase sequences for the
previous live lines. The stream double proves only that upstream did not emit a
home or clear sequence between those frames. It does not establish terminal scrolling, cursor placement, or the final
screen state because no terminal interpreted the byte stream.

`geometry(live)` returned `{x:0, y:0, width:40, height:2}` on **both**, i.e.
neither reports the static lines above.

This matters here because `packages/cli/src/ui/mouseEventsEnabled.ts:19-21`
enables mouse input only when `alternateBuffer === true`, so alternate screen is
the only mode in which selection is live.

## E18. Community viewport packages

Metadata, 2026-08-26:

| Package | Version | Peer `ink` | Last publish | Downloads (last month) |
| --- | --- | --- | --- | --- |
| `ink-scroll-view` | 0.3.7 | `^5 \|\| ^6 \|\| ^7` | 2026-05-08 | 524,958 |
| `ink-scroll-list` | 0.4.1 | `>=6` | 2026-01-03 | 324,368 |
| `ink-virtual-list` | 0.3.0 | `^6.0.0 \|\| ^7.0.0` | 2026-08-07 | 492 |

Download counts are the npm values captured on 2026-08-26 and are volatile.

Distributed package surfaces inspected in the scratch installation:

- `ink-scroll-view` (337 lines): `Box`, `measureElement` only. Clipping is
  `overflow: "hidden"` on a wrapper with `marginTop: -scrollOffset` on the
  content (`dist/index.js:194,200`). It exports controlled and uncontrolled
  components. `ScrollView` owns its offset and exposes `scrollTo`, `scrollBy`,
  `scrollToTop`, `scrollToBottom`, `getScrollOffset`, `getContentHeight`,
  `getViewportHeight`, `getBottomOffset`, `getItemHeight`, `getItemPosition`,
  `remeasure`, and `remeasureItem`. `ControlledScrollView` accepts a parent-owned
  offset and exposes the measurement and remeasurement subset. Both components
  wrap and measure every child, store per-item heights, compute per-item offsets,
  and expose `getItemPosition` (`dist/index.d.ts:10-356`;
  `dist/index.js:23-218,233-337`).
- `ink-scroll-list` (292 lines): no direct `ink` import. It wraps
  `ink-scroll-view`, extends `ScrollViewProps` with `selectedIndex` and
  `scrollAlignment: "auto" | "top" | "bottom" | "center"`, and exposes a ref
  extending `ScrollViewRef` (`dist/index.d.ts:1-230`). It therefore inherits the
  measured variable-height item model and imperative methods from
  `ink-scroll-view`.
- `ink-virtual-list` (210 lines): imports `Box`, `Text`, and `useStdout`, and reads
  terminal dimensions through `useStdout`. Its props include `items`,
  `renderItem`, `selectedIndex`, `keyExtractor`, `height`, `reservedLines`, and
  `itemHeight`. It renders only
  `items.slice(viewportOffset, viewportOffset + visibleCount)`
  (`dist/index.js:176`), exposes `scrollToIndex(index, alignment)`,
  `getViewport()`, and `remeasure()`, and accepts `renderScrollBar(viewport)`,
  `onViewportChange`, `showOverflowIndicators`, `renderOverflowTop`, and
  `renderOverflowBottom` (`dist/index.d.ts:27-108`). Its viewport follows a
  selected index and uses one fixed `itemHeight`; it does not expose a measured
  variable-height or pixel-offset model.

None uses any fork-only export.

Functional check with `viewport-probe.mjs`, upstream 7.1.1 + `ControlledScrollView`,
12 rows in a 4-row viewport:

```
scrollOffset=0  ->  rows row-0..row-3 visible
scrollOffset=5  ->  rows row-5..row-8 visible
```

Clip and translate both work on upstream.

## E19. Scroll-translated coordinates under an app-owned viewport

Measured with `child-coord-probe.mjs`: same `ControlledScrollView` tree, but each
row is individually measured with upstream `measureElement`.

| Row | `y` at `scrollOffset=0` | `y` at `scrollOffset=5` |
| --- | --- | --- |
| viewport container | 1 | 1 |
| row-0 | 1 | **-4** |
| row-5 | 6 | **1** |
| row-6 | 7 | 2 |
| row-11 | 12 | 7 |

At `scrollOffset=5`, row-5 measures at the viewport's own `y`, and row-0 measures
negative (scrolled off). The rendered frame confirms row-5 is the first visible
line.

**Interpretation:** Because the translation is a real negative Yoga margin,
upstream `measureElement` already returns viewport-relative, scroll-translated
coordinates. The fork's scroll-offset subtraction (E16) has no counterpart to
replace.

## E20. Ink ecosystem dependencies

| Package | Declared | Installed | Installed peer `ink` | Latest | Latest peer `ink` |
| --- | --- | --- | --- | --- | --- |
| `ink-gradient` | `^3.0.0` | 3.0.0 | `>=4` | 4.0.1 | `>=6` |
| `ink-spinner` | `^5.0.0` | 5.0.0 | `>=4.0.0` | 5.0.0 | `>=4.0.0` |
| `ink-testing-library` | `^4.0.0` | 4.0.0 | none (no `ink` peer) | 4.0.0 | none |
| `ink-select-input` | `^6.2.0` | 6.2.0 | `>=5.0.0` | 6.2.0 | `>=5.0.0` |

All installed peer ranges already admit `ink@7`. `ink-select-input` appears only
in `package.json:339` and `packages/cli/package.json:91`; it has zero imports in
`packages/*/src`, confirming the issue's claim.

`ink-testing-library` is imported by 37 files but is redirected to
`packages/cli/test-utils/ink-testing-library.ts` by `tsconfig.bun.json` and the
`bun-test-setup.ts` resolver plugin, so the published package is not exercised.

## E21. The two layouts, and where `<Static>` and selection each apply

`packages/cli/src/ui/layouts/DefaultAppLayout.tsx:175` branches on
`layoutSettings.useAlternateBuffer`:

- `AlternateBufferLayout` (lines 274-321) renders no `<Static>` at all. Its root
  `Box` is `width={terminalWidth} height={terminalHeight}` with
  `overflow="hidden"`, and contains only `ScrollableList` plus `MainControls`.
- `StandardBufferLayout` (lines 323-360) is the only layout that renders
  `<Static key={staticKey} items={staticItems}>`, and only when
  `staticItems.length > 0`.

`packages/cli/src/ui/mouseEventsEnabled.ts:19-21` enables mouse input only when
`alternateBuffer === true`.

**Source-layout interpretation:**

1. Mouse selection is live only in the layout that has no `<Static>` above the
   live region, and whose root fills the terminal. The live-region anchor is
   therefore structurally terminal row 0 today, which is what
   `useMouseSelection.ts:221-222` assumes.
2. The `fullStaticOutput` retention measured at E9 can only occur in the
   standard-buffer layout, since that is the only layout that mounts `<Static>`.

Neither consequence was verified end to end through a PTY; both are read from
the source and from E16/E17.

## E22. Licensing of the fork-only modules

The fork package declares `"license": "MIT"`, matching upstream. Four modules in
`node_modules/ink/build/` carry a different per-file header:

| Module | Header |
| --- | --- |
| `selection.js` (and `selection.d.ts`) | `Copyright 2025 Google LLC`, `SPDX-License-Identifier: Apache-2.0` |
| `scroll.js` | `Copyright 2025 Google LLC`, `SPDX-License-Identifier: Apache-2.0` |
| `layout.js` | `Copyright 2025 Google LLC`, `SPDX-License-Identifier: Apache-2.0` |
| `vertical-gap.js` | `Copyright 2025 Google LLC`, `SPDX-License-Identifier: Apache-2.0` |

No file in upstream 7.1.1's `build/` carries an `SPDX-License-Identifier` header
at all.

The headers occur on modules that cover selection ranges and copy reconstruction,
scroll offset computation, fragment layout reconstruction, and vertical gap
handling. A migration could use upstream APIs, a community package, or
independently designed code instead of reimplementing these modules. The issue
already schedules a "license/attribution review if fork algorithms are copied
into our source"; this records that these source files carry a distinct
copyright holder and license from the package they ship in.

P0 makes no legal determination. It records the headers as found.
