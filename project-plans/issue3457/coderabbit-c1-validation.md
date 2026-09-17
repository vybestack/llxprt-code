# C1 absolute retention bound: validation measurements

Verdict: the reworked C1 holds with a 4 MiB absolute limit, clean runs sit near 1.4 MiB, and all three sabotages fail it or the suite as required. The CodeRabbit concern is closed with numbers, not just a threshold bump.

Setup: branch `issue3457`, commit `fceb51eb1`, Bun 1.3.14 on darwin-arm64, run from `packages/cli` as `bun test src/ui/components/messages/ToolResultDisplay.retention.behavior.test.tsx`. Raw logs under `tmp/verify3457/` (gitignored).

## Rework shape

- `baseline = settledRetainedHeapBytes()` is read after `mountWarmup()` and before any unbroken body exists.
- A new helper `cycleUnbrokenBodies(root)` builds the eight rope-built unbroken bodies, renders each once, reads `afterFirstPass`, renders each again, reads `afterRevisit`, and returns the two numbers. The bodies and the loop bindings are locals of the helper, so no test-held reference survives the return.
- The test computes `retainedBytes = finishCycle(root) - baseline` and asserts it under the new `UNBROKEN_RETENTION_LIMIT_BYTES`, then keeps the old revisit assertion (`afterRevisit - afterFirstPass < UNBROKEN_REVISIT_LIMIT_BYTES`) using the helper's pass-local readings.

## Clean measurements (5 runs)

| run | absolute retained (bytes) | absolute (MiB) | revisit delta (bytes) | revisit (MiB) |
|-----|---------------------------|----------------|-----------------------|----------------|
| 1   | 1,494,374                 | 1.425          | 930,574               | 0.887          |
| 2   | 1,494,614                 | 1.425          | 915,142               | 0.873          |
| 3   | 1,472,502                 | 1.404          | 915,206               | 0.873          |
| 4   | 1,488,240                 | 1.419          | 915,142               | 0.873          |
| 5   | 1,483,422                 | 1.414          | 941,894               | 0.898          |

Absolute range 1.404 to 1.425 MiB (spread under 1.5%). Revisit range 0.873 to 0.898 MiB, matching the 0.86 to 0.90 MiB already recorded in the thresholds comment. All 5 runs: 8 pass, 0 fail.

## Threshold choice

`UNBROKEN_RETENTION_LIMIT_BYTES = 4 * MIB`.

- Headroom over clean: 4 MiB / 1.43 MiB worst case = 2.8x, above the file's 2x rule.
- Distance below sabotage: pinning unbroken bodies measured 17.47 MiB, so the limit sits 4.2x below the sabotage, above the file's 2x rule.

## Sabotage RED checks

### 1. Unbroken first-sight retention (module-scope `PINNED`, push only when the body has no newline)

- C1 FAILED on the absolute assertion: received 17,470,728 bytes (16.66 MiB) against the 4 MiB limit.
- The revisit delta stayed clean at 913,334 bytes (0.87 MiB). This is the CodeRabbit scenario reproduced exactly: a component that retains every unbroken body on first sight passes the old revisit-only assertion while holding 16.66 MiB. The absolute bound is what catches it.
- The other 7 tests passed (multiline bodies are not pinned, so A and B are unaffected), as expected.
- Reverted with `git checkout`; `git diff --stat` showed only the test file afterward.

### 2. All-body pinning (unconditional `PINNED.push(displayContent)`)

- A FAILED: received 17,997,546 bytes (17.2 MiB) against 4 MiB.
- B FAILED: received 16,484,128 bytes (15.7 MiB) against 1 MiB.
- C1 FAILED on the absolute assertion: received 17,475,588 bytes (16.7 MiB) against 4 MiB; revisit 917,208 bytes.
- B's received value is higher than the 2.48 MiB recorded in the old evidence comment because the module-scope array accumulates across tests in one process and test B's baseline no longer cancels all of it. The verdict is unchanged: B fails by more than an order of magnitude.
- Reverted and verified as above.

### 3. Trim bypass (`trimToVisibleTail` result replaced with `{ text: displayContent, hiddenDisplayLines: 0 }` in the defined-height branch)

- C1 FAILED by timeout: 26.8s of untrimmed renders against the 5s default test timeout. Its heap readings under the bypass came out negative (absolute -7,415,648, revisit -182,488), so for this sabotage the timeout is the verdict. The old C1 design does the same 16 renders and fails the same way, so RED coverage is not weaker than before.
- C2b FAILED on the heap assertion: received 12,271,146 bytes (11.70 MiB) against 6 MiB, close to the 12.45 MiB already on record.
- A also FAILED: received 8,715,918 bytes (8.31 MiB) against 4 MiB, matching the 8.33 MiB on record.
- Reverted and verified as above.

## Final state

- Only `packages/cli/src/ui/components/messages/ToolResultDisplay.retention.behavior.test.tsx` modified in the tree, plus this report.
- No `console.log` left in the test (the measurement log line was temporary).
- Prettier formatted the file (45ms, no complaints).
- Two final clean runs of the polished file: 8 pass, 0 fail each, about 1.3s per run.
- Typecheck of packages/cli (`bun run typecheck`, both tsconfig passes) completed with no diagnostics.
