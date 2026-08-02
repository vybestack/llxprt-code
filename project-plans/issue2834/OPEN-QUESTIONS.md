# PR #2884 (issue #2834) — two decisions I need from you

Everything else is done and green. These two are judgment calls I made a
provisional choice on, and I don't want to bury them.

---

## Question 1 — RESOLVED with evidence (no decision needed unless you disagree)

I tested this instead of leaving it hanging. Result: my original caution was
wrong, and I have corrected it.

**What I measured.** I fed the GLM tokenizer an `anthropic-messages`
projection and an `openai-chat` projection of the same conversation:

    raw BPE, openai-chat projected text   : 20
    raw BPE, anthropic-messages proj text : 26
    estimatePrompt(openai-chat)        -> count=20 method=exact
    estimatePrompt(anthropic-messages) -> THREW unsupported-protocol

The BPE tokenizes the Anthropic projection perfectly well. The **only** thing
that failed was my own `protocols` allowlist. The 20 vs 26 gap is simply the
`system` field that genuinely is sent on that wire format — that is a correct
larger number, not an error.

**Why the original reasoning was wrong.** The projection already captures the
protocol-specific request body (`anthropic-messages` projects
system/messages/tools; `openai-chat` projects messages/tools). The BPE is a
property of the *model*, not the wire format. So counting whichever text the
projection produced is exact either way.

**Precedent.** Main's own GPT-5.6 registration claims two protocols
(`openai-chat` + `openai-responses`) on exactly this reasoning.

**What I changed.** GLM 5.2 now claims `openai-chat` + `anthropic-messages`.
Kimi K3 and MiniMax M3 stay `openai-chat` only, because I have no evidence of
a real Anthropic-compatible deployment for those two. Added a test asserting
the GLM Anthropic count is exact and matches counting the projected text
directly; the "unsupported protocol" test now uses Kimi, which still rejects.

This also fixes a real usability bug: GLM over the z.ai Anthropic endpoint
previously hard-failed instead of returning a correct count.

**Only tell me if you disagree** and want it reverted to `openai-chat` only.

---

## Original Question 1 (kept for context) — Which wire protocols should the tokenizers claim?

### Background

Main's merged framework (`ModelPromptEstimatorRegistry`) makes each model
family declare which wire protocols it supports:

    protocols: new Set(['openai-chat', 'openai-responses'])

The full set of allowed values is only three:

    'anthropic-messages' | 'openai-chat' | 'openai-responses'

Declaring a protocol is a promise: "for this wire format, my token count is
**exact**." If the request is sent over a protocol the family did **not**
declare, the registry throws `unsupported-protocol` instead of returning a
number.

### What I chose

I registered **`openai-chat` only** for all three models (Kimi K3, GLM 5.2,
MiniMax M3).

### Why

These three are served over OpenAI-compatible chat completions. That is the
surface I can actually vouch for.

I deliberately did **not** claim `anthropic-messages`, even though I know GLM
is reachable through z.ai's Anthropic-compatible endpoint, because I have not
verified that the projected prompt for that wire format tokenizes to the same
count. Claiming it would mean silently returning a confidently wrong number.

With my choice, running GLM over the Anthropic endpoint raises a clear,
actionable error rather than under-reporting the context budget.

### The tradeoff

- **As-is (my choice):** never wrong, but GLM-over-Anthropic gets an error
  instead of a count.
- **Also claim `anthropic-messages`:** GLM-over-Anthropic gets a number, but
  I cannot currently prove that number is right.

### What I need

Leave it at `openai-chat` only, or add `anthropic-messages`?

If you want it added, I would first want to verify the Anthropic-projected
prompt actually tokenizes identically — I would not just widen the set.

---

## Question 2 — RESOLVED, and my original framing of it was wrong

I dug into how the projection is actually built, and it turns out option (b)
rested on a false premise of mine. Correcting the record.

**What I claimed.** That `promptSegments` is a flat `string[]` which "loses"
the framing-vs-content distinction, and that option (b) could recover exactness
by typing the segments.

**What is actually true.** `serializePromptSegments` produces **one segment per
top-level request-body key** — `system` / `messages` / `tools` for
anthropic-messages, `messages` / `tools` for openai-chat. Each segment is the
serialized value of that key. It was never a framing-vs-content split, and was
never intended as one.

More importantly: **the projection is the raw JSON API request body, not a
rendered chat template.** I checked — nothing applies a chat template before
projection (the only `chat_template` hit in the tree is an unrelated passthrough
parameter name in a profile test). So Kimi's XTML markers such as
`<|im_start|>` are **not present in the projected text at all**. The provider
applies the chat template server-side, after we send the body.

**Why that settles it.** Encoding every projected segment as ordinary text is
not a compromise — it is the only correct behaviour, because there are no
special tokens in the projected text to preserve. Option (b) would not have
improved exactness, because the framing it aimed to count exactly never reaches
the estimator.

**The real limitation, stated honestly.** Server-side chat-template tokens are
invisible to this estimator, so counts run slightly *low* by the template
overhead. That is a pre-existing, universal gap that applies equally to main's
GPT-5.6 estimator — it is not introduced by this PR and not something this PR
should try to fix.

**No decision needed** unless you want the server-side template overhead
modelled, which I would raise as its own issue against the projector.

---

## Original Question 2 (kept for context) — Kimi K3 structural-marker handling

### Background

Kimi K3's official tokenizer treats text in two different ways:

- **Structural markers** (chat framing like `<|im_start|>`) are encoded as
  single special control tokens.
- **User/model text** is encoded as ordinary bytes, so a user typing
  `<|im_start|>` can never mint a real control token.

My original standalone implementation supported both modes, because I
controlled the segment list and knew which segments were framing.

### The problem

Main's merged projector (issue #2817) hands the estimator this shape:

    promptText: string
    promptSegments?: readonly string[]

A flat array of strings. It carries **no marker of which segments are framing
versus user content**. So there is no longer any way for me to tell them apart
at the point where counting happens.

### The two options

**(a) What I implemented.** Encode every projected segment as ordinary text.
No projected string can ever become a control token.

- Correct security posture: untrusted text must never mint special tokens.
- Stays inside this PR's scope.
- Slight inexactness: real framing tokens get counted as their byte spelling
  rather than as one token, so Kimi counts can run a few tokens high on
  heavily-framed prompts.
- There is a test proving `<|im_start|>system<|im_end|>` arriving via a
  projection is counted as ordinary bytes, not collapsed to control tokens.

**(b) The alternative.** Extend the projection to carry typed segments
(framing vs content) so framing can be counted exactly.

- More exact for Kimi.
- But it changes a **core contract** owned by issue #2817, touching
  `packages/core/src/runtime/contracts/` and every provider that builds a
  projection. That is a materially larger blast radius than this issue.

### What I need

Confirm **(a)** is acceptable for this PR, or tell me to pursue **(b)**.

If (b), I would suggest it be its own issue against the projector rather than
bolted onto this one — but that is your call, not mine.

---

## Question 3 (smaller) — package size

The npm tarball now ships the tokenizer assets **twice**, about 9 MB each way:

    src/tokenizers/official/assets/*/tokenizer.bpe    (~9 MB)
    dist/src/tokenizers/official/assets/*/tokenizer.bpe (~9 MB)

This is because the package's `files` field already includes both `src` and
`dist` for everything — I did not introduce that convention, and I did not
want to unilaterally change packaging semantics for the whole package.

It could be roughly halved with a targeted exclude. Want me to?

---

## Status of everything else

- 38/38 CI checks pass, 0 failures, `MERGEABLE` / `CLEAN`
- 0 unresolved CodeRabbit comments
- Providers shard verified in the CI job log: ran **477/477** native Bun test
  files, and all six tokenizer suites executed
- My four new suites now import from `bun:test` (not `vitest`) per your
  instruction; 58 pass / 0 fail

**I have not merged and will not without your explicit go-ahead.**
