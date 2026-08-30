# Issue #3221 — Interface reach-through inventory (CLI + A2A)

Classification legend:
- **P** = presentation-only (legitimate host responsibility)
- **TI** = typed host input (interface parses input, sends declarative intent)
- **API-needed** = requires a public Agent operation/query/event (or already has one)
- **R** = obsolete internal reach-through (remove / convert)

Produced 2026-08-27 from production source on `issue3221` (base 354957220).
Test files excluded. Every entry cites file:line at inventory time.

---

## A. CLI (packages/cli)

### A1. Runtime assembly

| Site | What | Class | Disposition |
|---|---|---|---|
| src/config/configBuilder.ts:351 | `new Config(configParams)` — the single prod construction site (~60 args incl. factory bindings, skills registrar hook, onReloadMcpServers, githubBrokerClient, eventEmitter) | R | **#3222 owns** — its problem statement names this site; removal requires #3222 to fix providers' isolated runtime first |
| src/config/configBuilder.ts:17-18,38-39 | `registerAgentRuntimeFactories`/`attachAgentRuntimeFactories` (provider-held mutable registration seam) | R | **#3222 owns** |
| src/config/postConfigRuntime.ts:274 | `new ProfileManager()` post-Config | R | convert with #2635/#2643 transactional profile ops |
| src/cliSessionBootstrap.ts:135,156 | `new SettingsService()`, `new ProfileManager()` | R | profile application path; **#2635/#2643** |
| src/cliProviderInit.ts | private-field reads `_profileModelParams/_cliModelParams/_bootstrapArgs/_cliModelOverride`; `providerManager.setActiveProvider` | R | convert with #3222/#2635 (provider/profile transaction) |
| src/runtime/interactiveToolScheduler.ts | host-side scheduler via `getOrCreateScheduler` (slash-command flows) | API-needed (partial) | main loop already consumes `agent.stream()`; slash-flow scheduling remains host capability via Config seam until #3222 |
| src/ui/RuntimeContext.tsx:21-64 | 43 value imports from `providers/runtime.js` (biggest UI bridge) | API-needed (P2 gap) | deferred: needs provider-metrics/model-list/diagnostics surfaces (siblings/follow-ups); classified, not converted here |

### A2. Deep imports (production)

| Import | Sites | Class | Disposition |
|---|---|---|---|
| `@vybestack/llxprt-code-tools/tools/activate-skill.js` | configBuilder.ts:19 (registrar hook) | R | rides with configBuilder → **#3222** |
| `@vybestack/llxprt-code-tools/tools/acquisition.js` | shellCommandProcessor.ts:28, zed-terminal-manager.ts:22, injectionOutputBudget.ts:12 | TI/P | terminal-presentation helpers; benign data helpers — leave (guard allowlist concept in #2618) |
| `@vybestack/llxprt-code-telemetry/perf/*` | 5 files | P | perf reporting for terminal; leave for #2618 manifests |
| `@modelcontextprotocol/sdk/client/index.js` | commands/mcp/list.ts:15 | TI | MCP SDK type used to describe server entries; candidate for typed public contract in #2618 |

### A3. Provider SDK dependencies

| Dependency | Evidence | Class | Disposition |
|---|---|---|---|
| `@anthropic-ai/sdk@^0.55.1` (package.json:49) | zero imports anywhere in packages/cli (src, bin, bundle config; string hits are provider-name literals in tests only); not in bundle externals | R | **remove in this PR** |
| `openai@^5.10.1` (package.json:99) | zero imports, same verification | R | **remove in this PR** |

### A4. Settings/MCP mutations

| Site | Class | Disposition |
|---|---|---|
| commands/mcp/add.ts:173-182, remove.ts:22-25 (settings mutation for mcp add/remove) | TI→API-needed | settings-file mutation is host-side persistence; runtime refresh already goes through Agent mcp control. Leave; #2618/#2635 adjacent |

### A5. Already-converted surfaces (no action)

- Interactive loop consumes `agent.stream()` (useAgentEventStream.ts:327, #2372).
- Agent creation via `fromConfig` (cliAgentBootstrap.ts:71, nonInteractiveCli.ts:465, zedIntegration.ts:370).
- Provider activation via declarative agent config (#2374, #2481).
- No history-internals deep imports; settings imports all root-barrel.

---

## B. A2A server (packages/a2a-server)

### B1. Runtime assembly (all removed by this PR)

| Site | What | Class |
|---|---|---|
| src/config/config.ts:41 | `new Config(configParams)` | R |
| src/config/config.ts:103-113 | hand-wired `agentClientFactory`/`toolSchedulerFactory`/`taskToolRegistration` lambdas (createAgentClient/createToolScheduler/createTaskToolRegistration) | R |
| src/config/config.ts:148-158 | `new MessageBus` + structural-cast `config.initialize({messageBus})` | R |
| src/config/config.ts:160-208 | env-driven `config.refreshAuth(...)` orchestration (ccpa/api-key/vertex/oauth matrix) | R → TI (env parsing stays; execution becomes declarative `activation`) |
| src/agent/task.ts:112-116 | per-task `new MessageBus(policyEngine, debugMode)` | R → `agent.getMessageBus()` |
| src/agent/task.ts:118-127 | `createAgentRuntimeState(...)` | R |
| src/agent/task.ts:129-132 | direct `createAgentClient(config, runtimeState)` | R |
| src/agent/task.ts:331-348 | `(config as SchedulerConfig).getOrCreateScheduler(...)` structural cast | R → loop-owned scheduling via `agent.stream()` |
| src/agent/executor.ts:161,188 | `agentClient.initialize(config.getContentGeneratorConfig())` | R |

### B2. Deep imports

| Import | Sites | Class |
|---|---|---|
| `@vybestack/llxprt-code-core/services/history/IContent.js` (type-only ContentBlock/TextBlock) | task.ts, task-support.ts | API-needed (typed data contract) — use/export public typed contract instead of subpath |

### B3. Legitimate host concerns (stay in A2A)

- dotenv/env loading, workspace path resolution (`setTargetDir`), HTTP
  transport, task persistence, a2a protocol part mapping, buffered publication
  semantics, socket-close abort, per-task isolation model.
- `persistence/` task store; `commands/` protocol handlers.

---

## C. Enforcement gaps

| Gap | Disposition |
|---|---|
| `scripts/check-cli-import-boundary.ts` covers packages/cli/src only; a2a unpoliced | **this PR**: generalize to scan a2a (deep-import + construction bans) |
| `new Config` legal in covered packages | **this PR** for a2a (ban); CLI ban rides with #3222 |
| tsconfig wildcard paths in cli + a2a neutralize export maps | a2a aliases dropped here where migrated; full removal **#2618** |
| no ESLint no-restricted-imports for cli/a2a | **#2618** (generalized manifests) |

## D. Public Agent API gap list (classified, deferred unless a2a needs it now)

P0 (a2a bootstrap/identity/scheduler-callbacks/initialize/env-auth) — addressed
in this PR via createAgent/stream/confirmations. P1 (CLI bootstrap assembly:
ActivateSkillTool registrar hook, Config service injection, sandbox/github-broker
auth ops) — **#3222/#2619**. P2 (UI bridge: listAvailableModels,
getUnallowedParametersForActiveModel, tool-format state, provider metrics,
session token usage, load-balancer stats, profiles.create isLoadBalancer,
runtime diagnostics, session settings, runtime scopes, provider aliases,
quota/usage/reset-credits/provider-info/request-dump, MCP connection
test/token-expiry/config add-remove, perf surface, tools/acquisition) —
siblings/follow-ups per Coordination section of the plan README.
