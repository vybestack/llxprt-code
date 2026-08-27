# Issue #2761 parity probes: `@ai-sdk/google@2.0.85` vs `@google/genai@1.30.0`

Executable evidence for the decision in
[`dev-docs/providers/google-ai-sdk-parity.md`](../../dev-docs/providers/google-ai-sdk-parity.md).

This directory is **not** a member of the root npm or Bun workspace list. A root
`npm install` or `bun install` does not pull `@ai-sdk/google` into the llxprt
tree; you install here explicitly.

## Running

```bash
cd research/issue2761
bun install
bun run all                 # every probe, writes results/ and dependency-facts.json
bun run probe P04 P06       # named probes only
bun run facts               # dependency-facts.json only, no API calls
bunx tsc --noEmit -p tsconfig.json
```

The probes are **live**. They call the real Gemini API. The key comes from
`GEMINI_API_KEY`, or from the file named by `LLXPRT_PROBE_KEY_FILE`. There is
no default path, deliberately: a credential layout is not something to bake
into a repository. When neither is set the run aborts with a message naming
both, rather than producing a table full of failures that look like findings.

Models are chosen with `LLXPRT_PROBE_MODEL_GENERAL` (default
`gemini-3.1-flash-lite`) and `LLXPRT_PROBE_MODEL_GEMINI3` (default
`gemini-3.5-flash`).

## What a probe is

Each probe answers exactly one parity question by sending the same logical
request through both adapters and recording what each one actually did:

- `@google/genai` through `GoogleGenAI.models.generateContent` /
  `generateContentStream`, which is what `geminiGenerationExecution.ts` calls
  today.
- `@ai-sdk/google` through the low-level `LanguageModelV2` interface
  (`doGenerate` / `doStream`), which is where an llxprt adapter would sit. The
  `ai` package is deliberately not used, so the probes also establish that it
  would not be needed.

A probe writes `results/<ID>.json` containing the request context, both
observations, a verdict, and a finding. `results/summary.json` is the roll-up
the decision table is built from.

Verdicts:

| Verdict        | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `parity`       | The AI SDK delivers the behavior llxprt depends on.                  |
| `partial`      | It delivers it only with extra adapter-side work, or lossily.        |
| `gap`          | It cannot deliver it at this pin.                                    |
| `inconclusive` | The provider never gave a usable answer (quota or capacity). Counted separately so a rate-limited run can never be read as a capability finding. |

## Reading the artifacts honestly

- A finding prefixed `INCONCLUSIVE (HTTP ...)` means Google returned a quota or
  capacity status. That says nothing about either adapter. `src/run-all.ts`
  applies this centrally, including to failures a probe caught inside a
  sub-case, so a rate-limited run cannot be mistaken for a capability result.
- Adapter API keys are scrubbed from every artifact by the redactor in
  `src/harness.ts`. Thought signatures are recorded as a length plus a short
  prefix, never in full.

## Known environment limits at the time of the recorded run

The Gemini 2.x generation could not be exercised. `gemini-2.5-pro` and
`gemini-2.5-flash-lite` answer "no longer available to new users" on every key
available here, and the one key with `gemini-2.5-flash` access is on a free
tier capped at 20 generate-content requests per day. Every recorded probe
therefore ran against Gemini 3 models. Set `LLXPRT_PROBE_MODEL_GENERAL` to a
2.x model and re-run to extend the evidence if a key with that access appears.
