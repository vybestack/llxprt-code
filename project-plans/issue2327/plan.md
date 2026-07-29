# Issue 2327 Delivery Plan: Lazy MCP Tool Schemas

Plan ID: PLAN-20260728-ISSUE2327
Base: `533e6bb98` (`origin/main`)
Issue: https://github.com/vybestack/llxprt-code/issues/2327

## Policy provenance

`dev-docs/workflow/ISSUE-DELIVERY.md` is not present on the candidate base. This plan applies the bounded issue-delivery rules supplied with the issue request directly. `dev-docs/RULES.md` governs TDD and behavioral evidence.

## Problem and chosen architecture

Every registered MCP tool's complete schema currently reaches the model through `ToolRegistry.getFunctionDeclarations()` and `AgentClient.setTools()`. The bounded implementation will continue connecting to and discovering configured MCP servers, but an opt-in registry filter will omit unused MCP schemas from the model-facing declaration list.

The chosen design is:

- `mcp.lazy` is an opt-in, profile-persisted ephemeral boolean. Missing, false, or malformed values preserve eager behavior.
- `mcp.eagerServers` is an optional profile-persisted string array. It pins named servers to eager schema publication while lazy mode is enabled.
- Lazy loading is server-granular. MCP tools remain registered and executable; only model-facing schema publication is deferred.
- A concrete `activate_mcp_server` tool mirrors the existing `activate_skill` pattern. Its compact description lists deferred server names and up to 12 tool names per server, never full parameter schemas.
- Activating a server records its name in the session's `ToolRegistry`, refreshes model tools through the existing MCP context refresh path, and remains active for the session.
- `Config.refreshMcpContext()` rebuilds the activation tool after existing MCP lifecycle events, so connection, disconnection, restart, extension, trust, and tool-list changes reuse existing lifecycle plumbing.
- No MCP discovery, transport, OAuth, trust, execution-confirmation, prompt, resource, or instruction behavior changes.

This deliberately does not overload `MCPServerConfig.trust`; trust remains an execution-confirmation setting. No per-server config-schema field is needed because `mcp.eagerServers` supplies the bounded escape hatch.

## Decision-complete acceptance matrix

| ID | Given | When | Then | Evidence |
| --- | --- | --- | --- | --- |
| A1 | `mcp.lazy` is absent, false, or not boolean true | declarations are requested | all existing MCP and non-MCP declarations are byte-equivalent to the pre-feature path | tools behavioral test |
| A2 | `mcp.lazy` is true and no MCP tools exist | declarations are requested | builtin/discovered declarations are unchanged and no activation tool is exposed | tools behavioral test |
| A3 | `mcp.lazy` is true with MCP servers alpha and beta | declarations are requested | alpha and beta schemas are omitted while non-MCP schemas remain | tools behavioral test |
| A4 | lazy mode is true and `mcp.eagerServers` contains alpha | declarations are requested | alpha schemas are present and beta remains deferred | tools behavioral test |
| A5 | `mcp.eagerServers` is absent, malformed, or names an unknown server | declarations are requested | it is treated as empty/irrelevant without changing the remaining lazy decisions | tools behavioral test |
| A6 | an MCP tool is disabled or excluded by existing governance | its server is eager or activated | the existing governance still omits it | tools behavioral test |
| A7 | an explicitly configured subagent asks for a deferred MCP tool by name | filtered declarations are requested | the explicit filtered declaration path remains unchanged | tools behavioral test |
| B1 | at least one MCP server is deferred after MCP refresh | declarations are requested | exactly one `activate_mcp_server` declaration is present | activation integration test |
| B2 | alpha and beta are deferred | activation schema/description is inspected | the name enum contains alpha and beta and the description contains server names, tool counts, and tool names but no parameter schemas | activation tool test |
| B3 | a deferred server has more than 12 tools | activation description is inspected | 12 names and an omitted-count marker are shown | activation tool test |
| B4 | the model activates alpha | activation completes | alpha's complete schemas are published on the next model request, beta remains deferred, and the result explains that alpha is available | activation tool/integration test |
| B5 | alpha was already activated | alpha is activated again | activation is idempotent and alpha stays published | tools behavioral test |
| B6 | all servers are eager or activated, or lazy mode is off | activation tool is synchronized | `activate_mcp_server` is absent | activation integration test |
| B7 | an unknown server name is supplied | tool parameters are built or registry activation is requested directly | validation fails with a clear error and no server is activated | activation tool/tools test |
| C1 | alpha is activated | subsequent turns occur | alpha remains active for this `ToolRegistry` session | tools behavioral test |
| C2 | alpha is activated and its tools are removed on disconnect | declarations are requested | no alpha schemas remain and no stale activation choice is exposed as deferred | tools behavioral test |
| C3 | alpha is activated and reconnects/restarts under the same server name | tools are registered again | the replacement alpha schemas remain published in the same session | tools behavioral test |
| C4 | a deferred/activated server's tool list changes | existing MCP refresh runs | new tools follow the server's current deferred/activated state and the activation enum is rebuilt | core integration test |
| C5 | a fresh `ToolRegistry` is created | lazy declarations are requested | previous activation state is absent | tools behavioral test |
| D1 | settings registry is queried | `mcp.lazy` and `mcp.eagerServers` are inspected | types are boolean and string-array and both persist to profiles | settings test |
| D2 | a user enables lazy mode in a profile | a new session completes MCP discovery/refresh | activation behavior is available without any config schema or dependency change | core integration test |
| E1 | equivalent real MCP-shaped schemas are registered in eager and lazy registries | declarations are serialized | the test records declaration count and serialized character count and proves lazy mode is smaller | tools behavioral measurement |
| E2 | lazy mode defers only alpha while beta is activated/eager | declarations are serialized | the measured reduction is attributable only to alpha's omitted schemas | tools behavioral measurement |
| F1 | the feature is documented | a user reads ephemeral and MCP docs | opt-in syntax, eager exceptions, server granularity, session scope, context tradeoff, and exclusions are stated | doc review |

## Explicit non-goals

- Auto-unload after idle turns. It requires turn-level usage tracking and a new subsystem; the issue describes it as optional.
- Deferring server connection, process startup, authentication, or tool discovery.
- Tool-level activation within one server. Existing `includeTools` and `excludeTools` provide static trimming.
- Deferring MCP prompts, resources, or server instructions.
- Changing `getAllTools()`, `getEnabledTools()`, `getToolsByServer()`, `getTool()`, or public agent/MCP control types.
- Persisting activation state between sessions.
- Adding `/mcp load`, `/mcp` status rendering, telemetry, runtime token accounting, or a tokenizer dependency.
- A per-server `MCPServerConfig.lazy` field or any settings JSON-schema change.
- Any workflow, agent-memory, quality-tool, package dependency, lint, complexity, coverage, safety, cross-platform, or CI change.
- Unrelated refactors, test moves, cleanup, or optional hardening.

## Bounded test-first vertical slices

### Slice 1: registry schema deferral

RED: add real-registry behavioral tests for A1-A7, B5, C1-C3/C5, and E1-E2. Use MCP-shaped real declarative tools and a structural registry host; do not mock the component under test.

GREEN: add only the session activation set, lazy/eager setting interpretation, server validation/listing, and one model-declaration predicate to `ToolRegistry`.

### Slice 2: model activation tool

RED: add behavior tests for B1-B3, B4, B6-B7 using the real registry and tool.

GREEN: add the concrete `ActivateMcpServerTool`, its name constant/export, and compact discoverability description. Activation must await the existing context refresh callback before returning.

### Slice 3: existing lifecycle integration

RED: add a real `Config.refreshMcpContext()` integration test covering D2 and dynamic enum/state behavior C4 without mock-call assertions.

GREEN: add one concrete sync helper and call it from `refreshMcpContext()`. It may unregister/re-register only the activation tool; it must not alter MCP manager/discovery behavior.

### Slice 4: configuration registration and documentation

RED: extend settings registry tests for D1.

GREEN: register the two ephemerals and document F1. No config schema, MCP server config class, or dependency changes.

Each production change must be written after its failing behavioral test. Existing tests must remain unchanged except additive settings assertions.

## Expected paths

Planned new files:

1. `project-plans/issue2327/plan.md`
2. `packages/tools/src/tools/activate-mcp-server.ts`
3. `packages/tools/src/__tests__/tool-registry-mcp-lazy.test.ts`
4. `packages/tools/src/tools/activate-mcp-server.test.ts`
5. `packages/core/src/config/mcp-lazy-tool-sync.ts`
6. `packages/core/src/config/config.mcp-lazy.test.ts`

Planned modified files:

7. `packages/tools/src/tools/tool-registry.ts`
8. `packages/tools/src/types/tool-names.ts`
9. `packages/tools/src/index.ts`
10. `packages/core/src/config/config.ts`
11. `packages/settings/src/settings/registry/registry-entries-2.ts`
12. `packages/settings/src/__tests__/settingsRegistry.test.ts`
13. `docs/reference/ephemerals.md`
14. `docs/tools/mcp-server.md`

The two planned public registry methods are limited to `activateMcpServer(name)` and `listDeferredMcpServers()`. The concrete activation-tool export is planned feature surface, not a general-purpose abstraction. Any additional public method, interface, adapter, manager, service, or agent API field requires approval.

## Scope ledger

| Category | Planned net lines | Actual net lines |
| --- | ---: | ---: |
| Plan | 170 | 191 |
| Production source | 260 | 337 |
| Behavioral/settings tests | 575 | 860 |
| Documentation | 55 | 48 |
| Total (14 files) | 1,060 | 1,436 |

Targets and stops:

- Target ceiling: 25 files or 1,500 net changed lines.
- Mandatory scope review if either target is exceeded.
- Hard stop without approval: more than 40 files or 2,500 net changed lines.
- This plan additionally stops at the 25/1,500 target rather than consuming the hard budget without approval.
- Count generated or incidental tracked changes in the ledger; do not hide them as tooling output.

## Review triage contract

Every DeepThinker, OCR, CodeRabbit, CI, and human finding will be recorded as exactly one of:

- **Blocker-Fix**: accepted behavior, safety, correctness, architecture, or required gate cannot complete without it.
- **In-scope-Fix**: valid issue within this matrix and ledger.
- **Reject**: factually incorrect, already covered, or harmful to accepted behavior.
- **Defer**: valid but outside this issue's matrix; no implementation in this PR.

Reviewer suggestions never expand scope. At most two local OCR and two PR OCR runs are allowed.

## Stop conditions requiring approval
## Review triage record

DeepThinker findings:

- **Blocker-Fix:** foreign activation-tool collision, documented eager-server value shape, prohibited assertions, acceptance evidence gaps, and the scope overrun were fixed.
- **In-scope-Fix:** current-session `/set` limitations were documented, speculative exports were removed, and redundant comments were removed.
- **Reject:** removing runtime MessageBus storage, removing flat/nested setting support, or replacing the established MCP refresh lifecycle were source-incompatible recommendations.
- **Defer:** auto-unload, a hot-apply settings subsystem, generic parser/legacy-profile modernization, activation rollback, telemetry, status UI, tokenizer accounting, per-server config fields, tool-level activation, and connection/instruction deferral.

Local OCR run `20260728T175051Z-2afc8ff7` (`complete_best_effort`) produced nine hypotheses:

- **In-scope-Fix:** primitive ephemeral input handling, repeated eager-setting allocation, and execution-phase error classification were fixed.
- **Reject:** duplicate partial-eager coverage, changing the accepted explicit subagent path, clearing session activation on reconnect, and claims that activated replacement tools remain deferred.
- **Defer:** transactional activation rollback after refresh failure.

All accepted findings are resolved without expanding the acceptance matrix.


Stop before:

- any new subsystem, general public abstraction, interface/adapter/manager/service, or extra public registry/API method;
- any dependency, package graph, workflow, agent-memory, quality-tool, lint/complexity/coverage/CI/config-schema change;
- any MCP connection, discovery, OAuth, trust, confirmation, prompt/resource/instruction, or auto-unload behavior change;
- behavior not listed in the acceptance matrix;
- moving an unrelated refactor or test into scope;
- changing/deleting existing assertions to legitimize a default-path regression;
- exceeding the target ledger after consolidating test setup, or exceeding the hard budget under any circumstance.

## Required gates and exact-head completion

The candidate head is complete only when:

1. Every acceptance row has behavioral evidence on that exact head.
2. `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` pass.
3. The prescribed llxprt smoke test passes.
4. Local DeepThinker and OCR reviews are complete; every finding is classified; all Blocker-Fix and In-scope-Fix items are resolved.
5. The exact committed head is pushed; CI and bounded PR reviews pass on it; CodeRabbit threads are evaluated, answered, and resolved.
6. `git merge-base --is-ancestor origin/main HEAD` succeeds, the PR reports no conflicts, and the scope ledger is clean.
7. No forbidden suppressions, weakened gates, optional cleanup, or out-of-matrix changes are present.

Stop successfully at that point. Do not continue optional hardening or cleanup.
