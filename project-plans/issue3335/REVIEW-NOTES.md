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

6. **Confirm every cap value cannot affect a legitimate response.** Largest
   declared `maxOutputTokens` in the catalog is 128,000
   (`AnthropicModelData.ts:104`). Any cap near that is too tight.

7. **Confirm the CLI control assertions actually pin current behaviour**, i.e.
   balanced-fence and no-fence streams produce identical commit boundaries, not
   merely identical final text. The bound is only safe if normal streaming is
   provably unchanged.

8. **Check for drive-by edits** in both subagents' diffs before committing, the
   way item A needed.
