# Inventory: tests that depend on the fake-seam suppression (T1.9d-inv)

Starting head: `5f80f18d4`. Method: in the working tree, `applyFacadeProviderSwitch` in `packages/agents/src/api/providerSwitchOptionsAdapter.ts` was changed to call `switchProvider` with no `try`/`catch` (the `LLXPRT_FAKE_RESPONSES` suppression deleted). The agents, cli and a2a-server suites were run, then the file was set back to `HEAD`. Only this file is committed.

Logs (gitignored, `W/tmp/pr3911/T1.9d-inv/`): `agents-suite-1.log` (`npm run test` in `packages/agents`: its `run-bun-tests.ts` half, 741 of 745 files passed, EXIT=1), `agents-native-suite-1.log` (the second half of the agents `test` script, `bun ../../scripts/run_bun_tests.ts --workspace agents`, which `&&` skipped after the first failed; 8/8 passed), `cli-suite-1.log` (982/984 files passed, EXIT=1), `a2a-suite-1.log` (`npm run test:bun`, 24/24 passed). The per-test failure lines below were taken from a focused rerun of each failing file (`focus-*.log`) because the parallel runner interleaves the suite log. The suites ran partly in parallel on one machine; the six files were also rerun alone with the suppression still removed and failed the same way.

Every failure has the same cause: the test switches to a provider name that is not registered (`openai`, `other-provider`, `newprov`) under `LLXPRT_FAKE_RESPONSES`, and the switch now rejects with `Provider '<name>' not found`. Failures in the two property tests (`PROP ...`) report `expect(received).resolves.toBeUndefined()` or `Property failed after 1 tests`, and use the same unregistered-provider switch.

Totals: 6 files (4 agents, 2 cli), 0 in a2a-server, 16 failing tests.

## T1.9d-B1 (agents, 4 files)

| File | Failing tests (failure line) |
| --- | --- |
| `packages/agents/src/api/__tests__/agentUnconfigured.behavior.test.ts` | `AgentImpl: fail-closed when unconfigured (#2481) > setProvider from unconfigured returns previousProvider null, not sentinel (#2481)`: `error: Provider 'openai' not found` |
| `packages/agents/src/api/__tests__/mutationCoverage.behavior.test.ts` | `target 5: provider-switch model-change guard ... > a provider+model switch reflects the NEW model on getModel`: `error: Provider 'other-provider' not found`; `property cases > PROP target-5: model switches reflect nonblank selections and blank models use the configured default`: `error: expect(received).resolves.toBeUndefined()`; `property cases > setProvider without a model preserves the current model (kills 1139 ConditionalExpression true)`: `error: Provider 'openai' not found`; `property cases > PROP setProvider model preservation: for any provider switch name under the fake seam, setProvider without model preserves the current model`: `error: expect(received).resolves.toBeUndefined()`; `target 7: rebuild propagates approvalHandler ... > onApproval survives setProvider: tool auto-approves on turn 2 after rebuild`: `error: Provider 'openai' not found` |
| `packages/agents/src/api/__tests__/mutationCoverage.tokens.behavior.test.ts` | `mutation P23.b — restoreChatVisibility switch continuity (REQ-005) > after a provider+model switch, a second turn produces real text + one done (carriedHistory path)`: `error: Provider 'newprov' not found` |
| `packages/agents/src/api/__tests__/switch-context.spec.ts` | `T4 setProvider mid-session → getProvider reflects it and the follow-up turn uses the new provider over the switched fixture`, `T4c client rebinding on switch ...`, `T4d manual-switch HistoryService IDENTITY reuse + follow-up sees prior messages`, `T4f switching INTO a provider that cannot accept the prior provider thinking blocks applies stripThoughts normalization`: each `error: Provider 'openai' not found`; `T4dp property: generated message histories round-trip and preserve the same HistoryService identity across a switch`: `error: Property failed after 1 tests` |

## T1.9d-B2 (cli, 2 files)

| File | Failing tests (failure line) |
| --- | --- |
| `packages/cli/src/ui/commands/provider-command-owner.behavior.test.ts` | `registered provider command ownership > switches and records on the registered owner despite decoy invocation owners`: `error: expect(received).toStrictEqual(expected)`; `... > saves aliases for the registered owner and refreshes its aliases`: `error: Provider 'openai' not found`; `... > does not reroute a retired owner command to a surviving invocation owner`: `error: expect(received).toMatchObject(expected)` |
| `packages/cli/src/ui/hooks/provider-registration-owner.behavior.test.tsx` | `provider registration ownership > uses captured provider operations and replaces them without consulting context authority`: `error: Provider 'openai' not found` |

## Batches

- T1.9d-B1: the 4 agents files above.
- T1.9d-B2: the 2 cli files above.
- a2a-server: no failing files, no batch.
