# Agent API — Internal Design and Record

> **Status:** Authoritative for the internal architecture, import boundaries,
> and recorded decisions behind the Agent API. For the supported public surface
> — what consumers import, how they call it, and the event contract — see the
> [user-facing reference](../docs/agent-api.md).
>
> **Owner / date:** Agents package maintainers. Last updated 2026-08-01.

## Audience

This page is for **repository contributors** — developers working inside the
monorepo who need to understand the package structure, import boundaries,
internal wiring, and the recorded decisions that shaped the public API. It does
not document the consumer contract; that lives in
[../docs/agent-api.md](../docs/agent-api.md).

## Context and scope

The Agent API is the embeddable surface for driving an LLxprt Code agent from
code rather than the CLI. It lives in the `@vybestack/llxprt-code-agents`
package. The public consumer surface (entry point, configuration, lifecycle
methods, event contract) is documented in the
[user-facing reference](../docs/agent-api.md). This page records:

- Implementation history and recorded decisions.
- The import boundary rules and what the eventual `#1595` trim targets.
- The runtime-vs-app-service internal boundary.
- The current sequence model internals.
- The `internals.js` power-user subpath.
- The settings and config projection internals.
- The A2A server follow-up work.

## Entry package and the `core → agents` cycle avoidance

**Decision (recorded as B11):** The public Agent API ships from
`@vybestack/llxprt-code-agents`, never from `-core`. The agent runtime, chat
loop, and orchestration live in the `agents` package, which depends on `core`.
Re-exposing the public API from `-core` would imply a `core → agents` dependency
and create an import cycle. The package that owns the surface is the package
that exports it.

### Subpath stability contracts

The package exposes three import specifiers, each with a distinct stability
contract:

| Specifier                                      | Purpose                                                                          | Stability                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `@vybestack/llxprt-code-agents`                | The curated public Agent API (see [user reference](../docs/agent-api.md)).       | Supported / semver-covered.                        |
| `@vybestack/llxprt-code-agents/app-service.js` | Durable, config/app-service functions + `COMMAND_API_MAP`. No live agent needed. | Supported / semver-covered.                        |
| `@vybestack/llxprt-code-agents/internals.js`   | Power-user / low-level primitives (chat session, scheduler, orchestrator, etc.). | **Unstable** — may change without a major version. |

The root entry is **non-breaking and additive**: it currently re-exports the
low-level `internals.js` symbols alongside the new public Agent API, so no
existing import breaks today. The package `exports` map is defined in
`packages/agents/package.json`.

## Import boundary for `#1595`

The eventual `#1595` public-API trim narrows the import surface to only the
documented specifiers. When embedding LLxprt Code, import exclusively from:

1. **`@vybestack/llxprt-code-agents`** — the curated public root (the symbols in
   the [user reference](../docs/agent-api.md): `createAgent`, `fromConfig`,
   `listProviders`, `listTools`, the `Agent` interface, and the
   `AgentClientContract` type).
2. **`@vybestack/llxprt-code-agents/app-service.js`** — durable, no-live-agent
   functions. See [Runtime vs app-service](#runtime-vs-app-service).
3. **`@vybestack/llxprt-code-agents/internals.js`** — low-level power-user
   primitives. See [Power-user subpath: `internals.js`](#power-user-subpath-internalsjs).
   This subpath is **unstable** and may change without a major-version bump.

**Never import from deep package internals.** In particular, do not import from:

- `@vybestack/llxprt-code-agents` followed by a `/src/...` deep path.
- `@vybestack/llxprt-code-core/src/...` — the `core` package's source tree is
  package-internal.
- `@vybestack/llxprt-code-providers/src/...` — the `providers` package's source
  tree is package-internal.

The stable contract is the curated root plus the two documented subpaths.
Anything under a package's internal source tree has no stability guarantee.

## `createAgent` harness seams and production gating

`createAgent` (`packages/agents/src/api/createAgent.ts`) is optimized for the
embedder/fixture path. By default it applies three harness gates via
`AgentHarnessOptions` (`packages/agents/src/api/config-types.ts`):

1. **`forceInteractive`** (default `true`) — overwrites `interactive` to `true`
   so the confirmation coordinator does not throw and the policy engine keeps
   its default `ASK_USER` decision. Applied in `applyHarnessGates`.
2. **`forceConfirmations`** (default `true`) — injects a high-priority ASK
   policy rule via `injectConfirmationForcingPolicy` so every tool surfaces a
   confirmation request. This rule overrides the `read-only.toml` ALLOW rules
   (priority 1.050).
3. **`includeProcessCwd`** (default `true`) — adds `process.cwd()` to the
   workspace context so fixture paths resolve within the workspace boundary.

Production callers disable these via `harness: { forceInteractive: false,
forceConfirmations: false, includeProcessCwd: false }`. The CLI migration
entrypoint is `fromConfig`, which adopts an already-constructed CLI-style
`Config` and never applies these seams.

### Field classification

Most `AgentConfig` fields are **declarative** — the adapter
(`toConfigParameters` in `packages/agents/src/api/agentConfig.adapter.ts`) maps
them onto the core `ConfigParameters` object. A few fields are
**callbacks/factories** that are stripped before schema validation
(`AgentConfigSchema` in `packages/agents/src/api/config-schema.ts` is
`.strict()` and rejects function-typed fields):

- `onApproval`, `onOAuthPrompt`, `editorCallbacks`, `toolSchedulerFactory`.

These are destructured off the input before parsing and threaded directly into
the agent's runtime wiring rather than into `ConfigParameters`.

### The `settings` escape hatch

`settings` (`packages/agents/src/api/config-types.ts`) is an **unstable**
escape hatch for long-tail configuration. Its contents are merged into
`ConfigParameters` by the adapter, and it throws if a key shadows a typed
field. It is not semver-covered.

### Stream-timeout ephemerals

`streamFirstResponseTimeoutMs` and `streamIdleTimeoutMs` are typed
`AgentConfig` fields pushed as runtime `Config` ephemerals _after_ `Config`
construction via `applyRuntimeEphemerals` (in
`packages/agents/src/api/agentConfig.adapter.ts`). The default
first-response-timeout constant is
`DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS = 300_000`, defined in
`packages/core/src/utils/streamIdleTimeout.ts`. A value of `0` or negative
disables the watchdog.

## Confirmation handling (recorded decision B7)

**Decision:** A **wired** approval handler that rejects or throws is **safely
denied** — `AgenticLoop.wireApprovalHandler` in
`packages/agents/src/core/agenticLoop/AgenticLoop.ts` answers the confirmation
with a `Cancel` outcome (the handler `.catch` path) so the loop never hangs.
When **no** handler is wired, `createAgent` leaves `approvalHandler` undefined,
so `wireApprovalHandler()` returns a no-op — it does not auto-answer `Cancel`.
The confirmation therefore cannot be answered. In non-interactive contexts the
confirmation coordinator (`packages/agents/src/scheduler/confirmation-coordinator.ts`,
line 341) surfaces a structured error: `"requires user confirmation, which is
not supported in non-interactive mode"`, which emits an `AgentErrorEvent` and
terminates the turn with exactly one `done{reason:'error'}`.

**Future work (not shipped):** An automatic no-handler safe-denial (auto-`Cancel`
when no handler is wired) is a possible enhancement, sequenced separately. The
shipped semantics are: wired-handler-reject → safe denial; no-handler → clear
error.

## Runtime vs app-service

**Decision:** LLxprt Code distinguishes **runtime** concerns (the live
conversation) from **durable / app-service** concerns (persisted configuration
that outlives any single run).

- **Runtime** concerns live on the live `Agent` (`agent.setModel`,
  `agent.compress`, `agent.mcp.status`, `agent.tools.list`, …).
- **Durable** concerns live on the
  `@vybestack/llxprt-code-agents/app-service.js` subpath as standalone
  functions that do not require a live `Agent`.

The app-service barrel is `packages/agents/src/app-service.ts`, which re-exports
the implementation submodules under `packages/agents/src/app-services/`. The
exports include: `saveCurrentProfile`, `listProfiles`, `deleteProfile`,
`addMcpServer`, `removeMcpServer`, `editMemory`, `manageSkills`,
`manageExtensions`, `getAbout`, `getDiagnostics`, `mutateSettings`,
`listCliLocalCompletions`, and `COMMAND_API_MAP`.

### `COMMAND_API_MAP`

`COMMAND_API_MAP` (`packages/agents/src/app-services/command-api-map.ts`) is the
canonical slash-command to API mapping. Each entry is one of three kinds:

- `runtime` — a live `Agent` method path (affects the active conversation), e.g.
  `/model` → `agent.setModel`, `/compress` → `agent.compress`.
- `subpath` — a durable app-service function, e.g. `/profile save` →
  `saveCurrentProfile`, `/mcp add` → `addMcpServer`.
- `cli-local` — pure UI/UX with no core dependency, e.g. `/help`, `/theme`,
  `/clear`, `/quit`.

The shape of each mapping entry is `{ command, kind, target, exportName?,
note? }`.

#### Runtime rows closing capability gaps (`#2143`)

Six `runtime` rows map slash-commands onto the live `Agent` sub-surfaces:

| Command          | Kind      | Target                        |
| ---------------- | --------- | ----------------------------- |
| `/approval-mode` | `runtime` | `agent.setApprovalMode`       |
| `/policies`      | `runtime` | `agent.policy.getRules`       |
| `/task`          | `runtime` | `agent.tasks.list`            |
| `/hooks`         | `runtime` | `agent.hooks.listHooks`       |
| `/toolkey`       | `runtime` | `agent.tools.keys.save`       |
| `/toolkeyfile`   | `runtime` | `agent.tools.keys.setKeyFile` |

## Power-user subpath: `internals.js`

Low-level primitives are available from the
`@vybestack/llxprt-code-agents/internals.js` subpath. The barrel is
`packages/agents/src/internals.ts`, which is the **single source** of the
low-level re-export surface. The package top-level (`index.ts`) re-exports
everything here via `export * from './internals.js'` so that the top-level and
the `./internals.js` subpath expose the exact same low-level symbols (no
duplication drift).

Exported symbols include: `AgentClient`, `ChatSession`, `CoreToolScheduler`,
`SubagentOrchestrator`, `TaskTool`, turn/subagent types, and compression
primitives.

> `#1595` will migrate CLI/a2a consumers to this subpath and then remove the
> low-level re-exports from the top-level, leaving only the curated public Agent
> API at the package root. Importing low-level symbols from `./internals.js`
> explicitly is the forward-compatible choice.

`createTaskToolRegistration` is intentionally **not** re-exported from
`internals.ts`: it is app-glue (a factory function), and re-exporting it would
create a circular dependency. It remains exported solely from `index.ts`.

## New public enums and projected types (`#2143`)

Issue `#2143` promoted a set of enums and projected types to the public root so
developers can construct and inspect these values without a deep import into
the core package's internals or a raw `Config` escape hatch.

### VALUE enums

These are real runtime values (enum members round-trip), exported from the
public root in `packages/agents/src/api/index.ts` (re-exported from
`@vybestack/llxprt-code-core`):

- `ApprovalMode`: `DEFAULT = 'default'`, `AUTO_EDIT = 'autoEdit'`,
  `YOLO = 'yolo'` — defined in `packages/core/src/config/configTypes.ts`.
- `PolicyDecision`: `ALLOW = 'allow'`, `DENY = 'deny'`,
  `ASK_USER = 'ask_user'` — defined in `packages/policy/src/types.ts`.

### Projected types

These are type-only exports (compile-time shapes for the inspection methods on
the `Agent` sub-surfaces). Each omits non-serializable internals so the public
surface is JSON-safe and stable across versions. Defined in
`packages/agents/src/api/agent.ts`, exported via `packages/agents/src/api/index.ts`:

- `PolicyRuleView` — `argsPattern` is the RegExp source string (JSON-safe),
  never a live `RegExp`.
- `AgentTaskInfo` — omits `abortController`. A discriminated union since #1995:
  `AgentSubagentTaskInfo` (`kind: 'subagent'`, with `subagentName`/`goalPrompt`)
  or `AgentShellJobInfo` (`kind: 'shell'`, with
  `command`/`cwd`/`exitCode`/`signal`/`failureReason`); both share `id`,
  `status`, `launchedAt` and optional `completedAt`. `agent.tasks.cancel` and
  `cancelAllRunning` return promises because stopping a shell job is
  SIGTERM → bounded wait → SIGKILL.
- `HookInfo`, `AuthProviderDetail`, `AuthBucketStatus`.
- `McpServerAuthStatus`, `McpDetailStatus`, `McpServerDetail`,
  `McpDetailsOptions`, `McpPromptInfo`, `McpResourceInfo`, `McpBlockedServer`,
  `McpOAuthStatus`.
- `ToolKeyInfo`, `ToolKeyStatus`.
- `AgentMemoryControl`, `AgentSkillsControl`, `AgentWorkspaceControl`,
  `AgentLspControl`, `SkillInfo`, `LspServerStatus`, `LspStatusSnapshot`,
  `MemoryChangedEvent`, `MemoryRefreshResult`.

### Three constraints (`#2143` capability gaps)

The sub-controllers and projected types close capability gaps that previously
forced a raw `Config` escape hatch or a deep import into the core package. They
are shipped under three constraints:

1. **Masked-only** — raw secrets/tokens are never returned; only `maskedKey` or
   reference metadata surfaces.
2. **Projected public types** — omit non-serializable internals like
   `abortController` and live `RegExp`.
3. **Delegate-don't-cache** — every method delegates to the bound
   runtime/config on each call rather than holding a stale snapshot.

### MCP OAuth quad-state correction (`#2165`)

The `McpServerAuthStatus` fields were corrected in `#2165`:

- `authenticated` means "a valid persisted OAuth token exists" (i.e.
  `oauthStatus === 'authenticated'`) — it is no longer derived from the
  in-session marker.
- `requiresAuth` is the real per-server value (no longer hardcoded `true`).
- `sessionAuthenticated` is an in-session marker, distinct from `authenticated`.
  It is set by either `agent.auth.mcpLogin(server)` or a successful
  `agent.mcp.authenticate(server)` and is not persisted.

## Settings and config projection

The public `Agent` interface does **not** expose a raw `Config` reference.
`fromConfig` still adopts and delegates to the caller-owned `Config`, but clients
should use the typed Agent projections (`memory`, `skills`, `workspace`, `lsp`,
settings, policy, tools, tasks) instead of relying on internal runtime objects.

### Ephemeral settings

`getEphemeralSetting(key)`, `setEphemeralSetting(key, value)`, and
`getEphemeralSettings()` are thin pass-throughs to the bound `Config`.
Normalization and side effects are delegated to the `Config` — numeric coercion,
enum validation, and throws on invalid values are all `Config` rules the agent
propagates (never swallowed).

## Current sequence model

`agent.getCurrentSequenceModel()` (`packages/agents/src/api/agent.ts`) returns
the bound client's current model — the model the load-balancer sequence has
resolved for the active turn. It is nullable: before a model is bound (or if the
runtime has no sequence model), it returns `null`. It reflects rebinds: after
`setModel`, `setProvider`, or a profile rebind that rebuilds the loop,
`getCurrentSequenceModel()` reports the newly bound client's model.

### Context preservation across provider/model switch

`setModel` and `setProvider` (`packages/agents/src/api/agentImpl.ts`):

1. Apply the switch through the real runtime mutators.
2. Re-bind the agent's loop to the current client (`rebuildLoop`).
3. Preserve the same `HistoryService` identity and prior history across the
   rebind.

The `HistoryService` is created eagerly at `createAgent` time and stored for
reuse, so the same instance and accumulated history survives a provider/model
switch.

## `fromConfig` ownership semantics

`fromConfig` (`packages/agents/src/api/fromConfig.ts`) adopts a caller-supplied
`Config`. The `configOwnership: 'caller'` argument is threaded through
`finalizeAgent` (`packages/agents/src/api/createAgent.ts`) so `dispose()` skips
tearing down the caller-owned `Config` while still tearing down an agent-owned
`Config` (from `createAgent`, which passes `configOwnership: 'agent'`).

This is the opposite of `createAgent`, which builds and owns its own
`Config`/client and tears them down on `dispose()`.

## Stats source

Session statistics are projected from the in-process `uiTelemetryService`
singleton (`@vybestack/llxprt-code-core/telemetry/uiTelemetry.js`) combined
with the per-agent `HistoryService`. This is the same source the CLI renders.
The projection lives in `packages/agents/src/api/agentStatsProjector.ts`.

## `AgentClientContract`

The `AgentClientContract` — the structural interface describing the low-level
client the agent binds and drives — is a public, type-only export from the
curated root (re-exported from
`@vybestack/llxprt-code-core/core/clientContract.js`). The concrete
`AgentClient` class is documented on the
[`internals.js`](#power-user-subpath-internalsjs) subpath and is also reachable
from the root today for backward compatibility. Treat it as an unstable internal
that may change without notice.

## Core-owned MCP manager lifecycle

The agents package does not import or reference the concrete `McpClientManager`.
All MCP runtime behavior is surfaced through narrow core-owned `Config`
capabilities (`getMcpRuntimeStatus`, `refreshMcpServers`,
`awaitMcpDiscoveryGate`, `getMcpInstructions`) and a core-owned reload callback.
Agents consumes these capabilities; it never reaches the manager directly.

`agent.mcp.reload()` delegates to the core-owned `Config.reloadMcpServers()`
callback, which awaits the fresh config, swaps MCP and blocked-server state,
rebuilds MCP trusted policy rules, and invokes the live manager's
`reconcileConfiguredMcpServers()` once. After the reload, the agent re-publishes
its client tool declarations. It throws
`"MCP server reload is not available in this composition."` when reload
composition is unwired (the message is defined in
`packages/core/src/config/config.ts`, line 452). Agents must not call
`reconcileConfiguredMcpServers` directly — core owns that reconciliation.

## Recorded decisions

These decisions shaped the public surface and are recorded here for posterity:

- **Entry wording (B11):** the public API ships from
  `@vybestack/llxprt-code-agents`, never `-core` — avoiding a `core → agents`
  cycle.
- **Control-plane scope:** the thirteen sub-surfaces (`profiles`, `tools`,
  `mcp`, `auth`, `ide`, `session`, `hooks`, `policy`, `tasks`, `memory`,
  `skills`, `workspace`, `lsp`) are part of the internal contract, alongside the
  top-level turn/provider/model/approval-mode methods.
- **Confirmation handling (B7):** see [Confirmation handling](#confirmation-handling-recorded-decision-b7).
- **Idle-timeout is terminal:** a stream idle-timeout ends the turn with
  `done{reason:'error'}`.
- **Stats source:** see [Stats source](#stats-source).
- **`settings` escape hatch is unstable:** not semver-covered; prefer typed
  fields.
- **`core/index` trim:** the eventual removal of low-level re-exports from the
  package root is sequenced into `#1595`; today the root entry stays additive
  and non-breaking.
- **`#2143` capability gaps:** see
  [Three constraints](#three-constraints-2143-capability-gaps).

## Source and test locations

| Concern                             | Source                                                                    | Tests                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Public barrel exports               | `packages/agents/src/index.ts`, `packages/agents/src/api/index.ts`        | `scripts/check-agents-api-surface.ts`                      |
| `AgentConfig` types                 | `packages/agents/src/api/config-types.ts`                                 | `packages/agents/src/api/__tests__/config-adapter.spec.ts` |
| `createAgent`                       | `packages/agents/src/api/createAgent.ts`                                  | `packages/agents/src/api/__tests__/`                       |
| `fromConfig`                        | `packages/agents/src/api/fromConfig.ts`                                   | `packages/agents/src/api/__tests__/`                       |
| `Agent` interface and sub-surfaces  | `packages/agents/src/api/agent.ts`                                        | `packages/agents/src/api/__tests__/`                       |
| Event types                         | `packages/agents/src/api/event-types.ts`                                  | `packages/agents/src/api/__tests__/`                       |
| Auth precedence                     | `packages/agents/src/api/control/authState.ts`                            |                                                            |
| `internals.js` barrel               | `packages/agents/src/internals.ts`                                        |                                                            |
| `app-service.js` barrel             | `packages/agents/src/app-service.ts`                                      |                                                            |
| `COMMAND_API_MAP`                   | `packages/agents/src/app-services/command-api-map.ts`                     |                                                            |
| Confirmation forcing                | `packages/agents/src/api/confirmationForcing.ts`                          |                                                            |
| Confirmation coordinator            | `packages/agents/src/scheduler/confirmation-coordinator.ts`               |                                                            |
| Stream-timeout defaults             | `packages/core/src/utils/streamIdleTimeout.ts`                            | `packages/core/src/utils/streamIdleTimeout.test.ts`        |
| ApprovalMode / PolicyDecision enums | `packages/core/src/config/configTypes.ts`, `packages/policy/src/types.ts` |                                                            |
| Package exports map                 | `packages/agents/package.json`                                            |                                                            |

## Verification

The following claims in this document were verified against source during the
2026-08-01 documentation audit:

- `DEFAULT_STREAM_FIRST_RESPONSE_TIMEOUT_MS` is `300_000` — confirmed in
  `packages/core/src/utils/streamIdleTimeout.ts` (line 95), asserted in
  `packages/core/src/utils/streamIdleTimeout.test.ts` (line 594).
- The confirmation-coordinator non-interactive error message — confirmed in
  `packages/agents/src/scheduler/confirmation-coordinator.ts` (line 341).
- The untrusted-folder guard message — confirmed in
  `packages/core/src/config/config.ts` (line 519).
- The MCP reload error message — confirmed in
  `packages/core/src/config/config.ts` (line 452).
- Auth precedence order — confirmed in
  `packages/agents/src/api/control/authState.ts` (`computeAuthWinner`).
- `ApprovalMode` values — confirmed in
  `packages/core/src/config/configTypes.ts` (line 75).
- `PolicyDecision` values (`ASK_USER`, not `ASK`) — confirmed in
  `packages/policy/src/types.ts` (line 7).
- Subpath exports — confirmed in `packages/agents/package.json`.

## A2A server follow-up

**Status:** Next release work. Issue `#2204` enforces the public-API boundary
for the interactive CLI and non-interactive prompt mode — the two primary
near-term clients. The A2A server (`packages/a2a-server`) is intentionally out
of scope for that release because it was ported from upstream incompletely and
needs holistic follow-up work.

### Current state (not yet migrated)

- The A2A server does not consume the high-level public `Agent` surface
  (`createAgent` / `fromConfig` / `agent.stream` / `agent.chat`). Instead it
  imports the lower-level `AgentClient` directly and constructs its own `Config`
  internally via `executor.ts` (`getConfig()`).
- It bypasses the `createAgent`/`fromConfig` composition root that the CLI and
  the replaceable-client smoke test use, so it does not yet benefit from the
  single-agent / single-`ProviderManager` ownership invariants enforced by the
  public API.

### Next-release work

1. Migrate `packages/a2a-server/src/agent/executor.ts` and
   `task-runtime-helpers.ts` to construct the agent via the public
   `createAgent` / `fromConfig` API rather than instantiating `AgentClient` and
   building a `Config` directly.
2. Drive task execution through `agent.stream()` / `agent.chat()` and consume
   the typed `AgentEvent` stream, instead of the bespoke executor loop.
3. Add an A2A-specific import-boundary guard analogous to
   `scripts/check-cli-import-boundary.ts` once the A2A server is migrated.

The import-boundary choices in `#2204` (public root + `app-service.js` allowed;
deep runtime construction forbidden for CLI clients) do not block future A2A
adoption — the same public surface is available to the A2A server once its port
is completed.

## Tradeoffs

- **Additive root barrel.** The root re-exports `internals.js` symbols for
  backward compatibility, at the cost of a larger public surface until `#1595`
  trims it. This was chosen to avoid breaking existing consumers mid-release.
- **Delegate-don't-cache.** Every sub-surface method delegates to the bound
  runtime on each call. This avoids stale snapshots but adds per-call overhead.
  The tradeoff favors correctness over performance for configuration
  inspection.
- **Per-agent in-memory key store.** Named auth keys live in a per-agent
  `Map` that dies with the agent and never touches disk or the host keychain.
  This simplifies the hermeticity story (tests do not pollute the developer's
  host) but means named keys do not persist across agent instances.
