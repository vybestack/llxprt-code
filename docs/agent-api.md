<!-- @plan:PLAN-20260617-COREAPI.P28 @requirement:REQ-020 -->

# Agent API

<!-- @plan:PLAN-20260622-COREAPIGAP.P19 @requirement:REQ-010 -->

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

### Harness options (production gating)

```ts
readonly harness?: AgentHarnessOptions;
```

`createAgent` is optimized for the embedder/fixture path: by default it forces
three harness seams that make fixtures and interactive embedding convenient but
are **unsafe for production CLI callers**:

1. **`forceInteractive`** (default `true`) — overwrites `interactive` to `true`
   so the confirmation coordinator does not throw and the policy engine keeps
   its default `ASK_USER` decision.
2. **`forceConfirmations`** (default `true`) — injects a high-priority ASK
   policy rule so every tool surfaces a confirmation request (the
   confirmation-forcing seam).
3. **`includeProcessCwd`** (default `true`) — adds `process.cwd()` to the
   workspace context so fixture paths resolve within the workspace boundary.

Production callers (and the CLI migration path) can disable any combination:

```ts
const agent = await createAgent({
  provider: 'openai',
  model: 'gpt-5.5',
  interactive: false,
  approvalMode: ApprovalMode.DEFAULT,
  harness: {
    forceInteractive: false, // respect caller interactive:false
    forceConfirmations: false, // do NOT inject the confirmation-forcing rule
    includeProcessCwd: false, // do NOT mutate workspace with process.cwd()
  },
});
```

When all three are disabled, `createAgent` honors the caller's `interactive` and
`approvalMode` values verbatim, injects no extra policy rules, and leaves the
workspace context untouched. The defaults remain `true` so existing embedders
and fixture-driven tests continue to work without changes.

> **CLI migration note.** The supported near-term CLI adoption entrypoint is
> [`fromConfig`](#adopting-an-existing-config-fromconfig), which adopts an
> already-constructed CLI-style `Config` and never applies these harness seams.
> `createAgent` with `harness` disabled is the embedder path for callers who
> want `createAgent`'s provider/auth/setup without the unsafe defaults.

### Sandbox

`sandbox?: SandboxConfig` configures process/file sandboxing for tool execution.
The type is re-exported from core; see the
[sandbox documentation](./sandbox.md) for the full configuration shape.

## The `Agent` Control Plane

An `Agent` is the live runtime facade. It exposes top-level methods for sending
turns and switching provider/model/params, plus thirteen `readonly` sub-surfaces
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

### Top-level: approval mode

Read and mutate the live approval mode — the tool-confirmation policy the agent
applies on every turn. Both methods delegate directly to the bound `Config`
(no caching), so they always reflect the runtime's current state.

```ts
import { createAgent, ApprovalMode } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

agent.getApprovalMode(); // → ApprovalMode.DEFAULT (default)
agent.setApprovalMode(ApprovalMode.AUTO_EDIT);
agent.getApprovalMode(); // → ApprovalMode.AUTO_EDIT
```

`ApprovalMode` is a runtime VALUE enum exported from the public root:

| Member      | Meaning                                          |
| ----------- | ------------------------------------------------ |
| `DEFAULT`   | Confirm every tool call (interactive prompt).    |
| `AUTO_EDIT` | Auto-approve edit-class tools; confirm the rest. |
| `YOLO`      | Auto-approve all tools (no confirmation).        |

> **Untrusted-folder guard.** `setApprovalMode` delegates to the bound `Config`,
> which throws
> `"Cannot enable privileged approval modes in an untrusted folder."` for any
> non-`DEFAULT` mode when the working directory is not trusted. That throw
> propagates **unchanged** — it is not caught or normalized by the agent.

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

All nine are exposed as `readonly` properties on the `Agent`:

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

##### `agent.tools.keys` — `AgentToolKeyControl`

Built-in tool API-key storage (distinct from `agent.auth.keys`, which manages
**provider-auth** keys). Each method targets a built-in tool that consumes its
own API key (e.g. a search or web tool):

```ts
agent.tools.keys.supported(): readonly ToolKeyInfo[]
agent.tools.keys.status(toolName: string): Promise<ToolKeyStatus>   // masked
agent.tools.keys.save(toolName: string, key: string): Promise<void>
agent.tools.keys.delete(toolName: string): Promise<void>
agent.tools.keys.setKeyFile(toolName: string, path: string | null): Promise<void>
agent.tools.keys.getKeyFile(toolName: string): Promise<string | null>
```

`ToolKeyInfo` = `{ toolName: string; displayName: string; description?: string }`.
`ToolKeyStatus` = `{ toolName: string; hasKey: boolean; maskedKey?: string; keyFile?: string }`.

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

// Discover which built-in tools accept an API key.
for (const info of agent.tools.keys.supported()) {
  console.log(info.toolName, info.displayName);
}

// Store a key (masked on read-back).
await agent.tools.keys.save('web-search', 'sk-live-xxxxxxxx');
const status = await agent.tools.keys.status('web-search');
console.log(status.hasKey, status.maskedKey); // true 'sk-l••••••••xxxx'
```

> **SECURITY — masked only.** Raw secret values are **never** returned.
> `status(...)` surfaces only `maskedKey` (a redacted preview) and `keyFile`
> (a path reference); the full key is write-only through `save(...)`.

#### `agent.mcp` — `AgentMcpControl`

**Runtime-only** view of MCP servers: `listServers()`, `status()`,
`toolsByServer()`, `auth(server)`, `discoveryState()`, `refresh(server?)`.

OAuth + detailed inspection (added by #2143):

```ts
agent.mcp.authenticate(server: string): Promise<McpServerAuthStatus>   // real OAuth flow + post-auth tool refresh
agent.mcp.details(opts?: McpDetailsOptions): Promise<McpDetailStatus>
```

<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P07 @requirement:REQ-005 -->

- `McpServerAuthStatus` = `{ server: string; authenticated: boolean; requiresAuth: boolean; oauthStatus: McpOAuthStatus; sessionAuthenticated: boolean; authUrl?: string }`.
- `McpOAuthStatus` = `'authenticated' | 'expired' | 'none' | 'not-required'` — the real persisted OAuth state surfaced from the engine helper.
- `sessionAuthenticated: boolean` — the in-session marker, distinct from `authenticated`. It is set by either `agent.auth.mcpLogin(server)` or a successful `agent.mcp.authenticate(server)` (both mark the server authenticated for the current session); it is NOT persisted and does not by itself imply a valid stored OAuth token.
- `McpServerDetail` carries the same `oauthStatus` / `sessionAuthenticated` / `requiresAuth` fields on each entry of `McpDetailStatus.servers`.
- **CORRECTION (#2165):** `authenticated` now means "a valid persisted OAuth token exists" (i.e. `oauthStatus === 'authenticated'`) — it is NO LONGER derived from the in-session marker; `requiresAuth` is now the real per-server value (no longer hardcoded `true`).
- `McpDetailsOptions` = `{ includeTools?: boolean; includePrompts?: boolean; includeResources?: boolean }`.
- `McpDetailStatus` = `{ servers: readonly McpServerDetail[]; blockedServers: readonly McpBlockedServer[] }`.

`authenticate(server)` runs the real OAuth flow against a server that requires
auth, then refreshes that server's tool declarations so the live tool list
stays in sync. `details(opts?)` returns a structured snapshot of every server
(auth status, tools/prompts/resources as requested) plus any servers blocked by
an extension.

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({
  provider: 'fake',
  model: 'fake-model',
  mcpServers: {
    'auth-required-server': {
      /* … */
    },
  },
});

// Run OAuth for a server that requires it.
const authStatus = await agent.mcp.authenticate('auth-required-server');
if (authStatus.authUrl) {
  // Direct the user to authStatus.authUrl to complete the flow.
}

// Full structural snapshot (tools + prompts + resources).
const detail = await agent.mcp.details({
  includeTools: true,
  includePrompts: true,
  includeResources: true,
});
for (const server of detail.servers) {
  console.log(server.name, server.authenticated, server.tools?.length);
}
```

<!-- @plan:PLAN-20260622-MCPOAUTHTRUTH.P07 @requirement:REQ-005 -->

Reading the corrected OAuth quad-state (`oauthStatus` / `sessionAuthenticated` /
`requiresAuth`) off the public projection — public root import only, no deep
core import, no config-introspection call:

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

const status = await agent.mcp.auth('my-server');
// status.oauthStatus: 'authenticated' | 'expired' | 'none' | 'not-required'
// status.authenticated === (status.oauthStatus === 'authenticated')
// status.sessionAuthenticated: in-session marker (independent of a persisted token)
console.log(
  status.oauthStatus,
  status.authenticated,
  status.sessionAuthenticated,
  status.requiresAuth,
);

const detail = await agent.mcp.details({ includeTools: true });
for (const server of detail.servers) {
  console.log(server.name, server.oauthStatus, server.sessionAuthenticated);
}
```

> **Refresh parity.** `agent.mcp.refresh(server?)` restarts the target server
> (or all servers when called with no argument) **and** re-publishes its tool
> declarations (`setTools` parity), so the live tool list tracks server
> restarts without a separate manual publish step.
>
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

Detailed provider/bucket metadata (added by #2143):

```ts
agent.auth.detailedStatus(provider: string): Promise<AuthProviderDetail>
agent.auth.getHigherPriorityAuth(provider: string): Promise<string | null>
agent.auth.listBucketStatuses(provider: string): Promise<readonly AuthBucketStatus[]>
```

- `AuthProviderDetail` = `{ provider: string; authenticated: boolean; oauthEnabled: boolean; expiry?: number }`.
- `AuthBucketStatus` = `{ bucket: string; authenticated: boolean; expiry?: number; isSessionBucket: boolean }`.

`detailedStatus(provider)` returns a single provider's auth profile (whether
OAuth is enabled, token expiry). `getHigherPriorityAuth(provider)` reports the
name of the highest-priority auth source currently winning for that provider, or
`null` if none. `listBucketStatuses(provider)` returns per-bucket auth/expiry
metadata for providers that support multiple buckets.

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

const detail = await agent.auth.detailedStatus('openai');
console.log(detail.authenticated, detail.oauthEnabled, detail.expiry);

const winner = await agent.auth.getHigherPriorityAuth('openai');
console.log(winner); // e.g. 'keyName' | 'keyfile' | 'oauth' | null

for (const bucket of await agent.auth.listBucketStatuses('openai')) {
  console.log(bucket.bucket, bucket.authenticated, bucket.isSessionBucket);
}
```

> **SECURITY — masked only.** These methods return **metadata only** —
> `authenticated` flags, `expiry` timestamps, and reference names. Raw token
> strings are **never** returned.

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

Hook administration (added by #2143):

```ts
agent.hooks.listHooks(): readonly HookInfo[]
agent.hooks.getDisabledHooks(): readonly string[]
agent.hooks.setDisabledHooks(names: readonly string[]): void
agent.hooks.enable(name: string): void
agent.hooks.disable(name: string): void
```

`HookInfo` = `{ name: string; eventName: string; enabled: boolean; source?: string }`.

`listHooks()` returns the full registered-hook registry (name, event, enabled
flag, source). `getDisabledHooks()` / `setDisabledHooks(names)` read/replace the
disabled-hook name list in one call. `enable(name)` / `disable(name)` toggle a
single hook by name.

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

for (const hook of agent.hooks.listHooks()) {
  console.log(hook.name, hook.eventName, hook.enabled);
}

agent.hooks.disable('my-pre-send-hook');
console.log(agent.hooks.getDisabledHooks()); // ['my-pre-send-hook']
agent.hooks.enable('my-pre-send-hook');
```

> **Undefined-safe.** When no hook system is present, `listHooks()` → `[]`,
> `getDisabledHooks()` → `[]`, and the setters are no-ops.

#### `agent.policy` — `AgentPolicyControl`

Read-only inspection of the engine policy (added by #2143):

```ts
agent.policy.getRules(): readonly PolicyRuleView[]
agent.policy.getDefaultDecision(): PolicyDecision
agent.policy.isNonInteractive(): boolean
```

- `PolicyRuleView` = `{ priority?: number; toolName?: string; decision: PolicyDecision; argsPattern?: string; source?: string }`.
  Note `argsPattern` is the RegExp **source string** (JSON-safe) — never a live
  `RegExp`. Read-only inspection; rule mutation is intentionally out of scope.

`getRules()` returns the active policy rule set in priority order.
`getDefaultDecision()` returns the fallback `PolicyDecision` applied when no
rule matches. `isNonInteractive()` reports whether the engine is running in a
non-interactive context (no confirmation prompts).

```ts
import { createAgent, PolicyDecision } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

for (const rule of agent.policy.getRules()) {
  console.log(rule.priority, rule.toolName, rule.decision, rule.argsPattern);
}
console.log(agent.policy.getDefaultDecision()); // e.g. PolicyDecision.ALLOW
console.log(agent.policy.isNonInteractive()); // false
```

#### `agent.tasks` — `AgentTasksControl`

Undefined-safe async-task administration (added by #2143):

```ts
agent.tasks.list(): readonly AgentTaskInfo[]
agent.tasks.listRunning(): readonly AgentTaskInfo[]
agent.tasks.get(id: string): AgentTaskInfo | undefined
agent.tasks.cancel(id: string): boolean
agent.tasks.cancelAllRunning(): number   // returns count cancelled
```

`AgentTaskInfo` = `{ id: string; subagentName: string; goalPrompt: string; status: 'running'|'completed'|'failed'|'cancelled'; launchedAt: number; completedAt?: number; error?: string }`.
Note `abortController` is intentionally **NOT** exposed (projected public type
omits non-serializable internals).

```ts
import { createAgent } from '@vybestack/llxprt-code-agents';

const agent = await createAgent({ provider: 'fake', model: 'fake-model' });

for (const task of agent.tasks.listRunning()) {
  console.log(task.id, task.subagentName, task.goalPrompt);
}

const cancelled = agent.tasks.cancelAllRunning();
console.log(`Cancelled ${cancelled} running task(s).`);
```

> **Undefined-safe.** When no async-task manager is present, `list()` /
> `listRunning()` → `[]`, `get(id)` → `undefined`, `cancel(id)` → `false`,
> `cancelAllRunning()` → `0`.

#### `agent.memory` — `AgentMemoryControl`

Runtime memory operations (added by #2199). Delegates to the bound `Config`'s
memory surface so clients read/write runtime memory without a raw Config
escape hatch:

```ts
agent.memory.getMemory(): string
agent.memory.setMemory(content: string): void
agent.memory.getFileCount(): number
agent.memory.getFilePaths(): readonly string[]
agent.memory.getCoreMemory(): string | undefined
agent.memory.getCoreFileCount(): number
agent.memory.setCoreMemory(content: string): void
agent.memory.refresh(): Promise<MemoryRefreshResult>
agent.memory.onMemoryChanged(cb: (event: MemoryChangedEvent) => void): Unsubscribe
```

`getMemory()` / `setMemory(content)` read and write the user memory (the
`LLXPRT.md` content the agent includes in its system instruction).
`getFileCount()` / `getFilePaths()` return the count and paths of discovered
memory files. `getCoreMemory()` / `getCoreFileCount()` / `setCoreMemory()`
access the core (non-project) memory. `refresh()` reloads memory from disk and
returns `{ memoryContent, fileCount, filePaths }`. `onMemoryChanged(cb)`
subscribes to memory changes, passes `{ fileCount, coreMemoryFileCount? }`, and
returns an `Unsubscribe` function.

```ts
const agent = await createAgent({ provider: 'fake', model: 'fake-model' });
console.log(agent.memory.getMemory());
const unsub = agent.memory.onMemoryChanged((event) => {
  console.log(`memory reloaded from ${event.fileCount} file(s)`);
});
const refreshed = await agent.memory.refresh();
console.log(refreshed.memoryContent);
unsub();
```

#### `agent.skills` — `AgentSkillsControl`

Skills query/reload operations (added by #2199). Delegates to
`Config.getSkillManager()` so clients manage skills without a raw Config
escape hatch:

```ts
agent.skills.list(opts?: { includeDisabled?: boolean }): readonly SkillInfo[]
agent.skills.get(name: string): SkillInfo | undefined
agent.skills.reload(): Promise<void>
agent.skills.isAdminEnabled(): boolean
```

`SkillInfo` = `{ name: string; description?: string; disabled?: boolean; source?: string; location?: string }`. It intentionally omits skill body/prompt content.

`list()` returns enabled skills by default; pass `{ includeDisabled: true }`
to include disabled skills. `get(name)` returns a single skill by name, or
`undefined`. `reload()` re-discovers skills
from disk. `isAdminEnabled()` reports whether the skill system is
administratively enabled.

```ts
const agent = await createAgent({ provider: 'fake', model: 'fake-model' });
for (const skill of agent.skills.list()) {
  console.log(skill.name, skill.disabled);
}
await agent.skills.reload();
```

#### `agent.workspace` — `AgentWorkspaceControl`

Narrow workspace accessors (added by #2199). Delegates to
`Config.getWorkspaceContext()` / `getTargetDir()` / `getProjectRoot()` so
clients inspect workspace directories without a raw Config escape hatch:

```ts
agent.workspace.getDirectories(): readonly string[]
agent.workspace.addDirectory(path: string): void
agent.workspace.getWorkingDirectory(): string
agent.workspace.getProjectRoot(): string
```

`getDirectories()` returns all workspace root directories. `addDirectory(path)`
adds a directory to the workspace context. `getWorkingDirectory()` returns the
target working directory. `getProjectRoot()` returns the project root directory.

```ts
const agent = await createAgent({ provider: 'fake', model: 'fake-model' });
console.log(agent.workspace.getDirectories());
console.log(agent.workspace.getProjectRoot());
```

#### `agent.lsp` — `AgentLspControl`

Read-only LSP status inspection (added by #2199). Delegates to
`Config.getLspConfig()` / `Config.getLspServiceClient()` so clients check LSP
status without a raw Config escape hatch. Does not leak the raw
`LspServiceClient`:

```ts
agent.lsp.status(): Promise<LspStatusSnapshot>
```

`LspStatusSnapshot` = `{ disabled: boolean; servers: readonly LspServerStatus[]; unavailableReason?: string }`.
`LspServerStatus` = `{ serverId: string; healthy: boolean; detail?: string; state?: 'ok' | 'broken' | 'starting' | 'idle'; status?: string }`.

`status()` returns a snapshot. `disabled` is `true` when LSP is not configured
or the service client is unavailable; `servers` is always an array (empty when
no servers). `unavailableReason` is present when the client exists but is not
alive.

```ts
const agent = await createAgent({ provider: 'fake', model: 'fake-model' });
const lsp = await agent.lsp.status();
console.log(lsp.disabled, lsp.servers);
```

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

<!-- @plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007 -->

## Adopting an existing Config (`fromConfig`)

In addition to `createAgent` (which _builds and owns_ its own `Config`/client), the
public API exposes `fromConfig` for **adopting a caller-supplied `Config`**. This is
the seam the CLI uses to inject an already-constructed, CLI-style `Config` into an
agent without the agent rebuilding its own runtime from scratch.

```ts
import { fromConfig } from '@vybestack/llxprt-code-agents';

// `config` is a caller-owned Config built however you like (e.g. the CLI's
// Config builder). fromConfig ADOPTS it — it does not clone or rebuild it.
const agent = await fromConfig({ config });

// Client code should use the Agent's public projections rather than reaching
// back into the raw Config.
console.log(agent.getRuntimeId());
```

### Ownership semantics (critical)

The `Config` you hand to `fromConfig` is **caller-owned**:

- `fromConfig({ config })` adopts the `Config` (and the `Config`'s already-active
  provider manager + message bus). It does **not** take ownership of the `Config`
  itself.
- `await agent.dispose()` tears down the agent's runtime context, message bus,
  and tool schedulers, but it does **not** dispose the caller-supplied `Config`.
  The `Config` remains usable after the agent is disposed (e.g.
  `config.getEphemeralSettings()` still works).

This is the **opposite** of `createAgent`, which builds and **owns** its own
`Config`/client and **does** tear them down on `agent.dispose()`:

```ts
import { createAgent, fromConfig } from '@vybestack/llxprt-code-agents';

// createAgent: builds and OWNS its Config — disposed on agent.dispose().
const owned = await createAgent({ provider: 'fake', model: 'fake-model' });
await owned.dispose(); // owned Config/client is torn down.

// fromConfig: ADOPTS a caller-owned Config — NOT disposed by agent.dispose().
const agent = await fromConfig({ config });
await agent.dispose();
// `config` is STILL usable here — the caller owns its lifecycle.
```

### Optional tool confirmation

To drive turns that issue tool calls requiring confirmation, supply an
`onApproval` handler (the same field `createAgent` accepts):

```ts
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

const agent = await fromConfig({
  config,
  onApproval: () => ToolConfirmationOutcome.ProceedOnce,
});
```

See [Tool Confirmations and Safe Denial](#tool-confirmations-and-safe-denial)
for the full confirmation contract.

<!-- @plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007 -->

## Settings & Config Projection

An agent exposes a focused projection of its underlying `Config` for reading and
mutating ephemeral (per-session) settings. **Normalization and side effects are
delegated to the `Config`** — the agent is a thin pass-through, so the exact
rules the `Config` applies (numeric coercion, enum validation, throws on invalid
values) are the rules the agent enforces.

### No raw `Config` escape hatch

The public `Agent` interface intentionally does **not** expose a raw `Config`
reference. `fromConfig` still adopts and delegates to the caller-owned `Config`,
but clients should use the typed Agent projections below (`memory`, `skills`,
`workspace`, `lsp`, settings, policy, tools, tasks, etc.) instead of relying on
internal runtime objects.

### `agent.getEphemeralSetting(key)` / `setEphemeralSetting(key, value)`

Read and mutate a single ephemeral setting. The `Config` normalizes the value:

```ts
// Numeric normalization: a numeric string is coerced to a number.
agent.setEphemeralSetting('context-limit', '1000');
agent.getEphemeralSetting('context-limit'); // → 1000  (number, not string)

// Enum-valued keys accept their documented string forms.
agent.setEphemeralSetting('streaming', 'enabled');
agent.getEphemeralSetting('streaming'); // → 'enabled'

// An INVALID value is rejected — the Config rule throws and the agent
// propagates it (never swallowed).
agent.setEphemeralSetting('streaming', 123); // throws: message contains "must resolve"
```

### `agent.getEphemeralSettings()`

Returns a **read-only** snapshot of all ephemeral settings. It projects the
same normalized state the bound runtime `Config` owns:

```ts
agent.setEphemeralSetting('context-limit', 50000);
agent.setEphemeralSetting('streaming', 'disabled');

const viaAgent = agent.getEphemeralSettings();
// viaAgent contains { 'context-limit': 50000, streaming: 'disabled' }.
```

<!-- @plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007 -->

## Current Sequence Model

```ts
agent.getCurrentSequenceModel(): string | null;
```

Returns the **bound client's** current model — the model the load-balancer
sequence has resolved for the active turn. It is **nullable**: before a model is
bound (or if the runtime has no sequence model), it returns `null`. It
**reflects rebinds**: after `setModel(...)`, `setProvider(...)`, or a profile
rebind that rebuilds the loop, `getCurrentSequenceModel()` reports the newly
bound client's model.

```ts
const model = agent.getCurrentSequenceModel();
if (model) {
  console.log(`Bound to ${model}`);
} else {
  console.log('No sequence model bound yet.');
}
```

<!-- @plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007 -->

## Public Client Contract

The `AgentClientContract` — the structural interface describing the low-level
client the agent binds and drives — is a **public, type-only** export:

```ts
import type { AgentClientContract } from '@vybestack/llxprt-code-agents';
```

Use it when you need to express the contract shape generically (e.g. for a
type-level assertion or a generic constraint). It is exported as a **type** from
the curated public root; the concrete `AgentClient` **class** is **not** part of
the stable curated surface. It is documented on the
[`/internals.js`](#power-user-subpath-internalsjs) subpath (and, as a
power-user convenience, also reachable from the root today) — treat it as an
unstable internal that may change without notice.

<!-- @plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007 -->

## Runtime Identity

```ts
agent.getRuntimeId(): string;
```

Returns the agent's **read-only runtime identity** — a stable, non-empty string
identifying this runtime instance. It is set at construction time (from
`AgentConfig.sessionId` if provided, otherwise generated) and does not change
for the lifetime of the agent. Use it for logging, telemetry, or correlating
events across the message bus.

```ts
const agent = await fromConfig({ config });
const id = agent.getRuntimeId();
console.log(id); // a non-empty string, e.g. the adopted runtime's id
```

<!-- @plan:PLAN-20260621-COREAPIREMED.P22 @requirement:REQ-007 -->

## Import Boundary for #1595

The eventual #1595 public-API trim narrows the import surface to **only** the
documented specifiers. When embedding LLxprt, import exclusively from:

1. **`@vybestack/llxprt-code-agents`** — the curated public root (the symbols in
   this guide: `createAgent`, `fromConfig`, `listProviders`, `listTools`, the
   `Agent` interface, and the `AgentClientContract` type).
2. **`@vybestack/llxprt-code-agents/app-service.js`** — durable, no-live-`Agent`
   functions (`saveCurrentProfile`, `listProfiles`, `addMcpServer`, …). See
   [Runtime vs App-Service](#runtime-vs-app-service).
3. **`@vybestack/llxprt-code-agents/internals.js`** — low-level power-user
   primitives (`AgentClient`, `ChatSession`, `CoreToolScheduler`, …). See
   [Power-User Subpath: `internals.js`](#power-user-subpath-internalsjs). This
   subpath is **unstable** and may change without a major-version bump.

**Never import from deep package internals.** In particular, do **not** import
from any of these package-internal source trees — they are not public and will
break under #1595:

- `@vybestack/llxprt-code-agents` **followed by a `/src/...` deep path** (e.g.
  reaching into the agent package's internal source rather than its curated
  root/subpath exports).
- `@vybestack/llxprt-code-core/src/...` — the `core` package's source tree is
  package-internal.
- `@vybestack/llxprt-code-providers/src/...` — the `providers` package's source
  tree is package-internal.

The stable contract is the curated root + the two documented subpaths above.
Anything under a package's internal source tree has no stability guarantee.

## New public enums & projected types (#2143)

Issue #2143 promoted a set of enums and projected types to the **public root**
(`@vybestack/llxprt-code-agents`) so a #1595 developer can construct and inspect
these values without a deep import into the core package's internals or an
raw Config escape hatch.

### VALUE enums

These are real runtime values (enum members round-trip), importable from the
public root:

```ts
import { ApprovalMode, PolicyDecision } from '@vybestack/llxprt-code-agents';

// ApprovalMode: DEFAULT | AUTO_EDIT | YOLO  (see "Top-level: approval mode")
// PolicyDecision: ALLOW | DENY | ASK        (see "agent.policy")
console.log(ApprovalMode.DEFAULT, PolicyDecision.ALLOW);
```

### Projected types

These are type-only exports (compile-time shapes for the inspection methods
above); import them as types from the public root:

```ts
import type {
  PolicyRuleView,
  AgentTaskInfo,
  HookInfo,
  AuthProviderDetail,
  AuthBucketStatus,
  McpServerAuthStatus,
  McpDetailStatus,
  McpServerDetail,
  McpDetailsOptions,
  McpPromptInfo,
  McpResourceInfo,
  McpBlockedServer,
  ToolKeyInfo,
  ToolKeyStatus,
} from '@vybestack/llxprt-code-agents';
```

Each projected type omits non-serializable internals (e.g. `abortController` on
`AgentTaskInfo`, live `RegExp` on `PolicyRuleView`'s `argsPattern` string field)
so the public surface is JSON-safe and stable across versions.

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

#### `runtime` rows added by #2143

Six new `runtime` rows map slash-commands onto the live `Agent` sub-surfaces
documented above. Each `target` is a live `Agent` method path (matching
`packages/agents/src/app-services/command-api-map.ts`):

| Command          | Kind      | Target                        | Notes                                          |
| ---------------- | --------- | ----------------------------- | ---------------------------------------------- |
| `/approval-mode` | `runtime` | `agent.setApprovalMode`       | Live engine approval setting on the active run |
| `/policies`      | `runtime` | `agent.policy.getRules`       | Policy inspection reads the active run engine  |
| `/task`          | `runtime` | `agent.tasks.list`            | Async task list/inspect/cancel over active run |
| `/hooks`         | `runtime` | `agent.hooks.listHooks`       | Hook registry inspection + enable/disable      |
| `/toolkey`       | `runtime` | `agent.tools.keys.save`       | Built-in tool key storage feeds active run     |
| `/toolkeyfile`   | `runtime` | `agent.tools.keys.setKeyFile` | Built-in tool keyfile path feeds active run    |

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
- **Control-plane scope:** the thirteen sub-surfaces (`profiles`, `tools`,
  `mcp`, `auth`, `ide`, `session`, `hooks`, `policy`, `tasks`, `memory`,
  `skills`, `workspace`, `lsp`) are part of the public contract, alongside the
  top-level turn/provider/model/approval-mode methods.
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
- **#2143 capability gaps (REQ-001..008):** the top-level approval-mode methods,
  the `policy` / `tasks` sub-controllers, the extended `hooks` administration,
  the extended `auth` detailed metadata, the extended `mcp` OAuth/details, and
  `agent.tools.keys` close the capability gaps that previously forced a
  raw Config escape hatch or a deep import into the core package's internals.
  They are a prerequisite to the #1595 public-API trim, shipped under three
  constraints: **masked-only** (raw secrets/tokens are never returned — only
  `maskedKey` or reference metadata), **projected public types** (omit
  non-serializable internals like `abortController` and live `RegExp`), and
  **delegate-don't-cache** (every method delegates to the bound runtime/config
  on each call rather than holding a stale snapshot).

## A2A Server Follow-up (Next Release)

<!-- @plan:PLAN-20260629-ISSUE2204 @requirement:REQ-2204-A2A -->

Issue #2204 enforces the public-API boundary for the **interactive CLI** and
**non-interactive prompt mode** — the two primary near-term clients. The A2A
server (`packages/a2a-server`) is intentionally **out of scope** for this
release because it was ported from upstream incompletely and needs holistic
follow-up work. This section records the known A2A limitations so they are
explicit next-release work rather than hidden runtime coupling.

**Current state (not yet migrated):**

- The A2A server does **not** consume the high-level public `Agent` surface
  (`createAgent` / `fromConfig` / `agent.stream` / `agent.chat`). Instead it
  imports the lower-level `AgentClient` directly from
  `@vybestack/llxprt-code-agents` and constructs its own `Config` internally
  via `executor.ts` (`getConfig()`).
- It bypasses the `createAgent`/`fromConfig` composition root that the CLI and
  the replaceable-client smoke test use, so it does not yet benefit from the
  single-Agent / single-ProviderManager ownership invariants enforced by the
  public API.

**Next-release work (do NOT attempt in #2204):**

1. Migrate `packages/a2a-server/src/agent/executor.ts` and
   `task-runtime-helpers.ts` to construct the agent via the public
   `createAgent` / `fromConfig` API rather than instantiating `AgentClient`
   and building a `Config` directly.
2. Drive task execution through `agent.stream()` / `agent.chat()` and consume
   the typed `AgentEvent` stream, instead of the bespoke executor loop.
3. Add an A2A-specific import-boundary guard analogous to
   `scripts/check-cli-import-boundary.mjs` once the A2A server is migrated.

The import-boundary choices in #2204 (public root + `app-service.js` allowed;
deep runtime construction forbidden for CLI clients) do **not** block future
A2A adoption — the same public surface is available to the A2A server once its
port is completed.
