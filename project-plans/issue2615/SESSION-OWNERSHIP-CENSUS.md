# Slice E session execution ownership: deletion and caller census

Status: working-tree census on `issue2615-session-runtime`, compared with `origin/main` at `fde30e462b663cae4c7db974de854f18ac63b288` (also `HEAD`). This replaces the packet 1 direct-spelling inventory. The working tree contains dirty implementation and test changes; the full `npm run test:bun` rerun and final lint, format, typecheck, build, and session-boundary checks passed. The provider smoke did not pass because of an external HTTP 429. `project-plans/issue2615/analysis/role-assignment.json` is historical input from `fedd4f9e932834ffd7f3d9affa750db3d4829f1b`, not current evidence. Its `getTaskToolRegistration` entry, for example, points at a different tree.

## Scope and counting rule

The five live services are scheduler, task, shell, approval bus, and recording. An *original caller* below is one baseline access expression at a unique file, line and column, not one test, runtime invocation, or reference to a type. Counts include production and test/helper sites separately. A removed Config API may leave a similarly named method on a session owner, an explicit UI scheduler adapter, or a provider-auth bus; those are not Config access. The numbers reconcile the **checker-observed, named access-expression set**, not every possible dynamic or structural caller in the repository. See the coverage gaps below before using them as a claim of exhaustive deletion.

Reproduction from the repository root, without checking out the dirty tree:

```sh
mkdir -p tmp/issue2615-census-baseline
git archive fde30e462 packages tsconfig.json | tar -xf - -C tmp/issue2615-census-baseline
bun scripts/check-session-config-boundary.ts --root tmp/issue2615-census-baseline
bun scripts/check-session-config-boundary.ts
bun test scripts/tests/check-session-config-boundary.test.ts
```

The baseline archive contains the original package tsconfigs and source. The first checker command exits 1 with 94 stderr lines; the current command exits 0 with stdout `Session Config boundary: pass` and empty stderr. The test command exits 0 with `7 pass`, `0 fail`, `12 expect() calls`. The baseline checker is a production-only guard, not a fixture census: its 94 lines include declarations, Config-internal field access, and construction in addition to calls. Its raw stderr is captured at `tmp/issue2615-census-baseline/guard.stderr`. The independently collected baseline checker-backed access rows are at `tmp/issue2615-census-baseline/callers.tsv` and the deduplicated rows at `tmp/issue2615-census-baseline/callers.unique.tsv`. The scratch directory is gitignored and is not a durable PR artifact.

The supplemental read-only TypeScript scan used each baseline `packages/*/tsconfig.json` with `ts.readConfigFile`, `ts.parseJsonConfigFileContent`, `ts.createProgram` and `program.getTypeChecker()`. It visited `packages/*/src` source files in those programs, **including tests**, recorded each named property or literal indexed access, destructured binding, and indexed type projection, and recorded `checker.getSymbolAtLocation` declaration origins and `checker.getTypeAtLocation` receiver types. It deduplicated identical `(member, file, line, column, access kind, origin)` rows produced by multiple package programs. Raw observation: `412` program-local rows, `176` unique rows. A separate declaration-origin review excluded 6 accesses to fixture-local `getToolSchedulerFactory`, 3 to provider-auth `setRuntimeMessageBus`, 1 to the independent `subagentTypes.ts` structural guard, and 16 to the **retained** generic task registration APIs. The remaining 150 access expressions are apportioned below. The actual scan was run as a `bun - <<'TS' > tmp/issue2615-census-baseline/callers.tsv` inline TypeScript program, not as an added script; the TSV contains member, location, access kind, resolved declaration and receiver type. `sort -u tmp/issue2615-census-baseline/callers.tsv > tmp/issue2615-census-baseline/callers.unique.tsv` generated the deduplicated output. Unlike the enforcement checker, this supplemental scan matches a fixed list of spellings even if the resolved declaration is a structural host, then uses the symbol origin to separate Config reach-through from independent APIs. Neither scan follows arbitrary callback values or dynamic property keys.

Paths in the site ledger use `a/` = `packages/agents/src/`, `c/` = `packages/core/src/`, `cli/` = `packages/cli/src/`, `p/` = `packages/providers/src/`, `z/` = `packages/zed-acp/src/`. Numbers after the final colon are **baseline** line numbers. A repeated file with two line numbers denotes two separate access expressions. `P` means production, `T` means test or test helper. `M` means that the site was replaced with a session-owned dependency or an explicit forwarding contract. `D` means that the old Config access was removed as obsolete. Every number in the next table is a count of observed original expressions, not of new accesses.

| Removed Config service API or projected host member | Original P + T | Migrated | Deleted | Site disposition |
| --- | ---: | ---: | ---: | --- |
| `getOrCreateScheduler` | 8 + 23 = 31 | 27 | 4 | Production 8 M; tests/helpers 19 M, 4 D in removed `c/config/config.scheduler.test.ts`. |
| `disposeScheduler` | 9 + 19 = 28 | 19 | 9 | Production 9 M; tests/helpers 10 M, 9 D in removed `c/config/config.scheduler.test.ts`. |
| `getToolSchedulerFactory` | 2 + 7 = 9 | 2 | 7 | `a/api/agentRuntimeAssembly.ts:43` and `a/api/__tests__/fromConfig.behavior.test.ts:744` M; `c/config/schedulerRegistryAccess.ts:80` D with its helper, remaining six Config-factory fixture assertions D. Six **additional** fixture-local methods with this spelling are not Config callers. |
| `setToolSchedulerFactory` | 1 + 2 = 3 | 1 | 2 | Assembly M to explicit session factory; Config-setter fixtures D. |
| `getInteractiveSubagentSchedulerFactory` | 2 + 0 = 2 | 2 | 0 | Structural `ToolRegistryHost` calls M to scheduler-owner provider. |
| `setInteractiveSubagentSchedulerFactory` (Config projection) | 3 + 3 = 6 | 6 | 0 | CLI/runtime and fixture wiring M to agent scheduler owner. The separate `c/core/subagentTypes.ts:78` shape guard remains and is excluded. |
| `getAsyncTaskManager` | 16 + 7 = 23 | 22 | 1 | Session task manager M for 15 production and 7 fixture accesses; `c/config/configBase.ts:369` D (old settings side effect). Includes structural tool host and callback accesses. |
| `getAsyncTaskReminderService` | 0 + 0 = 0 | 0 | 0 | No named access in the scanned programs; lazy Config declaration and its helper were deleted. This zero does not count declaration sites. |
| `setupAsyncTaskAutoTrigger` | 2 + 1 = 3 | 3 | 0 | CLI and fixture consumers M to session task-services setup. The Config declaration is separate from these counts. |
| `getShellJobManager` | 12 + 2 = 14 | 11 | 3 | Session shell dependency M for nine production plus two fixture accesses; Config lazy-helper call `c/config/config.ts:782`, old task setting side effect `c/config/configBase.ts:377`, and lazy helper callback `c/config/asyncTaskServices.ts:199` D. Five `TasksControlDeps` callback uses retain the spelling but now receive the session-owned shell manager. |
| `peekShellJobManager` | 1 + 0 = 1 | 1 | 0 | `cli/utils/shellJobShutdownNotice.ts:90` M to non-creating session view. |
| `getRuntimeMessageBus` | 5 + 2 = 7 | 7 | 0 | Explicit session/invocation bus M; two provider-runtime identity fixture accesses M to the explicit bus. |
| `setRuntimeMessageBus` (Config only) | 3 + 2 = 5 | 1 | 4 | `c/skills/skillDiscovery.ts:47` M to explicit bus; Config init, CLI publication, and two provider-runtime Config-publication assertions D. Independent provider-auth setter and its tests are excluded. |
| `getSessionRecordingService` | 7 + 6 = 13 | 13 | 0 | Explicit session recording accessor/port M in agents, core hooks, CLI and Zed, plus six fixture reads. |
| `setSessionRecordingService` | 5 + 0 = 5 | 5 | 0 | All five recording transitions M to the session control's own recording state. |

Thus each **observed** removed-API row satisfies `original = migrated + deleted`, with production and fixture splits shown. Structural projections here count as old Config reach-through only when the call was part of that path. The public generic `getTaskToolRegistration` and `setTaskToolRegistration` are **retained**, so they are not added to the deletion arithmetic: 14 and 2 original observed access expressions respectively. Their metadata selects a task-tool registration; `c/config/toolRegistryFactory.ts:524,633,686` still reads that registration, while task manager and shell manager are passed independently. Current `c/config/configBaseCore.ts:281,864`, `c/config/configTypes.ts:501`, and `c/config/configConstructor.ts:225,630` retain registration for callers adopting an existing tool registry. This is a generic registry/factory contract, not an owned `AsyncTaskManager` instance.

### Reproduce the supplemental checker rows

The following is the read-only supplemental command used above. It scans each package with its tsconfig; the final `sort -u` removes observations repeated by package programs. This code is included so the TSV can be regenerated without relying on an untracked script.

```sh
bun - <<'TS' > tmp/issue2615-census-baseline/callers.tsv
import ts from 'typescript';
import { readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
const root = resolve('tmp/issue2615-census-baseline');
const names = new Set('getOrCreateScheduler disposeScheduler getToolSchedulerFactory setToolSchedulerFactory getInteractiveSubagentSchedulerFactory setInteractiveSubagentSchedulerFactory getAsyncTaskManager getAsyncTaskReminderService setupAsyncTaskAutoTrigger getShellJobManager peekShellJobManager getRuntimeMessageBus setRuntimeMessageBus getSessionRecordingService setSessionRecordingService getTaskToolRegistration setTaskToolRegistration'.split(' '));
for (const pkg of readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(x => x.isDirectory())) {
  const cfg = join(root, 'packages', pkg.name, 'tsconfig.json');
  if (!ts.sys.fileExists(cfg)) continue;
  const read = ts.readConfigFile(cfg, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, join(root, 'packages', pkg.name), undefined, cfg);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  for (const source of program.getSourceFiles()) {
    const file = relative(root, source.fileName).replaceAll('\\', '/');
    if (!/^packages\/[^/]+\/src\/.*\.[cm]?tsx?$/.test(file) || file.endsWith('.d.ts')) continue;
    const seen = new Set();
    const record = (node, name, kind, receiver) => {
      const at = source.getLineAndCharacterOfPosition(node.getStart(source));
      const loc = `${file}:${at.line + 1}:${at.character + 1}`;
      const key = `${loc}:${name}:${kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      const decl = checker.getSymbolAtLocation(node)?.declarations?.[0];
      const origin = decl ? relative(root, decl.getSourceFile().fileName).replaceAll('\\', '/') + ':' + (decl.getSourceFile().getLineAndCharacterOfPosition(decl.getStart()).line + 1) : '?';
      const type = receiver ? checker.typeToString(checker.getTypeAtLocation(receiver)).slice(0, 130) : '-';
      console.log([name, loc, kind, origin, type].join('\t'));
    };
    const walk = (node) => {
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const key = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
        if (key && names.has(key)) record(node, key, ts.isPropertyAccessExpression(node) ? 'dot' : 'indexed', node.expression);
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && ts.isVariableDeclaration(node.parent.parent)) {
        const key = node.propertyName?.getText(source).replaceAll(/["']/g, '') ?? node.name.getText(source);
        if (names.has(key)) record(node, key, 'destructure', node.parent.parent.initializer);
      }
      if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType) && ts.isStringLiteral(node.indexType.literal) && names.has(node.indexType.literal.text)) record(node, node.indexType.literal.text, 'type-index', node.objectType);
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
}
TS
sort -u tmp/issue2615-census-baseline/callers.tsv > tmp/issue2615-census-baseline/callers.unique.tsv
wc -l tmp/issue2615-census-baseline/callers.tsv tmp/issue2615-census-baseline/callers.unique.tsv
```

Raw last-command output (spaces are `wc` padding):

```text
     412 tmp/issue2615-census-baseline/callers.tsv
     176 tmp/issue2615-census-baseline/callers.unique.tsv
     588 total
```

Raw `cut -f3 tmp/issue2615-census-baseline/callers.unique.tsv | sort | uniq -c` output is `168 dot` and `8 type-index`; there were zero literal element-access or destructured-binding rows for these spellings in the parsed baseline files. Four indexed type projections are `Config['getOrCreateScheduler']` in `a/core/agenticLoop/__tests__/agenticLoop.display-callbacks.test.ts:258-261`; the other four project structural `SchedulerRuntime` or `AsyncTaskRuntime` in `cli/ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.ts:436,456,474,497`. The checker fixture test demonstrates literal indexed value access, but the baseline scan did not observe one in these programs.

## Baseline caller site ledger and replacement

Each line below enumerates baseline sites from the 150-row resolved-origin selection. Unless marked D in the table above or explicitly below, sites are M. This ledger includes old forwarding/callback contracts, not just concrete `Config` receiver types.

- Scheduler acquisition P: `a/core/agenticLoop/AgenticLoop.ts:630`, `a/core/nonInteractiveToolExecutor.ts:66`, `a/core/subagentExecution.ts:684`, `a/core/subagentRuntimeSetup.ts:278,720`, `cli/runtime/interactiveToolScheduler.ts:256,375`, `cli/ui/cliUiRuntime.ts:694`. T: `a/api/__tests__/fromConfig.behavior.test.ts:690`, `a/core/__tests__/subagentSchedulerDependencyBinding.test.ts:148`, `a/core/agenticLoop/__tests__/agenticLoop.cancellation.test.ts:176,278`, `a/core/agenticLoop/__tests__/agenticLoop.display-callbacks.test.ts:258,259,260,261,266`, `a/core/agenticLoop/__tests__/agenticLoop.scheduler-isolation.test.ts:59`, `a/core/subagentRuntimeSetup.scheduler.test.ts:263,300,338,368`, `a/core/subagentToolProcessing.test.ts:874,899`, `cli/ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.ts:456`, `c/config/config.agentInversion.test.ts:204,213`, **D** `c/config/config.scheduler.test.ts:110,125,228,235`.
- Scheduler release P: `a/core/agenticLoop/AgenticLoop.ts:581`, `a/core/nonInteractiveToolExecutor.ts:185`, `a/core/subagentExecution.ts:722`, `a/core/subagentRuntimeSetup.ts:289,732`, `cli/runtime/interactiveToolScheduler.ts:266,325,388`, `cli/ui/cliUiRuntime.ts:692`. T: `a/core/__tests__/subagent-tool-processing-test-helpers.ts:128`, `a/core/__tests__/subagentSchedulerDependencyBinding.test.ts:150`, `a/core/agenticLoop/__tests__/agenticLoop.cancellation.test.ts:143,188,241,290,389`, `a/core/agenticLoop/__tests__/agenticLoop.scheduler-isolation.test.ts:108`, `a/core/subagentRuntimeSetup.scheduler.test.ts:389`, `cli/ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.ts:436`, **D** `c/config/config.scheduler.test.ts:256,257,330,342,361,366,367,387,411`. Replacement is `agent.scheduler` / `schedulerOwner.acquire` and `.release` in `a/api/agentRuntimeAssembly.ts`, `a/core/agenticLoop/AgenticLoop.ts`, `a/core/subagentRuntimeSetup.ts`, `cli/ui/cliUiRuntime.ts`; the CLI's `getOrCreateScheduler` / `disposeScheduler` names now forward to that explicit owner, not Config.
- Scheduler factory getter P: `a/api/agentRuntimeAssembly.ts:43` M, `c/config/schedulerRegistryAccess.ts:80` D. T: `a/api/__tests__/fromConfig.behavior.test.ts:744` M, `:787` D; `a/api/__tests__/preflightAgentActivation.behavior.test.ts:154,174,185,201` D; `a/core/__tests__/subagentOrchestrator-runtime.test.ts:298` D. Setter P: `a/api/agentRuntimeAssembly.ts:44` M; T: `a/api/__tests__/preflightAgentActivation.behavior.test.ts:151`, `a/tools/task.message-bus.integration.test.ts:137` D. Original factory parameter/assignment at `c/config/configTypes.ts:503` and `c/config/configConstructor.ts:226,636` were removed. Explicit `toolSchedulerFactory` at the `fromConfig` / `createAgent` assembly boundary now supplies `createSessionSchedulerOwner` in `a/api/agentRuntimeAssembly.ts`; it is not a Config field.
- Interactive scheduler getter P: `c/config/toolRegistryFactory.ts:541,664`. Setter P: `cli/runtime/interactiveToolScheduler.ts:409,415`, `cli/ui/cliUiRuntime.ts:702`; T: `cli/ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.ts:474`, `cli/ui/hooks/useToolScheduler.part2.test.ts:552,569`. Replacement is `schedulerOwner.getInteractiveSubagentSchedulerFactory()` in `a/api/runtimeFactories.ts:101,115` and the agent scheduler owner setter in `cli/ui/cliUiRuntime.ts:709`. The unrelated `c/core/subagentTypes.ts:78` runtime shape guard still tests whether a host exposes a method of this name; it does not publish a Config-owned factory.
- Task manager getter P: `a/api/agentImpl.ts:538`, `a/tools/task.ts:707,828`, `a/tools/taskAsyncExecution.ts:164`, `cli/ui/cliUiRuntime.ts:710`, `cli/ui/commands/tasksCommand.ts:97,182,237`, `cli/ui/hooks/agentStream/useAgentStreamOrchestration.ts:133`, **D** `c/config/configBase.ts:369`, `c/config/toolRegistryFactory.ts:542,587,665`, `c/tools-adapters/CoreSubagentServiceAdapter.ts:145` (two expressions), `:587`. T: `a/api/__tests__/tasksControl.behavior.test.ts:44,69,108,152,268,348,388`. The tool registry, adapter and task command now obtain the manager bound by `SessionTaskServices` in `a/api/agentRuntimeAssembly.ts:231-268`, `a/api/fromConfig.ts:101,127,141-144`, `a/api/agentImpl.ts:603` and `c/config/toolRegistryFactory.ts:524-540`. The callback projections in the old adapter are part of this count, not additional Config methods.
- Auto-trigger P: `cli/ui/cliUiRuntime.ts:712`, `cli/ui/hooks/agentStream/useSubmitQuery.ts:375`; T: `cli/ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.ts:497`. Session setup is `a/api/agentImpl.ts:604` into `a/api/agentRuntimeAssembly.ts:268`. The old lazy construction of manager, reminder and trigger and their Config fields are absent. `c/config/asyncTaskServices.ts` now retains settings normalization rather than the lazy owner.
- Shell getter P: `a/api/agentImpl.ts:539`, `a/api/control/tasksControl.ts:84,102,120,139,158` (structural callback), **D** `c/config/asyncTaskServices.ts:199`, **D** `c/config/config.ts:782`, **D** `c/config/configBase.ts:377`, `c/config/toolRegistryFactory.ts:588`, `c/tools-adapters/CoreShellToolHostAdapter.ts:241,252`. T: `c/tools-adapters/CoreShellToolHostAdapter.test.ts:101,165`. Peeker P: `cli/utils/shellJobShutdownNotice.ts:90`. The current callback at `a/api/agentImpl.ts:604` returns `taskServices.shellJobs`; `c/config/toolRegistryFactory.ts` receives `getShellJobs` and the shutdown notice reads a session view. The remaining `TasksControlDeps.getShellJobManager` spelling is an explicit session-supplied callback, not a Config lookup.
- Approval getter P: `a/api/fromConfig.ts:92`, `c/config/config.ts:427`, `c/config/configBase.ts:183`, `c/config/skill-tool-sync.ts:31`, `c/skills/skillDiscovery.ts:45`. T: `p/runtime/assembleCliProviderRuntime.identity.test.ts:76,104`. Config setter P: **D** `cli/config/postConfigRuntime.ts:276`, **D** `c/config/config.ts:216`, `c/skills/skillDiscovery.ts:47` M. T: **D** `p/runtime/assembleCliProviderRuntime.identity.test.ts:66,97`. Session bus creation/adoption is `a/api/agentRuntimeAssembly.ts:64-79`, used by `a/api/fromConfig.ts:89-96` and passed into Config initialization/skill sync as a dependency. The provider-auth `p/auth/oauth-manager.ts:93` and auth tests have a different receiver and remain outside this tally.
- Recording getter P: `a/core/ChatSessionFactory.ts:347`, `a/core/chatSessionMediaLifecycle.ts:20`, `cli/ui/cliUiRuntime.ts:549`, `cli/ui/commands/continuePackageActions.ts:103`, `c/hooks/hookEventHandler.ts:205`, `z/zedIntegration.ts:464,668`. T: `a/api/__tests__/sessionControl.concurrency.behavior.test.ts:303,350,411,555`, `c/hooks/hookEventHandler.test.ts:561,591`. Setter P: `a/api/control/sessionControl.ts:316,332,408,969,1061`. The live service is now `SessionControl.recording` at `a/api/control/sessionControl.ts:106` with `getActiveRecording()` at `:743`; consumers receive recording through session state or injected access rather than Config.

## Declarations removed, declarative reads retained

Baseline Config-owned declarations: `c/config/configBase.ts` scheduler release and registry; `c/config/config.ts` scheduler acquisition, lazy task/reminder/trigger and shell getters, shell disposal; `c/config/configBaseCore.ts` fields for the scheduler factories, task manager/reminder/trigger, shell manager, approval bus and recording service, with corresponding setters, getters and peeker. `c/config/schedulerRegistryAccess.ts` and Config-owned lazy construction in `c/config/asyncTaskServices.ts` were removed. `c/session/sessionSchedulerRegistryImpl.ts` remains as the object-identity keyed session registry. Current `a/api/agentRuntimeAssembly.ts` constructs the scheduler owner, task/reminder/trigger and shell jobs, and `a/api/control/sessionControl.ts` owns recording. The retained `c/config/asyncTaskServices.ts` reads task and shell settings to normalize initial limits; `a/api/agentRuntimeAssembly.ts:242,251` consumes those values and subscribes to setting changes. Config still reads the policy engine, tool registry, settings and workspace/recording paths because those are inputs to session assembly, not storage for a live execution service. `c/config/configBaseCore.ts` retains task-tool registration as described above.

The supplemental access scan does **not** assign numeric original-caller totals to removed protected field reads, object-literal constructor arguments, imported helper calls, or construction sites. The guard's baseline stderr explicitly reports `AsyncTaskManager`, `AsyncTaskReminderService`, `AsyncTaskAutoTrigger`, and `ShellJobManager` constructions in `c/config/asyncTaskServices.ts:94,134,159,208`, plus the removed ownership declarations. Those are not quietly included in the 150 caller expressions. An actionable completion step is to extend the TypeScript census to enumerate declarations, references to protected/private fields, typed constructor options and helper-function references with symbol identity, including all fixture and entry-point programs, then reconcile those categories independently against the current tree.

## Guard and negative controls

Current production guard: `bun scripts/check-session-config-boundary.ts` exited 0, raw stdout `Session Config boundary: pass`, no findings on stderr. Baseline guard: same command with `--root tmp/issue2615-census-baseline` exited 1. Complete raw stderr:

```text
packages/agents/src/api/agentImpl.ts:538: getAsyncTaskManager (consumer)
packages/agents/src/api/agentImpl.ts:539: getShellJobManager (consumer)
packages/agents/src/api/agentRuntimeAssembly.ts:43: getToolSchedulerFactory (consumer)
packages/agents/src/api/agentRuntimeAssembly.ts:44: setToolSchedulerFactory (consumer)
packages/agents/src/api/control/sessionControl.ts:316: setSessionRecordingService (consumer)
packages/agents/src/api/control/sessionControl.ts:332: setSessionRecordingService (consumer)
packages/agents/src/api/control/sessionControl.ts:408: setSessionRecordingService (consumer)
packages/agents/src/api/control/sessionControl.ts:969: setSessionRecordingService (consumer)
packages/agents/src/api/control/sessionControl.ts:1061: setSessionRecordingService (consumer)
packages/agents/src/api/fromConfig.ts:92: getRuntimeMessageBus (consumer)
packages/agents/src/core/ChatSessionFactory.ts:347: getSessionRecordingService (consumer)
packages/agents/src/core/chatSessionMediaLifecycle.ts:20: getSessionRecordingService (consumer)
packages/agents/src/core/nonInteractiveToolExecutor.ts:66: getOrCreateScheduler (consumer)
packages/agents/src/core/nonInteractiveToolExecutor.ts:185: disposeScheduler (consumer)
packages/agents/src/core/subagentExecution.ts:684: getOrCreateScheduler (consumer)
packages/agents/src/core/subagentExecution.ts:722: disposeScheduler (consumer)
packages/agents/src/core/subagentRuntimeSetup.ts:278: getOrCreateScheduler (consumer)
packages/agents/src/core/subagentRuntimeSetup.ts:289: disposeScheduler (consumer)
packages/agents/src/core/subagentRuntimeSetup.ts:720: getOrCreateScheduler (consumer)
packages/agents/src/core/subagentRuntimeSetup.ts:732: disposeScheduler (consumer)
packages/cli/src/config/postConfigRuntime.ts:276: setRuntimeMessageBus (consumer)
packages/cli/src/runtime/interactiveToolScheduler.ts:375: getOrCreateScheduler (consumer)
packages/cli/src/runtime/interactiveToolScheduler.ts:388: disposeScheduler (consumer)
packages/cli/src/utils/shellJobShutdownNotice.ts:90: peekShellJobManager (consumer)
packages/core/src/config/asyncTaskServices.ts:94: ShellJobManager (construction)
packages/core/src/config/asyncTaskServices.ts:134: AsyncTaskManager (construction)
packages/core/src/config/asyncTaskServices.ts:159: AsyncTaskReminderService (construction)
packages/core/src/config/asyncTaskServices.ts:208: AsyncTaskAutoTrigger (construction)
packages/core/src/config/config.ts:216: setRuntimeMessageBus (consumer)
packages/core/src/config/config.ts:427: getRuntimeMessageBus (consumer)
packages/core/src/config/config.ts:732: getAsyncTaskManager (ownership)
packages/core/src/config/config.ts:735: asyncTaskManager (consumer)
packages/core/src/config/config.ts:736: asyncTaskManager (consumer)
packages/core/src/config/config.ts:740: getShellJobManager (ownership)
packages/core/src/config/config.ts:743: shellJobManager (consumer)
packages/core/src/config/config.ts:744: shellJobManager (consumer)
packages/core/src/config/config.ts:752: getAsyncTaskReminderService (ownership)
packages/core/src/config/config.ts:755: asyncTaskManager (consumer)
packages/core/src/config/config.ts:756: asyncTaskManager (consumer)
packages/core/src/config/config.ts:757: asyncTaskReminderService (consumer)
packages/core/src/config/config.ts:758: asyncTaskReminderService (consumer)
packages/core/src/config/config.ts:776: asyncTaskManager (consumer)
packages/core/src/config/config.ts:777: asyncTaskManager (consumer)
packages/core/src/config/config.ts:778: asyncTaskReminderService (consumer)
packages/core/src/config/config.ts:779: asyncTaskReminderService (consumer)
packages/core/src/config/config.ts:780: asyncTaskAutoTrigger (consumer)
packages/core/src/config/config.ts:781: asyncTaskAutoTrigger (consumer)
packages/core/src/config/config.ts:782: getShellJobManager (consumer)
packages/core/src/config/config.ts:842: getOrCreateScheduler (ownership)
packages/core/src/config/config.ts:1001: shellJobManager (consumer)
packages/core/src/config/config.ts:1002: shellJobManager (consumer)
packages/core/src/config/configBase.ts:41: getAsyncTaskManager (ownership)
packages/core/src/config/configBase.ts:42: getShellJobManager (ownership)
packages/core/src/config/configBase.ts:183: getRuntimeMessageBus (consumer)
packages/core/src/config/configBase.ts:222: disposeScheduler (ownership)
packages/core/src/config/configBase.ts:229: schedulerRegistry (consumer)
packages/core/src/config/configBase.ts:241: schedulerRegistry (ownership)
packages/core/src/config/configBase.ts:369: getAsyncTaskManager (consumer)
packages/core/src/config/configBase.ts:377: getShellJobManager (consumer)
packages/core/src/config/configBaseCore.ts:151: sessionRecordingService (ownership)
packages/core/src/config/configBaseCore.ts:157: asyncTaskManager (ownership)
packages/core/src/config/configBaseCore.ts:159: shellJobManager (ownership)
packages/core/src/config/configBaseCore.ts:161: asyncTaskReminderService (ownership)
packages/core/src/config/configBaseCore.ts:162: asyncTaskAutoTrigger (ownership)
packages/core/src/config/configBaseCore.ts:195: subagentSchedulerFactory (ownership)
packages/core/src/config/configBaseCore.ts:279: getToolSchedulerFactory (ownership)
packages/core/src/config/configBaseCore.ts:280: toolSchedulerFactory (consumer)
packages/core/src/config/configBaseCore.ts:286: setToolSchedulerFactory (ownership)
packages/core/src/config/configBaseCore.ts:287: toolSchedulerFactory (consumer)
packages/core/src/config/configBaseCore.ts:343: toolSchedulerFactory (ownership)
packages/core/src/config/configBaseCore.ts:360: runtimeMessageBus (ownership)
packages/core/src/config/configBaseCore.ts:371: setRuntimeMessageBus (ownership)
packages/core/src/config/configBaseCore.ts:372: runtimeMessageBus (consumer)
packages/core/src/config/configBaseCore.ts:374: getRuntimeMessageBus (ownership)
packages/core/src/config/configBaseCore.ts:375: runtimeMessageBus (consumer)
packages/core/src/config/configBaseCore.ts:469: setSessionRecordingService (ownership)
packages/core/src/config/configBaseCore.ts:472: sessionRecordingService (consumer)
packages/core/src/config/configBaseCore.ts:479: getSessionRecordingService (ownership)
packages/core/src/config/configBaseCore.ts:480: sessionRecordingService (consumer)
packages/core/src/config/configBaseCore.ts:486: peekShellJobManager (ownership)
packages/core/src/config/configBaseCore.ts:487: shellJobManager (consumer)
packages/core/src/config/configBaseCore.ts:489: setInteractiveSubagentSchedulerFactory (ownership)
packages/core/src/config/configBaseCore.ts:492: subagentSchedulerFactory (consumer)
packages/core/src/config/configBaseCore.ts:494: getInteractiveSubagentSchedulerFactory (ownership)
packages/core/src/config/configBaseCore.ts:497: subagentSchedulerFactory (consumer)
packages/core/src/config/schedulerRegistryAccess.ts:80: getToolSchedulerFactory (consumer)
packages/core/src/config/skill-tool-sync.ts:31: getRuntimeMessageBus (consumer)
packages/core/src/hooks/hookEventHandler.ts:205: getSessionRecordingService (consumer)
packages/core/src/skills/skillDiscovery.ts:45: getRuntimeMessageBus (consumer)
packages/core/src/skills/skillDiscovery.ts:47: setRuntimeMessageBus (consumer)
packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts:241: getShellJobManager (consumer)
packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts:252: getShellJobManager (consumer)
packages/zed-acp/src/zedIntegration.ts:464: getSessionRecordingService (consumer)
packages/zed-acp/src/zedIntegration.ts:668: getSessionRecordingService (consumer)
```

The fixture access rows are enumerated in the site ledger. The guard's test suite uses isolated fixture roots and `spawnSync` to check an added forbidden `getAsyncTaskManager` getter exits 1 with `packages/core/src/config/config.ts:` and `getAsyncTaskManager (ownership)`. Other negative tests check aliased `Config`, `deps.config`, literal indexed access, destructuring, `Config['getAsyncTaskManager']`, production TSX excluded from a package tsconfig, `new AsyncTaskManager` inside core config, constructor injection and constructor target injection. Its positive control accepts declarative `getModel`, an unrelated same-named class, session-owned construction and test fixtures. Raw runner result:

```text
(pass) is registered in normal lint, including the scoped runner path
(pass) exits nonzero with file, line, member and role on a forbidden getter
(pass) rejects a live getter declared on Config and aliased, indexed and deps.config calls
(pass) rejects service construction inside core config and injected service parameters
(pass) scans production TSX even when a package tsconfig excludes it
(pass) rejects service factories in Config constructor target contracts
(pass) accepts declarative config values, unrelated names, session-owned services and test fixtures
7 pass
0 fail
12 expect() calls
```

A separate production spelling scan with `rg -n '(getOrCreateScheduler|disposeScheduler|getAsyncTaskManager|getAsyncTaskReminderService|setupAsyncTaskAutoTrigger|getShellJobManager|peekShellJobManager|getRuntimeMessageBus|setRuntimeMessageBus|getSessionRecordingService|setSessionRecordingService|getToolSchedulerFactory|setToolSchedulerFactory|getInteractiveSubagentSchedulerFactory|setInteractiveSubagentSchedulerFactory|schedulerSingleton)' packages --glob '*.{ts,tsx}' --glob '!*.test.ts' --glob '!*.test.tsx' --glob '!*.spec.ts' --glob '!*.spec.tsx' --glob '!**/__tests__/**' --glob '!**/test-bun/**' --glob '!**/fixtures/**'` exited 0 with **45** matching lines, not zero. Raw matches are at `tmp/issue2615-census-baseline/current-text.txt`. They include `cli/runtime/interactiveToolScheduler.ts:258` (explicit adapter `getOrCreateScheduler`), `a/api/agentImpl.ts:604` (session shell callback), `p/auth/oauth-manager.ts:93` (provider-auth setter), and comments. This is why a raw spelling count must not be presented as a Config-boundary result. The current checker gives zero findings for its defined production scope; it does not establish a repository-wide absence of the names.

## Test-file assertions and run evidence

The S1/S8/S9/S12 tests below passed in the successful full `npm run test:bun` rerun (`test-bun11.exit=0`): 17/17 workspaces passed, 0 failed, 0 skipped, and scripts passed. The log is `tmp/verify2615-session-runtime/test-bun11.log` (gitignored). The assertions describe test expectations, not independently measured resource counts.

- S1, `a/api/__tests__/session-interleaved-turn-isolation.behavior.test.ts`: two same-label agents have distinct providers/buses and opposing `write_file` policies; one successful and one denied tool call are each asserted with length `1`. The test asserts turn-count pairs `[0,0]`, `[2,0]`, `[2,2]`, `[4,2]`, `[4,4]`, two provider calls per agent, and B remains at `4` after A's disposal.
- S8, `a/api/__tests__/session-concurrent-approval-execution.behavior.test.ts`: two schedulers with the same session label and invocation name each append **one** initial marker; duplicate and cross-bus approvals append none. Cancellation appends zero `must-not-run` markers; the approved retry appends one more marker only to A. `a/api/__tests__/session-scheduler-owner.test.ts` asserts A executes its tool once and B zero times before B's turn, then B executes once after A's owner is disposed.
- S9, `a/api/__tests__/session-lifecycle.behavior.test.ts`: ordered shutdown asserts **six** stage markers; concurrent/repeated disposal shares one promise; a fault injection preserves **five** original failures after attempting **nine** logged actions. Its `AgentImpl` case expects **four** cleanup failures in task, recording, scheduler and resource order. `a/api/__tests__/session-scheduler-owner.test.ts` also asserts a single scheduler disposal after concurrent calls and once for pending creation.
- S12, `a/api/__tests__/session-resource-retention.behavior.test.ts`: the first test runs **three** same-label create/run/dispose cycles with a surviving agent and expects **four** disposed-stage samples. The longer test loops **four** workload iterations and expects **four** created-stage samples; only the first **two** iterations submit model turns. At `working`, ceilings are scheduler handles `2`, bus listeners `12`, history listeners `2`, running tasks `1`, tracked executions `1`, running shell jobs `1`, retained shell jobs `4`, shell poll timers `1`, recording services `1`. At `disposed`, every one of those nine metrics has ceiling `0`. These are assertions read from the test file, **not measured observed runtime counts**; passing tests do not establish an exhaustive resource census.

## Limits and next check

The current guard visits production files under `packages/*/src`, intentionally excludes test/fixture directories and test suffixes, and recognizes specific Config class declarations, named service symbols and forbidden spellings. It catches literal indexed access, certain destructuring and aliased Config receivers, but it does not prove closure for a dynamically computed property name, a callback stored and invoked elsewhere, every structural interface whose declaration is outside the Config hierarchy, an invocation through a public generic registry, or tests outside the package program inputs. The supplemental scan broadens the fixture and structural **named access** inventory but does not resolve value flow from a callback or certify every `*.tsx` file excluded by a package tsconfig. The historical role JSON cannot repair those gaps. The 150-row reconciliation is evidence for the named accesses listed here only. Next, extend the guard with tests for the remaining structural/callback and dynamic categories where representable, run a separate checker reference pass for removed field and helper symbols plus fixture files and `packages/*/test-bun`, and store its complete machine-readable outputs as a tracked artifact before asserting exhaustive slice E closure. No whole-issue Config closure is claimed.

Verification on the dirty working tree: the earlier `test-bun10` run passed 17 workspaces but failed four scripts workspace tests. After those failures were addressed, the full `npm run test:bun` rerun passed (`test-bun11.exit=0`): 17/17 workspaces passed, 0 failed, 0 skipped, and scripts passed. Its log, `tmp/verify2615-session-runtime/test-bun11.log`, is gitignored. Final root lint, Prettier `--check`, typecheck, build, and session boundary guard all exited 0. The `zai-glm-flash` CLI smoke reached the provider but returned external HTTP 429 for insufficient balance; it is not a smoke pass. Passing tests and the guard do not establish exhaustive Config closure beyond the named accesses and production scope described above.
