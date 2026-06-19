<!-- @plan:PLAN-20260617-COREAPI.P28 @requirement:REQ-020 -->

# Agent API

The Agent API is the public, embeddable surface for driving an LLxprt agent
from your own code — without the CLI. You create an agent, send it input, and
consume a typed event stream. The same primitives the CLI uses are exposed as a
curated, stable contract so you can build chat loops, automation, and custom
front-ends on top of LLxprt.

## Entry Package

The public Agent API is exported from **`@vybestack/llxprt-code-agents`** — _not_
from `@vybestack/llxprt-code-core`.

This is deliberate. The agent runtime, chat loop, and orchestration live in the
`agents` package, which _depends on_ `core`. Re-exposing the public API from
`-core` would imply a `core → agents` dependency and create an import cycle.
Consumers import the agent surface from the package that actually owns it:

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';
```

Install it the same way you would any other dependency:

```bash
npm install @vybestack/llxprt-code-agents
```

### Subpaths at a glance

The package exposes three import specifiers, each with a distinct stability
contract:

| Specifier                                      | Purpose                                                                            | Stability                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| `@vybestack/llxprt-code-agents`                | The curated public Agent API (this guide).                                         | Stable / semver-covered.                           |
| `@vybestack/llxprt-code-agents/app-service.js` | Durable, config/app-service functions + `COMMAND_API_MAP`. No live `Agent` needed. | Stable / semver-covered.                           |
| `@vybestack/llxprt-code-agents/internals.js`   | Power-user / low-level primitives (chat session, scheduler, orchestrator, etc.).   | **Unstable** — may change without a major version. |

The root entry is **non-breaking and additive**: it currently re-exports the
low-level `internals.js` symbols alongside the new public Agent API, so no
existing import breaks today. A future release (#1595) will trim the root barrel
down to only the curated Agent API; until then, prefer importing low-level
symbols from `./internals.js` explicitly so your code keeps working after the
trim.

## Quick Start

The quickest way to get a **runnable** snippet is the shipped `'fake'` provider,
which replays responses from a JSONL fixture instead of calling a real model.
The `FakeProvider` is registered automatically when the `LLXPRT_FAKE_RESPONSES`
environment variable points to a fixture file:

```bash
export LLXPRT_FAKE_RESPONSES=/path/to/fixture.jsonl
```

With that set, `provider: 'fake'` becomes a fully working provider and the
example below runs end-to-end:

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({
  provider: 'fake',
  model: 'fake-model',
});

try {
  for await (const event of agent.stream({ text: 'Write me a haiku.' })) {
    switch (event.type) {
      case 'text':
        process.stdout.write(event.text);
        break;
      case 'tool-call':
        console.log(`\n[tool-call] ${event.call.name}`, event.call.args);
        break;
      case 'done':
        // Exactly one terminal `done` ends every stream.
        console.log(`\n[done] reason=${event.reason}`);
        break;
      default:
        // 'thinking', 'usage', 'notice', ... — see the AgentEvent union.
        break;
    }
  }
} finally {
  await agent.dispose();
}
```

For real work, swap `provider: 'fake'` for an actual provider (e.g.
`'openai'`, `'anthropic'`, `'gemini'`) and supply credentials via the `auth`
field (see [Authentication](#authentication-and-precedence)). The rest of the
loop is identical — the event stream contract does not change between providers.

> **Always `dispose()`.** An agent owns a runtime context, a message bus, and
> tool schedulers. Call `await agent.dispose()` (e.g. in a `finally`) to tear
> these down deterministically.

## `createAgent` and `AgentConfig`

```ts
export async function createAgent(rawConfig: AgentConfig): Promise<Agent>;
```

`createAgent` validates the config, builds an isolated runtime context with a
single shared message bus, activates the provider/model, resolves auth, and
returns a ready-to-use `Agent`. It is `async` — always `await` it.

### Required fields

| Field      | Type     | Description                               |
| ---------- | -------- | ----------------------------------------- |
| `provider` | `string` | Provider name, e.g. `'fake'`, `'openai'`. |
| `model`    | `string` | Model id for that provider.               |

### Commonly used optional fields

| Field                 | Type                                | Description                                                         |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| `modelParams`         | `Readonly<Record<string, unknown>>` | Provider/model knobs (temperature, etc.).                           |
| `auth`                | `AgentAuth`                         | Credentials — see [Authentication](#authentication-and-precedence). |
| `tools`               | `readonly string[]`                 | Allow-list of tool names to enable.                                 |
| `excludeTools`        | `readonly string[]`                 | Tools to exclude.                                                   |
| `mcpServers`          | `Record<string, MCPServerConfig>`   | MCP servers to wire at startup.                                     |
| `approvalMode`        | `ApprovalMode`                      | Tool-confirmation policy.                                           |
| `systemPrompt`        | `string`                            | System instruction.                                                 |
| `workingDir`          | `string`                            | Workspace root for file tools.                                      |
| `sessionId`           | `string`                            | Stable runtime id (defaults to a generated one).                    |
| `sandbox`             | `SandboxConfig`                     | Sandbox configuration (see below).                                  |
| `hooks`               | `AgentHooks`                        | Lifecycle hooks keyed by event name.                                |
| `streamIdleTimeoutMs` | `number`                            | Idle-timeout for a stream turn.                                     |
| `onApproval`          | `ApprovalHandler`                   | Callback invoked for tool confirmations.                            |
| `onOAuthPrompt`       | `OAuthPromptHandler`                | Callback invoked when an OAuth flow needs the user.                 |
| `editorCallbacks`     | `EditorCallbacks`                   | Hooks for opening/closing an external editor.                       |

`AgentConfig` carries many more long-tail fields (telemetry, compression,
recording, file filtering, policy, extensions, skills, IDE mode, etc.). See the
full interface in
[`packages/agents/src/api/config-types.ts`](../packages/agents/src/api/config-types.ts).

### Field classification

Most `AgentConfig` fields are **declarative** — the adapter
(`toConfigParameters`) maps them onto the core `ConfigParameters` object that
builds the runtime. A few fields are **callbacks/factories** that are NOT part
of the serializable config and are stripped before schema validation
(`AgentConfigSchema` is `.strict()` and rejects function-typed fields):

- `onApproval`, `onOAuthPrompt`, `editorCallbacks`, `toolSchedulerFactory`.

These are threaded directly into the agent's runtime wiring rather than into
`ConfigParameters`.

### The unstable `settings` escape hatch

```ts
readonly settings?: Readonly<Record<string, unknown>>;
```

`settings` is an **UNSTABLE** escape hatch for long-tail config not yet promoted
to a typed `AgentConfig` field. Its contents are merged into `ConfigParameters`
by the adapter, and it **throws** if a key shadows a typed field. It is **not
semver-covered** and may change without notice — prefer typed fields whenever
one exists.

### Sandbox

`sandbox?: SandboxConfig` configures process/file sandboxing for tool execution.
The type is re-exported from core; see the
[sandbox documentation](./sandbox.md) for the full configuration shape.

## The `Agent` Control Plane

An `Agent` is the live runtime facade. It exposes top-level methods for sending
turns and switching provider/model/params, plus seven `readonly` sub-surfaces
for focused control. See
[`packages/agents/src/api/agent.ts`](../packages/agents/src/api/agent.ts) for the
full interface.

### Top-level: turns

| Method                                  | Description                                                             |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `stream(input, opts?)`                  | Returns an `AsyncIterable<AgentEvent>` — the streaming turn.            |
| `chat(input, opts?)`                    | Buffers a turn into an `AgentResult` (text + toolCalls + finishReason). |
| `generate(input, opts?)`                | One-shot text generation returning a `string`.                          |
| `generateJson(contents, schema, opts?)` | Schema-constrained JSON generation.                                     |
| `generateEmbedding(texts)`              | Returns embedding vectors.                                              |

`input` is an `AgentInput`: either a `string` or
`{ text: string; role?: 'user' | 'system' }`. `opts` (`TurnOptions`) may carry
`signal` (an `AbortSignal`), `promptId`, `maxTurns`, and `mcpDiscovery`.

### Top-level: provider / model / params

| Method                                                                    | Description                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `getProvider()` / `setProvider(provider, model?)`                         | Read / switch the active provider (preserves context).              |
| `getModel()` / `setModel(model)`                                          | Read / switch the active model (preserves context).                 |
| `getProviderStatus()`                                                     | Returns `ProviderStatus` (provider, model, authStatus, baseUrl, …). |
| `getModelParams()` / `setModelParam(key, value)` / `clearModelParam(key)` | Read / mutate model params (lazy; no rebuild).                      |
| `getUserTier()`                                                           | Returns the provider user tier, if known.                           |
| `getCurrentSequenceModel()`                                               | Current load-balancer sequence model, or `null`.                    |

### Top-level: history & stats

`getHistory` / `setHistory` / `addHistory` / `restoreHistory` / `resetChat`
manage conversation history. `compress(opts?)` runs context compression and
returns a `CompressionResult`. `getStats()` returns `SessionStats` and
`onStats(cb)` subscribes to updates. `listProviders()` / `listTools()` are the
instance-scoped discovery helpers.

> **Stats source.** Session statistics are projected from the in-process
> `uiTelemetryService` singleton
> (`@vybestack/llxprt-code-core/telemetry/uiTelemetry.js`) combined with the
> per-agent `HistoryService`. This is the same source the CLI renders.

### Sub-surfaces

All seven are exposed as `readonly` properties on the `Agent`:

#### `agent.profiles` — `AgentProfileControl`

Runtime-side profile operations on the live agent: `list()`, `get(name)`,
`getDefault()`, `apply(name)` (rebinds the live runtime), `setDefault(name)`,
`create(name, detail)`, `saveCurrent(name)`, `delete(name)`.

> **Durable note.** Persisting/listing/deleting profiles on _disk_ is a durable
> concern also available on the [`app-service.js`](#runtime-vs-app-service)
> subpath (`saveCurrentProfile`, `listProfiles`, `deleteProfile`).

#### `agent.tools` — `AgentToolControl`

Live tool registry + confirmation wiring: `list()`, `setEnabled(names)`,
`onConfirmationRequest(cb)`, `respondToConfirmation(confirmationId, decision)`,
`onToolUpdate(cb)`, `setEditorCallbacks(cbs)`.

#### `agent.mcp` — `AgentMcpControl`

**Runtime-only** view of MCP servers: `listServers()`, `status()`,
`toolsByServer()`, `auth(server)`, `discoveryState()`, `refresh(server?)`.

> **Runtime-only.** `agent.mcp` reflects the _live_ connection set. Durable
> MCP server add/remove is **not** here — it lives on the
> [`app-service.js`](#runtime-vs-app-service) subpath (`addMcpServer`,
> `removeMcpServer`).

#### `agent.auth` — `AgentAuthControl`

Provider authentication: `login(provider, opts?)`, `logout(provider, opts?)`,
`status(provider?)`, `enableOAuth(provider)`, `disableOAuth(provider)`,
`listBuckets(provider?)`, `switchBucket(provider, bucket)`, `mcpLogin(server)`,
`setBaseUrl(baseUrl, opts?)`, and a nested `keys` control
(`AgentAuthKeysControl`: `list`, `save`, `use`, `delete`, `setRaw`,
`setKeyFile`). See [Authentication](#authentication-and-precedence).

#### `agent.ide` — `AgentIdeControl`

IDE integration: `current()`, `detected()`, `trust(name)`, `status()`,
`openEditor()`, `closeEditor()`.

#### `agent.session` — `AgentSessionControl`

Session lifecycle: `resume(target, options?)`, `createCheckpoint(label?)`,
`restoreCheckpoint(id)`, `listCheckpoints()`, `setRecording(state)`,
`getRecording()`.

#### `agent.hooks` — `AgentHookControl`

Lifecycle hooks: `onHookExecution(cb)`, `triggerSessionStart()`,
`triggerSessionEnd()`, `clear()`.

### `dispose()`

```ts
dispose(): Promise<void>;
```

Tears down the runtime context, message bus, and any injected/owned tool
schedulers. Always call it when finished with an agent.

## The `AgentEvent` Union

Every `stream()` turn yields a sequence of `AgentEvent` values. There are **19**
variants, discriminated by `type`. See
[`packages/agents/src/api/event-types.ts`](../packages/agents/src/api/event-types.ts).

| `type`              | Payload                                             | Terminal?          |
| ------------------- | --------------------------------------------------- | ------------------ |
| `text`              | `text: string`                                      | No                 |
| `thinking`          | `thought: ThoughtSummary`                           | No                 |
| `tool-call`         | `call: AgentToolCall`                               | No                 |
| `tool-result`       | `result: AgentToolResult`                           | No                 |
| `tool-confirmation` | `confirmation: ToolConfirmation`                    | No                 |
| `tool-status`       | `update: ToolUpdate`                                | No                 |
| `usage`             | `usage: UsageMetadataValue`                         | No                 |
| `model-info`        | `info: ModelInfo`                                   | No                 |
| `notice`            | `message: string`                                   | No                 |
| `compression`       | `info: ChatCompressionInfo \| null`                 | No                 |
| `context-warning`   | `estimatedRequestTokenCount`, `remainingTokenCount` | No (precedes done) |
| `retry`             | _(none)_                                            | No                 |
| `citation`          | `citation: string`                                  | No                 |
| `loop-detected`     | _(none)_                                            | No (precedes done) |
| `idle-timeout`      | `error: StructuredError`                            | No (precedes done) |
| `invalid-stream`    | _(none)_                                            | No                 |
| `hook-blocked`      | `info: AgentStopInfo`                               | No                 |
| `error`             | `error: StructuredError`                            | No (precedes done) |
| `done`              | `reason: DoneReason`, `finished?`, `stop?`          | **Yes**            |

> Several non-terminal events _signal_ an upcoming termination by setting the
> pending done reason (e.g. `error` → `done{reason:'error'}`, `loop-detected`
> → `done{reason:'loop-detected'}`, `context-warning` →
> `done{reason:'context-overflow'}`, `idle-timeout` → `done{reason:'error'}`).
> The stream is only _finished_ by the single `done` event.

### `DoneReason` and the exactly-one-`done` invariant

```ts
export type DoneReason =
  | 'stop'
  | 'aborted'
  | 'max-turns'
  | 'context-overflow'
  | 'loop-detected'
  | 'error'
  | 'hook-stopped';
```

**Invariant:** every `stream()`/`chat()` turn yields/returns **exactly one**
terminal `AgentDoneEvent` carrying one of these seven reasons. Errors surface as
an `AgentErrorEvent` **followed by exactly one** `done{reason:'error'}` — the
error event is informational; the `done` is the terminator.

`aborted` and `error` are **distinct** and must be treated differently
(this matters for exit-code mapping in a CLI/automation wrapper):

- `aborted` — the turn was cancelled (e.g. via an `AbortSignal`).
- `error` — the turn failed.

> **Idle-timeout is terminal.** A stream idle-timeout emits an `idle-timeout`
> event and then terminates the turn with `done{reason:'error'}`.

## Tool Confirmations and Safe Denial

Tools that require confirmation surface a `tool-confirmation` event and a
`tool-status` update with `status: 'awaiting-approval'`. To approve/deny, wire a
handler:

- Provide `onApproval` at `createAgent` time, **or**
- Subscribe via `agent.tools.onConfirmationRequest(cb)` and respond with
  `agent.tools.respondToConfirmation(confirmationId, decision)`.

**Wired handler that rejects/throws → safe denial.** When a handler **is**
wired but its promise rejects (or it throws), the loop must not leave the
confirmation unanswered (which would hang the loop). Instead it performs a
**safe denial** — the confirmation is answered with a `Cancel` outcome so the
scheduler cancels the tool and the loop proceeds. See
`AgenticLoop.wireApprovalHandler` (`packages/agents/src/core/agenticLoop/AgenticLoop.ts`,
the handler `.catch` path).

**No handler wired → clear error, not silent success and not silent Cancel.**
When `onApproval` is not provided, `createAgent` leaves `approvalHandler`
undefined, so `AgenticLoop.wireApprovalHandler()` returns a **no-op** — it does
**not** auto-answer `Cancel`. The confirmation therefore cannot be answered:
the agent does **not** silently proceed and does **not** silently deny. In
non-interactive contexts the confirmation coordinator surfaces a structured
error (`"requires user confirmation, which is not supported in non-interactive
mode"`, `packages/agents/src/scheduler/confirmation-coordinator.ts`), which
emits an `AgentErrorEvent` and terminates the turn with exactly one
`done{reason:'error'}`. Callers are expected to wire `onApproval` at
`createAgent` time, or subscribe via `agent.tools.onConfirmationRequest(cb)` and
respond with `agent.tools.respondToConfirmation(confirmationId, decision)`.

> An automatic no-handler safe-denial (auto-`Cancel` when no handler is wired)
> is a possible **future** enhancement, sequenced separately; it is **not**
> shipped today. The shipped semantics are: wired-handler-reject → safe denial,
> no-handler → clear error.

## Authentication and Precedence

Authentication is configured up-front via `AgentConfig.auth` (`AgentAuth`, which
extends `ProviderAuth`) and adjusted at runtime via `agent.auth` and
`agent.auth.keys`. The relevant fields are `apiKey`, `apiKeyFile`, `keyName`,
`baseUrl`, and `oauth`, with optional `profile` and `perProvider` overrides.

### Precedence order (highest → lowest)

The implemented precedence winner is computed in
[`packages/agents/src/api/control/authState.ts`](../packages/agents/src/api/control/authState.ts)
(`computeAuthWinner`):

1. **`raw`** — a raw key set at runtime via `agent.auth.keys.setRaw(value)`.
2. **`keyName`** — a named key reference selected via `agent.auth.keys.use(name)`
   (or seeded from a profile).
3. **`inline`** — an inline `auth.apiKey` supplied in `AgentConfig`.
4. **`keyfile`** — a key file path (`auth.apiKeyFile` / `setKeyFile`).
5. **`oauth`** — an OAuth-authenticated provider.
6. **`none`** — no credential; `authStatus` is `'unauthenticated'`.

`getProviderStatus()` reflects the winner: it surfaces `keyName` **only** when
the winner is `keyName`, and `keyFile` **only** when the winner is `keyfile`.
Secret values are never copied onto status or profile objects — only the
**reference** (name/path) surfaces. In-memory named keys live in a per-agent
store that dies with the agent and never touches disk or the host keychain.

## Context Preservation Across Provider/Model Switch

Switching the provider or model on a live agent **preserves conversation
context** (REQ-005). `setModel(model)` and `setProvider(provider, model?)`:

1. Apply the switch through the real runtime mutators.
2. Re-bind the agent's loop to the **current** client (`rebuildLoop`).
3. Preserve the **same `HistoryService` identity** and the prior history across
   the rebind.

The `HistoryService` is created eagerly at `createAgent` time and stored for
reuse, so the same instance (and the accumulated history) survives a
provider/model switch — the next turn continues the conversation rather than
starting fresh. See
[`packages/agents/src/api/agentImpl.ts`](../packages/agents/src/api/agentImpl.ts)
(`setModel`, `applyProviderSwitch`, `restoreChatVisibility`).

## Runtime vs App-Service

LLxprt distinguishes **runtime** concerns (the live conversation) from
**durable / app-service** concerns (persisted config that outlives any single
run). The boundary is intentional:

- **Runtime** concerns live on the live `Agent` (`agent.setModel`,
  `agent.compress`, `agent.mcp.status`, `agent.tools.list`, …).
- **Durable** concerns live on the
  **`@vybestack/llxprt-code-agents/app-service.js`** subpath as standalone
  functions that do **not** require a live `Agent`.

```ts
import {
  saveCurrentProfile,
  listProfiles,
  deleteProfile,
  addMcpServer,
  removeMcpServer,
  editMemory,
  manageSkills,
  manageExtensions,
  getAbout,
  getDiagnostics,
  mutateSettings,
  COMMAND_API_MAP,
} from '@vybestack/llxprt-code-agents/app-service.js';
```

Durable functions cover: profile save/list/delete, MCP server add/remove, memory
file edits, skill/extension config, settings mutation, and diagnostics/about.

### `COMMAND_API_MAP`

`COMMAND_API_MAP` (re-exported from the `app-service.js` subpath) is the
canonical slash-command → API mapping. Each entry assigns exactly one `kind`:

- `runtime` — a live `Agent` method path (affects the active conversation), e.g.
  `/model` → `agent.setModel`, `/compress` → `agent.compress`,
  `/mcp status` → `agent.mcp.status`.
- `subpath` — a durable app-service function, e.g. `/profile save` →
  `saveCurrentProfile`, `/mcp add` → `addMcpServer`, `/memory edit` →
  `editMemory`.
- `cli-local` — pure UI/UX with no core dependency, e.g. `/help`, `/theme`,
  `/clear`, `/quit`.

The shape of each mapping entry is `{ command, kind, target, exportName?,
note? }`. See
[`packages/agents/src/app-services/command-api-map.ts`](../packages/agents/src/app-services/command-api-map.ts).

## Power-User Subpath: `internals.js`

Low-level primitives — `AgentClient`, `ChatSession`, `CoreToolScheduler`,
`SubagentOrchestrator`, `TaskTool`, turn/subagent types, etc. — are available
from the **`@vybestack/llxprt-code-agents/internals.js`** subpath:

```ts
import {
  ChatSession,
  CoreToolScheduler,
} from '@vybestack/llxprt-code-agents/internals.js';
```

This subpath is **unstable**: it exists so existing CLI/a2a consumers can migrate
off the package root, and it may change without a major-version bump. Build
against the curated public root entry whenever possible; reach into
`internals.js` only when you genuinely need a low-level primitive.

> The package root currently re-exports `internals.js` symbols for backward
> compatibility. A future release (#1595) trims the root to only the public
> Agent API, so importing low-level symbols from `./internals.js` explicitly is
> the forward-compatible choice.

## Recorded Decisions

These decisions shaped the public surface and are recorded here for posterity:

- **Entry wording (B11):** the public API ships from
  `@vybestack/llxprt-code-agents`, never `-core` — avoiding a `core → agents`
  cycle.
- **Control-plane scope:** the seven sub-surfaces (`profiles`, `tools`, `mcp`,
  `auth`, `ide`, `session`, `hooks`) are part of the public contract, alongside
  the top-level turn/provider/model methods.
- **Confirmation handling (B7):** a **wired** approval handler that
  rejects/throws is **safely denied** (`Cancel`) by `AgenticLoop` so the loop
  never hangs. When **no** handler is wired, the agent neither silently proceeds
  nor silently denies — the confirmation is unanswerable and, in non-interactive
  contexts, surfaces a structured error ending in one `done{reason:'error'}`. An
  automatic no-handler safe-denial is a possible future enhancement, not shipped
  today.
- **Idle-timeout is terminal:** a stream idle-timeout ends the turn with
  `done{reason:'error'}`.
- **Stats source:** session stats come from
  `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js` (the in-process
  `uiTelemetryService`).
- **`settings` escape hatch is unstable:** not semver-covered; prefer typed
  fields.
- **`core/index` trim:** the eventual removal of low-level re-exports from the
  package root is sequenced into issue #1595; today the root entry stays
  additive and non-breaking.
