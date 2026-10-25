# T5.5-inv: `McpRuntimeOwner.create` caller inventory

Produced at HEAD `2c13d4e56` by an AST scan (TypeScript compiler API, call expressions whose callee is `McpRuntimeOwner.create`) over every file that names `McpRuntimeOwner` outside `project-plans/` and `tmp/` (163 files). The same scan found no reference to `McpRuntimeOwner.create` that is not a call (no alias, no `.bind`, no element access, no spread arguments). `git grep -n "McpRuntimeOwner.create"` over the whole repository lists 89 lines: 82 are calls, 7 are plan text. Callers exist only in `packages/agents` and `packages/cli`; `packages/zed-acp` names the type but never calls `create`.

## Counts

- Calls: 82 in 56 files.
- Production: 4 calls in 4 files (all `packages/agents/src/api`).
- Test: 78 calls in 52 files (48 in `packages/agents`, 4 in `packages/cli`). Three of the agents files are shared test helpers rather than test files (`helpers/mcp-owner-fixture.ts`, `helpers/async-child-disposal-join-fixture.ts`, `core/__tests__/subagent-test-helpers.ts`), and cli `integration-tests/test-utils.ts` plays the same role.
- Test files by edit class: 44 mechanical (M), 8 needing non-mechanical edits (N). The 4 production callers are all N and are changed by T5.5, not by the batches.
- Batches: 5 (T5.5a, T5.5b, T5.5c, T5.5d in agents with 12 files each; T5.5e in cli with 4 files), each at most 12 files and within one package.

## Position map (the tuple at HEAD, 21 positions)

1 `oauth`, 2 `config`, 3 `messageBus`, 4 `host` (`{ emitFeedback }`), 5 `managerFactory`, 6 `extensionLoader`, 7 `policyOwner`, 8 `policyOwnership`, 9 `lspOwner`, 10 `lspOwnership`, 11 `filesystemOwner`, 12 `filesystemOwnership`, 13 `memoryOwner`, 14 `definitionOwner`, 15 `definitionOwnership`, 16 `trustPort`, 17 `idePort`, 18 `trustCleanup`, 19 `skillOperations`, 20 `mcpSettings`, 21 `filesystemService`.

Mapping to the new objects (`ports-B6-B3.md`): positions 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18 and 21 go to `McpRuntimeAcquisition`; position 4 (`host.emitFeedback`), 19 and 20 go to `McpRuntimeOperations`.

## Shape summary (all 82 calls)

Omitted trailing positions are positions past the last argument; explicit `undefined` runs are `undefined` literals passed in a slot.

| Count | Shape |
| --- | --- |
| 44 | 8 args; filled 1-3, 7-8; undefined 4-6; omitted 9-21 |
| 19 | 2 args; filled 1-2; undefined none; omitted 3-21 |
| 4 | 7 args; filled 1-3, 7; undefined 4-6; omitted 8-21 |
| 2 | 20 args; filled 1-2, 5, 20; undefined 3-4, 6-19; omitted 21 |
| 2 | 7 args; filled 1-3, 5, 7; undefined 4, 6; omitted 8-21 |
| 1 | 16 args; filled 1-2, 9-10, 12, 15-16; undefined 3-8, 11, 13-14; omitted 17-21 |
| 1 | 19 args; filled 1-4, 6-12, 14-15, 19; undefined 5, 13, 16-18; omitted 20-21 |
| 1 | 16 args; filled 1-2, 8, 10, 12, 15-16; undefined 3-7, 9, 11, 13-14; omitted 17-21 |
| 1 | 20 args; filled 1-2, 20; undefined 3-19; omitted 21 |
| 1 | 6 args; filled 1-2, 6; undefined 3-5; omitted 7-21 |
| 1 | 12 args; filled 1-3, 8, 10-12; undefined 4-7, 9; omitted 13-21 |
| 1 | 5 args; filled 1-2, 5; undefined 3-4; omitted 6-21 |
| 1 | 13 args; filled 1-3, 7-8, 13; undefined 4-6, 9-12; omitted 14-21 |
| 1 | 20 args; filled 1-4, 7-8, 10-16, 18-20; undefined 5-6, 9, 17; omitted 21 |
| 1 | 20 args; filled 1-4, 7-20; undefined 5-6; omitted 21 |
| 1 | 21 args; filled 1-4, 7-18, 20-21; undefined 5-6, 19; omitted none |

The common shapes: 44 calls pass `oauth, config, bus, undefined x3, policyOwner, ownership` (8 arguments, `undefined` run at 4-6), 19 calls pass only `oauth, config`, and 6 calls pass 7 arguments. Every other shape occurs once or twice.

Defaults the constructor applies today when a position is missing, which the new helper and the five production callers must now spell out (the doc keeps these members required):

- `policyOwnership` defaults to `'caller'` (`selectMcpConstructionInputs`); with no `policyOwner` the runtime still owns the policy it builds.
- `lspOwnership`, `filesystemOwnership` and `definitionOwnership` default to `'runtime'` when the matching owner is `undefined`, else `'caller'`.
- `managerFactory` defaults to `McpClientManager` (`mcpRuntimeAssembly.ts` constructor). All four production callers pass `undefined` there today, so each gains `managerFactory: McpClientManager`.
- `skillOperations` defaults to `DEFAULT_SKILL_OPERATIONS`.
- `messageBus` with no `policyOwner` is rejected by `constructPolicyOwner` ("MCP policy handoff requires its explicit runtime owner"), and a bus that is not `policyOwner.session.messageBus` is rejected too.

## Production callers (4, all in packages/agents)

| File:line | Args | Filled positions | Explicit `undefined` runs | Omitted trailing | Edit class |
| --- | --- | --- | --- | --- | --- |
| packages/agents/src/api/activationPreflightState.ts:242 | 20 | 1-4, 7-8, 10-16, 18-20 | 5-6, 9, 17 | 21 | N (see notes) |
| packages/agents/src/api/adopted-agent-assembly.ts:309 | 20 | 1-4, 7-20 | 5-6 | 21 | N (see notes) |
| packages/agents/src/api/mcpOAuthAssembly.ts:77 | 21 | 1-4, 7-18, 20-21 | 5-6, 19 | none | N (see notes) |
| packages/agents/src/api/skill-discovery.ts:72 | 2 | 1-2 | none | 3-21 | N (see notes) |

## Test callers (78 calls in 52 files)

"M" is a mechanical swap: every filled argument maps to exactly one named member and no argument expression changes. "N" needs non-mechanical edits: 12 or more arguments, a filled position 13, 19, 20 or 21 (memory handoff, skill operations, MCP settings, filesystem service), or a conditional ownership expression.

| File | Batch | Calls (line: args, filled positions, explicit undefined runs, omitted trailing) | Class |
| --- | --- | --- | --- |
| packages/agents/src/api/__tests__/AgentRuntimeState.configDispose.test.ts | T5.5a | 35: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/activation-bootstrap-rollback.behavior.test.ts | T5.5a | 68: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/adoption-binding-failure.behavior.test.ts | T5.5a | 85: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/borrowed-lsp-publication-release.behavior.test.ts | T5.5a | 47: 16 args, filled 1-2, 9-10, 12, 15-16, undefined 3-8, 11, 13-14, omitted 17-21 | N |
| packages/agents/src/api/__tests__/borrowed-settings-disposal.behavior.test.ts | T5.5a | 82: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/config-initialization-boundary.behavior.test.ts | T5.5a | 73: 7 args, filled 1-3, 7, undefined 4-6, omitted 8-21<br>184: 7 args, filled 1-3, 7, undefined 4-6, omitted 8-21<br>293: 7 args, filled 1-3, 7, undefined 4-6, omitted 8-21 | M |
| packages/agents/src/api/__tests__/finalize-agent-collaborators.behavior.test.ts | T5.5a | 75: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/foreground-task-streaming-preservation.test.ts | T5.5a | 223: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/api/__tests__/helpers/async-child-disposal-join-fixture.ts | T5.5a | 373: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/api/__tests__/helpers/mcp-owner-fixture.ts | T5.5a | 58: 19 args, filled 1-4, 6-12, 14-15, 19, undefined 5, 13, 16-18, omitted 20-21 | N |
| packages/agents/src/api/__tests__/hook-provider-wire.behavior.test.ts | T5.5a | 144: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/api/__tests__/ide-client-independent.test.ts | T5.5a | 87: 16 args, filled 1-2, 8, 10, 12, 15-16, undefined 3-7, 9, 11, 13-14, omitted 17-21 | N |
| packages/agents/src/api/__tests__/instruction-publication-drain.behavior.test.ts | T5.5b | 92: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/isolated-session-client.behavior.test.ts | T5.5b | 68: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/mcp-adopted-extension-lifetime.test.ts | T5.5b | 93: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>260: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/mcp-approval-scheduler-isolation.test.ts | T5.5b | 202: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/api/__tests__/mcp-config-lifetime.test.ts | T5.5b | 331: 2 args, filled 1-2, undefined none, omitted 3-21<br>398: 20 args, filled 1-2, 20, undefined 3-19, omitted 21 | N |
| packages/agents/src/api/__tests__/mcp-construction-owner.test.ts | T5.5b | 124: 2 args, filled 1-2, undefined none, omitted 3-21<br>128: 7 args, filled 1-3, 7, undefined 4-6, omitted 8-21 | M |
| packages/agents/src/api/__tests__/mcp-consumer-operations.test.ts | T5.5b | 33: 6 args, filled 1-2, 6, undefined 3-5, omitted 7-21 | M |
| packages/agents/src/api/__tests__/mcp-filesystem-construction.behavior.test.ts | T5.5b | 69: 12 args, filled 1-3, 8, 10-12, undefined 4-7, 9, omitted 13-21 | N |
| packages/agents/src/api/__tests__/mcp-instruction-owner.test.ts | T5.5b | 172: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/api/__tests__/mcp-runtime-owner-extension-retirement.behavior.test.ts | T5.5b | 55: 5 args, filled 1-2, 5, undefined 3-4, omitted 6-21 | M |
| packages/agents/src/api/__tests__/mcp-runtime-owner-reload-retirement.behavior.test.ts | T5.5b | 79: 20 args, filled 1-2, 5, 20, undefined 3-4, 6-19, omitted 21 | N |
| packages/agents/src/api/__tests__/profile-finalization.behavior.test.ts | T5.5b | 87: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-admission-engine.behavior.test.ts | T5.5c | 80: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>255: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>387: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-binding-failure.behavior.test.ts | T5.5c | 116: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>301: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-binding-rollback.behavior.test.ts | T5.5c | 134: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-borrowed-preflight-engine.behavior.test.ts | T5.5c | 83: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>215: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>368: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-child-owner.behavior.test.ts | T5.5c | 106: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-owner-engine.behavior.test.ts | T5.5c | 82: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>286: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-owner-failure.behavior.test.ts | T5.5c | 134: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>305: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>479: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-owner-join.behavior.test.ts | T5.5c | 88: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>293: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-peer-engine.behavior.test.ts | T5.5c | 80: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>212: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-profile-engine.behavior.test.ts | T5.5c | 83: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>274: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>436: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-replacement-join.behavior.test.ts | T5.5c | 90: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>312: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>502: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-client-workspace-engine.behavior.test.ts | T5.5c | 86: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>259: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-settings-owner.behavior.test.ts | T5.5d | 124: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/session-tool-shared-config-wire.behavior.test.ts | T5.5d | 119: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/task-child-parameter-admission.behavior.test.ts | T5.5d | 227: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/api/__tests__/workspace-filesystem-client-replacement.behavior.test.ts | T5.5d | 96: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/agents/src/api/__tests__/workspace-ide-trust-live.behavior.test.ts | T5.5d | 66: 7 args, filled 1-3, 5, 7, undefined 4, 6, omitted 8-21 | M |
| packages/agents/src/api/__tests__/workspace-mcp-reload-config.behavior.test.ts | T5.5d | 62: 20 args, filled 1-2, 5, 20, undefined 3-4, 6-19, omitted 21 | N |
| packages/agents/src/api/__tests__/workspace-memory-lifetime.behavior.test.ts | T5.5d | 149: 13 args, filled 1-3, 7-8, 13, undefined 4-6, 9-12, omitted 14-21 | N |
| packages/agents/src/api/__tests__/workspace-startup-config.behavior.test.ts | T5.5d | 96: 2 args, filled 1-2, undefined none, omitted 3-21<br>210: 2 args, filled 1-2, undefined none, omitted 3-21<br>230: 2 args, filled 1-2, undefined none, omitted 3-21<br>257: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/api/__tests__/workspace-trust-mcp-wiring.behavior.test.ts | T5.5d | 99: 7 args, filled 1-3, 5, 7, undefined 4, 6, omitted 8-21 | M |
| packages/agents/src/api/__tests__/workspace-trust-production.behavior.test.ts | T5.5d | 137: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/core/__tests__/subagent-test-helpers.ts | T5.5d | 190: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/agents/src/core/subagent.stream-idle.test.ts | T5.5d | 250: 2 args, filled 1-2, undefined none, omitted 3-21<br>355: 2 args, filled 1-2, undefined none, omitted 3-21<br>496: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/cli/src/__tests__/stream-media-fixture.ts | T5.5e | 117: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/cli/src/integration-tests/test-utils.ts | T5.5e | 119: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |
| packages/cli/src/services/workspace-mcp-consumers.test.ts | T5.5e | 434: 2 args, filled 1-2, undefined none, omitted 3-21 | M |
| packages/cli/src/ui/cliUiRuntime.agentClientSource.test.ts | T5.5e | 97: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21<br>358: 8 args, filled 1-3, 7-8, undefined 4-6, omitted 9-21 | M |

## Batches

### T5.5a (agents: 12 files, 14 calls, 3 files needing non-mechanical edits)

- packages/agents/src/api/__tests__/AgentRuntimeState.configDispose.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/activation-bootstrap-rollback.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/adoption-binding-failure.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/borrowed-lsp-publication-release.behavior.test.ts (N, 1 call)
- packages/agents/src/api/__tests__/borrowed-settings-disposal.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/config-initialization-boundary.behavior.test.ts (M, 3 calls)
- packages/agents/src/api/__tests__/finalize-agent-collaborators.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/foreground-task-streaming-preservation.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/helpers/async-child-disposal-join-fixture.ts (M, 1 call)
- packages/agents/src/api/__tests__/helpers/mcp-owner-fixture.ts (N, 1 call)
- packages/agents/src/api/__tests__/hook-provider-wire.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/ide-client-independent.test.ts (N, 1 call)

### T5.5b (agents: 12 files, 15 calls, 3 files needing non-mechanical edits)

- packages/agents/src/api/__tests__/instruction-publication-drain.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/isolated-session-client.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/mcp-adopted-extension-lifetime.test.ts (M, 2 calls)
- packages/agents/src/api/__tests__/mcp-approval-scheduler-isolation.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/mcp-config-lifetime.test.ts (N, 2 calls)
- packages/agents/src/api/__tests__/mcp-construction-owner.test.ts (M, 2 calls)
- packages/agents/src/api/__tests__/mcp-consumer-operations.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/mcp-filesystem-construction.behavior.test.ts (N, 1 call)
- packages/agents/src/api/__tests__/mcp-instruction-owner.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/mcp-runtime-owner-extension-retirement.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/mcp-runtime-owner-reload-retirement.behavior.test.ts (N, 1 call)
- packages/agents/src/api/__tests__/profile-finalization.behavior.test.ts (M, 1 call)

### T5.5c (agents: 12 files, 27 calls, 0 files needing non-mechanical edits)

- packages/agents/src/api/__tests__/session-client-admission-engine.behavior.test.ts (M, 3 calls)
- packages/agents/src/api/__tests__/session-client-binding-failure.behavior.test.ts (M, 2 calls)
- packages/agents/src/api/__tests__/session-client-binding-rollback.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/session-client-borrowed-preflight-engine.behavior.test.ts (M, 3 calls)
- packages/agents/src/api/__tests__/session-client-child-owner.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/session-client-owner-engine.behavior.test.ts (M, 2 calls)
- packages/agents/src/api/__tests__/session-client-owner-failure.behavior.test.ts (M, 3 calls)
- packages/agents/src/api/__tests__/session-client-owner-join.behavior.test.ts (M, 2 calls)
- packages/agents/src/api/__tests__/session-client-peer-engine.behavior.test.ts (M, 2 calls)
- packages/agents/src/api/__tests__/session-client-profile-engine.behavior.test.ts (M, 3 calls)
- packages/agents/src/api/__tests__/session-client-replacement-join.behavior.test.ts (M, 3 calls)
- packages/agents/src/api/__tests__/session-client-workspace-engine.behavior.test.ts (M, 2 calls)

### T5.5d (agents: 12 files, 17 calls, 2 files needing non-mechanical edits)

- packages/agents/src/api/__tests__/session-settings-owner.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/session-tool-shared-config-wire.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/task-child-parameter-admission.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/workspace-filesystem-client-replacement.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/workspace-ide-trust-live.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/workspace-mcp-reload-config.behavior.test.ts (N, 1 call)
- packages/agents/src/api/__tests__/workspace-memory-lifetime.behavior.test.ts (N, 1 call)
- packages/agents/src/api/__tests__/workspace-startup-config.behavior.test.ts (M, 4 calls)
- packages/agents/src/api/__tests__/workspace-trust-mcp-wiring.behavior.test.ts (M, 1 call)
- packages/agents/src/api/__tests__/workspace-trust-production.behavior.test.ts (M, 1 call)
- packages/agents/src/core/__tests__/subagent-test-helpers.ts (M, 1 call)
- packages/agents/src/core/subagent.stream-idle.test.ts (M, 3 calls)

### T5.5e (cli: 4 files, 5 calls, 0 files needing non-mechanical edits)

- packages/cli/src/__tests__/stream-media-fixture.ts (M, 1 call)
- packages/cli/src/integration-tests/test-utils.ts (M, 1 call)
- packages/cli/src/services/workspace-mcp-consumers.test.ts (M, 1 call)
- packages/cli/src/ui/cliUiRuntime.agentClientSource.test.ts (M, 2 calls)


## Notes for T5.5a-e (helper-swap tasks)

- The agents helper is `packages/agents/src/api/__tests__/helpers/create-mcp-runtime.ts`. It does not exist yet, so T5.5a creates it (T5.5b-d depend on it). It takes `McpRuntimeAcquisition` and `McpRuntimeOperations` declared as local test types, keeps members optional where the old positional `create` accepts `undefined`, and calls the old positional signature. It is the only test code that knows the positional order.
- `helpers/mcp-owner-fixture.ts` already exports `buildTestMcpRuntime`, referenced by 165 files, and it is itself a 19-argument caller (class N). It stays; its `McpRuntimeOwner.create(` call routes through the new helper. Those 165 files need no change. The same holds for `async-child-disposal-join-fixture.ts` and `subagent-test-helpers.ts` (2-argument, class M).
- The cli helper is `packages/cli/src/integration-tests/test-utils.ts` (the plan's chosen location). It already contains one caller (`initializeTestAgent`, 8 arguments). T5.5e adds the exported helper there, routes that call and the three other cli callers through it. T5.5 then edits only the helper body in that file, which matches its scope line.
- `core/subagent.stream-idle.test.ts` and `core/__tests__/subagent-test-helpers.ts` sit outside `src/api`; they import the helper from `../api/__tests__/helpers/create-mcp-runtime.js`. Check the import is allowed by the agents lint config when T5.5a creates the helper.
- Class N files (8): `helpers/mcp-owner-fixture.ts` (19 args, ternary ownerships, positions 4, 6, 14, 19), `borrowed-lsp-publication-release.behavior.test.ts` (16 args), `ide-client-independent.test.ts` (16 args), `mcp-filesystem-construction.behavior.test.ts` (12 args, ternary), `workspace-memory-lifetime.behavior.test.ts` (position 13 memory handoff), `mcp-config-lifetime.test.ts` (line 398, 20 args, `mcpSettings` literal at 20), `mcp-runtime-owner-reload-retirement.behavior.test.ts` and `workspace-mcp-reload-config.behavior.test.ts` (20 args, `mcpSettings` binding at 20). In each the edit is still a one-to-one slot-to-member mapping; the non-mechanical part is naming the right member for each slot and moving `host` to `operations.emitFeedback`. No batch has more than 3 such files (T5.5a 3, T5.5b 3, T5.5c 0, T5.5d 2, T5.5e 0), under the 12-file limit of the T5.4a rule.

## Notes for T5.5 (production callers, all class N)

- `activationPreflightState.ts:242` (`#constructForegroundMcp`): 20 args; passes `{ emitFeedback: transport?.emitFeedback }` (possibly `undefined`), `this.messageBus` (`MessageBus | undefined`, declared on `ForegroundAgentAssembly` at `foreground-agent-assembly.ts:144`), `this.settingsOwner.readMcpSettingsBinding()` (`| undefined`).
- `adopted-agent-assembly.ts:309`: 20 args; `messageBus` is `adoptMessageBus ?? adoptMcpRuntime?.messageBus ?? adoptPolicyOwner?.session.messageBus` (can be `undefined`), `this.adoptSettingsOwner?.readMcpSettingsBinding()` (can be `undefined`).
- `mcpOAuthAssembly.ts:77`: 21 args; `messageBus` parameter is `MessageBus | undefined` (line 48), `settingsOwner?.readMcpSettingsBinding()`, and it is the only caller that fills position 21.
- `skill-discovery.ts:72`: `McpRuntimeOwner.create(host.oauth, config)`. It has no bus, policy owner, feedback sink or settings binding. With `messageBus`, `emitFeedback` and `mcpSettings` required it needs a real policy owner and bus, a feedback sink and a settings read, or those members must stay optional. This is the only production caller that is not a variant of the foreground/adopted shape.
- All four pass `undefined` for positions 5 and 6 (`managerFactory`, `extensionLoader`) in the first three callers and omit them in `skill-discovery.ts`; `managerFactory: McpClientManager` must be added to each, and `mcpRuntimeAssembly.ts` loses its `?? McpClientManager`.
- `mcp-runtime-construction.ts` also holds `constructPolicyOwner`, `retainPolicyOwner` and the other `retain*` helpers; only `McpRuntimeConstructionInputs` and `selectMcpConstructionInputs` are deleted by T5.5.

## Check of `ports-B6-B3.md` against HEAD (for the orchestrator)

Matches: the tuple has 21 positions and the doc lists 18 acquisition members plus 3 operations members (21). Member names and types correspond one to one with the tuple, including the `'runtime' | 'caller'` ownership types and `MemoryHandoff` (`{ owner, ownership?: 'caller' } | { owner, ownership: 'runtime' }`). The changes in e4c82e58a (`closeAdmission` split from `retireConnections`, private `reconfigurationOperations` set) are internal to `McpRuntimeOwner`. `create`'s inputs are unchanged; `closeAdmission(): void` is public on the owner and still backs the facade's `closeMcpAdmission(): void` (`foreground-agent-assembly.ts:280`, `adopted-agent-assembly.ts:666`), as the `AgentFacadeOwners` row in the doc says. No change to the doc is needed for that commit.

Mismatches (the doc says required; the code at HEAD allows absence, and some callers rely on it):

1. `McpRuntimeOperations.emitFeedback` "required; production passes the host's". Production passes `{ emitFeedback: transport?.emitFeedback }` and the `mcpHost?.emitFeedback` reads in `mcpOAuthAssembly.ts` and `adopted-agent-assembly.ts` (three production callers), which can be `undefined`; `McpHostServices.emitFeedback` itself is non-optional (`hostServices.ts:53`). Making it required means each caller must obtain a sink or the member stays `HostFeedbackSink | undefined`. The runtime stores `inputs.host?.emitFeedback` as optional.
2. `McpRuntimeAcquisition.messageBus` "required in production; test callers pass a real bus". The three non-trivial production callers pass `MessageBus | undefined`, `skill-discovery.ts` and the 18 two-argument tests pass none. Because `constructPolicyOwner` rejects a bus without an explicit `policyOwner` (and a bus that differs from `policyOwner.session.messageBus`), a required bus forces a required, matching `policyOwner` in the same call. Decide before T5.5: either require both (then the helper builds `new RuntimePolicyOwner(config)` with ownership `'runtime'` for the 18 two-argument tests and `skill-discovery.ts` does the same), or keep `messageBus` and `policyOwner` optional as a pair.
3. `McpRuntimeOperations.mcpSettings` "(required)". `SessionSettingsOwner.readMcpSettingsBinding()` returns `SessionMcpSettingsReads | undefined`; the adopted and `mcpOAuthAssembly.ts` callers pass it through an optional chain. `McpRuntimeOwner.reload()` rejects with "MCP server reload is not available in this composition." when it is absent (`mcpRuntimeAssembly.ts:653-656`), and `captureWorkspaceServerDeclarations` accepts `undefined`. 75 of the 78 test calls pass none; the three that fill position 20 are `mcp-config-lifetime.test.ts:398`, `mcp-runtime-owner-reload-retirement.behavior.test.ts:79` and `workspace-mcp-reload-config.behavior.test.ts:62`. Required means those tests must supply a read, and the "not available" branch becomes dead. That is a behavior change, not a signature change.
4. "Production callers" in the doc lists five including `integration-tests/test-utils.ts`; at HEAD there are four production callers, and `test-utils.ts` is a test helper (class M, 8 arguments).
5. The doc does not mention the existing agents helper `helpers/mcp-owner-fixture.ts` (`buildTestMcpRuntime`, 165 referencing files) or the plan's new `create-mcp-runtime.ts`; they overlap. This inventory routes `mcp-owner-fixture.ts` through the new helper rather than replacing it.
6. The doc keeps `managerFactory` "required; production passes `McpClientManager`". Production passes `undefined` today and relies on the constructor default, so T5.5 adds the argument at the four production sites and deletes the default.
