# P06 — RuntimeDependencies and Composition-Root Migration

Plan ID: PLAN-20260808-ISSUE2615.P06
Requirements: REQ-003, REQ-004

## Why this phase is the hinge

Every previous attempt to narrow this codebase stalled at the same wall: a leaf
file forwards its `Config` into a composition root, the root reads 8–25 members,
and no capability interface for the root is meaningful. The conclusion drawn
repeatedly was "composition roots should keep `Config`."

That conclusion is wrong in one specific way. A composition root does need many
dependencies — but it does not need them **as a `Config`**. It needs them as an
explicit record. Once it takes that record, the `Config` type disappears from
the root, and every file below it is free.

Do this phase before any bulk migration. P07–P10 are mechanical only because
P06 has landed.

## Deliverable 1 — `packages/core/src/config/runtimeDependencies.ts`

An interface listing exactly what the composition roots need, drawn from
`analysis/role-assignment.json`:

- the role interfaces they read from, by composition
- every service from `serviceLocators` that they currently fetch, as a **field**

Sketch — final shape comes from P01 data, not from this sketch:

```ts
export interface RuntimeDependencies {
  readonly session: SessionIdentity;
  readonly model: ModelSelection;
  readonly settings: EphemeralSettings;
  readonly paths: WorkspacePaths;
  readonly memory: MemoryAccess;
  readonly policy: PolicyAccess;
  readonly diagnostics: Diagnostics;

  // formerly fetched via service-locator getters on Config
  readonly toolRegistry: ToolRegistry;
  readonly providerManager: RuntimeProviderManager | undefined;
  readonly settingsService: SettingsService;
  readonly hookSystem: HookSystem | undefined;
  readonly subagentManager: SubagentManager | undefined;
  readonly messageBus: MessageBus;
}
```

## Deliverable 2 — a core-owned adapter

```ts
export function runtimeDependenciesFromConfig(config: Config): RuntimeDependencies;
```

Lives in core, takes the concrete `Config`, returns the record. This is the
**only** place outside core's own internals that reads the service-locator
getters. It is not a shim: it is the composition step, and it is where the
application entry point is expected to build its dependency record.

## Deliverable 3 — migrate the roots

P01 identified **21** composition roots, not the 5 this file originally named.
The authoritative list is `analysis/role-assignment.json` -> `compositionRoots`,
ordered by members read:

| File | members | calls fromConfig |
|---|---|---|
| `agents/src/api/agentImpl.ts` | 17 | no |
| `providers/src/runtime/runtimeContextFactory.ts` | 13 | no |
| `agents/src/core/subagentRuntimeSetup.ts` | 12 | no |
| `agents/src/core/ChatSessionFactory.ts` | 12 | no |
| `agents/src/api/fromConfig.ts` | 11 | (is the boundary) |
| `mcp/src/client/mcp-client-manager.ts` | 11 | no |
| `agents/src/api/createAgent.ts` | 10 | no |
| `cli/src/config/postConfigRuntime.ts` | 10 | no |
| `cli/src/nonInteractiveCli.ts` | 10 | **yes** |
| `providers/src/runtime/providerSwitch.ts` | 9 | no |
| `cli/src/cliSessionBootstrap.ts` | 9 | no |
| `a2a-server/src/agent/task.ts` | 9 | no |
| `agents/src/agents/executor.ts` | 7 | **yes** |
| `cli/src/zed-integration/zedIntegration.ts` | 7 | **yes** |
| `agents/src/core/client.ts` | 6 | no |
| `agents/src/tools/task.ts` | 3 | no |
| `cli/src/cliAgentBootstrap.ts` | 2 | **yes** |
| `agents/src/api/agentBootstrap.ts` | 1 | no |
| plus 3 with 0 members read | — | no |

Migrate every root in this table except `fromConfig.ts` itself.

Order matters: do the four `fromConfig` callers last, since they are the ones
that need the concrete-`Config` passthrough field.

Callers build the record with `runtimeDependenciesFromConfig(config)` at the
application entry point, once.

## The `fromConfig` constraint — read this before starting

`packages/agents/src/api/fromConfig.ts` takes a real `Config` and there is a
test asserting `internalConfig(agent) === the SAME caller-supplied Config`. That
identity is a real contract and **must not be broken**.

Therefore: `fromConfig` keeps its `Config` parameter. It is an adoption boundary,
not a composition root, and it is explicitly out of scope for this phase.
Composition roots that currently call `fromConfig` pass through the concrete
`Config` they were given at the entry point — which they hold as
`RuntimeDependencies.config`, a field typed as the concrete class and permitted
only here.

P01 shows **four** roots call `fromConfig`: `cli/src/nonInteractiveCli.ts`,
`agents/src/agents/executor.ts`, `cli/src/zed-integration/zedIntegration.ts`
and `cli/src/cliAgentBootstrap.ts`. Those four — and only those four — may
carry a `config` field typed as the concrete class. If a fifth appears, stop and
report rather than widening it.

## Acceptance criteria

- `runtimeDependencies.ts` and its adapter exist in core, exported via
  `./config/roles`
- All five roots take `RuntimeDependencies`
- No role interface gained a service-locator member (REQ-004)
- `fromConfig` unchanged; its identity test unchanged and passing
- `npm run typecheck`, `lint`, and the agents + cli suites pass
- Commit is self-contained and green

## Review gate

On completion, `deepthinker` reviews with the phase file, the diff, and the
question: *does the `RuntimeDependencies` record leak the god-object in a new
shape, or is it a genuine explicit-dependency record?* If it is judged a
rebadged `Config`, the phase is redone before P07 starts.
