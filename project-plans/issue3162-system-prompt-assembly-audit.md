# Issue #3162 — Audit: system-prompt assembly call sites and the owning architecture

Audit only. No production behaviour changes.

**Line numbers in this document are relative to commit `b45e8cdd7`** (the merge
base of this branch), *not* to the working tree, because this branch's own
comment-only edits shift lines in five files. Where a reference points into a
file this branch edits, the post-edit line is given in parentheses.

## 0. The issue body's inventory is stale — read this first

PR #3148 (commit `e15869fe3`, "Collapse system-prompt assembly to a single owner
and a declared placement (Fixes #3136)") merged at 2026-08-08T15:55:01Z. Issue
#3162 was created at 2026-08-08T17:55:04Z, two hours **after** that merge — so
the staleness is not a matter of the issue predating the work. The issue body
carries forward the inventory from the original #3136 investigation without
re-checking it against the merged result. Either way the consolidation it asks
for has already happened, so this audit reports on the *post*-consolidation
architecture and on what #3148 left undone.

Claim-by-claim verdict on the issue body:

| Issue-body claim | Verdict | Evidence |
| --- | --- | --- |
| Ten non-test call sites of `getCoreSystemPromptAsync` | **STALE** — there are now **five**, all in `packages/agents` | see §1 |
| Five of those ten are in `packages/providers/` | **STALE** — **zero** provider call sites remain | `grep -rn getCoreSystemPromptAsync packages/providers/src` returns only a test mock, `anthropic/test-utils/anthropicThinkingTestSetup.ts:28` |
| Two concatenation points join two *complete* prompts (`OpenAIRequestPreparation.ts:141`, `openAIResponsesExecutor.ts:365`) | **STALE** — both deleted; providers now transport verbatim | `OpenAIRequestPreparation.ts:277`, `openAIResponsesExecutor.ts:428` each read `options.systemInstruction ?? ''` and never rebuild |
| `coreMemory` is passed by exactly one call site | **STALE** — passed by three of five | §2 |
| `interactionMode` differs between agent- and provider-layer builds for the same request | **STALE** — there is no provider-layer build any more | §1 |
| Three independent placement decisions with no shared contract | **PARTLY STALE** — the *format* is now single-owned, but the *decision* is still ad-hoc | §4, §5 |
| A repo-wide search for `systemAsUser`, `systemPromptPlacement`, `supportsSystem`, `systemRole`, `promptPlacement` returns nothing | **STALE** — `systemPromptPlacement` and `SystemPromptPlacement` now exist | `packages/providers/src/utils/systemPromptPlacement.ts`, `packages/providers/src/IProvider.ts:145` |
| Deliverable 7: re-scope #3136 | **MOOT** — #3136 is implemented and merged by PR #3148 | `git log` `e15869fe3` |
| The subagent-memory trap (`subagentRuntimeSetup.ts` passes neither `userMemory` nor `coreMemory`) | **CLOSED** — both are now passed | `subagentRuntimeSetup.ts:836-837` |

## 1. Complete call-site inventory

Five non-test production sites call `getCoreSystemPromptAsync`. All five are in
`packages/agents`. No site in `packages/providers`, `packages/cli`,
`packages/core`, `packages/a2a-server` or `packages/mcp` calls it.

| # | Site | Layer | Trigger | Reachable |
| --- | --- | --- | --- | --- |
| 1 | `packages/agents/src/core/ChatSessionFactory.ts:140` | agents/core | **every turn** via the assembler seam below, plus session start and `client.updateSystemInstruction()` | yes |
| 2 | `packages/agents/src/core/subagentRuntimeSetup.ts:835` (now 841) | agents/core | **every subagent turn** via the assembler seam, plus subagent start: `task` tool → `SubagentOrchestrator.launch` → `SubAgentScope` → `createChatObject` | yes |
| 3 | `packages/agents/src/core/clientLlmUtilities.ts:34` | agents/core | `generateJson` / `generateContent` — next-speaker check, summariser, LLM edit fixer, prompt completion | yes |
| 4 | `packages/agents/src/agents/executor.ts:910` (now 916) | agents/agents | `AgentExecutor.run` → `createChatObject` → `buildSystemPrompt` | **NO — dead**, §3 |
| 5 | `packages/agents/src/compression/compressionSystemPrompt.ts:63` (now 67) | agents/compression | history compression: `OneShotStrategy.callProvider`, `MiddleOutStrategy.callProvider`, `runVerificationPass` | yes |

### The assembly boundary contract already exists: `SystemPromptAssembler`

Sites 1 and 2 are **per-turn** assemblers, not once-per-session builders, and
they are reached through an explicit one-method interface declared at
`packages/agents/src/core/chatSession.ts:123-125`:

    export interface SystemPromptAssembler {
      assemble(model: string): Promise<string>;
    }

`ChatSession._resolveSystemPromptForTurn()`
(`packages/agents/src/core/chatSession.ts:548-567`) calls `assemble(model)` and
writes the result to `generationConfig.systemInstruction`, and
`_withResolvedSystemPrompt` wraps **every** public send path so a turn cannot
transmit a stale prompt. `ChatSessionFactory.ts:395-398` and
`subagentRuntimeSetup.ts:781-792` each supply an implementation that closes over
the site's own `buildSystemInstruction`.

This matters for two reasons the rest of this audit depends on. First, the
boundary contract asked for by deliverable 6 is not missing — it exists, is
narrow, and is already the single seam through which a request-time prompt
reaches a provider. Second, sites 1 and 2 run **once per turn**, which is the
right cost frame for the disk-read findings below.

### Concatenation points

No site concatenates two *complete core prompts* any more. Four sites append
non-core sections to the single assembled core prompt:

| Site | Resulting section order |
| --- | --- |
| `ChatSessionFactory.ts:150-155` | `[envContext, corePrompt]` |
| `subagentRuntimeSetup.ts:847-854` | `[envContext, corePrompt, persona]` |
| `executor.ts:924-927` (dead) | `[corePrompt, persona]`, with env context baked *inside* persona by `executor-prompt-builder.ts` |
| `clientLlmUtilities.ts`, `compressionSystemPrompt.ts` | `[corePrompt]` only |

The two live multi-section sites agree that env context comes first. The dead
site disagrees; since it is unreachable this is latent, not live.

### Provider-layer transport sites (no assembly)

Each reads the assembled instruction and never rebuilds:
`anthropic/AnthropicRequestPreparation.ts:293`,
`openai/OpenAIRequestPreparation.ts:277`,
`openai-responses/openAIResponsesExecutor.ts:428`,
`gemini/geminiGenerationExecution.ts:130`,
`openai-vercel/vercelSystemPrompt.ts:30`.

### A vestigial provider-side memory channel remains

`NormalizedGenerateChatOptions.userMemory` is declared at `IProvider.ts:78` and
`BaseProvider.ts:81`, and is still populated on every request by
`runtimeNormalizer.ts:475-527` and `BaseProviderNormalization.ts:299-301`. **No
production provider reads it.** `openAIResponsesExecutor.ts:426` says so
explicitly: "options.userMemory is deliberately NOT read here".

`packages/providers/src/utils/userMemory.ts` `resolveUserMemory` has zero
production callers — its only four references are `vi.mock` calls in openai
tests. (Note the name collision: the *agents*-side `resolveUserMemory` at
`packages/agents/src/core/streamRequestHelpers.ts:239` is live and is what
populates the channel.)

This is a genuine dead site under deliverable 3: memory is snapshotted into
provider options on every request and then discarded. It is separate from the
dead code in §3 and is not covered by #3152.

## 2. Parameter divergence matrix

`CoreSystemPromptOptions` is declared at `packages/core/src/core/prompts.ts:215-227`.

| Option | 1 ChatSessionFactory | 2 subagentRuntimeSetup | 3 clientLlmUtilities | 4 executor (dead) | 5 compression |
| --- | --- | --- | --- | --- | --- |
| `userMemory` | JIT-aware: `isJitContextEnabled() ? getGlobalMemory() : getUserMemory()`, then `+ getJitMemoryForPath(getWorkingDir())` | `config.getUserMemory()` | `config.getUserMemory()` | `runtimeContext.getUserMemory()` | **—** |
| `coreMemory` | `config.getCoreMemory()` | `config.getCoreMemory()` | **—** | `runtimeContext.getCoreMemory()` | **—** |
| `mcpInstructions` | `config.getMcpInstructions()` | `config.getMcpInstructions()` | `config.getMcpInstructions()` | `runtimeContext.getMcpInstructions()` | `mcpClientManager.getMcpInstructions()` |
| `model` | `resolveModelForSystemPrompt(config)` | `modelConfig.model` | `model` param | `definition.modelConfig.model` | `resolvedOptions?.model ?? fallbackModel` |
| `tools` | `enabledToolNames` | `toolNames` from `combinedDeclarations` | `enabledToolNames` | `extractDeclaredToolNames(prepareToolsList())` | `undefined` |
| `provider` | **—** | **—** | **—** | **—** | **—** |
| `includeSubagentDelegation` | `shouldIncludeSubagentDelegationForConfig(...)` | `false` | `shouldIncludeSubagentDelegationForConfig(...)` | `false` | `false` |
| `asyncSubagentsEnabled` | **—** | **—** | **—** | **—** | **—** |
| `profileAsyncEnabled` | **—** | **—** | **—** | **—** | **—** |
| `interactionMode` | `isInteractive() ? 'interactive' : 'non-interactive'` | `'subagent'` | `isInteractive() ? 'interactive' : 'non-interactive'` | `'subagent'` | `isInteractive() ? 'interactive' : 'non-interactive'` |

### Options passed by zero sites

`provider`, `asyncSubagentsEnabled` and `profileAsyncEnabled` are never passed
by any call site. They are not inert — each is resolved internally from runtime
settings (`prompts.ts` `resolveProvider`, `resolveAsyncSubagentSettings`) and
consumed downstream (`prompt-config/prompt-resolver.ts` search paths;
`TemplateEngine` async guidance). They are dead **override points**: the
settings fallback always wins. For `provider` this means a subagent or
load-balanced request that runs on a different provider than the foreground
`activeProvider` setting resolves its prompt template files against the
*foreground* provider.

No option is passed by exactly one site.

### The `coreMemory` fallback — omitting it does not omit core memory

`resolveEffectiveMemories` (`prompts.ts:537-545`), quoted verbatim:

```ts
  let loadedCoreMemory = coreMemory;
  if (loadedCoreMemory === undefined) {
    try {
      loadedCoreMemory = await loadCoreMemoryContent(process.cwd());
    } catch {
      // Non-fatal: proceed without core memory
    }
  }
```

So `coreMemory: undefined` triggers a two-file `.LLXPRT_SYSTEM` read from
`process.cwd()`, and the result is appended to the prompt by
`prompt-config/prompt-service.ts:296-311` (`appendMemoryContent`). Consequences:

- Sites 3 and 5 omit `coreMemory` yet **still deliver core memory** to the
  model, via disk read rather than via `Config`.
- `Config.getCoreMemory()` returns `undefined` when JIT context is disabled
  **or** when no `contextManager` is present
  (`packages/core/src/config/configBase.ts:86-91` — the guard is
  `if (this.getJitContextEnabled() && this.contextManager)`). So sites 1, 2 and 4
  also hit the disk-read path in those configurations, and the comments at
  `subagentRuntimeSetup.ts:833` and `executor.ts:907-909` claiming the explicit
  pass "avoids the per-call two-file disk read" were only true when JIT is
  enabled. Because sites 1 and 2 assemble per turn, that is a two-file read per
  turn, not per session.
- `mcpInstructions` is merged into `effectiveCoreMemory`
  (`prompts.ts:565-570`), so MCP instructions ride the core-memory channel on
  every path including compression.

### `model.allMemoriesAreCore`

`prompts.ts:549-563` folds user memory into core memory and clears
`effectiveUserMemory` when the setting is true. It applies uniformly to all five
sites and drops the `---` separator that `appendMemoryContent` would otherwise
emit. No site is affected surprisingly.

### JIT memory is applied at exactly one site

Only `ChatSessionFactory.ts:123-131` appends `getJitMemoryForPath(...)`. When
JIT is enabled it also deliberately chooses `getGlobalMemory()` — which excludes
environment memory — instead of `getUserMemory()`.

`subagentRuntimeSetup.ts:836` uses `config.getUserMemory()`, which under JIT
returns `globalMemory + environmentMemory`
(`packages/core/src/config/config.ts:509-519`). Two consequences for subagents:

1. Subagents never receive JIT subdirectory `LLXPRT.md` content that the main
   agent receives.
2. `environmentMemory` already contains MCP instructions
   (`packages/core/src/services/contextManager.ts:62-64`), and
   `subagentRuntimeSetup.ts:838` passes `mcpInstructions` again, so under JIT the
   MCP instruction block is delivered twice — once inside user memory, once
   inside core memory.

## 3. Reachability

Sites 1, 2, 3 and 5 are reachable. Site 4 is not.

`AgentExecutor` (`packages/agents/src/agents/executor.ts:132`) is instantiated
only by `SubagentInvocation.execute()`
(`packages/agents/src/agents/invocation.ts:112`). `SubagentInvocation` has no
production caller: no code constructs it outside its own test, and no dynamic
import or string-keyed registry reaches it.

It *is* however re-exported from a barrel —
`packages/agents/src/internals.ts:65-66`:

    export * from './agents/invocation.js';
    export * from './agents/executor.js';

and `packages/agents/package.json` publishes `./internals.js` as a package
subpath. So both symbols are part of a **published API surface**, guarded by
`scripts/check-agents-api-surface.ts` in CI. A plain identifier grep cannot see
an `export *`, which is why this must be checked explicitly.

The reachability verdict stands — nothing *calls* them — but "unreachable" means
in-repo only, and the practical consequence is that removal is an API-surface
change, not a private cleanup.

**Name-collision warning.** `packages/a2a-server` implements an unrelated
`AgentExecutor` **interface** imported from `@a2a-js/sdk/server`
(`a2a-server/src/http/app.ts:11`), and constructs a `CoderAgentExecutor`
(`app.ts:175`) that implements it. That type is live and has nothing to do with
`packages/agents/src/agents/executor.ts`. Both automated reviewers on this PR
conflated the two and reported the class as reachable, so any future analysis of
this area should disambiguate by import path rather than by name.

Therefore the following are unreachable: `SubagentInvocation`, `AgentExecutor`,
`AgentExecutor.buildSystemPrompt`, the `getCoreSystemPromptAsync` call at
`executor.ts:910`, and the helpers in
`packages/agents/src/agents/executor-prompt-builder.ts` whose only caller is
`executor.ts`. Precedent for dead code in this area: #3142. Removal is already
tracked by **#3152**, which predates this audit and covers the same surface
including the `internals.ts` re-exports and the API-surface guard.

`subagentRuntimeSetup.ts` and `executor.ts` are two *independent* subagent
prompt builders, not one calling the other. The live `task` tool path is
`subagentRuntimeSetup.ts`. They do not produce the same prompt (different
section order, different tool derivation), so the dead path is also a divergent
path.

## 4. Placement inventory

| Path | Field on the wire | Role | Wrapping | Above or inside history | Constraint |
| --- | --- | --- | --- | --- | --- |
| gemini | top-level `systemInstruction` | — | none | above | external |
| openai chat completions | `messages[0]` | `system` | none | element 0 of `messages`, above all turns | external |
| openai-responses (incl. Codex mode) | top-level `instructions` | — | none | above | external |
| openai-vercel | SDK `system` option | — | none | above | internal SDK mapping onto an external role |
| anthropic, API key | top-level `system` (string or cache block) | — | none | above | external |
| anthropic, OAuth (`claudecode`) | `messages[0]`; `system` carries **only** the Claude Code string | `user` | `<system>…</system>` + boundary line | **inside** `messages` | external and non-negotiable |

Anthropic under OAuth is the only path that places the assembled prompt inside
conversation history, and it does so because the vendor rejects any other
content in the `system` field. There is no separate Codex provider; Codex is a
base-URL mode of openai-responses
(`openai-responses/openAIResponsesExecutor.ts:423`, `isCodexBaseURL`) and uses
the same `instructions` placement.

`formatContextPrefix` (`utils/systemPromptPlacement.ts:49-51`, now 59-61) is the
sole producer of the `<system>` wrapper and of `CONTEXT_PREFIX_BOUNDARY`. Its
only production caller is `AnthropicRequestPreparation.ts:301`. No other file
builds an equivalent wrapper. Format ownership is genuinely single.

## 5. The declared-placement contract is not wired

This is the principal finding.

As merged by #3148, `utils/systemPromptPlacement.ts:7-19` stated the intended
contract — "Providers now DECLARE a capability; this module DECIDES and formats"
— and `IProvider.ts:138-140` stated "Providers must not re-derive placement from
transport details." Both sentences described a wiring that does not exist; this
branch replaced them with an accurate description of the current state, so the
originals are visible in `git show b45e8cdd7` rather than in the tree.

Neither half of that contract is consumed in production:

- `resolveSystemPromptPlacement` (`utils/systemPromptPlacement.ts:61`, now 73) —
  zero production callers. Only its definition and `systemPromptPlacement.test.ts`
  reference it.
- `getSystemPromptPlacement` — declared at `IProvider.ts:145` (now 151),
  implemented at `anthropic/AnthropicProvider.ts:383`, zero production callers.
- The live decision is still `if (params.isOAuth)` at
  `anthropic/AnthropicRequestPreparation.ts:367`, dispatching to
  `buildOAuthSystemContext` or `buildNonOAuthSystemContext`.

So placement is still inferred ad-hoc from a local `isOAuth` flag — the exact
defect class #3162 was opened about. #3148 added the declaration and the decider
but never connected them to the request path.

### The two mechanisms use different predicates and can disagree

- Live transport: `AnthropicProvider.ts:636` sets
  `isOAuth = prepared?.isOAuth ?? this.classifyOAuthToken(authToken)` where
  `authToken` has already been resolved to a string by `resolveClientAuthToken`
  (`AnthropicProvider.ts:188-221`), and `classifyOAuthToken`
  (`AnthropicProvider.ts:128`) tests `authToken.startsWith('sk-ant-oat')`.
- Dead declaration: `getSystemPromptPlacement` (`AnthropicProvider.ts:383-399`)
  reads the *unresolved* `options.resolved?.authToken`; when it is not a string
  it returns `context-prefix` for any structural `RuntimeAuthTokenProvider`
  without resolving or prefix-checking it.

So one predicate inspects a resolved token's prefix and the other inspects an
object's shape. A `RuntimeAuthTokenProvider` whose `provide()` returns a
non-`sk-ant-oat` token (for example an `sk-ant-api` gateway key) makes the
declaration say `context-prefix` while the transport does `system-field`.
Nothing in the type system or in `resolveClientAuthToken` constrains what
`provide()` may return, so the divergence is constructible from the code as
written.

It cannot fire today, but not for the reason the provider's own comment at
`AnthropicProvider.ts:392-395` implies. There is **no production producer of a
`RuntimeAuthTokenProvider` anywhere in the tree**: the only `provide:`
implementations are the two interface declarations
(`packages/core/src/runtime/contracts/RuntimeProviderChat.ts:46`,
`packages/providers/src/types/providerRuntime.ts:8`) and a test
(`packages/providers/src/retryAuthTokenResolver.test.ts`). Production OAuth
tokens arrive as plain strings, which both predicates handle identically. The
provider-object branch of `getSystemPromptPlacement` is therefore unexercised
code whose behaviour has never been observed.

Wiring the contract up as-is would activate that unexercised branch. Reconcile
the predicates first.

## 6. Guards

### Fail-fast on a missing instruction — complete

`requireAssembledSystemInstruction` (`utils/systemPromptPlacement.ts:89`) is
called at the top of every real completion entry point:
`gemini/GeminiProvider.ts:385`, `openai/OpenAIProvider.ts:420`,
`anthropic/AnthropicProvider.ts:617`,
`openai-vercel/OpenAIVercelProvider.ts:177`,
`openai-responses/openAIResponsesExecutor.ts:220`.

Those five are the only `generateChatCompletionWithOptions` implementations in
production. Every other `IProvider` implementation is a decorator or router that
holds no guard of its own and preserves `systemInstruction` by object spread:

- `OpenAIResponsesProviderCore.generateChatCompletionWithOptions` routes
  unconditionally through the guarded executor.
- `LoadBalancingProvider` (`LoadBalancingProvider.ts:349`) delegates to one of
  the five, preserving the instruction via the `...options` spread in
  `loadBalancing/resolvedOptionsBuilder.ts:82` (the file never names
  `systemInstruction`; preservation is implicit in the spread).
- `RetryOrchestrator.ts:146`, `LoggingProviderWrapper.ts:79`, and
  `packages/agents/src/core/CompressionLoadBalancingProvider.ts:28` — the last of
  which sits on the compression path discussed in §7.3 and lives outside the
  provider package entirely — all likewise spread (`CompressionLoadBalancingProvider.ts:112-113`).
- `FakeProvider` is a test double.

The conclusion holds, but note that "every entry point" is a property of five
implementations plus five spread-preserving decorators, not of a single
chokepoint. A decorator that constructed a fresh options object instead of
spreading would silently drop the instruction and no guard would catch it,
because the guard lives downstream of the decorators.

Consequently every `options.systemInstruction ?? ''` fallback in the transport
layer is unreachable on a real request path; each is reachable only from
projection, which is exempt by design.

### Structural guard against a second assembler — exists

`eslint.config.js:1232-1249` restricts imports of `getCoreSystemPromptAsync`
from `@vybestack/llxprt-code-core/core/prompts.js` for
`packages/providers/src/**`, and runs in CI via the `lint_javascript` job. The
comment at `compression/compressionSystemPrompt.ts:20-22` describing this as "a
future no-restricted-imports guard" is stale; the guard was added.

Its limits: it matches only a static import of that one name from that one
module path. A dynamic `await import(...)`, a re-export through an intermediate
module, or a passed function reference would not be caught. Nothing enforces the
*placement* half of the architecture at all, which is how §5 arose.

## 7. Preservation constraints

1. **Anthropic OAuth prompt must not be lost.** Satisfied.
   `buildAnthropicSystemPrompt` (`anthropic/AnthropicRequestBuilder.ts:172-197`;
   the OAuth return is at 179) returns the required Claude Code string
   unconditionally under OAuth, and the real prompt is unshifted as `messages[0]`
   at `AnthropicRequestPreparation.ts:295-317`. Pinned byte-for-byte by
   `AnthropicProvider.systemPrompt.characterization.test.ts`.

   **The protecting mechanism is weaker than it looks.** That test is the only
   tripwire for this constraint, and it mocks the module it is protecting:
   `AnthropicProvider.systemPrompt.characterization.test.ts:50-51` does
   `vi.mock('@vybestack/llxprt-code-core/core/prompts.js', ...)` returning a
   fixed `MOCK_CORE_PROMPT`. It therefore pins the *placement and wrapper shape*
   but asserts nothing about the real assembled prompt, and a change made
   consistently across mock and builder would pass. Tracked as F1 in §10.

2. **Prefix caching, memory above history, memory as a system directive.**
   Satisfied, with one wording correction to the constraint as stated.

   Memory is at the top of the *request* — above conversation history — but it is
   at the *end of the system prompt*, not the top of it.
   `prompt-service.ts:296-311` starts from `basePrompt` and appends: core memory
   with no separator, then user memory after a `---` separator. So the order
   within the system prompt is `[base prompt, core memory, user memory]`.

   That ordering is what makes the prefix cacheable: the invariant part (the base
   prompt) comes first and the volatile part (memory) last, so a memory edit
   invalidates only the tail. Putting memory literally first would invalidate the
   whole prefix on every memory change. `cache_control` is attached at
   `AnthropicRequestPreparation.ts:304-317` (OAuth) and
   `AnthropicRequestBuilder.ts:186-194` (non-OAuth).

   Every provider except Anthropic-under-OAuth delivers the prompt in a real
   system field, so memory is a system directive and is never injected into
   conversation history. Anthropic-under-OAuth is the vendor-forced exception
   (§4). Any change to prompt content, section order, or the position of the
   `cache_control` block invalidates the cacheable prefix.

3. **`LLXPRT.md` should probably not be in the compression prompt.** Satisfied as
   literally stated — user memory is excluded. But the adjacent content is not.

   `compressionSystemPrompt.ts:63` passes neither `userMemory` nor `coreMemory`.
   Omitting the argument does not omit the content: because `coreMemory` is
   `undefined`, `resolveEffectiveMemories` reads `.LLXPRT_SYSTEM` from disk
   (`prompts.ts:537-545`) and `appendMemoryContent` appends it. Net effect today:

   | Content | Reaches the compression LLM |
   | --- | --- |
   | user memory (`LLXPRT.md`) | no — the stated constraint holds |
   | core memory (`.LLXPRT_SYSTEM`) | **yes** |
   | MCP instructions | **yes**, via the `mcpInstructions` merge into `effectiveCoreMemory` (`prompts.ts:565-570`) |

   So the finding is narrower than "memory is in the compression prompt": it is
   that `.LLXPRT_SYSTEM` and MCP instructions arrive *unintentionally*, through a
   fallback the caller cannot opt out of by omission. Whether they should be
   there is a decision for #3174; suppressing them requires an explicit empty
   value, which is a behaviour change and out of scope here.

## 8. Input-coverage gaps

Which inputs are lost if a site is removed, and what must be true first:

| Site | Unique inputs it contributes | If removed |
| --- | --- | --- |
| 1 ChatSessionFactory | JIT subdirectory memory; `getGlobalMemory()` selection under JIT | main agent loses JIT memory; no other site supplies it |
| 2 subagentRuntimeSetup | `interactionMode: 'subagent'` with subagent tool list; persona join | subagents lose subagent-mode rendering and persona (#2410) |
| 3 clientLlmUtilities | nothing unique | auxiliary calls would need an assembled instruction from elsewhere or they hit the fail-fast guard |
| 4 executor (dead) | nothing reachable | no effect |
| 5 compression | nothing unique | all three compression call sites would throw at the guard |

The historical trap named in the issue is closed: `subagentRuntimeSetup.ts`
passes both memories. The remaining comparable case is the inverse — a site
whose prompt contains *more* than intended because the disk-read fallback
supplies it silently. That applies to sites 3 and 5, and it is the mechanism
behind §7.3.

## 9. Architecture decision record

### 9.1 Assessment of the current state

Assembly ownership **holds**: one layer (`packages/agents`) assembles, providers
transport verbatim, a fail-fast guard covers every completion entry point, and a
lint rule mechanically prevents a provider-side assembler. That is the substance
of #3136 and it is genuinely in place.

It is one *layer*, not one *function*: five call sites build the options object
and they diverge on `userMemory` derivation (§2). Those divergences are not the
duplication defect #3136 fixed; they are per-site omissions.

Placement ownership **does not hold**: the declaration and the decider exist and
are unreachable, the decision is still ad-hoc, and the two OAuth predicates can
disagree (§5). Nothing enforces the placement half the way the lint rule
enforces the assembly half.

### 9.2 Decision: keep the layer owner, add a memory-derivation owner, finish placement

**Do not consolidate the five call sites into one function.** They are
legitimately distinct: they differ in tool set, interaction mode, persona
presence, and model source, and §8 shows each live one contributes something no
other supplies. Merging them would produce a function with a mode switch per
caller, which is the shape that made the original defect hard to see.

The single owner is the **layer**, and the boundary is already the right shape.

**Boundary contract (exists, keep as-is).**
`SystemPromptAssembler.assemble(model): Promise<string>`
(`packages/agents/src/core/chatSession.ts:123-125`) is the contract. Properties
worth stating explicitly because they are currently implicit:

- The agent layer owns assembly; the return value is the complete prompt.
- Providers receive it as `options.systemInstruction` and transport it verbatim.
- Providers must not read `options.userMemory`; that channel is vestigial (§1)
  and should be removed rather than left as a second, contradictory path.
- The assembler is invoked once per turn, before the send, so the rendered model
  always matches `body.model`.

**What is actually missing is an owner for memory derivation.** `userMemory` and
`coreMemory` are derived independently at each call site, and that is where D2,
D4, D5 and D7 all come from. Introduce one function that answers "what memory
does *this* request get", parameterised by execution context (main / subagent /
auxiliary / compression) rather than by call site, and have all five sites call
it. That function is also the correct home for the JIT decision and for making
"no core memory" expressible, which #3174 needs.

**Declared placement (finish the half that exists).** Providers keep declaring
via `IProvider.getSystemPromptPlacement`; the request path must consume it
through `resolveSystemPromptPlacement` instead of branching on a local flag.
`formatContextPrefix` already single-owns the format and needs no change.

**Structural guards.** One exists for assembly; two are missing:

1. A `no-restricted-imports`-style rule, or an architecture test, that fails if
   any file under `packages/providers/src` other than
   `utils/systemPromptPlacement.ts` branches on an OAuth flag to choose
   placement. The assembly rule at `eslint.config.js:1232-1249` is the precedent.
2. A test asserting that `resolveSystemPromptPlacement` has at least one
   production caller. The failure mode this audit found is not a wrong decision
   but an *unreached* one, and no existing guard can detect that — a lint rule
   cannot see absence of use. Note also that the assembly rule matches only a
   static import of one name from one path, so it would not catch a dynamic
   import or a re-export; `packages/core/src/index.ts:104` re-exports
   `getCoreSystemPromptAsync` today.

### 9.3 Preconditions before any code moves

1. The Anthropic OAuth characterization test must stop mocking the prompt module
   for at least one case, so it pins real assembled output and not only wrapper
   shape (F1). Until then it cannot be relied on as the tripwire for a placement
   change.
2. The two OAuth predicates must be reconciled on the resolved token **before**
   the declaration is consumed (§5). Wiring first activates an unexercised branch.
3. A characterization test must capture the current compression system
   instruction, so #3174 can prove what it removed.
4. The memory-derivation owner must be in place before the divergent subagent
   path is deleted (§3, #3152), so the surviving path is the corrected one.

## 10. Findings

Behaviour defects, ranked. None are fixed by this issue; each is filed as
follow-up work because the acceptance criteria forbid behaviour change here.

| # | Severity | Finding | Location | Filed as |
| --- | --- | --- | --- | --- |
| D1 | High | Declared-placement contract unwired: decider and declaration have zero production callers; placement still inferred from `isOAuth`. Wiring it as-is is unsafe because the two predicates disagree for a `RuntimeAuthTokenProvider` returning a non-`sk-ant-oat` token. | `utils/systemPromptPlacement.ts:61`, `IProvider.ts:145`, `AnthropicProvider.ts:383`, `AnthropicRequestPreparation.ts:367` | #3172 |
| D2 | High | Subagents never receive JIT subdirectory memory that the main agent receives. | `subagentRuntimeSetup.ts:836` vs `ChatSessionFactory.ts:123-131` | #3173 |
| D3 | Medium | `.LLXPRT_SYSTEM` and MCP instructions reach the compression LLM although the assembler passes neither, because omission triggers a disk-read fallback the caller cannot opt out of. `LLXPRT.md` is correctly excluded, so the owner's constraint as literally stated is met; the defect is the unintended adjacent content. Prioritised first in §11 despite the severity because the owner raised it. | `compressionSystemPrompt.ts:63`, `prompts.ts:537-545`, `prompts.ts:565-570` | #3174 |
| D4 | Medium | Under JIT, MCP instructions are delivered twice in the subagent prompt — inside user memory and inside core memory. | `subagentRuntimeSetup.ts:836-838`, `contextManager.ts:62-64` | #3173 |
| D5 | Medium | `provider` is never passed, so prompt-template resolution always uses the foreground `activeProvider`, which is wrong for a subagent or load-balanced request on another provider. | `prompts.ts` `resolveProvider`, `prompt-config/prompt-resolver.ts` | #3176 |
| D6 | Medium | Unreachable subagent prompt path: `SubagentInvocation` / `AgentExecutor` / `executor-prompt-builder.ts` have no production caller and diverge from the live path in section order and tool derivation. Removal is an API-surface change because `internals.ts:65-66` re-exports both and the subpath is published. | `invocation.ts:36`, `executor.ts:132`, `executor.ts:910`, `internals.ts:65-66` | already tracked by **#3152** |
| D7 | Low | `clientLlmUtilities` omits `coreMemory`, adding a two-file disk read per auxiliary LLM call. | `clientLlmUtilities.ts:34` | #3176 |
| D8 | Low | Compression `interactionMode` is derived from foreground `isInteractive()` and is never `'subagent'`, even when compressing a subagent's history. | `compressionSystemPrompt.ts:56-61` | #3176 |
| D9 | Low | Vestigial provider-side memory channel: `NormalizedGenerateChatOptions.userMemory` is populated on every request and read by no production provider; `providers/src/utils/userMemory.ts` `resolveUserMemory` has zero production callers. A second, contradictory memory path. | `IProvider.ts:78`, `runtimeNormalizer.ts:475-527`, `BaseProviderNormalization.ts:299-301`, `utils/userMemory.ts:22` | #3176 |

Test-coverage weaknesses that undermine the guarantees above:

| # | Severity | Finding | Location |
| --- | --- | --- | --- |
| F1 | Medium | The sole tripwire for the Anthropic-OAuth preservation constraint mocks the prompt module it protects, so it pins wrapper shape but asserts nothing about real assembled output. A coordinated change to mock and builder passes. This is the test that any placement work in #3172 would rely on. | `AnthropicProvider.systemPrompt.characterization.test.ts:50-51` |

Documentation drift — comments that assert something the code does not do.
These are corrected by this issue because they are comment-only.

| # | Drift | Location |
| --- | --- | --- |
| C1 | Module header claims providers declare and this module decides; nothing consumes either. | `utils/systemPromptPlacement.ts:7-19` |
| C2 | Interface doc claims the shared policy consumes the declaration. | `IProvider.ts:135-144` |
| C3 | "Replicates the provider's `getCoreSystemPromptAsync` **arguments** exactly: no `coreMemory` (matches current provider behavior)" was true of the argument list but invited the false inference that core memory is therefore excluded. Replaced with an explicit statement of what is and is not delivered. | `compressionSystemPrompt.ts:31-42` |
| C4 | Describes the pre-#3148 world as current ("Today the three compression call sites ... omit `systemInstruction`. The provider then rebuilds a core prompt"). | `compressionSystemPrompt.ts:7-23` |
| C5 | "a future `no-restricted-imports` guard" — the guard exists. | `compressionSystemPrompt.ts:20-22` |
| C6 | "passed explicitly to avoid the per-call two-file disk read" — untrue when JIT is disabled, because `getCoreMemory()` returns `undefined`. | `subagentRuntimeSetup.ts:830-834`, `executor.ts:904-909` |

## 11. Safe ordering for any consolidation or placement work

1. **#3174 (D3) first and separately.** It is the only finding where current
   behaviour sends content that is not wanted, and it is independent of
   everything else.
2. **#3172 (D1): reconcile the OAuth predicate before wiring the contract.**
   Wiring first would change Anthropic placement for any non-`oat`
   `RuntimeAuthTokenProvider` and produce vendor rejections. Reconcile on the
   resolved token, then wire, then keep the characterisation test as the
   tripwire.
3. **#3173 (D2 and D4) together.** Both stem from the subagent path choosing
   `getUserMemory()` where the main path chooses `getGlobalMemory()` plus JIT;
   changing one without the other trades a missing input for a doubled one.
4. **#3152 (D6) after #3173**, so the live path is the corrected one at the point
   the divergent copy is removed. Treat it as an API-surface removal, not a
   private cleanup.
5. **#3176 (D5, D7, D8, D9)** independently; it touches request-scoped values and
   a vestigial channel rather than prompt content.

F1 is a precondition of step 2, not a step of its own (§9.3).

Treat the memory-sourcing rule as the thing to centralise, not the call sites.
The five sites are legitimate; the duplicated and divergent *derivation* of
`userMemory` / `coreMemory` is the remaining unowned policy.
