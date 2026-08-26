# Review notes for the issue3335 branch

Things I flagged while reviewing subagent output. Kept here so they survive
context loss and get checked before the PR goes up.

## Corrected already

1. **Out-of-scope string churn** in `subagentOrchestrator.ts` — the item A
   subagent shortened two unrelated abort-message strings. Reverted.

2. **The default reproduced the bug it was fixing.** Item A derived the budget
   as `max_turns * modelMaxOutputTokens`, which for the incident profile is
   1000 x 16,384 = 16.4M. The runaway sat inside that at turn 253, so the
   feature would have been a no-op. Clamped to 2M with a regression test
   asserting the resolved value is strictly below `1000 * 16_384`.

3. **Per-delta `JSON.stringify` in the hot path.** The token estimate
   serialised every chunk's blocks to measure length, adding an allocation per
   delta to the code path this PR exists to make cheaper, and inflating the
   count with JSON syntax. Replaced with a direct length sum.

4. **Reasoning counting was accidental, not pinned.** The stringify happened to
   include thinking blocks, but nothing asserted it. Added a paired test:
   reasoning-heavy turn trips the budget, same visible text without reasoning
   does not.

## To check before the PR goes up

5. **`Turn.debugResponses` cap may be O(n * CAP) in time.** The current shape
   in `turn.ts` around :304-320 is:

   ```
   if (this.debugResponses.length > MAX_DEBUG_RESPONSE_CHUNKS) {
     this.debugResponses.splice(0, this.debugResponses.length - MAX_...);
   }
   // then rebuild debugThinkingByStreamId over the whole retained array
   ```

   Once the array reaches the cap, every subsequent chunk triggers a
   front-splice (an O(CAP) memmove) plus a full O(CAP) reindex of the streamId
   map. For a runaway producing millions of deltas that is O(n * CAP) work.

   Memory is correctly bounded, which is the headline fix, but this trades the
   memory blowup for a CPU one. A ring buffer, or an index offset instead of a
   physical splice, avoids it. Verify with a timing-independent assertion
   (count operations, not wall clock) rather than assuming.

   **MEASURED, and it is severe.** `tmp/oomproof/proof8.mjs` compares the landed
   shape against a ring buffer at the cap `turn.ts` actually uses
   (`MAX_DEBUG_RESPONSE_CHUNKS = 1024`):

   ```
   CAP=1000  chunks=200,000
   splice+reindex :   13242 ms   reindexOps=199,000,000   retained=1000
   ring buffer    :       2 ms   reindexOps=0             retained=1000
   slowdown       : 5661.4x
   ```

   200,000 chunks is a modest stream; the incident produced millions. As landed
   this converts the memory blowup into a 13-second-per-200k-chunk CPU stall,
   which is arguably a worse failure mode: the runaway hangs the process instead
   of crashing it, and it does so on the normal path too, not just under attack.
   MUST FIX before the PR. Replace the physical splice + full reindex with a
   ring buffer or a logical head offset so the steady-state cost is O(1) per
   chunk, and assert operation counts rather than wall clock.

6. **Confirm every cap value cannot affect a legitimate response.** Largest
   declared `maxOutputTokens` in the catalog is 128,000
   (`AnthropicModelData.ts:104`). Any cap near that is too tight.

7. **Confirm the CLI control assertions actually pin current behaviour**, i.e.
   balanced-fence and no-fence streams produce identical commit boundaries, not
   merely identical final text. The bound is only safe if normal streaming is
   provably unchanged.

8. **Check for drive-by edits** in both subagents' diffs before committing, the
   way item A needed.

## Does the budget actually stop the reported incident?

Measured against the incident's own telemetry: 8,138 DeepSeek responses from the
affected session, output tokens per response.

```
n=8138  min=2  p50=122  p90=376  mean=339  max=16384
turns to reach the 2,000,000 budget at mean output:  5,896
turns to reach it at p50 output:                    16,393
turns to reach it at the 16,384 ceiling:               122
```

Two conclusions, one reassuring and one not.

**The budget cannot degrade normal operation.** Typical output is 122 tokens per
turn. At that rate the budget is ~16,000 turns of work, and `max_turns` (1000 by
default) binds thousands of turns earlier. For ordinary traffic the budget is
never the thing that stops a run, which is exactly what was wanted.

**The budget only catches high-output runaways.** The incident reached turn 253.
Every sampled response for the runaway subagent (`typescriptexpert-wg1coz`) was
exactly 16,384, the per-response ceiling, so if that held across its turns the
budget trips at **turn 122** — less than half way to where it actually got, and
well before the heap died. That is a real fix for the observed failure mode.

But if a future runaway loops with *typical* 122-token responses instead, 253
turns is 30,866 tokens, about 1.5% of the budget. The budget would never fire
and `max_turns = 1000` would be the only stop, far too late to matter for
memory. **This change does not address a many-small-turns runaway.** The
per-delta retention work (#3339, #3341) is what bounds memory in that case, not
the budget. Worth stating plainly rather than implying the budget is a general
runaway guard.

Follow-up worth considering separately: a rate-based check (output tokens per
unit time, or turns without tool calls) would catch the case the budget misses.
Deliberately not in this change.

## Fence handling across backtick counts (#3340)

Probed the scanner directly with an unclosed fence followed by 800 KiB of body,
on this branch and on `main`, measuring what the split point retains.

| Opening      | main retains | branch retains | Verdict                    |
| ------------ | ------------ | -------------- | -------------------------- |
| 3-backtick   | 819,606      | 65,536         | fixed                      |
| 4-backtick   | —            | 65,536         | fixed                      |
| 5-backtick   | —            | 65,536         | fixed                      |
| 6-backtick   | 0            | 0              | unchanged, see below       |
| no fence     | 0            | 0              | control, unchanged         |

The 3/4/5 cases are the bug and they are fixed: retention drops from the entire
response to a bounded 64 KiB tail, and the header capture correctly recovers the
longer fence and its language so the continuation reopens with the right marker.

**Known limitation, pre-existing and not introduced here.** A 6-or-more-backtick
opening fence is not seen as opening a block at all. `scanFence`
(`incrementalSplitScanner.ts:169-194`) matches exactly three backticks and
returns 3, so the next three of a six-backtick run are read as a *closing*
fence: parity flips on and straight back off. The measurement above confirms
`main` behaves identically, so this branch neither causes nor worsens it.

Consequence is rendering, not memory: retention is 0, so there is no leak, but
the body of a six-backtick block is split at paragraph breaks and rendered as
prose rather than code. Six-backtick fences are legal CommonMark (used to nest
blocks containing five backticks) but rare in model output.

Fixing it means tracking fence run-length rather than parity, which is a real
change to the scanner and unrelated to the memory bound this PR is about.
Recorded rather than smuggled in.

## Review findings deliberately not fixed here

Two independent reviews (ocr, 16 findings; deepthinker, 15) drove the fixes in
this branch. Everything ranked HIGH or MEDIUM that this change introduced is
closed. What remains is recorded rather than silently dropped.

R1. **Kimi section counts persist across buffer flushes.** MEDIUM.
    `kimiScanTail` and the cumulative counts live in
    `openaiTextBuffer.ts:48-65`, but a normal flush clears only `textBuffer` and
    `textBufferBytes` (`OpenAIStreamProcessor.ts:312-325`). A begin marker whose
    prefix is flushed and whose suffix arrives next is counted as open even
    though the current buffer no longer holds the prefix, so flushing can be
    suppressed until an end marker or the 8 MiB cap.

    Not fixed here because the correct fix is to make flush and scan state
    move together, which changes Kimi tool-call framing rather than any memory
    bound. The 8 MiB cap means the failure is now bounded either way, which it
    was not before this branch.

R2. **Non-interactive still re-checks turn and time limits after the
    response.** MEDIUM, pre-existing. `subagentNonInteractive.ts` runs the full
    termination check between receiving a response and dispatching its tool
    calls, so a subagent on its final permitted turn can have those calls
    discarded. This is the same defect fixed for the interactive path in
    `62cd3c328`, but on the non-interactive path it predates the branch and is
    not caused by the budget work. Fixing it changes when existing runs stop,
    which deserves its own change and its own regression coverage.

R3. **`MAX_DEBUG_RESPONSE_CHUNKS` peaks at twice its name.** LOW. Retention is
    capped at 1,024 but trimming waits for `> 2 * cap`, so the true high-water
    mark is 2,048 chunks. That is the deliberate amortisation described above,
    and both the constant's comment and the test assert the `* 2` bound, so the
    behaviour is documented rather than surprising. The name could still be
    read as an absolute.

R4. **The derived default does not consult the model catalog.** LOW.
    `resolveModelMaxOutputTokens` reads the profile's `maxOutputTokens` and
    `modelParams.max_tokens` only, so a model whose limit is known only to the
    catalog or an alias falls back to the flat 2,000,000 rather than
    `max_turns * catalogMaxOutputTokens`. The clamp means the incident's shape
    is still caught; the effect is that some low-turn profiles get a looser
    default than they could. Reading the catalog here requires run-config
    resolution to happen after runtime activation, which is the ordering that
    caused the launch-failure bug fixed in `62cd3c328`.

R5. **Catalog maximum is 131,072, not 128,000.** LOW. Kimi declares 131,072,
    above the Anthropic figure used when sizing the caps. Every headroom ratio
    in this branch is therefore slightly overstated (16x becomes 15.26x for the
    aggregate ceiling). No cap changes rank as a result.

## Verification notes

V0. **Test-audit gate passes: no new findings on any touched test file.**
    `bun scripts/test-audit/scan.ts` over 2,699 files. Of the 13 test files this
    branch touches, 11 have zero findings, including all seven new ones
    (`subagent.aggregate-output-budget`, `subagentOrchestrator.output-budget`,
    `turn.debug-responses`, `providerStreamLimits`, `pendingResponseBuffer`,
    `contentEventProcessor.streaming`, `OpenAIStreamProcessor.retention`).

    Two touched files carry findings, all pre-existing:
    `settingsRegistry.test.ts` (4: WEAK_ONLY at 687/706/851, STRUCTURE_ONLY at
    882) and `subagentToolProcessing.test.ts` (2: MOCK_ONLY_ORACLE at 449/477).
    Both are outside this branch's hunks: the only edit to `settingsRegistry` is
    at line 955+, after every finding; the only edit to `subagentToolProcessing`
    is at 208-223, and the findings sit 200+ lines later. Confirmed directly by
    grepping `main` for the flagged test names, which are present there.

V2. **Full verification result.**

    ```
    npm run build      EXIT 0
    npm run typecheck  CLEAN (all workspaces, after build refreshed dist)
    npm run lint       EXIT 0 (all workspaces)
    npm run test       1 failure, the known flake below, nothing else
    test-audit scan    no new findings on any touched file
    smoke              EXIT 0 on dsflash-mi300x, the incident profile
    ```

    The suite exits 1 solely because of V1. Across the whole run there is
    exactly one `(fail)` line and it is that test; filtering it out leaves
    nothing. The repeated `Internal error: directory mismatch ... You don't need
    to do anything` lines are a bun runner warning, not failures.

    Re-confirmed after the suite finished and the machine was quiet: the test
    passes in 17.56ms (21/21).

V1c. **The whole `packages/agents/src/api/__tests__` directory is clean on both
    branches: 903 pass / 0 fail, identical.** The final full-suite run reported
    four distinct failures, all in that directory, including one named
    `T1 stream yields ordered thinking then text` that looked like it could be
    caused by the thinking-accounting changes. Each passes in isolation
    (`core-conversation.spec.ts` 9/9, `tasksControl.behavior.test.ts` 8/8), and
    the entire directory passes on this branch and on `main` with the same
    numbers. The failures do not reproduce at directory scale at all: they are
    an artifact of running the full suite alongside other heavy jobs.

V1b. **`subagent.runNonInteractive-term.test.ts` and
    `mutationCoverage.behavior.test.ts` are unstable together, on main too.**
    The final full-suite run reported three failures: the mutation post-auth
    guard test twice at exactly 30000.00ms (its timeout), and
    `should time out while waiting for interactive tool completion`.

    The second sits in a file this branch modifies, so it needed checking rather
    than assuming. In isolation it passes 12/12 on this branch. Run as a pair,
    both files give **23 pass / 11 fail on this branch and 23 pass / 11 fail on
    `main`** — identical. The term file drives `vi.useFakeTimers()` and
    `advanceTimersByTime`, which is exactly the shape that breaks when another
    file in the same process installs its own timer mocks.

    Pre-existing cross-file interference, not a regression here. As with V1, the
    project runner executes files individually, which is why the full suite is
    otherwise clean.

V1. **`grep-ripgrep-issue3203-remediation.test.ts` flakes under load, not from
    this branch.** The full-suite run reported
    `grep with exactly max_results matches is NOT marked incomplete` failing at
    15,006.97ms, which is its 15s timeout rather than a wrong result. Evidence
    it is environmental: the branch does not touch `packages/tools` at all
    (`git diff main --stat -- packages/tools` is empty); the test passes on
    `main` in 35ms; and it passes on this branch in isolation in 47ms (21/21).
    The failing run had `npm run lint`, `npm run test`, and a review subagent
    all running concurrently. Re-check any full-suite failure in isolation
    before treating it as real, and prefer not to run the suite alongside other
    heavy jobs.

## Findings on the provider work (#3341)

A. **Check 6 passes: cap values are safely generous.** `streamLimits.ts` sets
   tool-call 16 MiB, SSE line 8 MiB, reasoning capture 8 MiB, buffered text
   8 MiB. The largest legitimate single response is ~128k tokens, roughly
   512 KiB, so every cap has at least 16x headroom. `ProviderStreamProtocolError`
   correctly sets `isRetryable = false` and `shouldFailover = false`: a protocol
   violation should not cause a failover to another backend, and the message
   names both the limit and the received size.

B. **Byte accounting is incremental at three of four sites, and quadratic at
   the fourth.** These measure the delta and accumulate a counter, which is
   O(1) per chunk and correct:
   - `vercelReasoningCapture.ts:86` (`reasoningBytes + utf8ByteLength(delta)`)
   - `AnthropicStreamProcessor.ts:335` (`inputBytes += utf8ByteLength(delta)`)
   - `OpenAIStreamProcessor.ts:344` (`textBufferBytes += utf8ByteLength(delta)`)
   - `ToolCallCollector.ts:106-108` (per-fragment)

   But `vercelReasoningCapture.ts:137-141` calls `utf8ByteLength(buffer)` on the
   **accumulated** incomplete SSE line on every read:

   ```ts
   buffer += decoder.decode(value, { stream: true });
   const lines = buffer.split('\n');
   buffer = lines.pop() ?? '';
   assertProviderStreamByteLimit('incomplete SSE line', utf8ByteLength(buffer), ...);
   ```

   In normal operation the trailing line is short, so this is cheap. In the
   pathological case the cap exists to catch — a peer that never emits `\n` —
   the buffer grows to megabytes and is fully re-measured on every read, making
   the guard O(n^2) exactly when it is needed. It still fires at 8 MiB, so this
   is a should-fix rather than a must-fix, but it is avoidable.

   Remedy: gate the exact measurement behind an O(1) length pre-check. UTF-8
   byte length is bounded by `3 * str.length`, so `str.length * 3 <= limit`
   proves the value is under the limit without scanning it:

   ```ts
   function exceedsUtf8ByteLimit(value: string, limit: number): boolean {
     if (value.length * 3 <= limit) return false; // cannot exceed; O(1)
     return utf8ByteLength(value) > limit;
   }
   ```

## Findings on the CLI work (#3340)

9. **Check 7 passes.** `pendingResponseBuffer.test.ts:42-68` uses
   `toStrictEqual` on the exact `committed` array and the retained tail for both
   the no-fence and balanced-fence controls, so commit boundaries are genuinely
   pinned, not just final text. This is the "do not degrade normal streaming"
   guard and it is real.

10. **The bound assertion is too weak.** `:70-81` asserts
    `retained.length < 524_288` against an 820,014-character stream. 524,288 is
    exactly `MAX_UNCLOSED_FENCE_LENGTH`, so the test only proves retention
    landed under the trigger for this one fixture size. It would still pass if
    retention grew with the stream, which is the actual defect. The property
    that matters is that **retention does not scale with stream length**. Add a
    second stream at 2x the deltas and assert retention does not materially
    grow. Also drop `expect(original.length).toBe(820_014)`, which asserts the
    fixture rather than any behaviour.

11. **Threshold sizing is tight but defensible.**
    `MAX_UNCLOSED_FENCE_LENGTH = 512 KiB`, retaining `64 KiB` after a forced
    split. 512 KiB is roughly 128k tokens, which is exactly the largest declared
    `maxOutputTokens` in the catalog (`AnthropicModelData.ts:104`). So a
    legitimate maximum-length response consisting *entirely* of one unbroken
    code block would sit right at the trigger. That combination is vanishingly
    rare and the consequence is cosmetic (two adjacent, identically styled code
    blocks), so this is acceptable — but it should be stated in the constant's
    comment rather than left for a reviewer to work out.
