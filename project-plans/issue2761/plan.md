# Issue #2761 — Spike: `@ai-sdk/google` v2 parity for the Gemini adapter

Status: planning → implementation
Branch: `issue2761`

## 1. What the issue asks for

Decide whether the AI SDK v5-generation `@ai-sdk/google` package can replace
`@google/genai` as the wire adapter inside the (future) optional Gemini plugin,
without losing behavior that llxprt depends on today.

This is a **spike**. It produces a decision plus the executable evidence behind
it. It does **not** migrate any production code.

## 2. Prerequisite status (recorded, not resolved here)

The issue names #2759 (optional runtime-plugin package topology) as a hard
prerequisite. As of this branch #2759 is **open** and there is no `plugins/`
directory in the tree; #2758 (runtime plugin manifests) has landed.

Consequence for this spike: the probes cannot live in `plugins/google-gemini`
because that context does not exist yet. The issue itself calls for "focused
non-workspace probes", so the probes live in a non-workspace directory and the
decision is written so that it can be consumed by #2759's plugin context when
that lands. Nothing in this spike depends on the plugin topology existing.

## 3. Accepted behavior (acceptance criteria)

### AC1 — Pinned comparison and machine-recorded protocol/dependency facts

- A non-workspace probe context pins **exactly** `@ai-sdk/google@2.0.85` and
  **exactly** `@google/genai@1.30.0` (the version the repo ships today).
- The probe context is not a member of the root npm workspace list and is not
  in the root Bun lock workspace membership; a root `npm install` / `bun install`
  must not pull `@ai-sdk/google` into the tree.
- A probe **reads the installed package metadata** and emits
  `dependency-facts.json`. Hand-typed dependency claims are not acceptable
  evidence. It must record at minimum:
  - `@ai-sdk/google@2.0.85` → `@ai-sdk/provider`, `@ai-sdk/provider-utils`
    versions, `zod` peer range, engines.
  - the provider-protocol major implied by `@ai-sdk/provider`.
  - the versions of `ai`, `@ai-sdk/openai`, `@ai-sdk/provider`,
    `@ai-sdk/provider-utils`, `zod` already resolved in the llxprt root tree.
  - the `dist-tags.latest` of `@ai-sdk/google` and the provider-protocol major
    it implies.
- The decision doc must state explicitly that provider-protocol **v4** mixing is
  rejected, with the numbers to back it.

Boundary cases to record: a `@ai-sdk/provider` mismatch between the probe
context and the root tree would invalidate the "drop-in" claim, so the fact file
must make a mismatch visible rather than hiding it behind a boolean.

### AC2 — Executable live probes over the required behavior areas

One probe module per area. Each probe issues the **same logical request**
through both adapters against the live Gemini API and records structured
observations plus a per-area verdict of `parity`, `partial`, or `gap`.

| ID  | Area (from the issue)              | Concrete behavior under test                                                                                                              |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| P01 | API-key auth                       | API key accepted from an explicit option; auth header/query form actually sent; custom `User-Agent` and extra headers reach the wire.       |
| P02 | Non-streaming                      | Single-shot generate: text, `finishReason`, usage, `systemInstruction` transport, `responseId`-equivalent.                                  |
| P03 | Streaming + usage                  | Chunk sequence, incremental text, where usage lands (per-chunk vs terminal), thought chunks in stream.                                      |
| P04 | Parallel tools / tool-call IDs     | Force ≥2 function calls in one model turn; presence and value of `functionCall.id`; round-trip of those IDs on the tool-response turn.      |
| P05 | Schemas                            | Nested object, array, enum, `additionalProperties`, `format`, `anyOf`, and a declaration missing `type`: who cleans the Gemini dialect.     |
| P06 | Thought signatures (req + resp)    | Gemini 3: capture `thoughtSignature` off the response, re-send it on the next turn, and observe the synthetic-sentinel path.                |
| P07 | Thinking config                    | `thinkingBudget` + `includeThoughts` (2.5) and `thinkingLevel` (3.x); thought parts emitted and `thoughtsTokenCount` reported.              |
| P08 | Media                              | `inlineData` (base64 image) and URI-backed `fileData`.                                                                                      |
| P09 | Executable code / results          | Code-execution tool → `executableCode` and `codeExecutionResult` parts surfaced to the caller.                                              |
| P10 | Error / safety / finish            | Nonexistent model → error type, HTTP status, provider message; `MAX_TOKENS` finish; safety/`promptFeedback` surfacing.                      |
| P11 | Abort                              | Abort before dispatch and abort mid-stream; what is thrown, and whether the underlying HTTP request is actually cancelled.                  |
| P12 | baseURL / custom fetch / dumps     | Redirect to a local recording server; capture the exact outbound request body and inbound response body for SDK-context dumps.              |
| P13 | Grounding / URL-context metadata   | `googleSearch` and `urlContext` server tools; `groundingMetadata` and `urlContextMetadata` reaching the caller.                             |
| P14 | Model listing                      | Enumerate models; record how each adapter does it and whether llxprt's current listing path even depends on the adapter.                    |

Probe-design rules:

- Probe the **`LanguageModelV2` low-level interface** (`doGenerate` / `doStream`)
  for `@ai-sdk/google`, not the `ai` package's `generateText` / `streamText`
  helpers. A provider adapter inside llxprt would sit at that boundary, and
  probing it also establishes whether the `ai` package is needed at all.
- Probe `GoogleGenAI.models.generateContent` / `generateContentStream` for
  `@google/genai`, which is what `geminiGenerationExecution.ts` calls today.
- Every probe records the raw evidence it observed (redacted), not just a
  boolean. A verdict with no observation attached is not evidence.
- Probes must be re-runnable and must fail loudly on a missing API key rather
  than silently reporting `gap`.
- No secrets in committed artifacts. The harness redacts API keys from captured
  headers, URLs and bodies.

Boundary cases that must be exercised, not assumed:

- A tool declaration whose JSON Schema contains keywords the Gemini dialect
  rejects (P05) — this is where `geminiSchemaHelpers.cleanGeminiSchema` earns
  its keep, and the question is whether `@ai-sdk/google` already does it.
- A model turn with a function call but **no** thought signature on a Gemini 3
  model (P06) — llxprt injects `skip_thought_signature_validator` today.
- Abort raced against a stream that has already started emitting (P11).

### AC3 — Separate Vertex decision

Recorded as its own section, with evidence, and without pretending
`@ai-sdk/google` covers it:

- What `@google/genai@1.30.0` gives llxprt today (`vertexai: true`,
  project/location, ADC via `google-auth-library`) and which llxprt code paths
  use it (`GeminiProvider.buildGoogleGenAIOptions`, `geminiAuth.ts`,
  `geminiServerTools.ts`).
- Whether `@ai-sdk/google@2.0.85` provides any Vertex or ADC path — proven from
  its exports and dependency closure, not asserted.
- An explicit statement that pulling in `@ai-sdk/google-vertex` to paper over
  the auth cost is **not** an accepted move for this decision, and what that
  package would actually cost if it were ever adopted.

### AC4 — One adapter chosen

A single choice, stated plainly, with the rule applied as the issue states it:
select AI SDK **only** if there is no accepted behavior loss **and** the work is
bounded; otherwise keep `@google/genai` inside the plugin. The rationale cites
probe IDs.

### AC5 — Evidence-linked decision table published

`dev-docs/providers/google-ai-sdk-parity.md` carries a table with one row per
probe area: adapter-A observation, adapter-B observation, verdict, and a link to
both the probe source and the recorded evidence artifact.

## 4. What proves it

This spike's deliverable is evidence, so "the tests that prove it" are the
probes themselves plus the committed artifacts they produce:

- `dependency-facts.json` — produced by reading installed metadata; proves AC1.
- `results/P01..P14.json` — one artifact per probe area, each containing the
  request shape sent, the observation captured from each adapter, and the
  verdict; proves AC2.
- `results/summary.json` — machine-generated roll-up the decision table is
  derived from; guards against the doc drifting from the evidence.
- Re-running `bun run all` in the probe context regenerates every artifact.

Repo gates that must also pass unchanged: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and the
`stepfun-37` startup smoke.

## 5. Layout

```
research/issue2761/                 # non-workspace, gitignored dir, artifacts force-added
  package.json                      # private; exact pins; not a root workspace member
  tsconfig.json
  README.md                         # how to run, what a probe is, key handling
  src/
    harness.ts                      # key loading, redaction, artifact writer, verdicts
    adapters/genai.ts               # @google/genai side
    adapters/aisdk.ts               # @ai-sdk/google side (LanguageModelV2)
    probes/p01-...ts .. p14-...ts
    dependency-facts.ts
    run-all.ts
  dependency-facts.json             # committed artifact
  results/*.json                    # committed artifacts
dev-docs/providers/google-ai-sdk-parity.md
project-plans/issue2761/plan.md     # this file
```

`research/` is gitignored but already carries committed artifacts from #2253,
#2254 and #2835 (force-added). This spike follows that precedent: probe sources
and result artifacts are force-added; `node_modules` and any lock churn are not.

Placement rules honoured: plan under `project-plans/`, durable engineering
reference under `dev-docs/`. Nothing is written to `dev-docs/plans/`.

## 6. Out of scope

Everything in the issue's non-goals: production migration, adopting AI SDK
Google v4 or `@ai-sdk/google-vertex`, Code Assist changes, handwritten Google
auth, and removing implicit Vertex support. Also out of scope: doing #2759's
plugin scaffolding, changing anything under `packages/`, and touching the
existing `@google/genai` enclave rules.

## 7. Model and cost discipline

`gemini-2.5-flash` for the 2.x-generation behaviors and `gemini-3-flash-preview`
for the Gemini 3 thought-signature and `thinkingLevel` behaviors. Prompts stay
short and output budgets stay small; this is a parity spike, not a benchmark.
