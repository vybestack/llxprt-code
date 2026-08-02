# Agent API Reference

The Agent API is the embeddable surface for driving an LLxprt Code agent from
your own code — without the CLI. You create an agent, send it input, and consume
a typed event stream. The same primitives the `llxprt` CLI uses are available
here so you can build chat loops, automation pipelines, and custom front-ends.

## Purpose, audience, and stability

This page targets **developers embedding an LLxprt Code agent in their own
program**. If you use the `llxprt` command-line tool, see the
[getting started guide](getting-started.md) instead.

The API ships from the **`@vybestack/llxprt-code-agents`** npm package, which is
currently at version **0.x**. Under semver conventions for pre-1.0 packages, a
minor version bump may include breaking changes. The import surfaces break down
as follows:

| Import specifier                               | Stability                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `@vybestack/llxprt-code-agents`                | **Supported.** The curated public Agent API.                                     |
| `@vybestack/llxprt-code-agents/app-service.js` | **Supported.** Durable config functions (no live agent needed).                  |
| `@vybestack/llxprt-code-agents/internals.js`   | **Experimental.** Low-level primitives; may change without a major version bump. |

> **Experimental callout.** The `internals.js` subpath exposes low-level
> primitives (`AgentClient`, `ChatSession`, `CoreToolScheduler`, and similar).
> It exists so existing consumers can migrate off the package root, but it has
> no stability guarantee. Build against the curated root whenever possible.

## Entry package and imports

The public Agent API is exported from **`@vybestack/llxprt-code-agents`** — not
from `@vybestack/llxprt-code-core`. The agent runtime, chat loop, and
orchestration live in the `agents` package, which depends on `core`.

Install it like any other dependency:

```bash
npm install @vybestack/llxprt-code-agents
```

> **Tool-confirmation outcomes.** The `onApproval` handler returns a
> `ToolConfirmationOutcome` value (for example `ProceedOnce` or `Cancel`). That
> enum is defined in **`@vybestack/llxprt-code-tools`** — the agents package
> depends on it and uses it in its own types, but does **not** re-export it. If
> your code references `ToolConfirmationOutcome` directly (as the confirmation
> examples below do), install the tools package as well:
>
> ```bash
> npm install @vybestack/llxprt-code-tools
> ```
>
> Consumers that never name `ToolConfirmationOutcome` directly (for example,
> handlers that return a string literal the enum accepts) do not need it.

Import the primary entry point:

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';
```

## Quick start

The quickest way to get a runnable example is the built-in `'fake'` provider,
which replays responses from a JSONL fixture instead of calling a real model.
The fake provider is registered automatically when the `LLXPRT_FAKE_RESPONSES`
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
        // Exactly one terminal 'done' ends every stream.
        console.log(`\n[done] reason=${event.reason}`);
        break;
      default:
        // 'thinking', 'usage', 'notice', ... — see Events below.
        break;
    }
  }
} finally {
  await agent.dispose();
}
```

For real work, swap `provider: 'fake'` for an actual provider (for example
`'openai'`, `'anthropic'`, `'gemini'`) and supply credentials via the `auth`
field (see [Authentication and precedence](#authentication-and-precedence)).
The event stream contract does not change between providers.

> **Always call `dispose()`.** An agent owns a runtime context, a message bus,
> and tool schedulers. Call `await agent.dispose()` — for example in a `finally`
> block — to tear these down deterministically.

## Configuration: `createAgent` and `AgentConfig`

```ts
export async function createAgent(rawConfig: AgentConfig): Promise<Agent>;
```

`createAgent` validates the config, builds an isolated runtime context,
activates the provider and model, resolves auth, and returns a ready-to-use
`Agent`. It is `async` — always `await` it.

### Required fields

| Field      | Type     | Description                               |
| ---------- | -------- | ----------------------------------------- |
| `provider` | `string` | Provider name, e.g. `'fake'`, `'openai'`. |
| `model`    | `string` | Model id for that provider.               |

### Commonly used optional fields

| Field                          | Type                                   | Description                                                                                                                                                    |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelParams`                  | `Readonly<Record<string, unknown>>`    | Provider/model knobs (temperature, etc.).                                                                                                                      |
| `auth`                         | `AgentAuth`                            | Credentials — see [Authentication and precedence](#authentication-and-precedence).                                                                             |
| `tools`                        | `readonly string[]`                    | Allow-list of tool names to enable.                                                                                                                            |
| `excludeTools`                 | `readonly string[]`                    | Tools to exclude.                                                                                                                                              |
| `mcpServers`                   | `Record<string, AgentMcpServerConfig>` | MCP servers to wire at startup.                                                                                                                                |
| `approvalMode`                 | `ApprovalMode`                         | Tool-confirmation policy.                                                                                                                                      |
| `systemPrompt`                 | `string`                               | System instruction.                                                                                                                                            |
| `workingDir`                   | `string`                               | Workspace root for file tools.                                                                                                                                 |
| `sessionId`                    | `string`                               | Stable runtime id (defaults to a generated one).                                                                                                               |
| `sandbox`                      | `AgentSandboxConfig`                   | Sandbox configuration. See the [sandbox documentation](sandbox.md).                                                                                            |
| `hooks`                        | `AgentHooks`                           | Lifecycle hooks keyed by event name.                                                                                                                           |
| `streamIdleTimeoutMs`          | `number`                               | Idle-timeout for a stream turn.                                                                                                                                |
| `streamFirstResponseTimeoutMs` | `number`                               | First-response (time-to-first-content) watchdog in milliseconds. Default `300000`; `0` or a negative value disables it. A provider liveness signal disarms it. |
| `onApproval`                   | `ApprovalHandler`                      | Callback invoked for tool confirmations.                                                                                                                       |
| `onOAuthPrompt`                | `OAuthPromptHandler`                   | Callback invoked when an OAuth flow needs the user.                                                                                                            |
| `editorCallbacks`              | `EditorCallbacks`                      | Hooks for opening/closing an external editor.                                                                                                                  |

`AgentConfig` carries additional long-tail fields (telemetry, compression,
recording, file filtering, policy, extensions, skills, IDE mode, and more).

### Harness defaults and production gating

`createAgent` is optimized for the embedder/fixture path. By default it applies
three harness gates that make fixtures and interactive embedding convenient but
may be unsuitable for production callers:

| Gate                 | Default | Effect                                                                                       |
| -------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `forceInteractive`   | `true`  | Overwrites `interactive` to `true` so the confirmation coordinator does not throw.           |
| `forceConfirmations` | `true`  | Injects a high-priority ASK policy rule so every tool surfaces a confirmation request.       |
| `includeProcessCwd`  | `true`  | Adds `process.cwd()` to the workspace context so fixture paths resolve within the workspace. |

Production callers can disable any combination through `harness`:

```ts
const agent = await createAgent({
  provider: 'openai',
  model: 'gpt-5.5',
  interactive: false,
  approvalMode: ApprovalMode.DEFAULT,
  harness: {
    forceInteractive: false, // respect caller interactive: false
    forceConfirmations: false, // do not inject the confirmation-forcing rule
    includeProcessCwd: false, // do not mutate workspace with process.cwd()
  },
});
```

When all three are disabled, `createAgent` honors the caller's `interactive` and
`approvalMode` values verbatim, injects no extra policy rules, and leaves the
workspace context untouched.

> **Note.** [`fromConfig`](#adopting-an-existing-config-fromconfig) adopts an
> already-constructed config and never applies these harness gates.

### The `settings` escape hatch

```ts
readonly settings?: Readonly<Record<string, unknown>>;
```

`settings` is an **experimental** escape hatch for long-tail configuration not
yet promoted to a typed `AgentConfig` field. Its contents are merged into the
runtime configuration by the adapter, and it throws if a key shadows a typed
field. It is **not covered by the stability contract** and may change without
notice — prefer typed fields whenever one exists.

## Lifecycle and control-plane operations

An `Agent` is the live runtime facade. It exposes top-level methods for sending
turns, switching provider/model/params, and managing session state, plus
read-only sub-surfaces for focused control.

### Sending turns

| Method                                  | Description                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `stream(input, opts?)`                  | Returns an `AsyncIterable<AgentEvent>` — the streaming turn. Emits a terminal `done` event.              |
| `chat(input, opts?)`                    | Buffers a turn and returns an `AgentResult` (text + toolCalls + finishReason). Does **not** emit events. |
| `generate(input, opts?)`                | One-shot text generation returning a `string`.                                                           |
| `generateJson(contents, schema, opts?)` | Schema-constrained JSON generation.                                                                      |
| `generateEmbedding(texts)`              | Returns embedding vectors.                                                                               |

`input` is an `AgentInput`: a string, an array of content blocks, an
`{ text: string; role?: 'user' | 'system' }` object, or a message object.

`opts` (`TurnOptions`) may carry:

- `signal` — an `AbortSignal` to cancel the turn.
- `maxTurns` — maximum number of agentic turns.
- `mcpDiscovery` — `'await'` or `'skip'`.

### Provider, model, and params

| Method                                                                    | Description                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `getProvider()` / `setProvider(provider, model?)`                         | Read / switch the active provider (preserves context).              |
| `getModel()` / `setModel(model)`                                          | Read / switch the active model (preserves context).                 |
| `getProviderStatus()`                                                     | Returns `ProviderStatus` (provider, model, authStatus, baseUrl, …). |
| `getModelParams()` / `setModelParam(key, value)` / `clearModelParam(key)` | Read / mutate model params.                                         |
| `getCurrentSequenceModel()`                                               | Current load-balancer sequence model, or `null`.                    |

Switching the provider or model on a live agent **preserves conversation
context** — the next turn continues the conversation rather than starting fresh.

### Approval mode

Read and mutate the live approval mode — the tool-confirmation policy the agent
applies on every turn:

```ts
import { createAgent, ApprovalMode } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

agent.getApprovalMode(); // → ApprovalMode.DEFAULT (default)
agent.setApprovalMode(ApprovalMode.AUTO_EDIT);
agent.getApprovalMode(); // → ApprovalMode.AUTO_EDIT
```

`ApprovalMode` is a runtime enum exported from the public root:

| Member      | Meaning                                                                       |
| ----------- | ----------------------------------------------------------------------------- |
| `DEFAULT`   | Read-only tools are allowed automatically; write tools ask for confirmation.  |
| `AUTO_EDIT` | Edit-class tools are auto-approved; shell and other tools still ask.          |
| `YOLO`      | Auto-approve all tools (no confirmation). Dangerous command blocking applies. |

These mode meanings match the built-in policy stack described in
[Controlling Tool Execution](tool-permissions.md). The `ApprovalMode` enum value
itself only selects which mode-specific policy rules are active — it does not
inject rules of its own.

> **Important — harness defaults override this in `createAgent`.** By default
> `createAgent` applies `forceConfirmations: true`, which injects a
> high-priority ask rule so **every** tool surfaces a confirmation request,
> regardless of approval mode. To observe the enum's native behaviour, disable
> that harness gate (see [Harness defaults and production gating](#harness-defaults-and-production-gating)).

> **Warning — untrusted folders.** `setApprovalMode` throws
> `"Cannot enable privileged approval modes in an untrusted folder."` for any
> non-`DEFAULT` mode when the working directory is not trusted. The error
> propagates unchanged — it is not caught or normalized.

### History, stats, and compression

`getHistory`, `setHistory`, `addHistory`, `restoreHistory`, and `resetChat`
manage conversation history. `compress(opts?)` runs context compression.
`getStats()` returns `SessionStats` and `onStats(cb)` subscribes to updates.
`listProviders()` and `listTools()` are instance-scoped discovery helpers.

### Sub-surfaces

The `Agent` exposes the following `readonly` sub-surface properties:

#### `agent.tools`

Live tool registry and confirmation wiring. Key methods:

- `list()` — returns a snapshot of every registered tool with name, display
  name, description, source (`'builtin'`, `'mcp'`, `'extension'`, `'skill'`),
  enabled state, and optional parameters schema.
- `get(name)` — returns a handle wrapping the named tool, or `undefined` when
  no tool is registered under `name`. The handle exposes `build(params)` and
  `buildAndExecute(params, signal)` for direct invocation.
- `setEnabled(names)` — enable a specific set of tools.
- `onConfirmationRequest(cb)` / `respondToConfirmation(confirmationId, decision)`
  — wire and respond to tool confirmations.
- `keys` — a nested control for built-in tool API-key storage:
  `supported()`, `status(toolName)` (masked), `save(toolName, key)`,
  `delete(toolName)`, `setKeyFile(toolName, path)`, `getKeyFile(toolName)`.

> **Security — masked only.** Raw secret values are never returned. `status()`
> surfaces only a masked preview and a key-file path reference. The full key is
> write-only through `save()`.

#### `agent.mcp`

Runtime-only view of MCP servers. Key methods: `listServers()`, `status()`,
`toolsByServer()`, `auth(server)`, `discoveryState()`, `refresh(server?)`,
`reload()`, `authenticate(server)`, `details(opts?)`.

`authenticate(server)` runs the real OAuth flow against a server that requires
auth, then refreshes that server's tool declarations. `details(opts?)` returns a
structured snapshot of every server (auth status, tools/prompts/resources as
requested) plus any servers blocked by an extension.

`refresh(server?)` restarts the target server (or all servers when called with
no argument) and re-publishes its tool declarations. `reload()` hot-applies MCP
configuration changes without restarting the process — it throws
`"MCP server reload is not available in this composition."` when unavailable.

> **Durable MCP operations.** Adding or removing MCP server configuration is a
> durable concern available on the
> [`app-service.js`](#durable-app-service-functions) subpath, not on the live
> agent.

#### `agent.auth`

Provider authentication. Key methods: `login(provider, opts?)`,
`logout(provider, opts?)`, `status(provider?)`, `enableOAuth(provider)`,
`disableOAuth(provider)`, `listBuckets(provider?)`,
`switchBucket(provider, bucket)`, `mcpLogin(server)`, `setBaseUrl(baseUrl)`,
and a nested `keys` control (`list`, `save`, `use`, `delete`, `setRaw`,
`setKeyFile`).

Additional inspection methods: `detailedStatus(provider)`,
`getHigherPriorityAuth(provider)`, `listBucketStatuses(provider)`.

> **Security — masked only.** These methods return metadata only:
> authenticated flags, expiry timestamps, and reference names. Raw token
> strings are never returned.

#### `agent.profiles`

Runtime profile operations: `list()`, `get(name)`, `getDefault()`,
`apply(name)` (rebinds the live runtime), `setDefault(name)`, `create(name, detail)`,
`saveCurrent(name)`, `delete(name)`.

#### `agent.session`

Session lifecycle: `resume(target, options?)`, `resumeSession(ref)`,
`listSessions()`, `nameCurrentSession(name)`, `deleteSession(ref)`,
`createCheckpoint(name)`, `forkFromCheckpoint(ref)`, `listCheckpoints()`,
`renameCheckpoint(ref, name)`, `deleteCheckpoint(ref)`, `setRecording(state)`,
`getRecording()`.

#### `agent.hooks`

Lifecycle hooks: `onHookExecution(cb)`, `triggerSessionStart()`,
`triggerSessionEnd()`, `clear()`. Hook administration: `listHooks()`,
`getDisabledHooks()`, `setDisabledHooks(names)`, `enable(name)`,
`disable(name)`.

When no hook system is present, `listHooks()` returns `[]` and the setters are
no-ops.

#### `agent.policy`

Read-only inspection of the engine policy: `getRules()`, `getDefaultDecision()`,
`isNonInteractive()`. `PolicyDecision` is a runtime enum exported from the
public root: `ALLOW`, `DENY`, `ASK_USER`.

#### `agent.tasks`

Undefined-safe async-task administration: `list()`, `listRunning()`,
`get(id)`, `cancel(id)`, `cancelAllRunning()`.

When no async-task manager is present, `list()` / `listRunning()` return `[]`,
`get(id)` returns `undefined`, `cancel(id)` returns `false`, and
`cancelAllRunning()` returns `0`.

#### `agent.memory`

Runtime memory operations: `getMemory()`, `setMemory(content)`,
`getFileCount()`, `getFilePaths()`, `getCoreMemory()`, `getCoreFileCount()`,
`setCoreMemory(content)`, `refresh()`, `onMemoryChanged(cb)`.

#### `agent.skills`

Skills query/reload: `list(opts?)`, `get(name)`, `reload()`,
`isAdminEnabled()`.

#### `agent.workspace`

Workspace accessors: `getDirectories()`, `addDirectory(path)`,
`getWorkingDirectory()`, `getProjectRoot()`.

#### `agent.lsp`

Read-only LSP status: `status()` returns a snapshot with `disabled`,
`servers`, and optional `unavailableReason`.

#### `agent.ide`

IDE integration: `current()`, `detected()`, `trust(name)`, `status()`,
`openEditor()`, `closeEditor()`.

## Events

Every `stream()` turn yields a sequence of `AgentEvent` values discriminated by
`type`. There are 19 variants:

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

### `DoneReason`

There are two ways to consume a turn's outcome, and they surface the finish
reason differently:

- **`stream()`** yields an `AgentEvent` sequence that terminates with
  **exactly one** `done` event carrying a `reason` from the table below.
  Errors surface as an `error` event followed by exactly one `done` with
  `reason: 'error'`.
- **`chat()`** returns an `AgentResult` directly. It does **not** emit events.
  The finish reason is available on `result.finishReason`, and a failed turn
  populates `result.error` (an `AgentError`) alongside
  `finishReason: 'error'`.

| Reason             | Meaning                                                           |
| ------------------ | ----------------------------------------------------------------- |
| `stop`             | Normal completion.                                                |
| `aborted`          | The turn was cancelled (for example via an `AbortSignal`).        |
| `max-turns`        | The turn exceeded the configured maximum number of agentic turns. |
| `context-overflow` | The context window was exceeded.                                  |
| `loop-detected`    | A repetition loop was detected.                                   |
| `error`            | The turn failed. Preceded by an `error` event.                    |
| `hook-stopped`     | A lifecycle hook stopped the turn.                                |
| `refusal`          | The model's safety classifier declined the request.               |

Errors surface as an `error` event **followed by exactly one**
`done` with `reason: 'error'`. The error event is informational; the `done` is
the terminator. Treat `aborted` and `error` as distinct cases — `aborted` means
the turn was cancelled, `error` means it failed.

`refusal` indicates the turn completed (HTTP 200) but the model declined to
produce an actionable answer. Surface a user-visible notice rather than treating
it as a hard error.

> **Note — idle-timeout.** A stream idle-timeout emits an `idle-timeout` event
> and then terminates the turn with `done` carrying `reason: 'error'`.

## Tool confirmations and safe denial

Tools that require confirmation surface a `tool-confirmation` event and a
`tool-status` update with `status: 'awaiting-approval'`. To approve or deny,
wire a handler in one of two ways:

1. Provide `onApproval` at `createAgent` time, **or**
2. Subscribe via `agent.tools.onConfirmationRequest(cb)` and respond with
   `agent.tools.respondToConfirmation(confirmationId, decision)`.

**Wired handler that rejects or throws — safe denial.** When a handler is wired
but its promise rejects (or it throws), the confirmation is answered with a
`Cancel` outcome so the scheduler cancels the tool and the loop proceeds. The
loop never hangs.

**No handler wired — clear error.** When `onApproval` is not provided, the
confirmation cannot be answered. In non-interactive contexts the agent surfaces
a structured error
(`"requires user confirmation, which is not supported in non-interactive mode"`),
emits an `error` event, and terminates the turn with exactly one
`done` carrying `reason: 'error'`. The agent does **not** silently proceed and
does **not** silently deny.

Wire `onApproval` at `createAgent` time, or subscribe and respond via
`agent.tools` — do not leave confirmations unhandled.

## Authentication and precedence

Authentication is configured up-front via `AgentConfig.auth` and adjusted at
runtime via `agent.auth` and `agent.auth.keys`.

### Auth precedence (highest to lowest)

The auth source that wins is determined in this order:

| Priority | Source    | How it is set                                                   |
| -------- | --------- | --------------------------------------------------------------- |
| 1        | `raw`     | A raw key set at runtime via `agent.auth.keys.setRaw(value)`.   |
| 2        | `keyName` | A named key reference selected via `agent.auth.keys.use(name)`. |
| 3        | `inline`  | An inline `auth.apiKey` supplied in `AgentConfig`.              |
| 4        | `keyfile` | A key file path (`auth.apiKeyFile` or `setKeyFile`).            |
| 5        | `oauth`   | An OAuth-authenticated provider.                                |
| 6        | `none`    | No credential; `authStatus` is `'unauthenticated'`.             |

`getProviderStatus()` reflects the winner: it surfaces `keyName` only when the
winner is `keyName`, and `keyFile` only when the winner is `keyfile`. Secret
values are never copied onto status or profile objects — only the reference
(name or path) surfaces. In-memory named keys live in a per-agent store that
dies with the agent and never touches disk or the host keychain.

## Errors and disposal

### `dispose()`

```ts
dispose(): Promise<void>;
```

Tears down the runtime context, message bus, and any tool schedulers the agent
owns. Always call it when finished.

### Ownership and `dispose()`

`createAgent` **builds and owns** its own config and client — `agent.dispose()`
tears them down.

`fromConfig` **adopts** a caller-supplied config — `agent.dispose()` tears down
the agent's runtime context, message bus, and tool schedulers, but does **not**
dispose the caller-supplied config. The config remains usable after the agent is
disposed.

### Runtime identity

```ts
agent.getRuntimeId(): string;
```

Returns a stable, non-empty string identifying this runtime instance. It is set
at construction time (from `AgentConfig.sessionId` if provided, otherwise
generated) and does not change for the lifetime of the agent. Use it for logging,
telemetry, or correlating events.

## Examples

### Minimal chat turn

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({
  provider: 'openai',
  model: 'gpt-5.5',
  auth: { apiKey: process.env.OPENAI_API_KEY },
});

try {
  const result = await agent.chat({ text: 'What is 2 + 2?' });
  console.log(result.text);
} finally {
  await agent.dispose();
}
```

### Switching provider with context preservation

```ts
// The conversation history survives the switch.
await agent.setProvider('anthropic', 'claude-fable-5');
const continued = await agent.chat({ text: 'Continuing our conversation...' });
```

### Inspecting tools

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

for (const info of agent.tools.list()) {
  console.log(info.displayName ?? info.name, info.source, info.enabled);
}

const handle = agent.tools.get('read_many_files');
if (handle) {
  const result = await handle.buildAndExecute(
    { paths: ['src/**/*.ts'] },
    new AbortController().signal,
  );
  console.log(result.llmContent);
}
```

### Wiring tool confirmations

This example references `ToolConfirmationOutcome`, which lives in the tools
package — install `@vybestack/llxprt-code-tools` alongside the agents package
to run it (see [Entry package and imports](#entry-package-and-imports)).

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

const agent = await createAgent({
  provider: 'openai',
  model: 'gpt-5.5',
  auth: { apiKey: process.env.OPENAI_API_KEY },
  onApproval: (confirmation) => {
    console.log(`Confirming: ${confirmation.name}`);
    return ToolConfirmationOutcome.ProceedOnce;
  },
});
```

## Durable app-service functions

Durable configuration concerns — profile persistence, MCP server add/remove,
memory file edits, skill/extension management, settings mutation, and
diagnostics — are available as standalone functions that do **not** require a
live agent:

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

### `COMMAND_API_MAP`

`COMMAND_API_MAP` is the canonical slash-command to API mapping. Each entry is
one of three kinds:

- `runtime` — a live `Agent` method path (affects the active conversation).
- `subpath` — a durable app-service function.
- `cli-local` — pure UI/UX with no core dependency.

## Adopting an existing config: `fromConfig`

In addition to `createAgent`, the public API exposes `fromConfig` for adopting a
caller-supplied config object. This is the seam the CLI uses to inject an
already-constructed config into an agent without the agent rebuilding its own
runtime from scratch.

```ts
import { fromConfig } from '@vybestack/llxprt-code-agents';

// `config` is a caller-owned config built however you like.
const agent = await fromConfig({ config });

console.log(agent.getRuntimeId());
```

To drive turns that issue tool calls requiring confirmation, supply an
`onApproval` handler. As above, `ToolConfirmationOutcome` is exported from the
tools package (`@vybestack/llxprt-code-tools`), not the agents package:

```ts
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

const agent = await fromConfig({
  config,
  onApproval: () => ToolConfirmationOutcome.ProceedOnce,
});
```

## Related guides

- [Getting started](getting-started.md) — using the `llxprt` CLI.
- [Sandbox](sandbox.md) — configuring process and file sandboxing.
- [Settings and profiles](settings-and-profiles.md) — configuring LLxprt Code.
- [Policy configuration](policy-configuration.md) — tool-confirmation policies.
