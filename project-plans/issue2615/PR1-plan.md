# PR 1: Slice E interface contracts (issue #2615)

Status: in progress
Branch: `issue2615`
Base: main @ 8db0031ed

## Scope of this PR

Interface-only contract for slice E (session execution ownership group), as
permitted by the issue's landing discipline: "Interface-only contract PRs may
land ahead of consumers; they add types without behavior change and remove
nothing users depend on."

Adds:

1. `SessionExecutionServices` port interface, 5 members: `scheduler`,
   `tasks`, `shellJobs`, `approvals`, `recording`.
2. The member types those 5 expose (`SchedulerHandle`, task/shell/approval/
   recording port views), each minimal: only what existing consumers of the
   corresponding Config services use today. Member selection is driven by the
   census artifacts under `project-plans/issue2615/analysis/` plus direct
   reading of the consumer call sites, not by invention.
3. `SessionSchedulerRegistry` semantics contract (get-or-create with
   in-flight dedup, release/refcount, disposeAll joins in-flight; keys are
   owner objects, never strings) as an interface, capturing the semantics
   that `schedulerSingleton.ts` implements today.
4. `CancellationTree` contract if no equivalent type already exists
   (research first; reuse, do not duplicate).

Does NOT add in this PR:

- `SessionRuntime` class implementation (later wave PR).
- Any behavior, any construction change, any consumer migration.
- Any deletion. `schedulerSingleton.ts` and the Config fields stay untouched
  in this PR; their deletion is the same-PR-with-replacement rule of later
  PRs.

## Placement rule (binding, from the issue body)

Each port interface lives at or below every package that consumes it. Where
core itself consumes the service, the port sits beside the implementation and
imports flow inward; where only higher layers consume it, the port lives with
its consumers. TypeScript structural typing means implementations never import
the ports that name them. No central interfaces package. If a port accumulates
members none of its consumers use, split it.

Research step: enumerate the actual consumers of the E-group Config services
(scheduler get/dispose, asyncTaskManager, shellJobManager, asyncTaskReminder,
sessionRecordingService, toolSchedulerFactory, and nonInteractiveTool's
scheduler access) and map their packages. The port file(s) go in the lowest
package that must consume them. Expected consumer set from the plan's figure
3: AgenticLoop + nonInteractiveToolExecutor (verify package), task tool /
TasksControl, subagent runtime setup. If any consumer is in core, the ports
live in core; verify rather than assume.

## Size discipline

`SessionExecutionServices` has exactly 5 members. Each member type is small
(single digits). The 104-member `ProviderRuntimeConfig` is the cautionary
example; a header interface that exists to name implementations is a defect.
Every member must trace to at least one existing consumer call site; cite the
call site in the plan update when the member is added.

## Tests

Interface-only PR: the artifact is types. Compile-time contract tests are
acceptable (a Bun test importing the types and asserting assignability of
representative shapes, so deletion or drift breaks the build). Follow
dev-docs/RULES.md and the typescript-test-writing skill for form. No mocks,
no behavior theater. All new files TS; year 2026 copyright headers if headers
are used (match neighboring file conventions; many files here carry none).

## Verification (binding)

Full cycle on the branch before push:

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"
```

Note: long runners can be SIGTERM'd by an external ~2-minute watchdog when
run in the foreground; use nohup-plus-poll for the long steps if a foreground
run dies.

## References

- Issue #2615 body (authoritative; includes placement rule and coupling
  invariants added 2026-09-16).
- Plan document (untracked reference): `research/architecture/issue2615-ef-plan-2026-09-16/`
  (tex sources under `tex/`, figure 3 = slice E class structures, section 4
  = slice E design, section 8 = wave sequencing).
- Census: `project-plans/issue2615/analysis/`.
- #2320 (approval bus routing invariant), #3222 (G consumes E-ready gate).

## Findings (2026-09-16, PR 1 implementation)

### Placement decision: packages/core/src/session/

Core-side consumers exist, so the ports live in core beside the
implementations they name: nonInteractiveToolExecutor's scheduler access and
the task/shell/approval/recording service implementations are all in
packages/core. Higher consumers (AgenticLoop, task tool, TasksControl,
subagent setup in packages/agents) import core legally today. Imports flow
inward; implementations never import the ports.

### Member census (port member -> real consumer call sites, grep-audited)

TaskPort (all members kept; each has 2+ non-test call sites outside
core/src/config):
- canLaunchAsync: 3, tryReserveAsyncSlot: 2, cancelReservation: 2,
  registerTask: 2, completeTask: 2, failTask: 5, cancelTask: 8,
  getTaskByPrefix: 4, getAllTasks: 6, getRunningTasks: 4
  (getTask/get covered by the same consumers' read paths).

ShellJobPort: launch: 5, tailOutput: 5, getRunningJobs: 7, getByPrefix: 3;
cancel/get/list are the read/lifecycle surface of the already-extracted
ShellJobManager consumers (task tool, TasksControl).

SchedulerHandle: Pick of the existing core ToolSchedulerContract
(schedule, cancelAll, setCallbacks, dispose) - the four operations
AgenticLoop.ts ~590/635 and nonInteractiveTool use.

ApprovalBusPort: publish/subscribe/requestConfirmation/respondToConfirmation
carry the #2320 routing shape (correlationId + agent identity; no global or
label-keyed lookup member).

RecordingPort: isActive/getFilePath/flush/dispose/recordContent family used
by recording consumers at session shutdown and resume.

SessionSchedulerRegistry: getOrCreate/release/disposeAll capture
schedulerSingleton.ts semantics with owner-object keys replacing the
session-id string keys.

### Deviations from plan

TaskPort has 11 members, over the plan's single-digit guidance. Every member
traces to consumers, which is the binding rule from the issue (split only
when members have no consumers). Recorded rather than trimmed. RecordingPort
has 12 members (isActive, getFilePath, getSessionId, getChatsDir,
getProjectHash, getPendingByteCount, flush, dispose, recordContent,
recordSemanticMediaPurge, recordSessionMetadata, getSessionMetadataTitle),
also over the single-digit guidance; every member traces to consumers, so
the same rule keeps them.


## Research findings (PR 1 implementation, 2026-09-16)

### Placement decision

Ports live in `packages/core/src/session/` because core itself consumes the
E-group services, which triggers the "port sits beside the implementation"
half of the placement rule. Core consumers found:

- `core/src/tools-adapters/CoreShellToolHostAdapter.ts:241,247,252,258`
  (getShellJobManager, launch, tailOutput)
- `core/src/tools-adapters/CoreSubagentServiceAdapter.ts:587-592,637,745-768`
  (getAsyncTaskManager, reserve/register/cancel/complete/fail)
- `core/src/tools-adapters/coreSubagentServiceHelpers.ts:361,362,382,421`
- `core/src/services/asyncWorkFacade.ts` (task and job query/cancel facade)
- `core/src/tools-adapters/CoreMessageBusAdapter.ts:86,117,134,147`
  (requestConfirmation, publish, subscribe on the session bus)
- `core/src/hooks/hookEventHandler.ts:205` (recording getFilePath)
- `core/src/config/toolRegistryFactory.ts:542,587-588` (accessor wiring into
  the two adapters above)
- `core/src/config/configBase.ts:295-303` (settings application to task and
  job managers)
- `core/src/storage/media-lifecycle-metrics.ts:194` (recording
  getPendingByteCount)

Higher-layer consumers (agents, cli, zed-acp) also exist; the lowest consumer
package is core, so core wins. The reference design's illustrative path
under packages/agents is superseded by this evidence, exactly as the plan
directed ("verify rather than assume").

### Files added

- `packages/core/src/session/sessionExecutionServices.ts`:
  SessionExecutionServices (5 members) + SchedulerHandle, TaskPort,
  ShellJobPort, ApprovalBusPort, RecordingPort
- `packages/core/src/session/sessionSchedulerRegistry.ts`:
  SessionSchedulerRegistry + SchedulerPurpose (semantics contract of
  schedulerSingleton; keys are owner objects, never strings)
- `packages/core/src/session/cancellationTree.ts`: CancellationTree (no
  equivalent AbortSignal-linked type existed; search found only ad-hoc
  AbortSignal.any call sites)
- `packages/core/src/session/sessionExecutionServices.contract.test.ts`:
  compile-time assignability assertions plus module-load smoke
- Barrel exports added to `packages/core/src/index.ts` (core's convention
  for contracts; see line 89 neighborhood)

### Member census (member -> existing consumer call sites)

scheduler (SchedulerHandle = Pick<ToolSchedulerContract, schedule |
cancelAll | setCallbacks | dispose>):

- schedule: agents/src/core/agenticLoop/AgenticLoop.ts (scheduleTask path),
  agents/src/core/nonInteractiveToolExecutor.ts:149,
  agents/src/core/subagent.ts:775, agents/src/core/subagentExecution.ts:743,
  cli/src/ui/hooks/useReactToolScheduler.ts:281
- cancelAll: agents/src/core/agenticLoop/AgenticLoop.ts:568,584;
  agents/src/core/nonInteractiveToolExecutor.ts:178
- setCallbacks: core/src/config/schedulerSingleton.ts:215,245 (reuse refresh)
- dispose: core/src/config/schedulerSingleton.ts:372,402 (refcount zero)
- handleConfirmationResponse excluded: only internal coordinator and test
  call sites, no external production consumer

tasks (TaskPort, 11 members):

- canLaunchAsync: core coreSubagentServiceHelpers.ts:382;
  agents taskAsyncExecution.ts:131
- tryReserveAsyncSlot: CoreSubagentServiceAdapter.ts:592;
  agents taskAsyncExecution.ts:186
- cancelReservation: coreSubagentServiceHelpers.ts:421;
  agents taskAsyncExecution.ts:208
- registerTask: CoreSubagentServiceAdapter.ts:637;
  agents taskAsyncExecution.ts:293
- completeTask: CoreSubagentServiceAdapter.ts:748;
  agents taskAsyncExecution.ts:431
- failTask: CoreSubagentServiceAdapter.ts:768; coreSubagentServiceHelpers.ts:362;
  agents taskAsyncExecution.ts:437,451; agents taskAbortHelpers.ts:270
- cancelTask: CoreSubagentServiceAdapter.ts:745,765;
  core asyncWorkFacade.ts:212; agents taskAbortHelpers.ts:278;
  cli tasksCommand.ts:216; agents TasksControl cancel path
- getTask: coreSubagentServiceHelpers.ts:361; asyncWorkFacade.ts:122,210;
  cli tasksCommand.ts:190; agents taskAbortHelpers.ts:267
- getTaskByPrefix: asyncWorkFacade.ts:147; cli tasksCommand.ts:192
- getAllTasks: asyncWorkFacade.ts:102; cli tasksCommand.ts:102,248
- getRunningTasks: cli tasksCommand.ts (running filter); agents
  api/control/tasksControl.ts listRunning
- Excluded as E-group internal only: setMax/getMaxAsyncTasks (configBase
  settings), getPendingNotifications, markNotified, onTask* events
  (reminder service and auto trigger)

shellJobs (ShellJobPort, 7 members):

- launch: CoreShellToolHostAdapter.ts:247
- cancel: asyncWorkFacade.ts:205; agents tasksControl.ts:143,161
- get: asyncWorkFacade.ts:129,203; tasksControl.ts:122,141
- getByPrefix: asyncWorkFacade.ts:160
- list: asyncWorkFacade.ts:108; tasksControl.ts:86
- getRunningJobs: tasksControl.ts:104,160; cli
  utils/shellJobShutdownNotice.ts:90
- tailOutput: CoreShellToolHostAdapter.ts:258; asyncWorkFacade.ts:187
- Excluded: markNotified, getPendingNotifications, onJob* events
  (reminder/notification internals), setMax/getMaxBackgroundJobs
  (configBase), dispose (session-owned disposal order), getLiveSurvivorCount

approvals (ApprovalBusPort, 4 members, #2320 shape preserved):

- publish: core CoreMessageBusAdapter.ts:117; core policy/policy-helpers.ts:90,112
- subscribe: agents AgenticLoop.ts:267; core hookEventHandler.ts:187;
  CoreMessageBusAdapter.ts:134,147; core policy/config.ts:349
- requestConfirmation: core CoreMessageBusAdapter.ts:86
- respondToConfirmation: agents AgenticLoop.ts:279,298; agents
  api/control toolControl.ts:230
- Routing constraint recorded in the port JSDoc: requests carry
  toolCall.id plus agent identity, responses route by correlationId,
  no implicit bus fallback

recording (RecordingPort, 12 members):

- isActive: agents ChatSessionFactory.ts:350; agents
  chatSessionMediaLifecycle.ts:21,28; zed-acp zedIntegration.ts:669
- getFilePath: core hookEventHandler.ts:205; agents
  ChatSessionFactory.ts:353; cli performResume.ts:381
- getSessionId: cli cliSessionBootstrap.ts:275; cli performResume.ts:140;
  agents sessionControl.ts:303,454
- getChatsDir: cli chatCommand.ts:55
- getProjectHash: cli chatCommand.ts:41
- getPendingByteCount: core storage/media-lifecycle-metrics.ts:194
- flush: agents chatSessionMediaLifecycle.ts:27; cli performResume.ts:142;
  cli continuePackageActions.ts:108
- dispose: agents sessionControlRollback.ts:34; cli
  cliSessionBootstrap.ts:186,251; cli performResume.ts:382,422
- recordContent: agents sessionControl.ts:938,981
- recordSemanticMediaPurge: agents chatSessionMediaLifecycle.ts:26
- recordSessionMetadata: zed-acp zedIntegration.ts:670
- getSessionMetadataTitle: zed-acp zedIntegration.ts:466
- Excluded (co-located recording-package consumers only): enqueue,
  prepareContentBatch, recordCompressed, recordRewind,
  recordProviderSwitch, recordSessionEvent, recordDirectoriesChanged,
  recordSessionFork, createCheckpoint, deleteCheckpoint,
  renameCheckpoint, setSessionName, initializeForResume, adoptLock,
  ownsLockFor, getPendingRecordCount

SessionSchedulerRegistry semantics (from schedulerSingleton.ts, kept as
contract, string keys dropped): get-or-create with in-flight promise dedup
(schedulerInitStates), refcount via entry.refCount, release at zero disposes,
disposeAll joins in-flight. Purposes observed in today's keys: plain session
id (interactive main), `${sessionId}#agentic-loop#${uuid}` (per-loop),
subagent sessions (interactiveMode false). These become SchedulerPurpose
values 'session' | 'agentic-loop' | 'subagent' keyed by owner object.

No existing CancellationTree equivalent: search over packages found only
ad-hoc AbortSignal.any call sites (a2a-server task.ts:324, agents
controllerCommit.ts:649, cli setupGithubCommand.ts:129, core
hookSystem.ts:136); no shared contract type. New minimal contract added.

## Completion findings (continuation run, 2026-09-16)

### Placement decision (confirmed)

Core. Independently re-verified: core itself consumes the E-group services
outside `packages/core/src/config`, so the "port sits beside the
implementation" half of the placement rule applies and
`packages/core/src/session/` is the correct home. Core-side consumers:

- `core/src/tools-adapters/CoreShellToolHostAdapter.ts` (shell job manager
  access, launch, tailOutput)
- `core/src/tools-adapters/CoreSubagentServiceAdapter.ts` and
  `coreSubagentServiceHelpers.ts` (task manager reserve/register/settle)
- `core/src/services/asyncWorkFacade.ts` (task and job query/cancel)
- `core/src/tools-adapters/CoreMessageBusAdapter.ts` (approval bus)
- `core/src/policy/policy-helpers.ts` (bus publish)
- `core/src/hooks/hookEventHandler.ts` (bus subscribe, recording path)
- `core/src/storage/media-lifecycle-metrics.ts` (recording pending bytes)
- `core/src/recording/SessionTransitionService.ts`,
  `RecordingIntegration.ts`, `CheckpointService.ts` (recording writes and
  queries)

### Member census (re-verified this run; member -> consumer call sites)

TaskPort (11 members, all kept):

| Member | Consumer call sites |
| --- | --- |
| canLaunchAsync | coreSubagentServiceHelpers.ts:382; agents taskAsyncExecution.ts:131 |
| tryReserveAsyncSlot | CoreSubagentServiceAdapter.ts:592; agents taskAsyncExecution.ts:186 |
| cancelReservation | coreSubagentServiceHelpers.ts:421; agents taskAsyncExecution.ts:208 |
| registerTask | CoreSubagentServiceAdapter.ts:637; agents taskAsyncExecution.ts:293 |
| completeTask | CoreSubagentServiceAdapter.ts:748; agents taskAsyncExecution.ts:431 |
| failTask | CoreSubagentServiceAdapter.ts:768; coreSubagentServiceHelpers.ts:362; agents taskAsyncExecution.ts:437,451; taskAbortHelpers.ts:270 |
| cancelTask | CoreSubagentServiceAdapter.ts:745,765; asyncWorkFacade.ts:212; agents tasksControl.ts:136,155; taskAbortHelpers.ts:278; cli tasksCommand.ts:216; cli useAgentStreamOrchestration.ts:134 |
| getTask | coreSubagentServiceHelpers.ts:361; asyncWorkFacade.ts:122,210; agents tasksControl.ts:115,134; taskAbortHelpers.ts:267; cli tasksCommand.ts:190 |
| getTaskByPrefix | asyncWorkFacade.ts:147; cli tasksCommand.ts:192 |
| getAllTasks | asyncWorkFacade.ts:102; agents tasksControl.ts:80; cli tasksCommand.ts:102,248 |
| getRunningTasks | agents tasksControl.ts:98,154; cli useAgentStreamOrchestration.ts:134 |

ShellJobPort (7 members, all kept):

| Member | Consumer call sites |
| --- | --- |
| launch | CoreShellToolHostAdapter.ts:247 |
| cancel | asyncWorkFacade.ts:205; agents tasksControl.ts:143,161 |
| get | asyncWorkFacade.ts:129,203; agents tasksControl.ts:141 |
| getByPrefix | asyncWorkFacade.ts:160 |
| list | asyncWorkFacade.ts:108; agents tasksControl.ts:86 |
| getRunningJobs | agents tasksControl.ts:104,160; cli shellJobShutdownNotice.ts:90 |
| tailOutput | CoreShellToolHostAdapter.ts:258; asyncWorkFacade.ts:187 |

Spot-checks on the remaining ports:

- SchedulerHandle: schedule at agents nonInteractiveToolExecutor.ts:149,
  subagent.ts:775, subagentExecution.ts:743, AgenticLoop.ts:547, cli
  useReactToolScheduler.ts:281; cancelAll at AgenticLoop.ts:568,584 and
  nonInteractiveToolExecutor.ts:178; setCallbacks and dispose are consumed
  by schedulerSingleton.ts:215,245 and 372,402 (the registry-side consumer
  the SessionSchedulerRegistry contract replaces in a later PR).
- ApprovalBusPort: publish at CoreMessageBusAdapter.ts:117,
  policy-helpers.ts:90,112, hookEventHandler.ts:906; subscribe at
  CoreMessageBusAdapter.ts:134,147 and hookEventHandler.ts:187;
  requestConfirmation at CoreMessageBusAdapter.ts:86 (also tools package
  tools.ts:359, shell.ts:906); respondToConfirmation at
  AgenticLoop.ts:279,298 and agents toolControl.ts:230.
- RecordingPort: isActive at agents chatSessionMediaLifecycle.ts:21,28,
  ChatSessionFactory.ts:350, zed-acp zedIntegration.ts:669; getFilePath at
  ChatSessionFactory.ts:353 and core hookEventHandler.ts:206; getSessionId
  at cli chatCommand.ts:302,343,710, agents sessionControl.ts:303,454,
  core CheckpointService.ts:239; flush at chatSessionMediaLifecycle.ts:27;
  dispose at cli services/performResume.ts:382,422 and agents
  sessionControlRollback.ts:34; recordContent at sessionControl.ts:938,981
  and core SessionTransitionService.ts:187; the metadata and purge members
  as listed above.
- SessionSchedulerRegistry: semantics re-verified against
  schedulerSingleton.ts (in-flight dedup at 341-346, refcount at
  63/206/231, dispose-at-zero at 362-381). Purpose values trace to real
  keys: plain session id (cli interactiveToolScheduler.ts:252),
  `${sessionId}#agentic-loop#${uuid}` (AgenticLoop.ts:190), subagent
  sessions (agents subagentRuntimeSetup.ts:277,707).

### Members dropped

None. Every member of TaskPort and ShellJobPort traces to at least one
production consumer outside `packages/core/src/config`, so no member was
removed in this run. The exclusions recorded in the research findings
above (reminder/notification internals, max setters, recording-package
internals, handleConfirmationResponse) stand.

### Continuation fixes

- `packages/core/src/index.ts`: removed the duplicated
  `export * from './core/clientContract.js'` and
  `export * from './core/toolSchedulerContract.js'` lines left by the
  previous run; each of the three session contract modules is exported
  exactly once.
- Contract test verified: bun:test imports resolve, `.js` suffixes on
  relative imports, typechecks under the core noemit project, and contains
  no mocks and no method-was-called assertions (compile-time assignability
  aliases plus module-load smoke only).
