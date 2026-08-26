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
