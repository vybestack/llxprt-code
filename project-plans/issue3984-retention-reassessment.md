# Issue #3984: retention and model-visible image admission

> **Historical assessment:** The age-based durable-retirement recommendation below
> was superseded by the implemented request-view design. It is retained as a
> record of earlier analysis, not as current requirements. See the current
> implementation and evidence in [issue3984.md](issue3984.md).

## Status

Design reassessment requested by the user on 2026-10-29. This supersedes the
cap-increase plus one ordinary compression attempt as the proposed solution.
The existing uncommitted implementation and its green checks are a baseline,
not evidence that the retention behavior below works. No PR is open.

Two read-only assessments were obtained: backupcoder using Claude Sonnet 5.5,
and architect using the configured GPT architecture profile. No Opus-configured
subagent is available in this session. Neither assessment was represented as an
Opus review. Their numerical defaults are proposals, not measured optimal values.

## Established gaps

1. Real middle-out compression preserves its head and tail, including images.
   Small histories can be structural no-ops. High-density text pruning does not
   necessarily remove sibling media. A compression callback that clears history
   proves orchestration but does not establish actual image recovery.
2. Middle-out and one-shot sanitize images into textual placeholders for their
   summarization requests. Therefore an image-heavy source history does not by
   itself establish that those summarizer requests overflow. This boundary needs
   a real-strategy regression rather than an assumption.
3. `packages/agents/src/core/imagePayloadBudget.ts` already filters tool-result
   batches. Its inline-only accounting misses reference media, and its generic
   one-at-a-time advice cannot solve an individually oversized image. The helper
   reports the tool name but lacks per-image source and call identity.
4. Existing semantic media purge is an optional cache-sensitive optimization. Its
   explicit-cache-evidence branch may send the original history first. That is
   unsuitable as the only safety mechanism when the original history cannot fit.
5. Replacing media references with ordinary text can release live-history media
   ownership. A hash printed in a note is not a usable reread capability:
   `read_file` currently takes workspace paths. Retiring pixels from active
   context must not silently delete uploads or old versions of changed files.
6. The resolver's overflow counter is the subtotal at the first crossing. It must
   not be described as a complete measured conversation total without finishing
   the metadata count.

## Verified provider documentation

Fetched directly on 2026-10-29:

- Messages API: maximum request size **128 MB**, with HTTP 413 on excess:
  https://platform.claude.com/docs/en/api/errors#request-size-limits
- Claude Code's error reference explicitly lists
  `Request too large for the API's 32MB request limit`:
  https://code.claude.com/docs/en/errors#request-too-large

These sources do not establish which limit LLxprt's subscription OAuth requests
receive. The second fetched document was truncated after its index; the error
text is directly visible, but its detailed explanatory section was not inspected.
The 32,000,000-byte application guard is conservative compatibility policy, not a
proven OAuth transport maximum. The 128 MiB generic serializer allocation guard
is a local memory policy, not evidence of server allowance.

Encoded image bytes, full serialized-body bytes, image dimensions/count, and
model tokens are distinct constraints. A one-million-token context does not
remove the wire-size limit. A 150 MB request would exceed the documented
first-party Messages API limit.

## Recommended behavior

### Historical image residency

Apply an explicit residency policy before media materialization and independently
of token-driven compression. Count image age in successful model exchanges,
including autonomous tool continuations, rather than wall-clock time or only
human turns. Failed requests, cancellation, projection attempts and transport
retries do not advance age. Replaying an old image does not reset its age; an
explicit reread creates a fresh presentation.

Protect pending images and inputs that have never been successfully consumed.
Retire oldest consumed history images when they age out or image pressure reaches
a high watermark. Retire a batch to a lower watermark so the next small read does
not immediately cause another prefix rewrite. Preserve text observations and
replace model-visible pixels with an honest retirement note identifying the image
and explaining how to recover it. Do not invent a visual summary.

The initial age proposal is four completed exchanges, with an 80% high watermark
and a 60% target relative to the effective image budget. These are starting design
values to validate with real long-loop tests, not provider limits. Pending data
can exceed the low-water target: protect it and retire eligible old images, then
enforce the actual hard limits. Avoid adding multiple public knobs until needed.

Retain canonical disk-backed references with a client-only residency marker or a
verified equivalent durable archive. Project retired blocks to notes before
provider media selection. Preserve original per-content origins, tool-call/result
pairing, media ownership, resume/export behavior and a working session-scoped
reread route. A filename alone is insufficient for uploads or changed files.
If reread support is unavailable, do not claim those images are recoverable or
silently discard them.

This safety retirement must not wait for successful cache-write evidence. Reuse
existing history/recording transaction machinery where it fits, while preserving
origins and coordinating persistence, publication, cache/Responses-chain
invalidation and abandoned request cleanup. Do not copy a full-history cloning
pattern that erases identity-based origins. Persisted retirement and live state
must agree on failure and resume.

### Oversized new tool batches

Keep every tool response and its original call ID. Count inline and referenced
images, retaining a deterministic fitting subset. Associate omitted images with
their source and producing call, and return the feedback as ordinary tool output
so the model can continue without a user intervention.

- Aggregate excess: state the applicable byte budget, which images were omitted,
  and tell the model to request fewer images per call/batch.
- Single image over budget: explicitly say it cannot fit alone; request a smaller,
  resized, or cropped version. Do not recommend an unchanged reread.
- Fresh oversized user attachment: preserve input and produce a specific size
  diagnostic or an existing explicitly supported resize path. Do not silently
  discard it to obtain a successful request.

Use the same policy in foreground and subagent producers. Reconcile at the final
consumer boundary as well, because historical images, hooks, text and tools affect
available body space. Never retry an unchanged locally oversized request.

### Limits remain a backstop

Keep the exact bounded serialized-body measurement at projection and send. Leave
room for text, system instructions, tool schemas and JSON framing; a 32 MB image
allowance cannot promise a fitting 32 MB body. Keep batch admission separate from
retained-history pressure and endpoint hard ceilings.

Do not raise the image default again merely to make the captured incident pass.
First prove autonomous retirement and batch recovery with the existing 15 MiB
soft budget. A larger native soft budget, for example 24 MB of encoded images
under a conservative 32 MB complete-body ceiling, can be evaluated afterward.
It is not a substitute for retention, and exact body accounting remains decisive.
Explicit legacy overrides and zero semantics require an explicit consistent
policy and tests; the current batch-zero/request-zero split must not be
accidentally described as uniform disablement.

## Required implementation revision and behavioral evidence

Replace the ordinary-compression-only recovery claim and its fake-success tests.
Keep typed byte errors and the exact-body guard where useful. Reassess optional
budget-provenance plumbing based on the final provider policy rather than retaining
it solely to support the old cap increase. Do not remove user changes.

Before new production code, add failing Bun regressions through real collaborators:

1. Repeated small tool images across successful autonomous exchanges, below token
   thresholds: bounded selected image bytes, age/pressure retirement, latest image
   preserved, model-visible notes, and a subsequent reread of retired pixels.
2. Exact incident-sized 26-image history: recovery through retirement at the
   original soft cap rather than passing solely because the cap doubled.
3. Oversized parallel batch: every call receives its matching result, omitted
   sources get readable feedback, a protocol-aware model fixture reads fewer
   images next, and the real loop completes. Cover foreground and child paths.
4. Individually oversized tool image and oversized fresh user attachment have
   different remedies, with no unchanged retry or silently lost new input.
5. Real middle-out/one-shot request preparation contains media placeholders in the
   summarizer request; preserved head/tail images still obey residency afterward.
6. Resume, compression and media-store ownership preserve recoverable pixels and
   retirement state; changed source files do not substitute different pixels.
7. Persistence/publication rejection, compensation, cancellation before/after
   commit, stale history revisions and origin/cache invalidation remain coherent.
8. Exact JSON body overflow from non-image content remains classified separately;
   resource reservations and abandoned serialization plans are released.

Substitute infrastructure such as HTTP and keyring/filesystem boundaries as
appropriate. Do not replace compression, history mutation, or media selection
with a stub that manufactures the expected fit. Re-run verification and obtain a
review of the new lifecycle changes; the previous review covered the old design.

## Git state

The previously blocked empty `.git/index.lock` was checked for an owning process
and an active Git writer, then removed under the user's explicit authorization.
No source work was reverted, staged, committed or pushed during this reassessment.
