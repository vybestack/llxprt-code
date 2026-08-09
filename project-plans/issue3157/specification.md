# Specification: Load-balancer system prompt must name the selected sub-profile model (issue #3157)

Plan ID: PLAN-20260808-ISSUE3157
Generated: 2026-08-08
Branch: `issue3157`
Requirements: REQ-3157-1, REQ-3157-2, REQ-3157-3, REQ-3157-4, REQ-3157-5

**Decision: Option 2 — a narrowly-typed assembler port on the chat options, invoked
by `LoadBalancingProvider` once per selected sub-profile, before token estimation.**

---

## 1. Purpose and verified defect

`LoadBalancingProvider` selects a sub-profile *inside* `generateChatCompletion`
and overwrites `resolved.model` with that sub-profile's model. Every agent-layer
seam — including the single per-turn system-prompt assembler introduced by
\#3136 — has already run by then. The prompt therefore names one model while
`body.model` carries another.

### 1.1 What the prompt actually renders today (verified, and worse than the issue states)

The issue frames this as "the model named in the prompt *can differ* from
`body.model`". Reading the profile-application path shows the parent model for a
load-balancer profile is never a real model at all:

| Step | Evidence |
|---|---|
| Applying a `type: loadbalancer` profile resolves the model name to the literal string `'load-balancer'` | `packages/providers/src/runtime/profileApplication.ts:413-421` — `resolveRequestedModel` returns `'load-balancer'` when `isLoadBalancerProfile(actualProfile)` |
| That string is written into settings and `Config` | `profileApplication.ts:462-468` (`setActiveModel(modelToSet)`) → `packages/providers/src/runtime/providerMutations.ts:427-438` (`settingsService.updateSettings(activeProvider.name, { model: modelName })`, `config.setModel(modelName)`) |
| `Config.getModel()` reads it back | `packages/core/src/config/config.ts:382-403` |
| The agent assembler resolves its model from exactly that call | `packages/agents/src/core/systemPromptModel.ts:27-36` (`resolveModelForSystemPrompt`), used by `packages/agents/src/core/chatSession.ts:556-559` |
| The template substitutes `{{MODEL}}` verbatim | `packages/core/src/core/prompts.ts:451-460` (`buildPromptContext` → `model`), `packages/core/src/prompt-config/defaults/core.md:1` (`You are LLxprt Code running on {{PLATFORM}} with {{MODEL}} via {{PROVIDER}}.`) |

So on `main` a two-member round-robin pool renders
`… with load-balancer via load-balancer` on **both** requests, while the wire
carries `model-a` and then `model-b`. The delivered fix must make the rendered
model equal `resolved.model` for **each** selection.

### 1.2 Why no agent-layer-only fix reaches it

Selection is per-request and internal to the provider, and the failover strategy
selects *reactively* — it advances to the next backend only after an in-flight
delegate stream throws, inside a single `generateChatCompletion` call. Nothing
above the provider can know the answer in advance.

---

## 2. Verified call paths

Both strategies converge on exactly one function that receives the selected
sub-profile and runs before both estimation and delegation:
`LoadBalancingProvider.enforceTokenLimitForTarget`.

### 2.1 Round-robin

| # | Site | Evidence |
|---|---|---|
| 1 | Normalize options | `LoadBalancingProvider.ts:349-362` |
| 2 | Strategy branch (round-robin) | `LoadBalancingProvider.ts:366-369` |
| 3 | **Selection** | `LoadBalancingProvider.ts:372` `const subProfile = this.selectNextSubProfile()` |
| 4 | **Prepare target** (estimate, compress, resolve delegate) | `LoadBalancingProvider.ts:377-380` → `enforceTokenLimitForTarget` at `:294-340` |
| 5 | Build delegate options — `resolved.model` overwritten | `:391-394` → `buildRoundRobinResolvedOptions` `:419-431` → `loadBalancing/resolvedOptionsBuilder.ts:58-64`, `:107-197` (`model: subProfile.model` at `:160`; legacy `model: subProfile.modelId` at `:85-86`) |
| 6 | Transport budget | `:395` `requireTransportAttempt(resolvedOptions)` |
| 7 | Delegate call | `:403-411` → `loadBalancing/backendLifecycleNotifier.ts:190` `delegateProvider.generateChatCompletion(resolvedOptions)` |

### 2.2 Failover

| # | Site | Evidence |
|---|---|---|
| 1 | Strategy branch | `LoadBalancingProvider.ts:366-368` → `executeWithFailover` `:680-686` |
| 2 | Error-observation wrapper | `:683-685` → `providerErrorObservation.ts:134-144`, `:102-123` (spreads `...options`) |
| 3 | **Independent selection loop** | `executeObservedFailover` `:688-757`; `const subProfile = this.config.subProfiles[currentIndex]` at `:719`; advance at `:756` |
| 4 | Retry loop per backend | `tryBackendWithRetries` `:781-860` |
| 5 | **Prepare target** | `:799-802` → the *same* `enforceTokenLimitForTarget` `:294-340` |
| 6 | Attempt | `:805-813` → `attemptBackendRequest` `:882-924` → `loadBalancing/backendAttemptExecutor.ts:137-216` |
| 7 | Build delegate options — `resolved.model` overwritten | `backendAttemptExecutor.ts:157-162` → `:71-83` `deps.buildResolvedOptions(...)` → `LoadBalancingProvider.ts:919` → `buildResolvedOptions` `:663-668` → `buildDelegateResolvedOptions` `:433-438` → the same external builder |
| 8 | Transport budget | `backendAttemptExecutor.ts:81` |
| 9 | Delegate call | `backendAttemptExecutor.ts:90-110` → `createDelegateAttempt` (`loadBalancing/delegateAttempt.ts:31-39` → `utils/abortSignal.ts:60-71`, spreads `...options`) → `:98` `delegateProvider.generateChatCompletion(attempt.options)` |

### 2.3 Field survival (why an optional options field reaches the delegate)

Every hop between the agent seam and the delegate rebuilds options by spreading:

- `LoggingProviderWrapper` → `logging/optionsNormalizer.ts:41-43` `{ ...contentOrOptions }`
- `ProviderManager.normalizeRuntimeInputs` → `runtimeNormalizer.ts:521-531` `{ ...rawOptions, … }`
- LB delegate builder → `resolvedOptionsBuilder.ts:81-96`, `:156-175` `{ ...options, … }`
- `optionsWithPromptProjection` → `loadBalancing/preparedPromptOptions.ts:63-72`
- `withRequestSignal` → `utils/abortSignal.ts:64-70`
- `bindPreparedTransportSignal` → `agents/src/core/promptEnvelopeSendSeam.ts:47-54`

No hop enumerates fields, so no new field is dropped. Verified.

### 2.4 The three agent send seams

| Seam | Where options are built | Current system-prompt line |
|---|---|---|
| `TurnProcessor` (non-stream) | `_buildProviderChatOptions` `TurnProcessor.ts:621-638` → `buildProviderChatOptions` `promptEnvelopeSendSeam.ts:69-92` | `TurnProcessor.ts:636` / `promptEnvelopeSendSeam.ts:90` |
| `StreamProcessor` | `_buildStreamChatOptions` `StreamProcessor.ts:453-479` | `StreamProcessor.ts:475-477` |
| `DirectMessageProcessor` | `_createDirectProviderStream` `DirectMessageProcessor.ts:470-518` | `DirectMessageProcessor.ts:514-516` |

All three read `this.generationConfig.systemInstruction`, which
`ChatSession._resolveSystemPromptForTurn` (`chatSession.ts:548-567`) rewrites once
per turn under the serialization chain at `:582-604`.

### 2.5 Prompt token-offset accounting

- Agent layer: `chatSession.ts:562-566` estimates the assembled prompt and calls
  `historyService.setBaseTokenOffset(tokens)` with the **parent** model
  (`'load-balancer'`). Session start does the same at
  `ChatSessionFactory.ts:233-243`, `:406`.
- Provider layer: `enforceTokenLimitForTarget` (`:294-340`) estimates the
  **delegate's finalized envelope** via
  `preparedPromptOptions.estimatePreparedPrompt` (`:21-61`) →
  `loadBalancerPromptEstimator.estimateSelectedProviderPrompt` (`:17-42`) →
  `delegateProvider.projectPromptEnvelope(options)`. That projection consumes
  `options.systemInstruction`, so the LB's context-limit and compression
  decisions are made against whatever prompt is in the options **at that moment**.

**Consequence that fixes the ordering question:** re-rendering the prompt after
delegation would leave the LB enforcing limits and compressing against a prompt
it does not send. Re-rendering must happen **before** estimation. This is why
the seam is `enforceTokenLimitForTarget` and not the options builder.

`LoadBalancingProvider` implements neither `projectPromptEnvelope` nor
`getSystemPromptPlacement` (verified: no such members in
`LoadBalancingProvider.ts` or `loadBalancing/*.ts`), so the agent-layer
`prepareAtSendSeam` returns `{ estimate: null, options }` for it
(`promptEnvelopeSendSeam.ts:212-214`) and placement resolves to the delegate's
declaration. Neither needs to change.

---

## 3. Option evaluation and decision

| Option | Verdict | Grounds |
|---|---|---|
| **1. Accept and document** | Rejected | Fails issue acceptance criteria 2, 3 and 4. It also leaves the prompt naming the non-model string `'load-balancer'` (§1.1), which no user configured. |
| **2. Assembler port re-invoked after selection** | **Selected** | The one place that knows the selection is the provider; the one place that knows how to build a prompt stays `packages/agents`. The port is a value the caller supplies, so the provider *triggers* assembly it cannot *define*. Fits the existing option-passing architecture (`onProviderError`, `onStreamLiveness`, `userMemory` are already caller-supplied ports on the same object) and the existing spread-preserving hop chain (§2.3). |
| **3. Hoist selection above the agent seam** | Rejected | Verified impossible without redesigning failover. `executeObservedFailover` (`:688-757`) advances backends *reactively*, driven by exceptions thrown from a delegate stream inside `tryBackendWithRetries` (`:816-857`), and owns `FailoverState` (`:691`, `:814`, `:824-828`), circuit-breaker skipping (`:703-709`, `:722-734`), TPM skipping (`:727-729`) and aggregate error semantics (`:761-778`). Hoisting means moving the entire failover loop into the agent layer. Disproportionate to the defect and destabilizing to five verified subsystems. |
| **4. Constrain configuration (reject/warn on mixed models)** | Rejected | `validateLoadBalancerConfig` (`loadBalancing/configValidation.ts:75-101`) deliberately permits heterogeneous models, and heterogeneous pools are the point of a round-robin/failover pool that mixes a fast and a strong model. It also does not satisfy the issue's criteria 2 and 3, which are written against "two sub-profiles on **different** models". Additionally it would not fix §1.1: a homogeneous pool would still render `'load-balancer'`, because the parent model is that literal string regardless. Rejecting a capability to fix nothing is not a trade worth making. |

### 3.1 The guard the issue asked for

The issue's own reservation about Option 2 is that "it needs care so it cannot
become a general provider-side rebuild hook". Three contract rules, all
behaviorally tested (§8), close that:

1. The port **re-renders, never originates**. If `options.systemInstruction` is
   absent, the load balancer leaves the options untouched and the delegate's
   existing `requireAssembledSystemInstruction` fail-fast
   (`utils/systemPromptPlacement.ts:89-98`) fires exactly as it does today.
2. The port is invoked **only when the router actually changes the model**. If
   `resolveSubProfileModel(subProfile)` is empty, `resolved.model` is inherited
   from the parent (conditional spread at `resolvedOptionsBuilder.ts:85-86`), the
   caller's prompt is already correct, and the port is not invoked.
3. The port is invoked **at most once per selected backend attempt**, at one
   call site, not once per options rebuild.

---

## 4. Accepted behavior

| # | Accepted behavior | Requirement |
|---|---|---|
| 1 | For a **round-robin** load-balancer profile whose sub-profiles use different models, the model rendered into the system instruction the delegate receives equals `resolved.model` on that same request — for every selection in the rotation, not just the first. | REQ-3157-1 |
| 2 | For the **failover** strategy, the delegate that actually transmits receives a system instruction rendering **its own** sub-profile model, including when it is reached after an earlier backend failed **before** its first yielded chunk. Backend switching only occurs on a pre-yield failure; a backend that fails after yielding chunks re-throws the raw error immediately with no further switching (post-yield switching is explicitly out of scope). | REQ-3157-2 |
| 3 | System-prompt **assembly logic** remains solely owned by `packages/agents`. `LoadBalancingProvider` invokes a caller-supplied port; it never imports `getCoreSystemPromptAsync`, never constructs prompt text, and never originates a prompt where the caller supplied none. | REQ-3157-3 |
| 4 | The load balancer's own token estimate, context-limit enforcement, compression decision and `promptEnvelopeTransportToken` are computed from the **same** system instruction it transmits. | REQ-3157-4 |
| 5 | Non-load-balancer request paths are behaviorally unchanged: exactly one assembly per turn, performed by `ChatSession`, on all three send paths. | REQ-3157-5 |

---

## 5. Non-goals and explicit exclusions

- **`getCurrentModel()` is not changed.** `LoadBalancingProvider.getCurrentModel`
  (`:474-484`) answers from `lastSelected` and therefore reports the previous
  request's model. The issue cites it as evidence that querying the balancer
  cannot help; it is not in the acceptance criteria and is tracked separately
  (\#2379). The selected design does not read it.
- **The `{{PROVIDER}}` token is not changed.** `buildSystemInstruction`
  (`ChatSessionFactory.ts:117-158`) does not pass `provider`, so
  `resolvePromptArgs` leaves `providerArg` undefined
  (`prompts.ts:487-512`) and `buildPromptContext` resolves it independently
  (`prompts.ts:444`). The port's only parameter is `model`. Rendering the
  delegate's provider name is a separate change with its own risk and is out of
  scope.
- **Model-specific prompt-template overlay selection is not changed.** It is
  keyed on provider + model inside the prompt service; the provider stays
  `'load-balancer'`, so overlay resolution behaves exactly as it does today.
- **The agent-layer base token offset is not re-synced per sub-profile.**
  `historyService.setBaseTokenOffset` (`chatSession.ts:566`) remains the
  parent-model assembly. A pool that alternates models has no single correct
  agent-layer value, and having a provider write back into the agent's
  `HistoryService` would invert the dependency direction that \#3136
  established. The LB's *own* accounting is made consistent by REQ-3157-4;
  the agent-layer offset stays a whole-session approximation, as it already is.
- **No configuration constraint, warning, or diagnostic is added** for
  mixed-model pools (Option 4 is rejected, so the issue's conditional criterion 6
  does not apply).
- **Compression request paths are untouched.** `MiddleOutStrategy.ts:452`,
  `OneShotStrategy.ts:330`, `compression/utils.ts:290` and
  `CompressionLoadBalancingProvider.ts:129` build their own options and use the
  compression prompt, not the agent core prompt.
- **No new dependency, no new package, no new setting/flag/env var, no new
  workflow, no agent-memory change, no new ESLint rule.**
- **No adjacent refactor.** `LoadBalancingProvider`'s failover loop, circuit
  breaker, TPM tracking, stats, lifecycle notification and error aggregation are
  not restructured.
- **No new public abstraction beyond the single port type** described in §6.
  The re-render helper is a module-private function in a new
  `loadBalancing/` module with one export.

---

## 6. Contract

### 6.1 Core-owned runtime contract

`packages/core/src/runtime/contracts/RuntimeProviderChat.ts`

```typescript
/**
 * Caller-supplied renderer for the assembled system prompt, parameterized by
 * the model that will appear on the wire.
 *
 * Supplied by the agent layer, which owns assembly (issue #3136). A ROUTER
 * provider — one that selects a different model than the caller resolved —
 * invokes this after selection so the rendered model matches `resolved.model`
 * (issue #3157). It is a re-render hook, not an assembly hook: a provider must
 * not invoke it when the caller supplied no `systemInstruction`, and must not
 * invoke it when it is not overriding the model.
 */
export interface RuntimeSystemPromptAssembler {
  assemble(model: string): Promise<string>;
}

export interface RuntimeGenerateChatOptions {
  // … existing members unchanged …
  systemInstruction?: string;
  systemPromptAssembler?: RuntimeSystemPromptAssembler;
}
```

### 6.2 Provider-side mirror

Following the existing mirroring convention in that file's header comment
("Concrete providers satisfy them through TypeScript structural typing") and the
precedent of `ResolvedAuthToken` / `RuntimeResolvedAuthToken` and
`UserMemoryInput` / `RuntimeUserMemoryInput`:

`packages/providers/src/types/providerRuntime.ts`

```typescript
export interface SystemPromptAssembler {
  assemble(model: string): Promise<string>;
}
```

`packages/providers/src/IProvider.ts`

```typescript
export interface GenerateChatOptions {
  // … existing members unchanged …
  systemInstruction?: string;
  systemPromptAssembler?: SystemPromptAssembler;
}
```

Structural identity with `RuntimeSystemPromptAssembler` and with the agent
layer's existing `SystemPromptAssembler` (`agents/src/core/chatSession.ts:123-125`)
is intentional and is what lets the same object flow across all three
declarations with no adapter and no import from `packages/agents` into
`packages/providers`.

### 6.3 Agent-side carrier

`packages/agents/src/core/chatSession.ts`

```typescript
export interface ChatSessionConfig extends ModelGenerationSettings {
  // … existing members unchanged …
  systemPromptAssembler?: SystemPromptAssembler;
}
```

Chosen over threading a new constructor parameter through `TurnProcessor`,
`StreamProcessor` and `DirectMessageProcessor` because:

- `ChatSessionConfig` is agent-owned (declared in `chatSession.ts:28-41`, not in
  core's `ModelGenerationSettings`), and already carries caller-supplied function
  ports (`onProviderError`, `onStreamLiveness`).
- All three seams already read `this.generationConfig.systemInstruction` on the
  exact line that must also carry the port, so the prompt and its renderer travel
  together and cannot drift apart.
- Fewer touchpoints, and no growth of three already-long constructors.

`ChatSession`'s constructor assigns it once from its existing sixth parameter.
Per-request `SendMessageParams.config.systemPromptAssembler` is **not** honored,
exactly as `params.config.systemInstruction` is not honored today — the seams read
`this.generationConfig` only.

### 6.4 The re-render step

New module `packages/providers/src/loadBalancing/selectedModelPrompt.ts`, one
export:

```typescript
/**
 * Re-render the caller-assembled system prompt for the model this router
 * selected, so the rendered model matches `resolved.model` (issue #3157).
 *
 * Returns `options` unchanged — never a rebuilt prompt — when the router is not
 * overriding the model, when the caller supplied no assembler, or when the
 * caller supplied no prompt to re-render. Assembly stays owned by the agent
 * layer; this only re-invokes it.
 */
export async function optionsWithSelectedModelPrompt(
  options: GenerateChatOptions,
  selectedModel: string,
): Promise<GenerateChatOptions>;
```

Behavior, in order:

1. `selectedModel.trim() === ''` → return `options` unchanged.
   (Legacy `LoadBalancerSubProfile` without `modelId`: `resolved.model` is
   inherited from the parent at `resolvedOptionsBuilder.ts:85-86`, so the
   caller's prompt is already correct.)
2. `options.systemPromptAssembler === undefined` → return `options` unchanged.
3. `options.systemInstruction` is absent or blank (undefined, empty, or
   whitespace-only — blank is "missing" per `systemPromptPlacement.ts`) →
   return `options` unchanged, preserving the original invalid value for the
   delegate's fail-fast guard. The port re-renders but never originates a
   prompt.
4. Otherwise return `{ ...options, systemInstruction: await
   options.systemPromptAssembler.assemble(selectedModel) }`.

No `try`/`catch`. **Fail-fast:** an assembler rejection propagates. Verified
consequence on the failover path: it is thrown from
`enforceTokenLimitForTarget` before `requestStarted = true`
(`LoadBalancingProvider.ts:799-804`), so `tryBackendWithRetries` records it via
`recordBackendFailure` (`:830-837`) and it surfaces inside the
`LoadBalancerFailoverError` aggregate (`:773-778`). It is reported, never
swallowed, and needs no new error type or handling branch.

### 6.5 The single call site

`LoadBalancingProvider.enforceTokenLimitForTarget` (`:294-340`), immediately
after the delegate-provider lookup and **before** `buildDelegateResolvedOptions`
and `estimateForSubProfile`:

```typescript
const targetOptions = await optionsWithSelectedModelPrompt(
  options,
  resolveSubProfileModel(subProfile),
);
```

`targetOptions` then replaces `options` for the remainder of the function:
`buildDelegateResolvedOptions(subProfile, targetOptions)` (`:308-311`),
`estimateForSubProfile(...)` (`:312-316`),
`optionsWithPromptProjection(targetOptions, result)` (`:319`), and
`compressForContextLimit(targetOptions, …)` (`:323-329`).

This is the **only** place the port is read. Consequences, all verified:

- Round-robin reaches it at `:377`; failover reaches it at `:799`. One seam
  covers both strategies (REQ-3157-1, REQ-3157-2).
- Estimation, compression and the transport token are computed from the prompt
  that will be sent (REQ-3157-4).
- `resolveSubProfileModel` (`loadBalancing/subProfileHelpers.ts:26-32`) is the
  exact function that supplies `resolved.model` in both builder branches, so the
  rendered model and `body.model` come from one source (REQ-3157-1/2).
- `resolveModelField` (`runtimeNormalizer.ts:253-281`) gives
  `rawOptions.resolved.model` first precedence, so the sub-profile model is what
  reaches the wire.

### 6.6 File-size constraint (verified, load-bearing)

`packages/providers/src/LoadBalancingProvider.ts` currently measures **781**
effective lines against the `max-lines: 800` cap
(`eslint.config.js:249-252`, `skipBlankLines: true, skipComments: true`).
The helper therefore **must** live in its own module; only the import and the
call belong in `LoadBalancingProvider.ts`. `enforceTokenLimitForTarget` stays
well under `max-lines-per-function: 80` (`eslint.config.js:253-256`).

---

## 7. Boundary cases (all specified, all tested)

| Input / condition | Required behavior | Rationale |
|---|---|---|
| Round-robin, two sub-profiles, **different** models | Request *n* renders the model selected for request *n* | REQ-3157-1 |
| Round-robin, sub-profiles with the **same** model | Prompt is re-rendered to that model; rendered model still equals `resolved.model` | Uniform rule; no special case |
| Failover, first backend throws before yielding | The second delegate receives a prompt rendering the second sub-profile's model | REQ-3157-2 |
| Failover, first backend throws **after** yielding chunks | Unchanged failover semantics: the raw backend error is re-thrown immediately — there is **no** switching to another backend. Post-yield switching is explicitly out of scope. | Existing invariant: a partial stream cannot be silently retried against another backend |
| Failover retries against the **same** backend (`retryCount > 1`) | Re-rendered per attempt with the same model → identical prompt text | Deterministic; no cache-prefix churn |
| **No** `systemPromptAssembler` on options | Delegate receives the caller's `systemInstruction` byte-identical | Backward compatibility; mirrors `ChatSession`'s existing no-assembler behavior (`chatSession.ts:549-551`) |
| Assembler present, absent or blank `systemInstruction` (undefined/empty/whitespace) | Delegate receives the original value unchanged; the LB originates nothing and the assembler is never invoked | §3.1 rule 1; blank is "missing" per `systemPromptPlacement.ts`; existing delegate fail-fast still fires |
| Legacy `LoadBalancerSubProfile` with absent/empty/whitespace-only `modelId` | Prompt untouched; `resolved.model` inherited from parent | `modelId.trim() === ''` means no override for both prompt re-rendering and `resolved.model` (review fix: predicates agree) |
| Assembler rejects | Rejection propagates; failover aggregates it into `LoadBalancerFailoverError` | Fail-fast over a defensive fallback layer |
| Non-load-balancer provider | No behavior change; the port is simply never read | REQ-3157-5 |

---

## 8. Test-first implementation plan

All new and changed tests use **Bun** and import from `bun:test`, matching the
existing suites (`packages/providers/src/__tests__/LoadBalancingProvider.tokenAccounting.test.ts:10`,
`packages/agents/src/core/chatSession.systemPromptAssembly.test.ts:20`).

Strict red-then-green: every step below writes the failing test first, confirms
the expected failure message, then writes the minimum production code.

### Step 1 — RED: agent seam carries the port on all three send paths

File: `packages/agents/src/core/chatSession.systemPromptAssembly.test.ts` (extend).

Add a `describe('router re-render port (issue #3157)')` block reusing the
existing `buildFixture` helper, with the stub provider's
`generateChatCompletion` acting as a router: it calls
`options.systemPromptAssembler.assemble('router-picked-model')` and records the
result. Three cases: `sendMessage`, `sendMessageStream`,
`generateDirectMessage`. Each asserts the recorded prompt is
`'[model=router-picked-model]'` while `capturedCalls[n].systemInstruction` is
still the turn-model prompt.

Expected RED on `main`: `options.systemPromptAssembler` is `undefined`
(the field does not exist), so the stub throws
`TypeError: undefined is not an object (evaluating 'options.systemPromptAssembler.assemble')`.

### Step 2 — GREEN: declare and thread the port

1. `packages/core/src/runtime/contracts/RuntimeProviderChat.ts` — add
   `RuntimeSystemPromptAssembler` and the optional
   `RuntimeGenerateChatOptions.systemPromptAssembler` (§6.1).
2. `packages/providers/src/types/providerRuntime.ts` — add
   `SystemPromptAssembler` (§6.2).
3. `packages/providers/src/IProvider.ts` — add
   `GenerateChatOptions.systemPromptAssembler` (§6.2).
4. `packages/agents/src/core/chatSession.ts` — add
   `ChatSessionConfig.systemPromptAssembler` (`:28-41`); in the constructor
   (`:212-224`), assign it from the existing `systemPromptAssembler` parameter
   when defined.
5. `packages/agents/src/core/promptEnvelopeSendSeam.ts` — add a
   `systemPromptAssembler` parameter to `buildProviderChatOptions` (`:69-92`)
   and set it on the returned options next to `systemInstruction`.
6. `packages/agents/src/core/TurnProcessor.ts` — pass
   `this.generationConfig.systemPromptAssembler` from
   `_buildProviderChatOptions` (`:621-638`).
7. `packages/agents/src/core/StreamProcessor.ts` — set the field in
   `_buildStreamChatOptions` (`:453-479`).
8. `packages/agents/src/core/DirectMessageProcessor.ts` — set the field in
   `_createDirectProviderStream` (`:470-518`).

No change to `ChatSessionFactory.ts` or `subagentRuntimeSetup.ts`: both already
build a `SystemPromptAssembler` and pass it to the `ChatSession` constructor
(`ChatSessionFactory.ts:395-398`, `:424`; `subagentRuntimeSetup.ts:781-791`, `:802`).

### Step 3 — RED: round-robin renders the selected sub-profile model

File (new): `packages/providers/src/__tests__/LoadBalancingProvider.systemPromptModel.test.ts`.

Justification for a new file: the existing LB suites cover model resolution,
stats, failover mechanics, token accounting and lifecycle. None asserts anything
about `systemInstruction`. A dedicated file keeps this contract visible and
avoids diluting those suites.

Case 3.1 — two `ResolvedSubProfile`s on `model-a` / `model-b`, `round-robin`,
an assembler of `async (model) => '[model=' + model + ']'`, and a stub delegate
capturing every `GenerateChatOptions` it receives. Assert, per request, that
`captured[n].systemInstruction === '[model=' + captured[n].resolved.model + ']'`
and that the two requests name `model-a` then `model-b`.

Expected RED on `main`: both requests carry the caller's
`'[model=load-balancer]'`.

### Step 4 — RED: failover renders the transmitting backend's model

Case 4.1 — `failover` strategy, two sub-profiles on different models, delegate
throws on its first invocation and yields on the second (pattern from
`LoadBalancingProvider.failover.selection.test.ts:173-230`). Assert the delegate
options captured on the **successful** attempt satisfy
`systemInstruction === '[model=' + resolved.model + ']'` and name the second
sub-profile's model.

Expected RED on `main`: the successful attempt carries `'[model=load-balancer]'`.

### Step 5 — GREEN: the re-render step

1. Create `packages/providers/src/loadBalancing/selectedModelPrompt.ts` with
   `optionsWithSelectedModelPrompt` exactly as specified in §6.4.
2. Wire the single call site in
   `LoadBalancingProvider.enforceTokenLimitForTarget` exactly as specified in
   §6.5.

### Step 6 — RED then GREEN: the LB estimates what it sends

Case 6.1 — round-robin, one sub-profile, a delegate implementing
`projectPromptEnvelope` that records `options.systemInstruction` (pattern from
`LoadBalancingProvider.tokenAccounting.test.ts:103-146`), with
`providerManager.setTokenizerFactory(...)` supplied. Assert the projection saw
the sub-profile-rendered prompt, and that the *same* string reached
`generateChatCompletion`.

Expected RED before Step 5: the projection sees `'[model=load-balancer]'`.
Turns GREEN by construction because §6.5 places the re-render **before**
`estimateForSubProfile`. (If an implementation instead re-rendered at the
options builder, this case stays RED — that is its purpose.)

### Step 7 — Guard cases (GREEN on `main`, must stay GREEN)

Written after Steps 3–6 so they cannot be mistaken for the failing evidence.

- 7.1 No assembler on options → delegate receives the caller's
  `systemInstruction` byte-identical.
- 7.2 Assembler present, `systemInstruction` absent → delegate receives
  `systemInstruction === undefined` and the assembler is never invoked.
- 7.3 Legacy sub-profile without `modelId` → prompt untouched and the assembler
  is never invoked.
- 7.4 Round-robin: the assembler is invoked exactly once per request; failover
  with a failing primary: exactly once per attempted backend.

### Step 8 — Full verification

Run the commands in §11 and fix any failure at its root cause.

---

## 9. Behavioral test plan and expected red/green evidence

| # | File | Case | On `main` | After fix |
|---|---|---|---|---|
| T1 | `agents/…/chatSession.systemPromptAssembly.test.ts` | `sendMessage`: router provider re-renders via `options.systemPromptAssembler` | **RED** — `systemPromptAssembler` is `undefined`; stub throws `TypeError` | GREEN — `'[model=router-picked-model]'` |
| T2 | same | `sendMessageStream`: same | **RED** — same | GREEN |
| T3 | same | `generateDirectMessage`: same | **RED** — same | GREEN |
| T4 | `providers/…/LoadBalancingProvider.systemPromptModel.test.ts` | Round-robin, different models, request 1 | **RED** — `'[model=load-balancer]'`, expected `'[model=model-a]'` | GREEN |
| T5 | same | Round-robin, different models, request 2 | **RED** — `'[model=load-balancer]'`, expected `'[model=model-b]'` | GREEN |
| T6 | same | Round-robin: rendered model `===` `resolved.model` on both requests | **RED** | GREEN |
| T7 | same | Failover: first backend throws, second transmits | **RED** — successful attempt carries `'[model=load-balancer]'`, expected `'[model=model-b]'` | GREEN |
| T8 | same | Failover: rendered model `===` `resolved.model` on the transmitting attempt | **RED** | GREEN |
| T9 | same | `projectPromptEnvelope` observes the sub-profile-rendered prompt, identical to the transmitted one | **RED** — projection sees `'[model=load-balancer]'` | GREEN |
| T10 | same | No assembler → `systemInstruction` byte-identical to the caller's | GREEN | GREEN (regression guard) |
| T11 | same | Assembler present, no `systemInstruction` → delegate gets `undefined`; assembler never invoked | GREEN | GREEN (originate-nothing guard) |
| T12 | same | Legacy sub-profile without `modelId` → prompt untouched; assembler never invoked | GREEN | GREEN (no-model-override guard) |
| T13 | same | Assembler invocation count: 1 per round-robin request; 1 per attempted failover backend | **RED** — 0 invocations | GREEN |
| T14 | existing `packages/providers/src/__tests__/LoadBalancingProvider.*.test.ts` | Whole suite | GREEN | GREEN (unchanged; none set `systemInstruction`, verified by grep) |
| T15 | existing `chatSession.systemPromptAssembly.test.ts` cases 1–6 | Per-turn assembly, offset recomputation, serialization, no-assembler | GREEN | GREEN (REQ-3157-5) |
| T16 | `npm run lint:eslint-guard` + `npm run lint:ci` | `getCoreSystemPromptAsync` remains banned in `packages/providers/src/**` (`eslint.config.js:1161-1178`); no severity downgrade | GREEN | GREEN |

Anti-mock-theater note: T4–T13 assert on the `GenerateChatOptions` the delegate
provider actually receives and on the prompt text it actually gets — the observable
contract between the balancer and its backend — not on internal call
sequencing. T13 counts assembler invocations because "at most once per selected
backend" is itself a required behavior (§3.1 rule 3), not an implementation
detail.

---

## 10. Requirement → test evidence matrix

| Requirement | Delivered by | Proven by | Fails on `main` |
|---|---|---|---|
| REQ-3157-1 — round-robin rendered model `===` `body.model`, every selection | §6.4 helper + §6.5 call site reached at `LoadBalancingProvider.ts:377` | T4, T5, T6 | Yes |
| REQ-3157-2 — failover rendered model `===` `body.model` on the transmitting backend | same helper reached at `LoadBalancingProvider.ts:799` | T7, T8 | Yes |
| REQ-3157-3 — assembly stays agent-owned; port re-renders, never originates | §6.1–6.3 port; §6.4 rules 2 and 3; no provider import of `getCoreSystemPromptAsync` | T11, T12, T13, T16 | T13 yes; T11/T12/T16 are guards |
| REQ-3157-4 — LB estimates/compresses the prompt it sends | §6.5 places the re-render before `estimateForSubProfile` | T9 | Yes |
| REQ-3157-5 — non-LB paths unchanged, one assembly per turn | No change to `ChatSession._resolveSystemPromptForTurn` or `_withResolvedSystemPrompt` | T10, T15, T1–T3 | T1–T3 yes; T10/T15 are guards |

Every requirement has at least one test that is RED on current `main`, satisfying
the issue's fourth acceptance criterion.

---

## 11. Constraints

### 11.1 Lint and type-suppression prohibition (restated, non-negotiable)

- **Lint and complexity rules must not be loosened.** No rule may be disabled,
  downgraded from `error` to `warn`/`off`, or scoped away by a new `files:`
  carve-out. No threshold may be raised — specifically not `max-lines` (800),
  `max-lines-per-function` (80), `complexity` (25), or
  `sonarjs/cognitive-complexity` (30). `scripts/check-eslint-guard.ts` exists to
  reject exactly this and must stay green.
- **No suppression directives may be introduced.** No `eslint-disable`,
  `eslint-disable-next-line`, `eslint-disable-line`, `@ts-ignore`,
  `@ts-expect-error`, `@ts-nocheck`, `any`, or type assertions used to silence a
  diagnostic. If lint or `tsc` complains, fix the underlying issue.
- The `no-restricted-imports` guard banning `getCoreSystemPromptAsync` in
  `packages/providers/src/**` (`eslint.config.js:1161-1178`) must remain intact
  and unmodified. The design never needs it: `packages/providers` gains no import
  from `packages/agents` and no import from
  `@vybestack/llxprt-code-core/core/prompts.js`.
- The `max-lines` headroom in `LoadBalancingProvider.ts` (781/800 effective,
  §6.6) is to be respected by extraction, never by relaxing the cap.

### 11.2 Testing

- All new and changed tests are Bun tests importing from `bun:test`. No Vitest
  imports, no new `.spec.ts` under Vitest, no new `.js` test files.
- No test may assert current incorrect behavior as correct (RULES.md).

### 11.3 Scope

Strictly issue 3157. No adjacent cleanup, speculative hardening, new dependency,
workflow change, memory change, public abstraction beyond §6, or unrelated
refactor. Any file not named in §8 is out of scope unless a verification failure
in §11.4 forces a minimal, root-cause fix.

### 11.4 Verification (must all pass before push)

```
npm run lint:ci
npm run lint:eslint-guard
npm run typecheck
npm run test
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```
