# Issue #3136 — Two layers independently assemble the system prompt; collapse to a single owner

## Problem (verified against source)

`ChatSession.generationConfig.systemInstruction` reaches providers as
`options.systemInstruction`. Every provider request path then builds a *second*
complete core prompt with `getCoreSystemPromptAsync` and concatenates the two,
producing `[core prompt A] + [env context] + [core prompt B]`.

Measured on this repo today (openai path, real captured request
`/tmp/i3136/before-request.json`): system message **64,187 chars**; preamble 2x;
`# Core Mandates` 2x; `LLxprt Code Added Memories` 12x.

Provider core-prompt build sites:

- `packages/providers/src/openai/OpenAIRequestPreparation.ts:125` (merge :141)
- `packages/providers/src/openai-responses/openAIResponsesExecutor.ts:360` (merge :374)
- `packages/providers/src/anthropic/AnthropicRequestPreparation.ts:306` OAuth (merge :318), `:390` non-OAuth (merge :403)
- `packages/providers/src/gemini/geminiRequestBuilding.ts:253` via `geminiGenerationExecution.ts:129` (merge :137)
- `packages/providers/src/openai-vercel/vercelSystemPrompt.ts:60` — builds a core
  prompt and **never** reads `options.systemInstruction`, silently discarding the
  agent-assembled prompt (a #2410 gap on that path)

## Mandate (from the issue, final comment — supersedes earlier criteria)

- Exactly ONE layer calls `getCoreSystemPromptAsync` per request; a second call
  site prevented **structurally**.
- The provider layer **transports** the assembled instruction and does **not**
  rebuild a core prompt. No fallback rebuild.
- `mergeSystemInstruction` deleted, or reduced so it cannot concatenate two full
  prompts.
- Subagent personas still reach every provider path (#2410).
- Subagent requests render with `interactionMode: 'subagent'`.
- The rendered model name always equals the model sent as `body.model`.
- No reconciliation logic between config accessors or prompt builders.

## Blockers found during design review (all verified in source)

### B1 — Fixing #3136 alone makes #3138 strictly worse

`mergeSystemInstruction` places the provider copy **first**. The provider rebuilds
per request with the **fresh** model (`BaseProvider.ts:841`
`resolvedModel: this.computeModel(settings)`). The agent copy is second and
carries a **stale** model: `AgentClient.runtimeState` is `readonly`, assigned once
(`client.ts:111`, `:145`), and `handleModelChanged` (`client.ts:255-257`) only
nulls `currentSequenceModel` — it does not refresh the prompt or invalidate the
chat. Deleting the provider copy without fixing staleness leaves the stale name as
the only rendering.

**=> Model freshness must land in this PR, before provider-side assembly is removed.**

### B2 — Compression would silently lose its system prompt

`packages/agents/src/compression/OneShotStrategy.ts:329-343` calls
`provider.generateChatCompletion({...})` with **no `systemInstruction`**. Same for
`MiddleOutStrategy.ts:451` and the verification pass. These rely entirely on the
provider-side build today.

### B3 — Load balancer defeats "rendered == sent" from any agent seam

`packages/providers/src/loadBalancing/resolvedOptionsBuilder.ts:132` overwrites
`resolved.model` with `subProfile.model` **inside** the provider, after every agent
seam. `LoadBalancingProvider.getCurrentModel()` (`:474-484`) returns the
*previously* selected sub-profile. Today the provider rebuild renders the correct
sub-profile model, so removal is a regression for LB specifically.

### B4 — Three send seams, not one

`generationConfig.systemInstruction` is read independently at
`TurnProcessor.ts:636` (via `buildProviderChatOptions`), `StreamProcessor.ts:475`
(own inline builder), and `DirectMessageProcessor.ts:514` (own inline builder).
Any fix applied at `buildProviderChatOptions` covers only one of three.

### B5 — Kimi pre-pass is a second writer

`OpenAIProvider.maybeProcessKimiMedia` (`:664-671`) appends uploaded-file
reference text to `options.systemInstruction` inside the provider.

### B6 — The duplication is MASKING a missing input (subagent memory)

Verified: `grep -n "userMemory\|coreMemory" packages/agents/src/core/subagentRuntimeSetup.ts`
returns **nothing**. The subagent build (`:808-814`) passes only
`mcpInstructions`, `model`, `tools`, `includeSubagentDelegation`,
`interactionMode`. There is also no `coreMemory` reference anywhere under
`packages/providers/`.

**Consequence: a subagent's user memory arrives today ONLY via the
provider-layer rebuild.** Deleting provider-side assembly without first moving
memory into the subagent build silently strips user memory from every subagent.

The owning assembler must first supply the **union** of the inputs the nine
existing call sites collectively pass, each sourced from the layer that knows the
correct value.

### B7 — Placement is a second, unowned policy

There is no capability concept for *where* the prompt goes. A repo-wide search
for `systemAsUser`, `systemPromptPlacement`, `supportsSystem`, `systemRole`,
`promptPlacement` returns nothing. Each provider infers placement ad-hoc from
local conditions such as `isOAuth`. Three placements exist today:

| Path | Placement |
| --- | --- |
| openai chat completions | `messages[0]`, `role: system` |
| openai-responses / codex | `instructions` field |
| anthropic OAuth | `messages[0]`, `role: user`, wrapped in `<system>` tags |

This is the same defect class as the assembly problem: a policy with no owner,
re-derived independently, free to drift. It is why the duplication appeared in
two different shapes rather than one recognizable defect.

## Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Accept** LB divergence; document it and file a follow-up issue. | The alternative (an assembler port re-invoked by the provider) puts assembly back inside a provider, contradicting the mandate. |
| D2 | Compression strategies **supply an explicit `systemInstruction`** assembled in the agent layer, preserving today's content. | No behavior change now. "Does compression need the full core prompt?" is filed separately. |
| D3 | This PR **includes request-time assembly** so the rendered model equals `body.model`. | Required by the mandate and by B1. |
| D4 | `AgentExecutor` is **taught to assemble** a complete prompt. **Not deleted.** | It is dead production code, but it is exported surface; deletion needs explicit owner approval. Deferred. |
| D5 | Providers **throw** when `systemInstruction` is absent on a real request. | Fail-fast; after D2 every production caller supplies one. |
| D6 | Kimi pre-pass **stays**, documented as request-specific media context, not core-prompt assembly. | It is additive and runs before request preparation. |

## Chosen owner and seam

**Owner:** the agent layer. **Seam:** `ChatSession`, resolved once per turn,
before delegating to `TurnProcessor` / `StreamProcessor` / `DirectMessageProcessor`.

It is the only point all three send paths share (B4); it keeps all three option
builders synchronous; and it is before compression enforcement
(`TurnProcessor.ts:490-509`), so the token offset
(`applySystemPromptTokenOffset`, `HistoryService.setBaseTokenOffset`) stays
correct.

The model is obtained by **asking the provider** — `IProvider.getCurrentModel?()`
(`IProvider.ts:137` -> `BaseProvider.ts:881-884` -> `:273-280` ->
`computeModel(settingsService)` `:333-353`), the same function that produces
`resolved.model` at `BaseProvider.ts:841`. One model resolver (the provider's),
one prompt assembler (the agent's). This is a query to the owner, not
reconciliation.

## Contract

`RuntimeGenerateChatOptions.systemInstruction` / `GenerateChatOptions.systemInstruction`
= **the complete system prompt for this request, assembled by the caller.**
Providers use it verbatim. Providers never call `getCoreSystemPromptAsync`.

## Placement policy (second requirement)

Placement becomes an explicit, **declared provider capability**, not an
inference. Exactly one component consumes the capability and positions the
prompt; providers declare, they do not decide.

- `system-field` — provider accepts arbitrary system content; the prompt goes
  there. (openai chat completions -> `messages[0]` `role:system`;
  openai-responses -> `instructions`; gemini -> `systemInstruction`;
  anthropic non-OAuth -> `system`.)
- `context-prefix` — the provider's system field is reserved or unusable; the
  prompt goes at the very **top of the context**, above memory content, with a
  clear boundary marker. (anthropic OAuth / `claudecode`.)

Invariants for both:
- The prompt is injected **exactly once** per request.
- The prompt is **never inside conversation history** — it is either the system
  directive or the first element of the context.
- Ordering inside the prompt is preserved: core system content precedes
  `.LLXPRT_SYSTEM`, which precedes global then project `LLXPRT.md`.

The existing Anthropic OAuth branch (`AnthropicRequestPreparation.ts:326-361`)
is the **reference implementation** of `context-prefix` and must be preserved,
not special-cased: `messages.unshift` (top of context, not history), `<system>`
wrapper with the `User provided conversation begins here:` boundary,
`cache_control` breakpoint, and the Claude Code string alone in `system`.
Violating the `system`-field constraint causes Anthropic to reject the request
outright.

## Acceptance criteria

1. A main-agent request contains the preamble, `# Core Mandates`, and each
   discovered memory block **exactly once**.
2. A subagent request contains exactly one core prompt, rendered with
   `interactionMode: 'subagent'`, plus the persona exactly once, after it.
3. The persona reaches **every** provider path, including openai-vercel.
4. No file under `packages/providers/src` calls `getCoreSystemPromptAsync`,
   enforced structurally.
5. After a mid-session model change, the model rendered in the system prompt
   equals `body.model` on the wire (non-load-balancer paths).
6. `mergeSystemInstruction` is deleted; no dedup/substring logic exists anywhere.
7. Compression requests still carry the system prompt they carry today.
8. `AgentExecutor` produces a complete prompt (core prompt + persona).
9. Anthropic OAuth is unchanged byte-for-byte (see below).
10. Subagent requests retain **user memory and core memory** after the collapse,
    proven by a test that FAILS against a naive removal of the provider-layer
    build (B6).
11. The preamble appears **exactly once** in the fully serialized request body,
    for every provider path.
12. The prompt never appears inside conversation history.
13. Placement is chosen from a **declared provider capability**, not inferred
    inside each provider.
14. Anthropic OAuth keeps `context-prefix` placement above memory content, the
    Claude Code string alone in `system`, and its `cache_control` breakpoint,
    covered by a regression test.
15. Ordering is preserved: core system content -> `.LLXPRT_SYSTEM` -> global
    `LLXPRT.md` -> project `LLXPRT.md`.

## Behaviors that must survive

- **Anthropic OAuth:** the request `system` field contains ONLY
  `"You are Claude Code, Anthropic's official CLI for Claude."`
  (`AnthropicRequestBuilder.ts:178-180`, unconditional). Our prompt is delivered
  as `messages[0]` `role:'user'` wrapped exactly
  `<system>\n${prompt}\n</system>\n\nUser provided conversation begins here:`
  with `cache_control {type:'ephemeral', ttl}` when caching is on
  (`AnthropicRequestPreparation.ts:322-350`). Byte-for-byte.
- Anthropic non-OAuth: array-with-`cache_control` when caching on, bare string
  when off, `undefined` when empty (`AnthropicRequestBuilder.ts:182-196`).
- Gemini `systemInstruction` request field.
- Responses/Codex `instructions` field, set only when non-empty.
- OpenAI chat: system prompt as `messages[0]`.
- Main-agent order env-then-core; subagent order env, core, persona — these
  differ and must not be unified.
- Token-offset accounting and drift reconciliation.
- The assembler must pass `coreMemory` explicitly, or `prompts.ts:539-545` does a
  two-file disk read per call.

## Implementation sequence (riskiest first)

1. **DONE (partial).** Request-time assembly at the `ChatSession` seam via an
   injected `SystemPromptAssembler`; model from `provider.getCurrentModel()`;
   token-offset recomputation moved with it.
2. Anthropic OAuth byte-for-byte characterization test (tripwire before touching
   `AnthropicRequestPreparation.ts`).
3. Compression strategies supply `systemInstruction`.
4. **Close the input gap (B6) BEFORE any removal.** The subagent assembler must
   pass `userMemory` and `coreMemory`. Add the failing-first test required by
   acceptance criterion 10.
5. **Placement capability (B7).** Declare `system-field` | `context-prefix` on
   providers; one placement component consumes it; Anthropic OAuth becomes the
   reference `context-prefix` implementation rather than a special case.
6. Delete provider-side assembly at all six sites; delete
   `systemInstructionMerge.ts`; providers throw when no instruction is supplied.
7. openai-vercel now transports the instruction (behavior fix, new test).
8. `AgentExecutor` assembles a complete prompt.
9. ESLint `no-restricted-imports` banning `getCoreSystemPromptAsync` in
   `packages/providers/src/**` (existing repo pattern, `eslint.config.js` uses it
   4x). Added last, since it fails until step 6 completes.

## Verification

    npm run lint:ci
    npm run lint:eslint-guard
    npm run typecheck
    npm run test
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

No new `eslint-disable*`, no TS suppression directives, no severity downgrades,
no complexity/size threshold increases, no new `ignores:` entries.

## Measurement

Before: 64,187 chars (captured `/tmp/i3136/before-request.json`). After: to be
captured with the same profile and recorded in the PR.

## Out of scope

- #3131 Codex synthetic AGENTS.md duplication.
- Whether compression needs the full core prompt (follow-up).
- Load-balancer model divergence (follow-up, per D1).
- Deleting `AgentExecutor`/`SubagentInvocation` dead code (needs owner approval).
