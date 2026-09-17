# Issue #3457 — Make ToolResultDisplay retention checks reliable under allocator and RSS variance

Branch: `issue3457` · Test under change:
`packages/cli/src/ui/components/messages/ToolResultDisplay.retention.behavior.test.tsx`

## Problem

The two strict process-RSS checks (lines 96 and 118 on main) fail intermittently
in full-suite runs (`Expected: < 10485760, Received: 10485760` / `10780672` /
`10993664` across #3457, #3450, #3478 witnesses) while isolated reruns pass.
RSS is process-wide and ratchets under allocator/JIT variance, so a 10 MiB
strict threshold cannot separate behavior from noise. The failing runs block
the local verification gate for unrelated changes.

## Root-cause research (scratch probes, tmp/verify3457/, Bun 1.3.14 darwin-arm64)

Measured channels: settled retained JSC heap = `heapStats().heapSize +
extraMemorySize` after two `gcAndSweep()` calls. This channel was stable to
±0.05 MiB across repeated runs on this host, unlike RSS.

Findings, each from a scratch probe (probe files retained in tmp/verify3457/
until branch close; numbers embedded here because tmp/ is gitignored):

1. **The current test's own harness pins result bodies, unrelated to the
   component.** `ink-testing-library` keeps a module-level `instances` array;
   every `render()` call pushes its ink instance and nothing removes it (the
   library's exported `cleanup()` is never called by our
   `renderWithProviders`, whose own `cleanup` export is a documented no-op).
   Each pinned instance holds the React root → fiber tree → props → the full
   `resultDisplay` body. Measured: 24 render/unmount cycles with distinct
   ~1.0 MiB multiline bodies grow retained heap **linearly, ~2.2 MiB per body,
   no plateau** (probe6). A component that receives the body prop and renders
   an empty Box leaks identically (probe7 P4: +16.9 MiB / 8 bodies), while the
   identical JSX built outside a component leaks nothing (P5: +1.0 MiB / 8).
   Same-body repeats retain nothing (dedup by reference), which is why the
   existing warmup + two-render shape sometimes squeaks under 10 MiB and
   sometimes does not.
2. **A second, larger pinning appears when `rerender` drops the provider
   tree.** `renderWithProviders` returns ink's `rerender`, and rerendering a
   bare element replaces the provider-wrapped root, so `useTerminalStore()`
   falls back to the context default and the `useStoreSelector` subscription
   path pins fibers whose props hold bodies. Measured: 8 distinct large
   multiline bodies via bare rerender = **+6.4 to +8.7 MiB** (probe9 R1/R4,
   probe10 C1/C3/C4 — leaks even when the component renders nothing but the
   store hooks run); the same cycling without the store hooks = +0.6 MiB
   (probe10 C2). Unbroken 1 MiB bodies are flat (probe9 R3).
3. **With the full provider tree present on every rerender — the product-like
   shape — retention is small and stable: +1.84/+1.94 MiB total for 8 distinct
   ~1.0 MiB multiline bodies** (probe11, two runs). That residual is bounded
   cache/content cost (stringWidth LRU is capped at 20 000 entries; visible
   words per body are ~34), not body retention.
4. **The component's own render path retains nothing body-sized**: a full
   clone of `renderStringContent`'s JSX driven outside the component is flat
   (probe5 E3 +1.34, probe9 R2 −1.75/+0.42 across runs), and direct
   `trimToVisibleTail` loops retain nothing.

Conclusion: the RSS assertions were measuring harness pinning plus process
variance. `ToolResultDisplay` itself does not retain large bodies; the
corrected test must measure retention through a cycling shape that keeps the
provider tree intact, and must prove it still fails if the component is made
to retain.

## Accepted behavior

1. Retention evidence moves from process RSS to the settled retained JSC heap
   channel (`heapSize + extraMemorySize` after double `gcAndSweep`), the same
   family of JSC evidence #3518 introduced for `jscMemorySampler.test.ts`.
2. Repeated render/cleanup cycling over distinct large results does not retain
   tool-result bodies: cycling keeps the full provider tree on every rerender
   (no bare-element rerender through `renderWithProviders`), ends by shrinking
   off the last large body, unmounts, settles, and asserts the retained-heap
   delta stays far below body-sized growth.
3. The 1 000 000-character unbroken-input regression from #3478 stays, on the
   same retained-heap channel.
4. The one-render marginal-cost check (old peak-RSS intent: a broken trim
   must cost body-sized layout work) is kept as a heap-during-mount check on
   the same JSC channel rather than peak RSS.
5. Existing behavioral assertions (tail visibility, hidden-line reporting,
   hidden-row counting by line, fully-visible small results) are unchanged.
6. The memory assertions remain behavioral: real renders through the real
   component and providers, no mocks of the component or its layout, no
   implementation-detail spies.

Out of scope: fixing the harness footguns themselves (ink-testing-library
instance pinning; `renderWithProviders().rerender` dropping providers) beyond
what the test needs to avoid them; long-session soak (#3430); memory ownership
(#3428/#3365). The harness footguns get a separate filed issue.

## Test design

In `ToolResultDisplay.retention.behavior.test.tsx`:

- Keep the JSC guard style already in the file (fail fast when
  `bun:jsc` `gcAndSweep` is missing).
- Cycling helper: initial `render` of the provider-wrapped component with a
  small warmup body; N=8 rerenders each of the full provider-wrapped tree with
  a distinct ~1 MiB multiline body; final rerender with a small body; unmount;
  double `gcAndSweep`; report delta. The provider tree must be rebuilt per
  rerender so providers are never absent (probe11 shape). Export a
  `wrapWithProviders`-style helper from `src/test-utils/render.tsx` and have
  `renderWithProviders` reuse it, so the test composes the same stack instead
  of duplicating it (test-util-internal, not a public abstraction).
- Test A (retention, replaces the line-118 RSS check): assert cycled delta
  below a threshold chosen from measurements with ≥2× headroom below
  sabotage and ≥2× above the clean measurement (measured clean ≈ 2 MiB on 8
  bodies; sabotage adds ≥ 8 MiB; threshold ≈ 4 MiB unless wider margins are
  measured).
- Test B (control): same cycling with the SAME large body repeated asserts
  near-flat retention (≈< 1 MiB), proving the harness is not quietly pinning
  per render.
- Test C (#3478 regression, replaces the line-96-family RSS check): distinct
  unbroken 1 000 000-character bodies through the same cycling; plus a
  during-mount heap check: settled baseline → mount large unbroken body →
  read heap before unmount → assert the marginal heap is bounded well below
  body size (trim keeps layout work proportional to the visible window).
- Sabotage validation (RED evidence, never committed): temporarily add a
  module-level `retained: string[]` push in `ToolResultDisplay`, run Tests
  A/B/C, record the failing numbers, revert. Likewise temporarily disable the
  `trimToVisibleTail` call to show Test C's during-mount check fails.
  Evidence goes in the PR body.

## Verification cycle

Standard repo cycle (npm run test / lint / typecheck / format / build, plus
`bun scripts/start.ts --profile-load zai-glm-flash` smoke), plus
issue-specific gates:

- Isolated: ≥5 consecutive `bun test` runs of the changed file, all green,
  deltas logged.
- Repeated-measure: the cycled deltas across those runs must sit well below
  the threshold (no run within 25% of it).
- Concurrent workspace runner: full `npm run test` green (the #3478 witness
  was 722 files at concurrency 4).

## Review

deepthinker compliance review (max 2 rounds). OCR is skipped per standing
instruction (OCR disabled until re-enabled); the issue's OCR cap is a limit,
not a mandate.
