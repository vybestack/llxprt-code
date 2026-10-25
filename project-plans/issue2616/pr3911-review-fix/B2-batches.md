# B2 inventory: files that use the B2 fixtures (T6.0)

Produced by T6.0-list at head `e7f9b497382cb958f7a4bb8762dd56cea20f2d47` (after phases 1 to 5). The T6.0-Sxx slice tasks append their sections below the slice table. T6.0-agg appends the batch plan.

## Search

```
git grep -l -E 'adoption-fixture|agent-resource-capture|activation-acquisition-capture|caller-fixture|skills-fixture-caller|createAgentRuntimeFactoryBindings' -- packages | LC_ALL=C sort
```

- Search output: 349 files (the plan's count was 346 at the starting head).
- `createAgentRuntimeFactoryBindings` was NOT deleted in phase 1. It is still declared in `packages/agents/src/api/runtimeFactories.ts:70` and used by 195 files in this list (157 in agents, 31 in cli). T6.D2 decides whether it has a production caller left.
- Added by this task beyond the search output (5 files), because T6.D2's deletion check names symbols the search cannot see:
  - Two definitions that the path-name search misses because no file names them in text: `adoption-fixture.ts` (declares `adoptFixture`) and `activation-acquisition-capture.ts` (declares `capturedActivation`, `captureActivationAcquisition`, `prepareActivationFixture`, `createFixtureForeground`, `observeActivationPreparation`, `captureActivationConstruction`).
  - Three importers that reach `fixtureAgentResources` through the `agentHarness.ts` re-export (`export { fixtureAgentResources } from './agent-resource-capture.js'`): `session-metrics-isolation.behavior.test.ts`, `session.clearConversation.behavior.test.ts`, and `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.background-clear.test.tsx`. Found with `git grep -l -w` on every exported name of the five fixtures and `createAgentRuntimeFactoryBindings`.
  - Verified clean: the other candidates from that name search (five providers runtime tests) only declare their own local function named `openCaller`, so they are not listed.
- Total in this list: **354 files** (6 definitions, 319 importers, 29 incidental).

## Kinds and roles

- `definition`: declares one of the six names (the five fixtures, plus `runtimeFactories.ts` for `createAgentRuntimeFactoryBindings`).
- `importer`: imports (static, dynamic or `mock.module` path) one of the fixtures, or uses `createAgentRuntimeFactoryBindings`, or reaches `fixtureAgentResources` through `agentHarness.ts`. The "uses" column lists which.
- `incidental`: matched only by text that is not a fixture import. 29 of the 29 match only the literal session id string `'isolated-caller-fixture'` (the `caller-fixture` alternative of the search matches inside it); 0 match some other way. A slice task records an incidental file as "no B2 fixture use; nothing to migrate" after confirming the match.
- Role: `test` (`*.test.ts(x)`, `*.spec.ts`), `helper` (non-test file under a test directory or a test fixture/util), `source` (production file).
- "blocks" is a count of lines starting an `it(`/`test(` block (a size hint for slicing, not the scenario list; slice tasks record the real scenarios).

## Definitions

| file | declares | direct importers in this list |
| --- | --- | --- |
| `packages/agents/src/api/__tests__/helpers/adoption-fixture.ts` | adoptFixture (the `fromConfig` stand-in that writes the unreachable `adopt*` fields) | 37 |
| `packages/agents/src/api/__tests__/helpers/agent-resource-capture.ts` | AgentResourceCapture, fixtureAgentResources, captureAgentAdoption, captureAgentCreation | 224 |
| `packages/agents/src/api/__tests__/helpers/activation-acquisition-capture.ts` | capturedActivation, captureActivationAcquisition, prepareActivationFixture, createFixtureForeground, observeActivationPreparation, captureActivationConstruction | 57 |
| `packages/agents/src/api/__tests__/helpers/caller-fixture.ts` | useFakeResponsesReplay, Caller, openCaller | 5 |
| `packages/agents/src/api/__tests__/helpers/skills-fixture-caller.ts` | SkillsCaller, openSkillsCaller | 13 |
| `packages/agents/src/api/runtimeFactories.ts` | createAgentRuntimeFactoryBindings (plus production factories createAgentClient, createToolScheduler, createTaskRegistration, createAgenticLoop; production code, not a fixture) | 195 |

Importers via `agentHarness.ts`'s re-export are counted under agent-resource-capture. Several helpers in slice T6.0-S13 import these definitions and are imported by many tests (agentHarness.ts, disposalProbe.ts, session-failure-fixture.ts, recording-owner-lifetime-fixture.ts, generation-owner-fixture.ts, child-parameter-tool.ts, async-child-disposal-join-fixture.ts, session-client-capture.ts, skills-fixture-declarations.ts, realLoopHarness.ts). Tests that reach a fixture only through such a helper are not listed unless they also name a fixture path or symbol; T6.D2's grep (`adoptFixture|captureAgentAdoption|fixtureAgentResources|createAgentRuntimeFactoryBindings`) is the end check for those.

## Slices

26 slices of at most 20 files. The rules: a directory with 5 or more files is cut on its own; directories with fewer than 5 files are grouped by package; no slice mixes directories except the small-directory groups. Files in a directory are cut into equal-sized pieces in sorted order.

| slice | directory or group | files | lines | it/test blocks |
| --- | --- | --- | --- | --- |
| T6.0-S01 | packages/agents/src/api/__tests__ | 20 | 6968 | 22 |
| T6.0-S02 | packages/agents/src/api/__tests__ | 20 | 8710 | 81 |
| T6.0-S03 | packages/agents/src/api/__tests__ | 20 | 6558 | 91 |
| T6.0-S04 | packages/agents/src/api/__tests__ | 20 | 8172 | 52 |
| T6.0-S05 | packages/agents/src/api/__tests__ | 20 | 9925 | 89 |
| T6.0-S06 | packages/agents/src/api/__tests__ | 20 | 11219 | 97 |
| T6.0-S07 | packages/agents/src/api/__tests__ | 20 | 9036 | 38 |
| T6.0-S08 | packages/agents/src/api/__tests__ | 20 | 8134 | 89 |
| T6.0-S09 | packages/agents/src/api/__tests__ | 20 | 9473 | 98 |
| T6.0-S10 | packages/agents/src/api/__tests__ | 20 | 5881 | 67 |
| T6.0-S11 | packages/agents/src/api/__tests__ | 20 | 9511 | 26 |
| T6.0-S12 | packages/agents/src/api/__tests__ | 14 | 3204 | 22 |
| T6.0-S13 | packages/agents/src/api/__tests__/helpers | 15 | 5022 | 0 |
| T6.0-S14 | packages/agents/src/core | 7 | 3558 | 45 |
| T6.0-S15 | packages/agents/src/core/agenticLoop/__tests__ | 6 | 1507 | 18 |
| T6.0-S16 | agents small directories (4 dirs, each under 5 files) | 9 | 3035 | 25 |
| T6.0-S17 | packages/cli/src | 11 | 5331 | 67 |
| T6.0-S18 | packages/cli/src/__tests__ | 7 | 1449 | 0 |
| T6.0-S19 | packages/cli/src/ui/contexts | 6 | 3591 | 6 |
| T6.0-S20 | packages/cli/src/ui/hooks | 16 | 8546 | 16 |
| T6.0-S21 | cli small directories (12 dirs, each under 5 files) | 11 | 3178 | 48 |
| T6.0-S22 | cli small directories (12 dirs, each under 5 files) | 10 | 5301 | 42 |
| T6.0-S23 | core small directories (4 dirs, each under 5 files) | 8 | 1647 | 33 |
| T6.0-S24 | packages/providers/src/runtime | 7 | 1868 | 42 |
| T6.0-S25 | providers small directories (1 dirs, each under 5 files) | 1 | 180 | 1 |
| T6.0-S26 | packages/zed-acp/src | 6 | 3791 | 14 |

Verification (the orchestrator runs this; it prints nothing on success):

```
cd /Volumes/XS1000/acoliver/projects/llxprt/branch-2/llxprt-code/tmp/w2616k && git grep -l -E 'adoption-fixture|agent-resource-capture|activation-acquisition-capture|caller-fixture|skills-fixture-caller|createAgentRuntimeFactoryBindings' -- packages | LC_ALL=C sort > tmp/pr3911/T6.0-list/search.txt && sed -n '/^## Slice file lists/,$p' project-plans/issue2616/pr3911-review-fix/B2-batches.md | grep -o '^| `packages/[^`]*`' | tr -d '|` ' | LC_ALL=C sort > tmp/pr3911/T6.0-list/listed.txt && comm -23 tmp/pr3911/T6.0-list/search.txt tmp/pr3911/T6.0-list/listed.txt
```

A non-empty result is a file the search finds that no slice lists. Every slice file list row starts a table line with the path in backticks; the 5 extra files are listed too and are marked "added" in the "source" column.

## Slice file lists

### T6.0-S01: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/AgentRuntimeState.configDispose.test.ts` | test | importer | agent-resource-capture | 150 | 1 | search |
| `packages/agents/src/api/__tests__/activation-bootstrap-rollback.behavior.test.ts` | test | importer | activation-acquisition-capture | 255 | 1 | search |
| `packages/agents/src/api/__tests__/activation-media-owner-lifetime.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 319 | 2 | search |
| `packages/agents/src/api/__tests__/activation-preflight-cleanup-failure.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 229 | 2 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-1.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 311 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-10.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 333 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-11.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 569 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-12.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 302 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-13.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 322 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-14.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 323 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-15.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 304 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-16.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 500 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-17.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 332 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-18.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 561 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-2.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 296 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-3.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 288 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-4.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 284 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-5.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 313 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-6.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 484 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-7.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 493 | 1 | search |

### T6.0-S02: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-8.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 283 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState-owner-9.behavior.test.ts` | test | importer | activation-acquisition-capture, createAgentRuntimeFactoryBindings | 323 | 1 | search |
| `packages/agents/src/api/__tests__/activationPreflightState.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 318 | 1 | search |
| `packages/agents/src/api/__tests__/adoption-binding-failure.behavior.test.ts` | test | importer | agent-resource-capture | 263 | 1 | search |
| `packages/agents/src/api/__tests__/adoption-publication-barrier.behavior.test.ts` | test | importer | adoption-fixture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 323 | 4 | search |
| `packages/agents/src/api/__tests__/adoption-scheduler-owner.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 242 | 2 | search |
| `packages/agents/src/api/__tests__/agent-unconfigured-adoption.behavior.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 380 | 2 | search |
| `packages/agents/src/api/__tests__/agent.sequenceModel-owner-1.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 422 | 2 | search |
| `packages/agents/src/api/__tests__/agent.sequenceModel.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 143 | 5 | search |
| `packages/agents/src/api/__tests__/agent.settings.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 724 | 16 | search |
| `packages/agents/src/api/__tests__/agentAdmission.owner.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 826 | 12 | search |
| `packages/agents/src/api/__tests__/agentMessageBus.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 363 | 4 | search |
| `packages/agents/src/api/__tests__/agentUnconfigured.behavior.test.ts` | test | importer | adoption-fixture | 362 | 12 | search |
| `packages/agents/src/api/__tests__/async-child-background-isolation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 676 | 7 | search |
| `packages/agents/src/api/__tests__/auxiliary-generation-lifetime.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 748 | 4 | search |
| `packages/agents/src/api/__tests__/borrowed-settings-disposal.behavior.test.ts` | test | importer | agent-resource-capture | 271 | 1 | search |
| `packages/agents/src/api/__tests__/bucket-consent.behavior.test.ts` | test | importer | agent-resource-capture | 133 | 3 | search |
| `packages/agents/src/api/__tests__/cli-turn-parity-owner-1.spec.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 642 | 1 | search |
| `packages/agents/src/api/__tests__/cli-turn-parity.early-owner-1.spec.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 602 | 1 | search |
| `packages/agents/src/api/__tests__/cli-turn-parity.early-owner-2.spec.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 666 | 1 | search |

### T6.0-S03: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 289 | 1 | search |
| `packages/agents/src/api/__tests__/cli-turn-parity.spec.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 579 | 1 | search |
| `packages/agents/src/api/__tests__/config-initialization-boundary.behavior.test.ts` | test | importer | agent-resource-capture | 312 | 12 | search |
| `packages/agents/src/api/__tests__/config-injection.spec.ts` | test | importer | agent-resource-capture, caller-fixture, createAgentRuntimeFactoryBindings | 277 | 6 | search |
| `packages/agents/src/api/__tests__/config-provider-ownership-owner-1.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 464 | 5 | search |
| `packages/agents/src/api/__tests__/config-provider-ownership-owner-2.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 478 | 5 | search |
| `packages/agents/src/api/__tests__/config-provider-ownership-owner-3.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 342 | 1 | search |
| `packages/agents/src/api/__tests__/config-provider-ownership.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 511 | 5 | search |
| `packages/agents/src/api/__tests__/config.folderTrustLive.test.ts` | test | importer | adoption-fixture | 463 | 20 | search |
| `packages/agents/src/api/__tests__/createAgent.activation.behavior.test.ts` | test | importer | agent-resource-capture | 257 | 8 | search |
| `packages/agents/src/api/__tests__/createAgent.selfAssembly.behavior.test.ts` | test | importer | agent-resource-capture | 312 | 7 | search |
| `packages/agents/src/api/__tests__/finalize-agent-collaborators.behavior.test.ts` | test | importer | adoption-fixture, agent-resource-capture | 267 | 1 | search |
| `packages/agents/src/api/__tests__/finalizeAgent.postAuthClient.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 169 | 1 | search |
| `packages/agents/src/api/__tests__/foreground-task-streaming-preservation.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 494 | 6 | search |
| `packages/agents/src/api/__tests__/from-config-validation-acquisition.behavior.test.ts` | test | importer | agent-resource-capture | 196 | 3 | search |
| `packages/agents/src/api/__tests__/fromConfig-acquisition.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 422 | 5 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-1.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 258 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-2.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 161 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-3.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 157 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-4.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 150 | 1 | search |

### T6.0-S04: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-5.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 408 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-6.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 419 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-7.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 407 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-8.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 517 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission-owner-9.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 557 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-admission.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 185 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-bootstrap-failure.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 309 | 2 | search |
| `packages/agents/src/api/__tests__/fromConfig-cleanup.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 327 | 2 | search |
| `packages/agents/src/api/__tests__/fromConfig-identity.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 753 | 15 | search |
| `packages/agents/src/api/__tests__/fromConfig-ownership-effects.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 346 | 3 | search |
| `packages/agents/src/api/__tests__/fromConfig-properties.behavior.test.ts` | test | importer | agent-resource-capture, caller-fixture, createAgentRuntimeFactoryBindings | 438 | 7 | search |
| `packages/agents/src/api/__tests__/fromConfig-session.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 218 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfig-tokenizer-readiness.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 493 | 2 | search |
| `packages/agents/src/api/__tests__/fromConfig.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 491 | 3 | search |
| `packages/agents/src/api/__tests__/fromConfigSkills.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 426 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfigTaskTool-owner-1.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 568 | 2 | search |
| `packages/agents/src/api/__tests__/fromConfigTaskTool-owner-2.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 222 | 1 | search |
| `packages/agents/src/api/__tests__/fromConfigTaskTool.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 362 | 2 | search |
| `packages/agents/src/api/__tests__/hook-provider-wire.behavior.test.ts` | test | importer | agent-resource-capture | 230 | 1 | search |
| `packages/agents/src/api/__tests__/hook-session-shutdown.behavior.test.ts` | test | importer | agent-resource-capture | 496 | 4 | search |

### T6.0-S05: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/hookAdmin.behavior.test.ts` | test | incidental | string only | 222 | 6 | search |
| `packages/agents/src/api/__tests__/host-github-broker-owner.behavior.test.ts` | test | importer | agent-resource-capture | 530 | 8 | search |
| `packages/agents/src/api/__tests__/ide-client-independent.test.ts` | test | importer | agent-resource-capture | 802 | 16 | search |
| `packages/agents/src/api/__tests__/instruction-publication-drain.behavior.test.ts` | test | importer | agent-resource-capture | 292 | 1 | search |
| `packages/agents/src/api/__tests__/loop-transaction-retirement.behavior.test.ts` | test | importer | agent-resource-capture | 807 | 9 | search |
| `packages/agents/src/api/__tests__/mcp-adopted-extension-lifetime.test.ts` | test | importer | agent-resource-capture | 433 | 2 | search |
| `packages/agents/src/api/__tests__/mcp-agent-operations.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 472 | 2 | search |
| `packages/agents/src/api/__tests__/mcp-approval-owner-isolation-owner-1.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 410 | 1 | search |
| `packages/agents/src/api/__tests__/mcp-approval-owner-isolation.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 785 | 1 | search |
| `packages/agents/src/api/__tests__/mcp-approval-scheduler-isolation.test.ts` | test | importer | agent-resource-capture | 441 | 1 | search |
| `packages/agents/src/api/__tests__/mcp-config-lifetime.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 507 | 4 | search |
| `packages/agents/src/api/__tests__/mcp-connected-disposal.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 476 | 2 | search |
| `packages/agents/src/api/__tests__/mcp-construction-owner.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 664 | 4 | search |
| `packages/agents/src/api/__tests__/mcp-instruction-owner.test.ts` | test | importer | agent-resource-capture | 459 | 1 | search |
| `packages/agents/src/api/__tests__/mcp-owner-status-isolation.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 447 | 1 | search |
| `packages/agents/src/api/__tests__/model-notification-root-isolation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 711 | 2 | search |
| `packages/agents/src/api/__tests__/policy-client-binding-rollback.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 89 | 1 | search |
| `packages/agents/src/api/__tests__/policy-owner-dispatch.behavior.test.ts` | test | importer | agent-resource-capture | 192 | 2 | search |
| `packages/agents/src/api/__tests__/post-config-preflight.test.ts` | test | importer | activation-acquisition-capture | 689 | 15 | search |
| `packages/agents/src/api/__tests__/preflight-release.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 497 | 10 | search |

### T6.0-S06: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/preflightAgentActivation-factory-preservation.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 449 | 2 | search |
| `packages/agents/src/api/__tests__/preflightAgentActivation.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 477 | 5 | search |
| `packages/agents/src/api/__tests__/profile-alias-defaults-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 506 | 5 | search |
| `packages/agents/src/api/__tests__/profile-atomicity-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 453 | 3 | search |
| `packages/agents/src/api/__tests__/profile-authclear-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 450 | 5 | search |
| `packages/agents/src/api/__tests__/profile-authtiming-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 535 | 8 | search |
| `packages/agents/src/api/__tests__/profile-basics-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 489 | 7 | search |
| `packages/agents/src/api/__tests__/profile-chat-preparation.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 746 | 2 | search |
| `packages/agents/src/api/__tests__/profile-commit-publication.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 751 | 4 | search |
| `packages/agents/src/api/__tests__/profile-failover-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 463 | 6 | search |
| `packages/agents/src/api/__tests__/profile-lb-authkey-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 543 | 6 | search |
| `packages/agents/src/api/__tests__/profile-lb-context-timeout-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 412 | 3 | search |
| `packages/agents/src/api/__tests__/profile-lb-detection-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 527 | 15 | search |
| `packages/agents/src/api/__tests__/profile-persistence-owner.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 396 | 1 | search |
| `packages/agents/src/api/__tests__/profile-postcommit-lifetime.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 795 | 5 | search |
| `packages/agents/src/api/__tests__/profile-postcommit-siblings.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 564 | 1 | search |
| `packages/agents/src/api/__tests__/profile-preparation-cancellation.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 663 | 1 | search |
| `packages/agents/src/api/__tests__/profile-workflow-owner.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 682 | 16 | search |
| `packages/agents/src/api/__tests__/profileApplication.owner-owner-1.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 687 | 1 | search |
| `packages/agents/src/api/__tests__/profileApplication.owner-owner-2.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 631 | 1 | search |

### T6.0-S07: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/profileApplication.owner-owner-3.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 814 | 1 | search |
| `packages/agents/src/api/__tests__/profileApplication.owner-owner-4.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 476 | 1 | search |
| `packages/agents/src/api/__tests__/profileApplication.owner-owner-5.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 638 | 1 | search |
| `packages/agents/src/api/__tests__/profileApplication.owner-owner-6.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 659 | 1 | search |
| `packages/agents/src/api/__tests__/profileApplication.owner-owner-7.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 622 | 1 | search |
| `packages/agents/src/api/__tests__/profileApplication.owner.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 573 | 1 | search |
| `packages/agents/src/api/__tests__/provider-activation-adoption.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 387 | 4 | search |
| `packages/agents/src/api/__tests__/provider-factory-authority.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 634 | 8 | search |
| `packages/agents/src/api/__tests__/provider-owner-generation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 415 | 3 | search |
| `packages/agents/src/api/__tests__/provider-read-ports.behavior.test.ts` | test | importer | agent-resource-capture | 38 | 1 | search |
| `packages/agents/src/api/__tests__/provider-switch-publication.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 374 | 1 | search |
| `packages/agents/src/api/__tests__/provider-switch-transaction.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 656 | 1 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-1.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 373 | 2 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-10.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 411 | 2 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-2.behavior.test.ts` | test | importer | agent-resource-capture | 68 | 3 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-3.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 356 | 1 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-4.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 439 | 2 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-5.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 401 | 2 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-6.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 355 | 1 | search |
| `packages/agents/src/api/__tests__/providerActivation-owner-7.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 347 | 1 | search |

### T6.0-S08: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/providerActivation-owner-8.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 465 | 4 | search |
| `packages/agents/src/api/__tests__/providerActivation.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 613 | 5 | search |
| `packages/agents/src/api/__tests__/quota-registry-proxy-isolation.behavior.test.ts` | test | importer | agent-resource-capture | 305 | 2 | search |
| `packages/agents/src/api/__tests__/rebuild-loop-ownership.behavior.test.ts` | test | importer | agent-resource-capture | 463 | 11 | search |
| `packages/agents/src/api/__tests__/recording-compression-origin.behavior.test.ts` | test | importer | agent-resource-capture | 412 | 7 | search |
| `packages/agents/src/api/__tests__/recording-facade-chat-channel.behavior.test.ts` | test | importer | agent-resource-capture | 328 | 4 | search |
| `packages/agents/src/api/__tests__/recording-finalizer-join.behavior.test.ts` | test | importer | agent-resource-capture, caller-fixture, createAgentRuntimeFactoryBindings | 337 | 2 | search |
| `packages/agents/src/api/__tests__/recording-nonstream-413-hooks.behavior.test.ts` | test | importer | agent-resource-capture | 386 | 4 | search |
| `packages/agents/src/api/__tests__/recording-owner-lifetime.behavior.test.ts` | test | importer | agent-resource-capture | 498 | 8 | search |
| `packages/agents/src/api/__tests__/recording-shared-history-origin.behavior.test.ts` | test | importer | agent-resource-capture | 397 | 9 | search |
| `packages/agents/src/api/__tests__/recording-tool-hook-owner.behavior.test.ts` | test | importer | agent-resource-capture | 204 | 1 | search |
| `packages/agents/src/api/__tests__/replaceableClient.smoke.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 571 | 6 | search |
| `packages/agents/src/api/__tests__/runtime-owner-bindings.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 444 | 5 | search |
| `packages/agents/src/api/__tests__/runtime-owner-kimi-http.test.ts` | test | importer | agent-resource-capture | 375 | 1 | search |
| `packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts` | test | importer | agent-resource-capture, caller-fixture, createAgentRuntimeFactoryBindings | 252 | 5 | search |
| `packages/agents/src/api/__tests__/same-agent-admission.driver.ts` | helper | importer | agent-resource-capture | 133 | 0 | search |
| `packages/agents/src/api/__tests__/sameLabel.toolIsolation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 652 | 2 | search |
| `packages/agents/src/api/__tests__/schedulerOwner.collision.behavior.test.ts` | test | incidental | string only | 317 | 2 | search |
| `packages/agents/src/api/__tests__/session-background-clear.behavior.test.ts` | test | importer | agent-resource-capture | 455 | 9 | search |
| `packages/agents/src/api/__tests__/session-client-admission-engine.behavior.test.ts` | test | importer | agent-resource-capture | 527 | 2 | search |

### T6.0-S09: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/session-client-borrowed-preflight-engine.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 542 | 2 | search |
| `packages/agents/src/api/__tests__/session-client-child-owner.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 520 | 5 | search |
| `packages/agents/src/api/__tests__/session-client-owner-engine.behavior.test.ts` | test | importer | agent-resource-capture | 511 | 3 | search |
| `packages/agents/src/api/__tests__/session-client-owner-join.behavior.test.ts` | test | importer | activation-acquisition-capture | 487 | 2 | search |
| `packages/agents/src/api/__tests__/session-client-peer-engine.behavior.test.ts` | test | importer | agent-resource-capture | 389 | 1 | search |
| `packages/agents/src/api/__tests__/session-client-profile-engine.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 585 | 3 | search |
| `packages/agents/src/api/__tests__/session-client-replacement-join.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 692 | 3 | search |
| `packages/agents/src/api/__tests__/session-client-workspace-engine.behavior.test.ts` | test | importer | agent-resource-capture | 335 | 2 | search |
| `packages/agents/src/api/__tests__/session-execution-resolution.behavior.test.ts` | test | importer | agent-resource-capture | 185 | 3 | search |
| `packages/agents/src/api/__tests__/session-image-operation-lifetime.behavior.test.ts` | test | importer | agent-resource-capture | 666 | 12 | search |
| `packages/agents/src/api/__tests__/session-media-owner-closure.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 555 | 7 | search |
| `packages/agents/src/api/__tests__/session-metrics-isolation.behavior.test.ts` | test | importer | agent-resource-capture (via agentHarness re-export) | 193 | 2 | added |
| `packages/agents/src/api/__tests__/session-owner-restore-checkpoint.behavior.test.ts` | test | importer | agent-resource-capture | 361 | 7 | search |
| `packages/agents/src/api/__tests__/session-recording-identity.behavior.test.ts` | test | importer | agent-resource-capture | 270 | 6 | search |
| `packages/agents/src/api/__tests__/session-settings-owner.behavior.test.ts` | test | importer | agent-resource-capture | 737 | 16 | search |
| `packages/agents/src/api/__tests__/session-tool-approval-owner.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 384 | 1 | search |
| `packages/agents/src/api/__tests__/session-tool-catalog-owner.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 648 | 11 | search |
| `packages/agents/src/api/__tests__/session-tool-mcp-cancellation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 379 | 2 | search |
| `packages/agents/src/api/__tests__/session-tool-owner-risk.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 642 | 7 | search |
| `packages/agents/src/api/__tests__/session-tool-shared-config-wire.behavior.test.ts` | test | importer | agent-resource-capture | 392 | 3 | search |

### T6.0-S10: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/session.clearConversation.behavior.test.ts` | test | importer | agent-resource-capture (via agentHarness re-export) | 674 | 14 | added |
| `packages/agents/src/api/__tests__/settings-surface.spec.ts` | test | importer | agent-resource-capture, caller-fixture, createAgentRuntimeFactoryBindings | 269 | 6 | search |
| `packages/agents/src/api/__tests__/shell-owner-isolation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 812 | 6 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-1.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 196 | 2 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-10.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 213 | 1 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-2.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 187 | 2 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-3.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 167 | 1 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-4.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 239 | 2 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-5.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 154 | 1 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-6.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 231 | 2 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-7.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 175 | 1 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-8.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 250 | 1 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration-owner-9.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 220 | 2 | search |
| `packages/agents/src/api/__tests__/skillReloadDeclaration.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 180 | 2 | search |
| `packages/agents/src/api/__tests__/staleClient.behavior.test.ts` | test | importer | agent-resource-capture | 293 | 7 | search |
| `packages/agents/src/api/__tests__/task-child-parameter-admission.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 402 | 3 | search |
| `packages/agents/src/api/__tests__/task-child-whitelist-preservation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 322 | 3 | search |
| `packages/agents/src/api/__tests__/task-timeout-settings-validation.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 303 | 1 | search |
| `packages/agents/src/api/__tests__/tasksControl.behavior.test.ts` | test | importer | agent-resource-capture | 409 | 8 | search |
| `packages/agents/src/api/__tests__/turn-lb-final-dispatch.behavior.test.ts` | test | importer | agent-resource-capture | 185 | 2 | search |

### T6.0-S11: packages/agents/src/api/__tests__ (20 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/turn-revision-capture.fixture.ts` | helper | importer | agent-resource-capture | 332 | 0 | search |
| `packages/agents/src/api/__tests__/turn-trust-revocation.behavior.test.ts` | test | importer | agent-resource-capture | 404 | 1 | search |
| `packages/agents/src/api/__tests__/two-agent-identity.driver.ts` | helper | importer | agent-resource-capture | 391 | 0 | search |
| `packages/agents/src/api/__tests__/workspace-catalog-owner-owner-1.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 645 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-catalog-owner-owner-2.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 373 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-catalog-owner-owner-3.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 418 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-catalog-owner-owner-4.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 381 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-catalog-owner-owner-5.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 384 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-catalog-owner-owner-6.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 427 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-catalog-owner.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 396 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-checkpoint-lifetime.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 509 | 3 | search |
| `packages/agents/src/api/__tests__/workspace-definition-extension-isolation.behavior.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 668 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-definition-lifetime.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 553 | 2 | search |
| `packages/agents/src/api/__tests__/workspace-definition-preflight.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 603 | 2 | search |
| `packages/agents/src/api/__tests__/workspace-definition-transfer.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 517 | 3 | search |
| `packages/agents/src/api/__tests__/workspace-filesystem-encoding.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 398 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-filesystem-lifetime.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 465 | 3 | search |
| `packages/agents/src/api/__tests__/workspace-filesystem-production.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 662 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-filesystem-shared-skills.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 620 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-filesystem-skill-publication.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 365 | 1 | search |

### T6.0-S12: packages/agents/src/api/__tests__ (14 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/workspace-lsp-lifetime.behavior.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 403 | 3 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-10.behavior.test.ts` | test | importer | activation-acquisition-capture | 210 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-2.behavior.test.ts` | test | importer | agent-resource-capture | 240 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-3.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 217 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-4.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 224 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-5.behavior.test.ts` | test | importer | agent-resource-capture | 177 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-6.behavior.test.ts` | test | importer | agent-resource-capture | 182 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-7.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 248 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-8.behavior.test.ts` | test | importer | activation-acquisition-capture | 210 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime-owner-9.behavior.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 234 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-memory-lifetime.behavior.test.ts` | test | importer | agent-resource-capture | 204 | 1 | search |
| `packages/agents/src/api/__tests__/workspace-registrar-reload-owner-owner-1.behavior.test.ts` | test | importer | agent-resource-capture, skills-fixture-caller | 315 | 3 | search |
| `packages/agents/src/api/__tests__/workspace-registrar-reload-owner.behavior.test.ts` | test | importer | skills-fixture-caller | 185 | 3 | search |
| `packages/agents/src/api/__tests__/workspace-trust-production.behavior.test.ts` | test | importer | agent-resource-capture | 155 | 3 | search |

### T6.0-S13: packages/agents/src/api/__tests__/helpers (15 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/api/__tests__/helpers/activation-acquisition-capture.ts` | helper | definition | declares | 279 | 0 | added |
| `packages/agents/src/api/__tests__/helpers/adoption-fixture.ts` | helper | definition | declares | 147 | 0 | added |
| `packages/agents/src/api/__tests__/helpers/agent-resource-capture.ts` | helper | definition | adoption-fixture, activation-acquisition-capture, createAgentRuntimeFactoryBindings | 371 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/agentHarness.ts` | helper | importer | agent-resource-capture | 578 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/async-child-disposal-join-fixture.ts` | helper | importer | agent-resource-capture | 620 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/caller-fixture.ts` | helper | definition | createAgentRuntimeFactoryBindings | 288 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/child-parameter-tool.ts` | helper | importer | agent-resource-capture | 70 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/disposalProbe.ts` | helper | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 609 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/generation-owner-fixture.ts` | helper | importer | agent-resource-capture | 446 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/realLoopHarness.ts` | helper | incidental | string only | 398 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.ts` | helper | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 549 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/session-client-capture.ts` | helper | importer | agent-resource-capture | 169 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/session-failure-fixture.ts` | helper | importer | activation-acquisition-capture | 84 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/skills-fixture-caller.ts` | helper | definition | agent-resource-capture, createAgentRuntimeFactoryBindings | 348 | 0 | search |
| `packages/agents/src/api/__tests__/helpers/skills-fixture-declarations.ts` | helper | importer | agent-resource-capture | 66 | 0 | search |

### T6.0-S14: packages/agents/src/core (7 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/core/coreToolScheduler.approval-outcomes.test.ts` | test | incidental | string only | 853 | 11 | search |
| `packages/agents/src/core/coreToolScheduler.denial-transitions.test.ts` | test | incidental | string only | 205 | 1 | search |
| `packages/agents/src/core/coreToolScheduler.interactiveMode.test.ts` | test | incidental | string only | 566 | 6 | search |
| `packages/agents/src/core/coreToolScheduler.issue3299.test.ts` | test | incidental | string only | 636 | 6 | search |
| `packages/agents/src/core/coreToolScheduler.raceCondition.test.ts` | test | incidental | string only | 628 | 6 | search |
| `packages/agents/src/core/coreToolScheduler.seenCallIds.test.ts` | test | incidental | string only | 235 | 3 | search |
| `packages/agents/src/core/nonInteractiveToolExecutor.responseStructure.test.ts` | test | incidental | string only | 435 | 12 | search |

### T6.0-S15: packages/agents/src/core/agenticLoop/__tests__ (6 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.auto-policy.test.ts` | test | incidental | string only | 132 | 1 | search |
| `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.cancellation.test.ts` | test | incidental | string only | 557 | 6 | search |
| `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.doneOrdering.test.ts` | test | incidental | string only | 158 | 1 | search |
| `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.output-bound.test.ts` | test | incidental | string only | 156 | 1 | search |
| `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.prompt-id.test.ts` | test | incidental | string only | 261 | 4 | search |
| `packages/agents/src/core/agenticLoop/__tests__/agenticLoop.retryDiscard.test.ts` | test | incidental | string only | 243 | 5 | search |

### T6.0-S16: agents small directories (4 dirs, each under 5 files) (9 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/agents/src/__tests__/coreToolScheduler-same-path-mutations-helpers.ts` | helper | incidental | string only | 306 | 0 | search |
| `packages/agents/src/api/profile-candidate-operations.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 535 | 1 | search |
| `packages/agents/src/api/runtimeFactories.ts` | source | definition | declares | 192 | 0 | search |
| `packages/agents/src/core/__tests__/child-task-tool-lifetime.behavior.test.ts` | test | importer | agent-resource-capture | 263 | 2 | search |
| `packages/agents/src/core/__tests__/subagentOrchestrator.isolatedConfigDispose.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 275 | 3 | search |
| `packages/agents/src/core/__tests__/subagentSchedulerDependencyBinding.test.ts` | test | incidental | string only | 209 | 1 | search |
| `packages/agents/src/session/childToolDisplay.test.ts` | test | incidental | string only | 154 | 1 | search |
| `packages/agents/src/session/scheduler-owner-integration.test.ts` | test | incidental | string only | 384 | 5 | search |
| `packages/agents/src/session/sessionSchedulerOwner.test.ts` | test | incidental | string only | 717 | 12 | search |

### T6.0-S17: packages/cli/src (11 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/cli/src/activation-bootstrap-handoff.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 312 | 4 | search |
| `packages/cli/src/bootstrap-cleanup-lifecycle.test.ts` | test | importer | adoption-fixture, activation-acquisition-capture | 822 | 18 | search |
| `packages/cli/src/cli.provider-init.test.ts` | test | importer | agent-resource-capture | 491 | 3 | search |
| `packages/cli/src/cliAgentBootstrap.test.ts` | test | importer | agent-resource-capture, activation-acquisition-capture | 275 | 9 | search |
| `packages/cli/src/cliBootstrap.providerActivation.test.ts` | test | importer | activation-acquisition-capture | 335 | 8 | search |
| `packages/cli/src/nonInteractiveCli.slashCommandsAndThinking-owner-1.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 670 | 4 | search |
| `packages/cli/src/nonInteractiveUnconfiguredProvider.test.ts` | test | importer | adoption-fixture | 642 | 12 | search |
| `packages/cli/src/session-client-bootstrap.behavior.test.ts` | test | importer | activation-acquisition-capture | 440 | 6 | search |
| `packages/cli/src/workspace-extension-lifetime-owner-1.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 444 | 1 | search |
| `packages/cli/src/workspace-extension-lifetime-owner-2.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 453 | 1 | search |
| `packages/cli/src/workspace-extension-lifetime.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 447 | 1 | search |

### T6.0-S18: packages/cli/src/__tests__ (7 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/cli/src/__tests__/command-owner-fixture.ts` | helper | importer | agent-resource-capture | 134 | 0 | search |
| `packages/cli/src/__tests__/headless-policy-fixture.ts` | helper | importer | adoption-fixture | 122 | 0 | search |
| `packages/cli/src/__tests__/scripted-headless-owner.ts` | helper | importer | agent-resource-capture | 218 | 0 | search |
| `packages/cli/src/__tests__/session-client-headless-fixture.ts` | helper | importer | activation-acquisition-capture | 441 | 0 | search |
| `packages/cli/src/__tests__/startup-activation-fixture.ts` | helper | importer | adoption-fixture | 88 | 0 | search |
| `packages/cli/src/__tests__/stream-media-fixture.ts` | helper | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 225 | 0 | search |
| `packages/cli/src/__tests__/task-notification-fixture.ts` | helper | importer | agent-resource-capture | 221 | 0 | search |

### T6.0-S19: packages/cli/src/ui/contexts (6 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/cli/src/ui/contexts/runtime-owner-bridge-owner-1.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 721 | 1 | search |
| `packages/cli/src/ui/contexts/runtime-owner-bridge-owner-2.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 772 | 1 | search |
| `packages/cli/src/ui/contexts/runtime-owner-bridge.oauth.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 640 | 1 | search |
| `packages/cli/src/ui/contexts/runtime-owner-bridge.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 645 | 1 | search |
| `packages/cli/src/ui/contexts/runtime-owner-missing.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 477 | 1 | search |
| `packages/cli/src/ui/contexts/runtime-profile-port.behavior.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 336 | 1 | search |

### T6.0-S20: packages/cli/src/ui/hooks (16 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/cli/src/ui/hooks/child-tool-owner-owner-1.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 581 | 1 | search |
| `packages/cli/src/ui/hooks/child-tool-owner-owner-2.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 590 | 1 | search |
| `packages/cli/src/ui/hooks/child-tool-owner-owner-3.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 595 | 1 | search |
| `packages/cli/src/ui/hooks/child-tool-owner-owner-4.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 629 | 1 | search |
| `packages/cli/src/ui/hooks/child-tool-owner-owner-5.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 619 | 1 | search |
| `packages/cli/src/ui/hooks/child-tool-owner.test.tsx` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 616 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-1.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 484 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-2.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 470 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-3.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 476 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-4.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 499 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-5.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 480 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-6.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 471 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-7.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 526 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-8.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 505 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner-owner-9.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 498 | 1 | search |
| `packages/cli/src/ui/hooks/client-tool-owner.test.tsx` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 507 | 1 | search |

### T6.0-S21: cli small directories (12 dirs, each under 5 files) (11 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/cli/src/config/__tests__/cliRuntimeImportCut.test.ts` | test | importer | activation-acquisition-capture | 331 | 3 | search |
| `packages/cli/src/config/__tests__/e2eOrderingParity.test.ts` | test | importer | activation-acquisition-capture | 381 | 9 | search |
| `packages/cli/src/config/__tests__/profileOverridePrecedenceParity.test.ts` | test | importer | activation-acquisition-capture | 489 | 13 | search |
| `packages/cli/src/config/config.kimiModelBootstrap.test.ts` | test | importer | activation-acquisition-capture | 140 | 2 | search |
| `packages/cli/src/config/config.loadMemory.test.ts` | test | importer | activation-acquisition-capture | 230 | 2 | search |
| `packages/cli/src/config/foreground-cli-kimi-http.test.ts` | test | importer | adoption-fixture | 203 | 1 | search |
| `packages/cli/src/config/runtimePlugins.wiring.test.ts` | test | importer | activation-acquisition-capture | 302 | 5 | search |
| `packages/cli/src/integration-tests/__tests__/prepare-preflight.ts` | helper | importer | activation-acquisition-capture | 80 | 0 | search |
| `packages/cli/src/integration-tests/__tests__/session-client-owner-fixture.ts` | helper | importer | activation-acquisition-capture | 74 | 0 | search |
| `packages/cli/src/integration-tests/provider-switching.integration.test.ts` | test | importer | activation-acquisition-capture | 606 | 13 | search |
| `packages/cli/src/integration-tests/test-utils.ts` | helper | importer | adoption-fixture | 342 | 0 | search |

### T6.0-S22: cli small directories (12 dirs, each under 5 files) (10 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/cli/src/runtime/__tests__/runtime-model-ownership.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 609 | 1 | search |
| `packages/cli/src/services/workspace-mcp-consumers.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 518 | 5 | search |
| `packages/cli/src/session/__tests__/telemetry-cleanup.fixture.ts` | helper | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 495 | 0 | search |
| `packages/cli/src/session/interactive-owner-startup.test.tsx` | test | importer | adoption-fixture | 400 | 5 | search |
| `packages/cli/src/session/telemetry-export-cleanup.behavior.test.ts` | test | importer | agent-resource-capture | 171 | 4 | search |
| `packages/cli/src/ui/cliUiRuntime.agentClientSource.test.ts` | test | importer | adoption-fixture, agent-resource-capture | 580 | 3 | search |
| `packages/cli/src/ui/commands/clearCommand.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 638 | 7 | search |
| `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.background-clear.test.tsx` | test | importer | agent-resource-capture (via agentHarness re-export) | 805 | 8 | added |
| `packages/cli/src/ui/hooks/agentStream/__tests__/useSubmitQuery.providerIgnoreCancel.bun.tsx` | helper | importer | adoption-fixture | 861 | 1 | search |
| `packages/cli/src/ui/utils/autoPromptGenerator.test.ts` | test | importer | agent-resource-capture | 224 | 8 | search |

### T6.0-S23: core small directories (4 dirs, each under 5 files) (8 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/core/src/hooks/__tests__/physical-hook-fixture.ts` | helper | incidental | string only | 141 | 0 | search |
| `packages/core/src/hooks/hook-runner-lifetime.test.ts` | test | incidental | string only | 236 | 3 | search |
| `packages/core/src/hooks/hook-system-lifetime.test.ts` | test | incidental | string only | 152 | 2 | search |
| `packages/core/src/hooks/notification-hook.test.ts` | test | incidental | string only | 167 | 4 | search |
| `packages/core/src/hooks/session-hook-owner.test.ts` | test | incidental | string only | 336 | 7 | search |
| `packages/core/src/telemetry/loggers.test.circular.ts` | source | incidental | string only | 130 | 2 | search |
| `packages/core/src/tools-adapters/workspace-filesystem-skills.test.ts` | test | incidental | string only | 164 | 3 | search |
| `packages/core/src/tools-adapters/workspace-filesystem-tools.test.ts` | test | incidental | string only | 321 | 12 | search |

### T6.0-S24: packages/providers/src/runtime (7 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/providers/src/runtime/assembleCliProviderRuntime.identity.test.ts` | test | importer | agent-resource-capture | 473 | 7 | search |
| `packages/providers/src/runtime/assembleCliProviderRuntime.test.ts` | test | importer | agent-resource-capture | 229 | 8 | search |
| `packages/providers/src/runtime/isolated-runtime-owner-scope.test.ts` | test | importer | agent-resource-capture | 297 | 5 | search |
| `packages/providers/src/runtime/runtime-owner-requirements.test.ts` | test | importer | adoption-fixture | 39 | 2 | search |
| `packages/providers/src/runtime/runtimeContextFactory.requiredConfig.test.ts` | test | importer | adoption-fixture | 85 | 3 | search |
| `packages/providers/src/runtime/runtimeLifecycle.spec.ts` | test | importer | agent-resource-capture | 356 | 7 | search |
| `packages/providers/src/runtime/runtimeRegistry.spec.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 389 | 10 | search |

### T6.0-S25: providers small directories (1 dirs, each under 5 files) (1 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/providers/src/openai-responses/compression-session-headers.behavior.test.ts` | test | importer | agent-resource-capture | 180 | 1 | search |

### T6.0-S26: packages/zed-acp/src (6 files)

| file | role | kind | uses | lines | blocks | source |
| --- | --- | --- | --- | --- | --- | --- |
| `packages/zed-acp/src/zed-model-port.behavior.test.ts` | test | importer | adoption-fixture, createAgentRuntimeFactoryBindings | 394 | 2 | search |
| `packages/zed-acp/src/zed-provider-owner.connection-owner-1.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 716 | 1 | search |
| `packages/zed-acp/src/zed-provider-owner.connection-owner-2.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 444 | 1 | search |
| `packages/zed-acp/src/zed-provider-owner.connection-owner-3.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 793 | 1 | search |
| `packages/zed-acp/src/zed-provider-owner.connection.test.ts` | test | importer | createAgentRuntimeFactoryBindings | 747 | 1 | search |
| `packages/zed-acp/src/zedIntegration.test.ts` | test | importer | agent-resource-capture, createAgentRuntimeFactoryBindings | 697 | 8 | search |

## `adopt*` fields (from `git grep -n "adopt[A-Z]" -- packages/agents/src/api ':!*__tests__*' ':!*.test.ts'`)

Production writes to `adopt*` fields: `git grep -n -E 'adopt[A-Z][A-Za-z]* *=[^=>]' -- packages/agents/src ':!*.test.ts' ':!*/__tests__/*'` finds exactly three writes from outside the assembly's own methods, all in `AgentActivationBootstrap.adopt` (`activationPreflightState.ts:531-533`): `adoptSettingsService`, `adoptIntent`, `adoptCredentialAuthority`. The remaining writes are the assembly writing its own derived state (listed after the table). Every other input field below is written only by test fixtures (`adoption-fixture.ts`, `adopted-provider-fixture.ts`). There is no other production caller of `fromConfig`/`AgentActivationBootstrap.adopt` outside tests except `packages/cli/src/integration-tests/test-utils.ts:127`, a test utility that passes `{ mcpOwnership: 'caller' }`.

Input fields declared at `adopted-agent-assembly.ts:141-183` (35 fields). "Production readers" are the methods that read the field in non-test source; the columns are the plan's: set in production, readers (file and symbol, with line numbers).

| field | declared | set in production | production readers |
| --- | --- | --- | --- |
| `adoptSettingsService` | adopted-agent-assembly.ts:141 | yes, activationPreflightState.ts:531 | adopted-agent-assembly.ts #adoptValidateAdoption (253); adopted-agent-assembly.ts #adoptAcquireProviders (442); adopted-agent-assembly.ts #adoptFinalize (587); adopted-agent-assembly.ts #adoptAcquireFacade (602, 606); adopted-agent-assembly.ts #adoptConstructFacade (704, 722); fromConfig-session.ts acquireAdoptedProviderManager (116); fromConfig-session.ts acquireAdoptedOAuth (150); fromConfig-session.ts activateAdoptedProviders (173, 185); fromConfig-session.ts acquireAdoptedSession (449); fromConfig-session.ts activateAdoptedSession (472, 485); activationPreflightState.ts validateAdoptionIdentity (559); activationPreflightState.ts acceptAdoption (636) |
| `adoptIntent` | adopted-agent-assembly.ts:142 | yes, activationPreflightState.ts:532 | adopted-agent-assembly.ts assembleAdoption (228); adopted-agent-assembly.ts #adoptValidateAdoption (247, 248, 251); adopted-agent-assembly.ts #adoptAssertWorkspaceHandoff (289, 291); adopted-agent-assembly.ts #adoptConstructMcp (305, 307, 334, 339, 349); adopted-agent-assembly.ts #adoptAdoptConfig (423); adopted-agent-assembly.ts #adoptOwnsMcp (492); adopted-agent-assembly.ts #adoptComplete (515); adopted-agent-assembly.ts #adoptFinalize (573, 575); adopted-agent-assembly.ts #adoptAcquireFacade (637); adopted-agent-assembly.ts #adoptCloseMcpAdmission (656); adopted-agent-assembly.ts #adoptConstructFacade (711); fromConfig-session.ts acquireAdoptedSession (439, 440); fromConfig-session.ts activateAdoptedSession (479); activationPreflightState.ts validateAdoptionIdentity (548, 557); activationPreflightState.ts acceptAdoption (628) |
| `adoptSettingsOwner` | adopted-agent-assembly.ts:143 | no | adopted-agent-assembly.ts #adoptValidateAdoption (253); adopted-agent-assembly.ts #adoptMcpOperations (371); adopted-agent-assembly.ts #adoptAcquireProviders (441, 447) |
| `adoptProviderManager` | adopted-agent-assembly.ts:144 | no | adopted-agent-assembly.ts #adoptAssertBorrowedClient (278); adopted-agent-assembly.ts #adoptFinalize (567); fromConfig-session.ts acquireAdoptedProviderManager (104, 105); fromConfig-session.ts activateAdoptedProviders (176); activationPreflightState.ts validateAdoptionIdentity (558) |
| `adoptOauthManager` | adopted-agent-assembly.ts:145 | no | adopted-agent-assembly.ts #adoptValidateAdoption (260); adopted-agent-assembly.ts #adoptAcquireOAuth (482); activationPreflightState.ts validateAdoptionIdentity (570) |
| `adoptMessageBus` | adopted-agent-assembly.ts:146 | no | adopted-agent-assembly.ts assembleAdoption (204); activationPreflightState.ts validateAdoptionIdentity (571) |
| `adoptMcpRuntime` | adopted-agent-assembly.ts:147 | no | adopted-agent-assembly.ts assembleAdoption (206); adopted-agent-assembly.ts #adoptValidateAdoption (254, 255, 257); adopted-agent-assembly.ts #adoptAssertBorrowedClient (279); adopted-agent-assembly.ts #adoptAssertWorkspaceHandoff (287); adopted-agent-assembly.ts #adoptAdoptConfig (400); adopted-agent-assembly.ts #adoptAcquireOAuth (487); adopted-agent-assembly.ts #adoptOwnsMcp (493); fromConfig-session.ts acquireAdoptedSession (461); activationPreflightState.ts validateAdoptionIdentity (547) |
| `adoptActivationPreflight` | adopted-agent-assembly.ts:148 | no | adopted-agent-assembly.ts assembleAdoption (190, 200); adopted-agent-assembly.ts #adoptValidateAdoption (261); adopted-agent-assembly.ts #adoptAssertBorrowedClient (282); adopted-agent-assembly.ts #adoptConstructMcp (299); adopted-agent-assembly.ts #adoptAdoptConfig (402); adopted-agent-assembly.ts #adoptAcquireProviders (436); adopted-agent-assembly.ts #adoptAcquireOAuth (472); adopted-agent-assembly.ts #adoptComplete (499); adopted-agent-assembly.ts #adoptFinalize (563); activationPreflightState.ts validateAdoptionIdentity (552); activationPreflightState.ts acceptAdoption (627) |
| `adoptAgentClient` | adopted-agent-assembly.ts:149 | no | adopted-agent-assembly.ts #adoptAssertBorrowedClient (276, 283); adopted-agent-assembly.ts #adoptAdoptConfig (411); fromConfig-session.ts acquireAdoptedSession (442, 465) |
| `adoptProviderFileLifecycle` | adopted-agent-assembly.ts:150 | no | adopted-agent-assembly.ts #adoptAcquireProviders (453); activationPreflightState.ts validateAdoptionIdentity (577) |
| `adoptTokenizerFactory` | adopted-agent-assembly.ts:151 | no | adopted-agent-assembly.ts #adoptAcquireOAuth (475); activationPreflightState.ts validateAdoptionIdentity (572) |
| `adoptContentGeneratorFactory` | adopted-agent-assembly.ts:152 | no | adopted-agent-assembly.ts #adoptAcquireOAuth (479); activationPreflightState.ts validateAdoptionIdentity (574) |
| `adoptRuntimeFactoryBindings` | adopted-agent-assembly.ts:155 | no | adopted-agent-assembly.ts #adoptInitializeSession (544); fromConfig-session.ts acquireAdoptedSession (457) |
| `adoptCredentialAuthority` | adopted-agent-assembly.ts:158 | yes, activationPreflightState.ts:533 | adopted-agent-assembly.ts assembleAdoption (214) |
| `adoptPolicyOwner` | adopted-agent-assembly.ts:159 | no | adopted-agent-assembly.ts assembleAdoption (207); adopted-agent-assembly.ts #adoptPolicyHandoff (377); fromConfig-session.ts acquireAdoptedSession (461) |
| `adoptTrustPort` | adopted-agent-assembly.ts:160 | no | adopted-agent-assembly.ts #adoptConstructMcp (352); activationPreflightState.ts validateAdoptionIdentity (590) |
| `adoptIdePort` | adopted-agent-assembly.ts:161 | no | adopted-agent-assembly.ts #adoptConstructMcp (354) |
| `adoptHookOwner` | adopted-agent-assembly.ts:162 | no | adopted-agent-assembly.ts #adoptInitializeSession (551, 555); activationPreflightState.ts validateAdoptionIdentity (597) |
| `adoptDefinitionOwner` | adopted-agent-assembly.ts:163 | no | adopted-agent-assembly.ts assembleAdoption (229, 230); adopted-agent-assembly.ts #adoptConstructMcp (303); adopted-agent-assembly.ts #adoptAdoptConfig (422); adopted-agent-assembly.ts #adoptAcquireOAuth (485); adopted-agent-assembly.ts #adoptComplete (514); adopted-agent-assembly.ts #adoptInitializeSession (541); adopted-agent-assembly.ts #adoptAcquireFacade (636); adopted-agent-assembly.ts #adoptCloseMcpAdmission (657); adopted-agent-assembly.ts #adoptConstructFacade (681); activationPreflightState.ts validateAdoptionIdentity (589) |
| `adoptFilesystemOwner` | adopted-agent-assembly.ts:164 | no | adopted-agent-assembly.ts #adoptAssertWorkspaceHandoff (290); adopted-agent-assembly.ts #adoptConstructMcp (301); activationPreflightState.ts validateAdoptionIdentity (588) |
| `adoptLspOwner` | adopted-agent-assembly.ts:165 | no | adopted-agent-assembly.ts #adoptAssertWorkspaceHandoff (288); adopted-agent-assembly.ts #adoptConstructMcp (332, 335) |
| `adoptMemoryOwner` | adopted-agent-assembly.ts:166 | no | adopted-agent-assembly.ts assembleAdoption (232, 233, 234); adopted-agent-assembly.ts #adoptAssertWorkspaceHandoff (292); adopted-agent-assembly.ts #adoptConstructMcp (311, 313, 314); activationPreflightState.ts validateAdoptionIdentity (565) |
| `adoptAsyncTaskManager` | adopted-agent-assembly.ts:167 | no | adopted-agent-assembly.ts #adoptAcquireFacade (603) |
| `adoptMcpHost` | adopted-agent-assembly.ts:168 | no | adopted-agent-assembly.ts #adoptConstructMcp (310, 321, 326); activationPreflightState.ts validateAdoptionIdentity (549) |
| `adoptMcpTokenStorage` | adopted-agent-assembly.ts:169 | no | adopted-agent-assembly.ts #adoptConstructMcp (323); activationPreflightState.ts validateAdoptionIdentity (550) |
| `adoptGithubBrokerClient` | adopted-agent-assembly.ts:170 | no | adopted-agent-assembly.ts assembleAdoption (195) |
| `adoptDisposeGitHubBroker` | adopted-agent-assembly.ts:171 | no | adopted-agent-assembly.ts assembleAdoption (196) |
| `adoptImageOperation` | adopted-agent-assembly.ts:172 | no | adopted-agent-assembly.ts assembleAdoption (187); activationPreflightState.ts validateAdoptionIdentity (561) |
| `adoptOnApproval` | adopted-agent-assembly.ts:175 | no | adopted-agent-assembly.ts #adoptAcquireFacade (620, 621) |
| `adoptOnOAuthPrompt` | adopted-agent-assembly.ts:176 | no | adopted-agent-assembly.ts #adoptConstructFacade (715) |
| `adoptEditorCallbacks` | adopted-agent-assembly.ts:177 | no | adopted-agent-assembly.ts #adoptAcquireFacade (611) |
| `adoptPrepareSessionTools` | adopted-agent-assembly.ts:178 | no | adopted-agent-assembly.ts #adoptInitializeSession (559) |
| `adoptToolSchedulerFactory` | adopted-agent-assembly.ts:179 | no | adopted-agent-assembly.ts #adoptFinalize (581) |
| `adoptSkillPolicy` | adopted-agent-assembly.ts:180 | no | adopted-agent-assembly.ts #adoptMcpOperations (366) |
| `adoptRegisterSkillTools` | adopted-agent-assembly.ts:183 | no | adopted-agent-assembly.ts #adoptMcpOperations (368) |

Abstract redeclarations in `fromConfig-session.ts`: adoptSettingsService (:70), adoptIntent (:71), adoptAgentClient (:72), adoptRuntimeFactoryBindings (:73), adoptPolicyOwner (:76), adoptMcpRuntime (:77), adoptProviderManager (:91), adoptRelease (:95).

Derived state the assembly writes to itself (not inputs; not candidates for deletion by T6.D1): adoptClient (fromConfig-session.ts:79), adoptMcp (fromConfig-session.ts:80), adoptMedia (fromConfig-session.ts:81), adoptSelectedSettings (fromConfig-session.ts:82), adoptFiles (fromConfig-session.ts:83), adoptManager (fromConfig-session.ts:84), adoptOauth (fromConfig-session.ts:85), adoptTokenizer (fromConfig-session.ts:86), adoptContent (fromConfig-session.ts:87), adoptSelectedBus (fromConfig-session.ts:88), adoptImages (fromConfig-session.ts:89), adoptRuntimeId (fromConfig-session.ts:92), adoptAuthority (fromConfig-session.ts:93), adoptOAuthProfiles (fromConfig-session.ts:96), adoptSuppliedOAuth (fromConfig-session.ts:99), adoptTokenStore (fromConfig-session.ts:100), adoptOAuthBus (fromConfig-session.ts:101), adoptAgent (adopted-agent-assembly.ts:384), adoptGithub (adopted-agent-assembly.ts:386).

### `AgentAdoptionIntent` ownership options (`config-types.ts:441-449`)

| option | set in production | production readers |
| --- | --- | --- |
| `sessionId`, `activation` | no production caller of `fromConfig` outside tests | adopted-agent-assembly.ts (#adoptValidateAdoption, #adoptFinalize), fromConfig-session.ts |
| `sessionIdentityOwnership` | no (`foreground-agent-assembly.ts:300` and `agentRuntimeAssembly.ts:655` set the facade field `'config'` directly, not this option) | adopted-agent-assembly.ts:711 |
| `definitionOwnership`, `filesystemOwnership`, `lspOwnership` (`'agent' \| 'caller'`) | no | adopted-agent-assembly.ts:228,289,291,305,307,334,339,349,423,515,637,656; mcpOAuthAssembly.ts rejection branches |
| `mcpOwnership` | no (only `cli/src/integration-tests/test-utils.ts:130`, a test utility) | activationPreflightState.ts:548; adopted-agent-assembly.ts:492 |

## Production failures

None recorded. T6.Bxx coders add entries here under the conservation rule.
