# Lane C: remove command, React, ACP and A2A service shapes

## Measurement and scope

The remaining Lane C surfaces contain 1,308 prohibited shapes. They must be removed through consumer cutovers, without changing the boundary rule.

Measured in the assigned worktree on 2026-10-13, initial HEAD 294b07768, branch issue2616-final-c. Command: `npm run check:runtime-boundary -- --output tmp/verify2616-c/boundary-inventory-complete.json`. All scanners completed, compiler diagnostics were zero and the ratcheted command exited 0. Strict findings remain; a passing ratchet is not completion. An earlier scan during declaration regeneration and another before plugin-local SDK installation were blocked and are not measurement evidence.

| Package | Bundle | Bag parameter | Total |
| --- | ---: | ---: | ---: |
| cli | 722 | 534 | 1,256 |
| zed-acp | 30 | 7 | 37 |
| a2a-server | 12 | 3 | 15 |
| Total | 764 | 544 | 1,308 |

Every finding is assigned exactly once in the owner-type inventory below. Counts include inferred variables, expressions, callbacks, returns and React dependency arrays, not just declarations. The raw audit retains exact positions. `tmp/verify2616-c/owner-findings.json` additionally records syntax, enclosing declaration and checker type; `owner-groups.json` records group/file totals. The type at a reported expression can differ from the witness used by the guard, which also inspects contextual types and resolved return signatures. Container and inferred-expression groups therefore remain obligations.

The parent checkout, Lane B and integration worktrees are outside this lane. No agents/provider implementation edits, pushes or GitHub writes are part of this work. Steps 38-41 migrate consumers; step 42 later deletes raw Agent getters only after their last consumers move. Retained old functionality may remain for unmigrated consumers, but a migrated command has no old-context route, compatibility export, adapter fallback or renamed services collection.

## Ownership decisions

A command is a registered closure with explicit operation functions captured by its application host. Its invocation carries cancellation, arguments and the UI data it actually needs. It cannot select an owner from invocation.services, an identifier map or process state. Bind instance methods through closures at the host, preserving their receiver. Domain operations return data or typed command results, never service objects. A command group may share one cohesive operation interface only when every consumer uses that domain; independent operations are separate parameters.

React hosts retain session lifetimes privately. Domain contexts carry the operations used by their subscribers and fail when their provider is absent. Stream reducers consume event data, layout components consume display data, and input completion uses catalog/history reads. None receives a graph through Agent, CliUiRuntime runtime projections or CommandContext. Referential stability is maintained by owner-bound callbacks, not a mutable module pointer.

ACP and A2A own transport/task lifetimes. Creation is a specific host boundary with declarative inputs and an acquired lifetime, not an injected collection of factories and services. Accepted requests are joined before retirement; disposing session A cannot close session B. These adapters never construct a provider/settings/policy graph.

### Replacement recipes

- **Command:** Bind each command at registration to separate operation functions. Invoke with signal, parsed arguments and rendering data only. Completion gets its own data/read operation, not the execution context.
- **Command-services:** Delete services after the last command consumer moves. Bind settings persistence, checkpoint restore, logging, definition reads/writes and Agent operations separately to their actual consumers. Never return this collection from a replacement factory.
- **Stream:** Bind stream creation, steering, cancellation and recording operations separately. Event reduction accepts event data and history setters. Checkpoint persistence gets capture/write operations; no raw client, scheduler, message bus or Agent projection.
- **Browser:** Bind session listing, inspection, resume, rename and delete operations to the browser. Props carry rows, selection state and callbacks only; recording ownership stays with the session and resume commits through a purpose-specific operation.
- **Dialog:** Each dialog receives only its domain reads and writes: model catalog/selection, provider selection, profile document operations, tools catalog or auth request. Parent dialog rendering carries discriminated view data and callbacks, not Agent or CommandContext.
- **Host:** The application entry owns Agent and its joined disposal. Keep declarative startup data separate from session admission/activation operations. Publish bound callbacks directly to consumers, not a bootstrap result with a graph. Lane B owns agents assembly; this lane migrates only host call sites.
- **Execution:** Bind shell launch/cancel and tool scheduling/approval operations to the host lifetime. Hooks receive execution events, pending requests and reply operations. Never return raw scheduler/client resources.
- **Input:** Remove Agent and CommandContext from input/layout/context props. Bind submit/steer/cancel, completion/history and UI actions separately. Owner-scoped React contexts expose one domain of operations each; leaf layout props are immutable display data and callbacks.
- **ACP:** Session transport receives stream/cancel, options read/write, approval reply and history/recording operations separately. Session loading accepts a specific declarative creator and owns only transport retirement. No creation-capable services collection.
- **ACP-build:** Use agents-owned declarative creation, retain the Agent only privately in the acquiring session host, publish domain callbacks and await disposal. Remove returned ZedSessionAgent/provider-manager graph and host provider construction. Coordinate the existing assembly contract with Lane B without editing its files.
- **A2A:** Executor receives a task-session creation function; each acquired task privately owns its session lifetime. Streaming, approval reply, history, cancellation and shutdown are separate operations. HTTP receives execute/cancel operations; task caches contain task data/owners, never a root-id service registry.

## Ordered independently verified slices

Each listed command or named prop/hook owner is one slice, including its registration/producer sites and all callers. An interface-only edit with still-broad producers does not finish a slice. Every slice builds and passes package verification before its commit. The inventory recipes identify the replacement for inferred expressions in that slice; they are not intermediary runtime types.

1. **38.1 Model command owner.** Replace modelCommand's context-based execution with a factory bound to model selection and recording. Register it through BuiltinCommandLoader in both synchronous and asynchronous paths. Verify two registries with equal session labels, model/filter effects, recording and continued B execution after A closes.
2. **38.2 Tool-format command owner.** Bind format state/read and override operations. Use a value predicate for supported format literals; preserve invalid-value output and reset semantics.
3. **38.3 Set command/schema owner.** Bind setting/model-parameter read/write/clear operations and separate schema completion reads. Verify real settings effects, parsing, busy/stale outcomes and command help.
4. **38.4 Provider command owner.** Bind provider selection, current provider/model reads, alias persistence and recording/UI publication. Remove raw Agent routing and payment-mode context casts; bind that notification explicitly.
5. **38.5 Auth command owner; then one slice each for key, keyfile, baseurl, logout and quota.** Bind credential CRUD, auth selection/cancellation, endpoint writes and quota data reads at their own registrars. No manager/client reach-through. Use explicit host credential authority, isolated stores and filesystem fixtures.
6. **38.6 Profile command/schema owner.** Bind list/read/save/load/delete/default operations. Profile loading performs publication within the owner operation; no sessionClient.publishTools call. Preserve durable documents, explicit unset, selected binding and failed-load rollback.
7. **39.1 History/session owners, one slice each for chat/chatOwner, continue, copy, compress, dumpcontext and restore.** Bind session/history/recording/media operations. Remove historyServiceAccess client acquisition after the last caller moves.
8. **39.2 Workspace/tool owners, one slice each for tools, directory, memory, image, bug, MCP and policies.** Bind tool views, workspace authorization, memory/image/reporting and MCP operations separately. Preserve denied access and exactly-once tool effects.
9. **39.3 Hook/task/definition owners, one slice each for hooks, tasks, todo/todoOperations, subagent and extensions.** Bind hook execution, task queries/actions and definition operations. Role execution is a purpose-specific owned operation, never a returned detached client.
10. **39.4 Remaining command owners, one slice per remaining command in the inventory.** Bind about, diagnostics, debug, IDE, logging, stats, perf and the UI-only commands to their actual operations/data. Command-loader/prompt-processor owners migrate after the commands they publish.
11. **39.5 Common command invocation owner.** Delete CommandContext.services and runtime fields, change SlashCommand signatures to invocation/UI data only, and migrate CommandContextInputs, SlashCommandHandlerDeps, processor results, schema completion and confirmation retry. No alternate action field or optional legacy bridge.
12. **40.1 Stream submission owners, one slice each for UseSubmitQueryDeps/BuildSubmitQueryDepsArgs, SubmitQueryCallbackDeps, UseAgentEventStreamArgs, AgentStreamOrchestrationDeps and stream lifecycle/checkpoint helpers.** Bind run/steer/cancel and session recording individually; keep admitted continuation and terminal event semantics.
13. **40.2 Noninteractive owner.** Migrate RunNonInteractiveParams and session-dispatch consumers to the same stream and command operations, with explicit terminality/cancellation/recording ownership.
14. **40.3 Input owners, one slice each for AppInputParams/AppInputResult, input-core helpers, InputPromptProps/InputPromptRuntimeProps/InputPromptState and completion hooks.** Data props and per-input operations replace wholesale context.
15. **40.4 Dialog/browser owners, one slice each for AppDialogsParams, each dialog props type, UseSessionBrowserProps and its helper families, UseProviderDialogParams, UseToolsDialogParams and UseWelcomeOnboardingOptions.** Bind only domain operations used by each owner.
16. **40.5 React execution/listener owners, one slice each for ReactToolSchedulerRuntime, ShellExecutionParams, UseCoreEventHandlersOptions and UseAutoAcceptIndicatorArgs.** Verify scheduling, approval and subscribe/unsubscribe using real execution/UI behavior.
17. **40.6 Application composition owners, one slice each for AppCommandData/AppCommandBindings, AppBootstrapProps/AppBootstrapResult, UseSessionInitializationParams, AppContainerRuntimeProps/AppRuntimeViewProps, AppProps, DefaultAppLayoutProps/LayoutStructureProps/TranscriptProps and RuntimeContext.** Remove raw facade and broad host results after leaf cutovers. Host startup projections are separate declarative data and direct operation bindings.
18. **41.1 ACP session host owner.** Remove zed-session-agent's constructed graph and ZedSessionAgent bundle using the agents-owned creation contract. Verify two real sessions, auth/profile isolation, resume and independent disposal.
19. **41.2 ACP transport owner.** Migrate zed-session-ports, zed-agent-setup, zed-session-loader, runZedIntegration and zedIntegration consumers to stream/options/approval/history operations. Delete wholesale session-port parameters in the same slice.
20. **41.3 A2A executor owner.** Replace CoderAgentExecutorDependencies with a specific creator plus independent task-operation functions. Migrate executor creation and HTTP wiring together.
21. **41.4 A2A task owner.** Migrate Task/createTaskRuntime to acquired task lifetimes and stream/approval/history operations. Verify duplicate approval, cancellation, eviction and surviving sibling tasks.

Each phase consumes every named and inferred group assigned to its recipe, including imports and dependency arrays. A broad Agent occurrence is assigned to the command, hook or host containing it; it is never exempted because the host ultimately owns Agent. An acquired host may store Agent privately, but it cannot pass that facade to ordinary consumers or return it inside a bootstrap collection.

## Behavioral and checkpoint gates

Before changing a test, record its static test/expect-site counts and executed test/assertion counts. Add behavior tests before changing production. Execute commands through the real registry, use createAgent with explicit CredentialAuthority from the owned credential fixture and FakeProvider disk input, and use the existing Ink harness for rendering. All filesystem/config/keychain authority is fixture-local. Keep Linux/macOS/Windows paths and cleanup portable. Existing assertions are not removed or weakened.

Run `bun scripts/test-audit/scan.ts tmp/verify2616-c/audit-<slice>-before` and the corresponding after directory. Compare MOCK_MIRROR, ALWAYS_TRUE, SELF_CONFIRMING and NO_ASSERT for changed tests; there may be no new findings.

For every checkpoint run build, typecheck, lint:ci and the boundary check sequentially; also run the full scripts suite when scripts are touched and full CLI/ACP/A2A package suites for their corresponding slices. Use detached nohup jobs and write logs/exit files under tmp/verify2616-c. Rerun every failed file alone and fix standalone failures. Record passing-alone load flakes separately, never as standalone passes of the full run. A complete boundary audit must have zero diagnostics and no nonratcheted findings. Lower only entries that actually drop; never raise a baseline or weaken enforcement.

Commit only source/tests, the lowered baseline and this plan as applicable. Use the configured identity and suffix (Refs #2616, #3841). Keep tmp/ untracked. Record slice commits, before/after counts, test counts, log paths and next slice in tmp/verify2616-c/STATUS.md.

## Exhaustive owner-type inventory

B denotes runtime-service-bundle and P denotes runtime-service-bag-parameter. Group names are checker names or enclosing declarations for inferred shapes. The file list includes every location-bearing file in the group. Recipe assignments specify each group's replacement; declaration and inferred witnesses move with their owning functional slice.

### cli

| Owner type or inferred declaration | B | P | Replacement | Files |
| --- | ---: | ---: | --- | --- |
| `CommandContext` | 219 | 298 | Command | `packages/cli/src/nonInteractiveCliCommands.ts` (5/0)<br>`packages/cli/src/services/BuiltinCommandLoader.ts` (0/1)<br>`packages/cli/src/services/FileCommandLoader.ts` (1/2)<br>`packages/cli/src/services/McpPromptLoader.ts` (0/2)<br>`packages/cli/src/services/prompt-processors/argumentProcessor.ts` (0/1)<br>`packages/cli/src/services/prompt-processors/shellProcessor.ts` (0/1)<br>`packages/cli/src/services/prompt-processors/types.ts` (0/1)<br>`packages/cli/src/ui/commands/aboutCommand.ts` (6/6)<br>`packages/cli/src/ui/commands/authCommand.ts` (5/6)<br>`packages/cli/src/ui/commands/baseurlCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/bugCommand.ts` (3/4)<br>`packages/cli/src/ui/commands/chatCommand.ts` (23/17)<br>`packages/cli/src/ui/commands/chatOwnerCommand.ts` (15/13)<br>`packages/cli/src/ui/commands/clearCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/compressCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/continueCommand.ts` (4/4)<br>`packages/cli/src/ui/commands/continuePackageActions.ts` (2/3)<br>`packages/cli/src/ui/commands/copyCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/debugCommands.ts` (6/12)<br>`packages/cli/src/ui/commands/diagnosticsCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/directoryCommand.tsx` (1/3)<br>`packages/cli/src/ui/commands/docsCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/dumpcontextCommand.ts` (1/2)<br>`packages/cli/src/ui/commands/extensionsCommand.ts` (9/14)<br>`packages/cli/src/ui/commands/helpCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/historyServiceAccess.ts` (0/1)<br>`packages/cli/src/ui/commands/hooksCommand.ts` (12/13)<br>`packages/cli/src/ui/commands/ideCommand.ts` (0/3)<br>`packages/cli/src/ui/commands/imageCommand.ts` (0/2)<br>`packages/cli/src/ui/commands/initCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/keyCommand.ts` (5/6)<br>`packages/cli/src/ui/commands/keyfileCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/loggingCommand.ts` (1/6)<br>`packages/cli/src/ui/commands/logoutCommand.ts` (1/2)<br>`packages/cli/src/ui/commands/mcpAuth.ts` (0/2)<br>`packages/cli/src/ui/commands/mcpCommand.ts` (5/6)<br>`packages/cli/src/ui/commands/memoryCommand.ts` (2/6)<br>`packages/cli/src/ui/commands/modelCommand.ts` (1/2)<br>`packages/cli/src/ui/commands/mouseCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/perfCommand.ts` (0/3)<br>`packages/cli/src/ui/commands/permissionsCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/policiesCommand.ts` (6/6)<br>`packages/cli/src/ui/commands/privacyCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/profileCommand.ts` (3/9)<br>`packages/cli/src/ui/commands/profileLoad.ts` (0/3)<br>`packages/cli/src/ui/commands/profileSchemas.ts` (0/4)<br>`packages/cli/src/ui/commands/providerCommand.ts` (2/3)<br>`packages/cli/src/ui/commands/quitCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/quotaCommand.ts` (24/9)<br>`packages/cli/src/ui/commands/restoreCommand.ts` (2/4)<br>`packages/cli/src/ui/commands/schema/index.ts` (5/4)<br>`packages/cli/src/ui/commands/schema/types.ts` (0/2)<br>`packages/cli/src/ui/commands/setCommand.ts` (5/6)<br>`packages/cli/src/ui/commands/setCommandSchema.ts` (4/6)<br>`packages/cli/src/ui/commands/settingsCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/setupCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/setupGithubCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/skillsCommand.ts` (0/6)<br>`packages/cli/src/ui/commands/statsCommand.ts` (2/9)<br>`packages/cli/src/ui/commands/subagentCommand.ts` (4/13)<br>`packages/cli/src/ui/commands/tasksCommand.ts` (5/8)<br>`packages/cli/src/ui/commands/themeCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/todoCommand.ts` (11/10)<br>`packages/cli/src/ui/commands/todoOperations.ts` (0/4)<br>`packages/cli/src/ui/commands/toolformatCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/toolkeyCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/toolkeyfileCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/toolsCommand.ts` (3/4)<br>`packages/cli/src/ui/commands/types.ts` (1/2)<br>`packages/cli/src/ui/commands/uiprofileCommand.ts` (0/1)<br>`packages/cli/src/ui/commands/vimCommand.ts` (0/1)<br>`packages/cli/src/ui/components/DialogManager.tsx` (3/0)<br>`packages/cli/src/ui/components/SubagentManagement/SubagentManagerDialog.tsx` (2/1)<br>`packages/cli/src/ui/components/inputPromptHooks.ts` (1/0)<br>`packages/cli/src/ui/hooks/schemaCompletionUtils.ts` (1/1)<br>`packages/cli/src/ui/hooks/slashCommandHandlers.ts` (14/6)<br>`packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` (1/0)<br>`packages/cli/src/ui/hooks/slashCompletionEffect.ts` (3/4)<br>`packages/cli/src/ui/hooks/useCommandCompletion.tsx` (1/1)<br>`packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (3/1)<br>`packages/cli/src/ui/hooks/useSlashCompletion.tsx` (4/4)<br>`packages/cli/src/ui/utils/fuzzyFilter.ts` (1/2) |
| `Agent` | 123 | 51 | Stream | `packages/cli/src/cli.tsx` (2/0)<br>`packages/cli/src/cliAgentBootstrap.ts` (2/0)<br>`packages/cli/src/cliSessionBootstrap.ts` (0/1)<br>`packages/cli/src/cliTerminalSession.ts` (2/0)<br>`packages/cli/src/nonInteractiveCli.ts` (8/2)<br>`packages/cli/src/nonInteractiveCliCommands.ts` (4/3)<br>`packages/cli/src/runtime/interactiveToolScheduler.ts` (0/2)<br>`packages/cli/src/session/interactiveUI.tsx` (5/4)<br>`packages/cli/src/session/nonInteractiveSession.ts` (1/0)<br>`packages/cli/src/ui/App.tsx` (1/0)<br>`packages/cli/src/ui/AppContainerRuntime.tsx` (1/1)<br>`packages/cli/src/ui/commands/baseurlCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/chatOwnerCommand.ts` (12/0)<br>`packages/cli/src/ui/commands/clearCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/compressCommand.ts` (2/1)<br>`packages/cli/src/ui/commands/continueCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/continuePackageActions.ts` (1/0)<br>`packages/cli/src/ui/commands/diagnosticsCommand.ts` (1/1)<br>`packages/cli/src/ui/commands/directoryCommand.tsx` (2/0)<br>`packages/cli/src/ui/commands/dumpcontextCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/historyServiceAccess.ts` (2/1)<br>`packages/cli/src/ui/commands/hooksCommand.ts` (7/1)<br>`packages/cli/src/ui/commands/logoutCommand.ts` (2/1)<br>`packages/cli/src/ui/commands/mcpAuth.ts` (1/1)<br>`packages/cli/src/ui/commands/mcpCommand.ts` (5/0)<br>`packages/cli/src/ui/commands/mcpDisplay.ts` (0/1)<br>`packages/cli/src/ui/commands/modelCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/perfCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/policiesCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/profileCommand.ts` (2/0)<br>`packages/cli/src/ui/commands/profileLoad.ts` (1/0)<br>`packages/cli/src/ui/commands/providerCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/restoreCommand.ts` (1/0)<br>`packages/cli/src/ui/commands/subagentCommand.ts` (1/1)<br>`packages/cli/src/ui/commands/tasksCommand.ts` (4/1)<br>`packages/cli/src/ui/commands/toolsCommand.ts` (3/0)<br>`packages/cli/src/ui/components/DialogManager.tsx` (6/3)<br>`packages/cli/src/ui/components/SubagentManagement/SubagentManagerDialog.tsx` (1/1)<br>`packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (3/0)<br>`packages/cli/src/ui/containers/AppContainer/hooks/useSessionInitialization.ts` (1/1)<br>`packages/cli/src/ui/hooks/agentStream/checkpointPersistence.ts` (2/2)<br>`packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts` (2/1)<br>`packages/cli/src/ui/hooks/agentStream/useAgentStream.ts` (2/2)<br>`packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (1/1)<br>`packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (2/1)<br>`packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (3/1)<br>`packages/cli/src/ui/hooks/shellCommandProcessor.ts` (2/3)<br>`packages/cli/src/ui/hooks/slashCommandHandlers.ts` (6/0)<br>`packages/cli/src/ui/hooks/slashCommandProcessor.ts` (0/1)<br>`packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` (1/3)<br>`packages/cli/src/ui/hooks/useReactToolScheduler.ts` (2/0)<br>`packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts` (3/0)<br>`packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (2/0)<br>`packages/cli/src/ui/hooks/useToolsDialog.ts` (1/1)<br>`packages/cli/src/ui/hooks/useWelcomeOnboarding.ts` (1/1)<br>`packages/cli/src/ui/utils/ownerSessionUi.ts` (0/5)<br>`packages/cli/src/ui/utils/resumeOwnerSession.ts` (1/2) |
| `SlashCommandHandlerDeps` | 28 | 23 | Command | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` (27/23)<br>`packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (1/0) |
| `SubmitQueryCallbackDeps` | 20 | 9 | Stream | `packages/cli/src/ui/hooks/agentStream/submitQueryTurnLifecycle.ts` (13/7)<br>`packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (7/2) |
| `AppInputParams` | 14 | 14 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (14/14) |
| `RunNonInteractiveParams` | 10 | 7 | Host | `packages/cli/src/nonInteractiveCli.ts` (10/7) |
| `UseSessionBrowserProps` | 8 | 8 | Browser | `packages/cli/src/ui/hooks/useSessionBrowser.ts` (2/1)<br>`packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts` (6/7) |
| `UseSubmitQueryDeps` | 9 | 7 | Stream | `packages/cli/src/ui/hooks/agentStream/submitQueryTurnLifecycle.ts` (1/2)<br>`packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/0)<br>`packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (7/5) |
| `AppDialogsParams` | 6 | 6 | Dialog | `packages/cli/src/ui/containers/AppContainer/hooks/useAppDialogs.ts` (6/6) |
| `RuntimeBootstrapMetadata` | 6 | 5 | Host | `packages/cli/src/config/profileBootstrap.ts` (6/5) |
| `AgentStreamOrchestrationDeps` | 5 | 5 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (5/5) |
| `AppContainerRuntimeProps` | 5 | 5 | Input | `packages/cli/src/ui/AppContainer.tsx` (1/1)<br>`packages/cli/src/ui/AppContainerRuntime.tsx` (4/4) |
| `DefaultAppLayoutProps` | 1 | 9 | Input | `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` (1/4)<br>`packages/cli/src/ui/layouts/DefaultAppLayoutRegions.tsx` (0/5) |
| `todoCommand (inferred Identifier)` | 10 | 0 | Command | `packages/cli/src/ui/commands/todoCommand.ts` (10/0) |
| `TodoContext` | 1 | 9 | Command | `packages/cli/src/ui/commands/todoOperations.ts` (1/9) |
| `AgentActivationOperation` | 6 | 3 | Host | `packages/cli/src/cli.tsx` (2/0)<br>`packages/cli/src/cliProviderInit.ts` (0/1)<br>`packages/cli/src/cliSessionBootstrap.ts` (4/1)<br>`packages/cli/src/config/profileBootstrap.ts` (0/1) |
| `AppCommandData` | 9 | 0 | Dialog | `packages/cli/src/ui/components/Composer.tsx` (2/0)<br>`packages/cli/src/ui/components/DialogManager.tsx` (1/0)<br>`packages/cli/src/ui/components/SubagentManagement/SubagentManagerDialog.tsx` (1/0)<br>`packages/cli/src/ui/components/views/ExtensionsList.tsx` (1/0)<br>`packages/cli/src/ui/contexts/AppCommandsContext.tsx` (4/0) |
| `UseAgentEventStreamArgs` | 5 | 3 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts` (5/3) |
| `AppBootstrapResult` | 5 | 2 | Host | `packages/cli/src/ui/AppContainerRuntime.tsx` (4/2)<br>`packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts` (1/0) |
| `AppCommandBindings` | 7 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (4/0)<br>`packages/cli/src/ui/contexts/AppCommandsContext.tsx` (3/0) |
| `InputPromptState` | 4 | 3 | Input | `packages/cli/src/ui/components/inputPromptHooks.ts` (4/3) |
| `ParsedBootstrapArgs` | 6 | 1 | Host | `packages/cli/src/cliBootstrap.tsx` (2/0)<br>`packages/cli/src/config/config.ts` (2/0)<br>`packages/cli/src/config/profileBootstrap.ts` (2/1) |
| `AppBootstrapProps` | 3 | 3 | Host | `packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts` (3/3) |
| `CommitInteractiveStartupArgs` | 3 | 3 | Host | `packages/cli/src/session/interactiveUI.tsx` (3/3) |
| `ShellExecutionParams` | 3 | 3 | Execution | `packages/cli/src/ui/hooks/shellCommandProcessor.ts` (3/3) |
| `Agent[]` | 5 | 0 | Stream | `packages/cli/src/ui/App.tsx` (1/0)<br>`packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (1/0)<br>`packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/0)<br>`packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (1/0)<br>`packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts` (1/0) |
| `CommandContext.services` | 5 | 0 | Command-services | `packages/cli/src/ui/hooks/slashCommandProcessor.ts` (2/0)<br>`packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` (2/0)<br>`packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (1/0) |
| `SlashCommandProcessorCoreResult` | 5 | 0 | Command | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (3/0)<br>`packages/cli/src/ui/hooks/slashCommandProcessor.ts` (1/0)<br>`packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (1/0) |
| `TranscriptProps` | 2 | 3 | Input | `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` (2/3) |
| `CommandContextInputs` | 2 | 2 | Command | `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` (2/2) |
| `ConfiguredProviderActivationResult` | 3 | 1 | Host | `packages/cli/src/cli.tsx` (2/1)<br>`packages/cli/src/cliProviderInit.ts` (1/0) |
| `LayoutStructureProps` | 3 | 1 | Input | `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` (3/1) |
| `Promise<Agent>` | 4 | 0 | Host | `packages/cli/src/cliAgentBootstrap.ts` (1/0)<br>`packages/cli/src/cliTerminalSession.ts` (1/0)<br>`packages/cli/src/nonInteractiveCli.ts` (2/0) |
| `RuntimeConfigBootstrap` | 3 | 1 | Host | `packages/cli/src/cli.tsx` (2/1)<br>`packages/cli/src/cliSessionBootstrap.ts` (1/0) |
| `UseSlashCommandProcessorCoreArgs` | 2 | 2 | Command | `packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (2/2) |
| `AppProps` | 1 | 2 | Input | `packages/cli/src/ui/App.tsx` (1/2) |
| `import("node_modules/@types/react/index").RefObject<AppCommandBindings>` | 3 | 0 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (3/0) |
| `OwnerInteractiveStartup` | 2 | 1 | Host | `packages/cli/src/session/interactiveUI.tsx` (2/1) |
| `renderStoreBackedDialog (inferred Identifier)` | 3 | 0 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (3/0) |
| `runCommandAction (inferred ObjectLiteralExpression)` | 3 | 0 | Input | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` (3/0) |
| `state (inferred ObjectLiteralExpression)` | 3 | 0 | Browser | `packages/cli/src/ui/components/InputPrompt.tsx` (1/0)<br>`packages/cli/src/ui/components/SessionBrowserDialog.tsx` (1/0)<br>`packages/cli/src/ui/components/inputPromptHooks.ts` (1/0) |
| `(Agent \| Set<string>)[]` | 2 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts` (2/0) |
| `activateConfiguredProvider (inferred ObjectLiteralExpression)` | 2 | 0 | Host | `packages/cli/src/cliProviderInit.ts` (2/0) |
| `ActivationPreflight` | 1 | 1 | Host | `packages/cli/src/cli.tsx` (1/0)<br>`packages/cli/src/cliTerminalSession.ts` (0/1) |
| `agent (inferred ObjectLiteralExpression)` | 2 | 0 | Host | `packages/cli/src/cliAgentBootstrap.ts` (1/0)<br>`packages/cli/src/cliTerminalSession.ts` (1/0) |
| `AppRuntimeViewProps` | 1 | 1 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/1) |
| `BuildSubmitQueryDepsArgs` | 1 | 1 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/1) |
| `CommandActionOutcome` | 2 | 0 | Command | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` (2/0) |
| `dispatchInteractiveOrNonInteractive (inferred ObjectLiteralExpression)` | 2 | 0 | Host | `packages/cli/src/session/nonInteractiveSession.ts` (2/0) |
| `ForegroundAgentOptions` | 1 | 1 | Host | `packages/cli/src/cliAgentBootstrap.ts` (1/1) |
| `import("node_modules/@types/react/index").RefObject<SubmitQueryCallbackDeps>` | 2 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (2/0) |
| `import("node_modules/@types/react/index").RefObject<UseAgentEventStreamArgs>` | 2 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentEventStream.ts` (2/0) |
| `import("node_modules/@types/react/index").RefObject<UseSubmitQueryDeps>` | 2 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (2/0) |
| `InputPromptProps` | 1 | 1 | Input | `packages/cli/src/ui/components/InputPrompt.tsx` (0/1)<br>`packages/cli/src/ui/components/inputPromptTypes.ts` (1/0) |
| `InputPromptRuntimeProps` | 1 | 1 | Input | `packages/cli/src/ui/components/inputPromptHooks.ts` (0/1)<br>`packages/cli/src/ui/components/inputPromptTypes.ts` (1/0) |
| `ModelDialogCommandContext` | 1 | 1 | Command | `packages/cli/src/ui/components/modelDialogHandler.ts` (1/1) |
| `NonInteractiveSessionOptions` | 1 | 1 | Host | `packages/cli/src/session/nonInteractiveSession.ts` (1/1) |
| `PipedOrPromptSessionOptions` | 1 | 1 | Host | `packages/cli/src/session/nonInteractiveSession.ts` (1/1) |
| `Promise<readonly CheckpointInfo[]>` | 2 | 0 | Command | `packages/cli/src/ui/commands/chatOwnerCommand.ts` (2/0) |
| `Promise<typeof import("packages/providers/src/composition/index")>` | 2 | 0 | Host | `packages/cli/src/cliSessionBootstrap.ts` (1/0)<br>`packages/cli/src/commands/mcp/list.ts` (1/0) |
| `React.PropsWithChildren<DefaultAppLayoutProps>` | 0 | 2 | Input | `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` (0/2) |
| `ReactToolSchedulerRuntime` | 1 | 1 | Execution | `packages/cli/src/ui/hooks/useReactToolScheduler.ts` (1/1) |
| `SessionBrowserDialogProps` | 1 | 1 | Browser | `packages/cli/src/ui/components/SessionBrowserDialog.tsx` (1/1) |
| `SessionDispatchOptions` | 1 | 1 | Host | `packages/cli/src/session/nonInteractiveSession.ts` (1/1) |
| `UseAutoAcceptIndicatorArgs` | 1 | 1 | Input | `packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts` (1/1) |
| `UseCoreEventHandlersOptions` | 1 | 1 | Input | `packages/cli/src/ui/hooks/useCoreEventHandlers.ts` (1/1) |
| `useInputFinish (inferred Identifier)` | 2 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (2/0) |
| `UseProviderDialogParams` | 1 | 1 | Dialog | `packages/cli/src/ui/hooks/useProviderDialog.ts` (1/1) |
| `UseSessionInitializationParams` | 1 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useSessionInitialization.ts` (1/1) |
| `UseToolsDialogParams` | 1 | 1 | Dialog | `packages/cli/src/ui/hooks/useToolsDialog.ts` (1/1) |
| `UseWelcomeOnboardingOptions` | 1 | 1 | Dialog | `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts` (1/1) |
| `(Agent \| "agent" \| "raw" \| MutableRefObject<RecordingIntegration \| null> \| ((message: ConsoleMessageItem) => void) \| undefined)[]` | 1 | 0 | Input | `packages/cli/src/ui/hooks/useCoreEventHandlers.ts` (1/0) |
| `(Agent \| "agent" \| "raw" \| React.MutableRefObject<RecordingIntegration \| null> \| undefined)[]` | 1 | 0 | Dialog | `packages/cli/src/ui/containers/AppContainer/hooks/useAppDialogs.ts` (1/0) |
| `(Agent \| "agent" \| "raw" \| RecordingIntegration \| DialogOpeners \| import("packages/cli/src/ui/contexts/RuntimeContext").RuntimeApi \| ((msg: { type: MessageType; content: string; timestamp: Date; }) => void) \| undefined)[]` | 1 | 0 | Dialog | `packages/cli/src/ui/hooks/useProviderDialog.ts` (1/0) |
| `(Agent \| (() => void) \| import("node_modules/@types/react/index").MutableRefObject<QueuedSubmission[]>)[]` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/0) |
| `(Agent \| CliUiRuntime \| (() => void) \| null)[]` | 1 | 0 | Input | `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` (1/0) |
| `(Agent \| CliUiRuntime \| DialogOpeners \| ((msg: { type: MessageType; content: string; timestamp: Date; }) => void) \| null)[]` | 1 | 0 | Dialog | `packages/cli/src/ui/hooks/useToolsDialog.ts` (1/0) |
| `(Agent \| import("packages/cli/src/ui/contexts/RuntimeContext").RuntimeApi \| import("packages/cli/src/ui/contexts/OAuthControlContext").OAuthControl)[]` | 1 | 0 | Dialog | `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts` (1/0) |
| `(Agent \| SchedulerRefs \| ((ready: boolean) => void))[]` | 1 | 0 | Execution | `packages/cli/src/runtime/interactiveToolScheduler.ts` (1/0) |
| `(Agent \| StreamingState \| ((submission: QueuedSubmission) => void))[]` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (1/0) |
| `(Agent \| UiRuntime \| ((item: Omit<HistoryItem, "id">, baseTimestamp: number) => number))[]` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useSessionInitialization.ts` (1/0) |
| `(boolean \| import("node_modules/@types/react/index").RefObject<AppCommandBindings>)[]` | 1 | 0 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (1/0) |
| `(CliUiRuntime \| ((itemData: Omit<import("packages/cli/src/ui/types").HistoryItem, "id">, baseTimestamp?: number, isResuming?: boolean) => number) \| { ui: { clear: () => void; addItem: UseHistoryManagerReturn["addItem"]; pendingItem: unknown; loadHistory: UseHistoryManagerReturn["loadHistory"]; }; recordingOwner?: "agent"; services: { agent: Agent \| null; }; recordingSwapCallbacks?: unknown; } \| ((kind: ListDialogKind) => void))[]` | 1 | 0 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (1/0) |
| `(CommandContext \| (SubagentDefinitionReads & SubagentDefinitionWrites) \| (() => void) \| undefined)[]` | 1 | 0 | Command | `packages/cli/src/ui/components/SubagentManagement/SubagentManagerDialog.tsx` (1/0) |
| `(CompletionState \| InputPromptState \| { escPressCount: React.RefObject<number>; showEscapePrompt: boolean; setShowEscapePrompt: React.Dispatch<React.SetStateAction<boolean>>; escapeTimerRef: React.RefObject<NodeJS.Timeout \| null>; resetEscapeState: () => void; } \| { handleSubmitAndClear: (submittedValue: string) => void; handleSubmit: (submittedValue: string) => void; } \| ReverseSearchState \| { navigateUp: () => void; navigateDown: () => void; } \| (() => Promise<void>))[]` | 1 | 0 | Input | `packages/cli/src/ui/components/inputPromptHooks.ts` (1/0) |
| `(import("packages/cli/src/ui/commands/types").CommandContext \| UseSlashCommandProcessorCoreArgs \| SlashCommandProcessorState \| { pendingItem: HistoryItemWithoutId \| null; setPendingItem: (item: HistoryItemWithoutId \| null) => void; pendingHistoryItems: HistoryItemWithoutId[]; addMessage: (message: import("packages/cli/src/ui/types").Message) => void; } \| SlashCommandCancellation)[]` | 1 | 0 | Command | `packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (1/0) |
| `(number \| Agent \| ((itemData: Omit<import("packages/cli/src/ui/types").HistoryItem, "id">, baseTimestamp?: number, isResuming?: boolean) => number) \| import("node_modules/@types/react/index").Dispatch<import("node_modules/@types/react/index").SetStateAction<HistoryItemWithoutId \| null>> \| import("node_modules/@types/react/index").MutableRefObject<HistoryItemWithoutId \| null> \| ((value: boolean) => void) \| ShellCommandRuntime \| ((message: string) => void) \| ((command: Promise<void>) => void \| Promise<void>) \| undefined)[]` | 1 | 0 | Execution | `packages/cli/src/ui/hooks/shellCommandProcessor.ts` (1/0) |
| `(string \| Agent \| Pick<CheckpointRuntime, "getCheckpointingEnabled"> \| HistoryItem[] \| TrackedToolCall[] \| ((message: string) => void) \| Pick<WorkspaceCheckpointOperations, "createFileSnapshot" \| "getCurrentCommitHash"> \| FsOps \| undefined)[]` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/checkpointPersistence.ts` (1/0) |
| `(string \| DialogStore \| ((itemData: Omit<import("packages/cli/src/ui/types").HistoryItem, "id">, baseTimestamp?: number, isResuming?: boolean) => number) \| ModelSwitchRuntime \| ModelDialogCommandContext \| null)[]` | 1 | 0 | Command | `packages/cli/src/ui/components/modelDialogHandler.ts` (1/0) |
| `(string \| import("packages/agents/index").Agent \| import("packages/core/index").LocalMediaStore \| LoaderDeps \| ((target: ContinueTarget, currentGen: number, currentSessionId: string) => Promise<{ enriched: EnrichedSessionSummary; } \| { skipped: true; } \| null>) \| undefined)[]` | 1 | 0 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts` (1/0) |
| `(string \| number \| boolean \| readonly string[] \| CommandContext \| readonly SlashCommand[] \| AllSetters \| { line: string; commandIndex: number; cursorCol: number; } \| Partial<Pick<CliUiRuntime, "isExtensionEnabled">> \| StateRefs \| ((h: string) => void) \| null \| undefined)[]` | 1 | 0 | Command | `packages/cli/src/ui/hooks/useSlashCompletion.tsx` (1/0) |
| `(string[] \| CommandContext \| TextBuffer)[]` | 1 | 0 | Command | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (1/0) |
| `(symbol \| Agent \| SchedulerRefs \| React.MutableRefObject<PendingScheduleRequests>)[]` | 1 | 0 | Execution | `packages/cli/src/runtime/interactiveToolScheduler.ts` (1/0) |
| `(TerminalStore \| { buffer: import("packages/cli/src/ui/components/shared/buffer-types").TextBuffer; commandContext: import("packages/cli/src/ui/commands/types").CommandContext; inputHistoryStore: import("packages/cli/src/ui/hooks/useInputHistoryStore").UseInputHistoryStoreReturn; handleUserInputSubmit: (submittedValue: string) => void; handleSteer: (text: string) => boolean; vimHandleInput: (key: import("packages/cli/src/ui/contexts/KeypressContext").Key) => boolean; sendAllQueuedSubmissions: () => void; steerAllQueuedSubmissions: () => void; clearQueuedSubmissions: () => void; handleIdePromptComplete: (result: import("packages/cli/src/ui/IdeIntegrationNudge").IdeIntegrationNudgeResult) => void; handleOAuthCodeDialogClose: () => void; handleOAuthCodeSubmit: (code: string) => Promise<void>; handleSettingsRestart: () => void; } \| { contextFileNames: string[]; mainControlsRef: React.RefObject<import("node_modules/ink/build/dom").DOMElement \| null>; pendingHistoryItemRef: React.RefObject<import("node_modules/ink/build/dom").DOMElement \| null>; rootUiRef: React.RefObject<import("node_modules/ink/build/dom").DOMElement \| null>; handleClearScreen: () => void; } \| { welcomeActions: import("packages/cli/src/ui/hooks/useWelcomeOnboarding").WelcomeActions; triggerWelcomeAuth: (provider: string, method: "oauth" \| "api_key", apiKey?: string) => Promise<void>; onWorkspaceMigrationDialogOpen: () => void; openThemeDialog: () => void; openProviderDialog: () => void; handleThemeSelect: (themeName: string \| undefined, scope: import("packages/cli/src/config/settings").SettingScope) => void; handleThemeHighlight: (themeName: string \| undefined) => void; handleAuthSelect: (selection: string \| undefined, _scope: import("packages/cli/src/config/settings").SettingScope) => Promise<void>; handleEditorSelect: (editorType: import("packages/core/index").EditorType \| undefined, scope: import("packages/cli/src/config/settings").SettingScope) => void; handleProviderSelect: (providerName: string) => Promise<void>; handleProfileSelect: (profileName: string) => Promise<void>; openLoadProfileDialog: () => Promise<void>; openCreateProfileDialog: () => void; openProfileListDialog: () => Promise<void>; viewProfileDetail: (profileName: string, openedDirectly?: boolean) => Promise<void>; closeProfileDetailDialog: () => Promise<void>; loadProfileFromDetail: (profileName: string) => Promise<void>; deleteProfileFromDetail: (profileName: string) => Promise<void>; deleteProfileFromList: (profileName: string) => Promise<void>; setProfileAsDefault: (profileName: string) => Promise<void>; openProfileEditor: (profileName: string, openedDirectly?: boolean) => Promise<void>; closeProfileEditor: () => Promise<void>; saveProfileFromEditor: (profileName: string, updatedProfile: unknown) => Promise<void>; handleToolsSelect: (toolName: string) => void; handleFolderTrustSelect: (choice: import("packages/cli/src/ui/trustDialogHelpers").FolderTrustChoice) => Promise<void>; })[]` | 1 | 0 | Command | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `(UseSessionBrowserProps \| { setters: BrowserSetters; selectedTargetKeyRef: React.MutableRefObject<string \| null>; loadSessions: () => Promise<void>; })[]` | 1 | 0 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts` (1/0) |
| `(UseSessionBrowserProps \| BrowserSetters)[]` | 1 | 0 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts` (1/0) |
| `{ llxprtMdFileCount, setLlxprtMdFileCount, coreMemoryFileCount, setCoreMemoryFileCount: _setCoreMemoryFileCount, } (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts` (1/0) |
| `{ props: UseSessionBrowserProps; refs: BrowserRefs; setters: BrowserSetters; derived: DerivedState; executeResume: (session: EnrichedSessionSummary) => void; executeDelete: (session: EnrichedSessionSummary) => void; }[]` | 1 | 0 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserKeypress.ts` (1/0) |
| `AppCommandDataContext (inferred NullKeyword)` | 1 | 0 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (1/0) |
| `appCommands (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `AppCommandsProvider (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (0/1) |
| `AppCommandsProvider (inferred VariableDeclaration)` | 1 | 0 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (1/0) |
| `AppContainerRuntime (inferred VariableDeclaration)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `AppInputResult (inferred TypeAliasDeclaration)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `bootstrap (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `bootstrapAndLoadProfile (inferred VariableDeclaration)` | 1 | 0 | Input | `packages/cli/src/config/config.ts` (1/0) |
| `bootstrapRuntimeAndConfig (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/cliSessionBootstrap.ts` (1/0) |
| `bufferSetup (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `buildAppCommands (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `buildAppCommands (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (0/1) |
| `buildControllerContext (inferred Parameter)` | 0 | 1 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserKeypress.ts` (0/1) |
| `buildHandlerDeps (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (1/0) |
| `buildSubmitQueryDeps (inferred ObjectLiteralExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/0) |
| `config (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/cliSessionBootstrap.ts` (1/0) |
| `constructForegroundAgentAndDispatch (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/cli.tsx` (1/0) |
| `context (inferred Identifier)` | 1 | 0 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserKeypress.ts` (1/0) |
| `core (inferred CallExpression)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `createNonInteractiveAgent (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/nonInteractiveCli.ts` (1/0) |
| `createRuntimeMetadata (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/config/profileBootstrap.ts` (1/0) |
| `data (inferred ArrowFunction)` | 1 | 0 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (1/0) |
| `data (inferred CallExpression)` | 1 | 0 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (1/0) |
| `data (inferred ParenthesizedExpression)` | 1 | 0 | Input | `packages/cli/src/ui/contexts/AppCommandsContext.tsx` (1/0) |
| `deleteCommand (inferred VariableDeclaration)` | 1 | 0 | Command | `packages/cli/src/ui/commands/profileCommand.ts` (1/0) |
| `DialogManager (inferred Identifier)` | 1 | 0 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (1/0) |
| `DialogManager (inferred VariableDeclaration)` | 1 | 0 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (1/0) |
| `execPromise (inferred ObjectLiteralExpression)` | 1 | 0 | Execution | `packages/cli/src/ui/hooks/shellCommandProcessor.ts` (1/0) |
| `executeSubmission (inferred ObjectLiteralExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useSubmitQuery.ts` (1/0) |
| `finish (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `handleKeypress (inferred ObjectLiteralExpression)` | 1 | 0 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserHelpers.ts` (1/0) |
| `handleLegacyKeyAction (inferred VariableDeclaration)` | 1 | 0 | Command | `packages/cli/src/ui/commands/keyCommand.ts` (1/0) |
| `handleLoad (inferred VariableDeclaration)` | 1 | 0 | Command | `packages/cli/src/ui/commands/keyCommand.ts` (1/0) |
| `HistoryService` | 1 | 0 | Input | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` (1/0) |
| `import("packages/agents/index").Agent[]` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `input (inferred CallExpression)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `keyfileCommand (inferred VariableDeclaration)` | 1 | 0 | Command | `packages/cli/src/ui/commands/keyfileCommand.ts` (1/0) |
| `orchestration (inferred SatisfiesExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStream.ts` (1/0) |
| `outcome (inferred ArrowFunction)` | 1 | 0 | Input | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` (1/0) |
| `parseBootstrapArgs (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/config/profileBootstrap.ts` (1/0) |
| `parseProcessBootstrapArgs (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/config/profileBootstrap.ts` (1/0) |
| `Pick` | 0 | 1 | Input | `packages/cli/src/ui/components/inputPromptHooks.ts` (0/1) |
| `proc (inferred CallExpression)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `processSlash (inferred SpreadElement)` | 1 | 0 | Input | `packages/cli/src/ui/hooks/slashCompletionEffect.ts` (1/0) |
| `processSlash (inferred VariableDeclaration)` | 1 | 0 | Input | `packages/cli/src/ui/hooks/slashCompletionEffect.ts` (1/0) |
| `Promise<{ readonly remainingHistory: readonly import("packages/agents/index").AgentHistoryItem[]; readonly itemsRemoved: number; }>` | 1 | 0 | Command | `packages/cli/src/ui/commands/chatOwnerCommand.ts` (1/0) |
| `Promise<CheckpointInfo>` | 1 | 0 | Command | `packages/cli/src/ui/commands/chatOwnerCommand.ts` (1/0) |
| `Promise<CommandActionOutcome>` | 1 | 0 | Command | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` (1/0) |
| `Promise<ConfiguredProviderActivationResult>` | 1 | 0 | Host | `packages/cli/src/cli.tsx` (1/0) |
| `Promise<import("packages/agents/index").Agent>` | 1 | 0 | Host | `packages/cli/src/cli.tsx` (1/0) |
| `Promise<RuntimeConfigBootstrap>` | 1 | 0 | Host | `packages/cli/src/cli.tsx` (1/0) |
| `Promise<void>` | 1 | 0 | Command | `packages/cli/src/ui/commands/chatOwnerCommand.ts` (1/0) |
| `promptCompletion (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/hooks/useCommandCompletion.tsx` (1/0) |
| `props` | 1 | 0 | Input | `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` (1/0) |
| `provider (inferred ObjectLiteralExpression)` | 1 | 0 | Dialog | `packages/cli/src/ui/containers/AppContainer/hooks/useAppDialogs.ts` (1/0) |
| `renderAccountStoreDialog (inferred Parameter)` | 0 | 1 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (0/1) |
| `renderDialogBody (inferred Identifier)` | 1 | 0 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (1/0) |
| `renderDialogBody (inferred Parameter)` | 0 | 1 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (0/1) |
| `renderSessionBrowserDialog (inferred Parameter)` | 0 | 1 | Dialog | `packages/cli/src/ui/components/DialogManagerRenderers.tsx` (0/1) |
| `renderSettingsStoreDialog (inferred Parameter)` | 0 | 1 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (0/1) |
| `renderStoreBackedDialog (inferred Parameter)` | 0 | 1 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (0/1) |
| `renderUtilityStoreDialog (inferred Parameter)` | 0 | 1 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (0/1) |
| `result (inferred ObjectLiteralExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/0) |
| `runCommandAction (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/hooks/slashCommandHandlers.ts` (0/1) |
| `runNonInteractiveSession (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/session/nonInteractiveSession.ts` (1/0) |
| `runPipedOrPromptSession (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/session/nonInteractiveSession.ts` (1/0) |
| `runtimeState (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/config/config.ts` (1/0) |
| `schedulePaymentModeCheck (inferred VariableDeclaration)` | 1 | 0 | Command | `packages/cli/src/ui/commands/profileLoad.ts` (1/0) |
| `schedulerRuntime (inferred ArrowFunction)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (1/0) |
| `schedulerRuntime (inferred CallExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (1/0) |
| `schedulerRuntime (inferred ParenthesizedExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (1/0) |
| `setup (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `showAutoAcceptIndicator (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `startInteractiveUI (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/session/interactiveUI.tsx` (1/0) |
| `startInteractiveUI (inferred Parameter)` | 0 | 1 | Host | `packages/cli/src/session/interactiveUI.tsx` (0/1) |
| `state (inferred CallExpression)` | 1 | 0 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (1/0) |
| `stream (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `switchProvider (inferred VariableDeclaration)` | 1 | 0 | Command | `packages/cli/src/ui/commands/providerCommand.ts` (1/0) |
| `toolSchedulerResult (inferred Identifier)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (1/0) |
| `toolsRaw (inferred ObjectLiteralExpression)` | 1 | 0 | Dialog | `packages/cli/src/ui/containers/AppContainer/hooks/useAppDialogs.ts` (1/0) |
| `useAppBootstrap (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts` (1/0) |
| `useAppCommands (inferred ArrowFunction)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `useAppCommands (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `useAppCommands (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (0/1) |
| `useAppDialogsRuntime (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `useAppInput (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `useAppInput (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `useAppInput (inferred VariableDeclaration)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `useAppInputRuntime (inferred CallExpression)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `useAppInputRuntime (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/AppContainerRuntime.tsx` (1/0) |
| `useBootstrapEvents (inferred ObjectLiteralExpression)` | 1 | 0 | Host | `packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts` (1/0) |
| `useCommandContext (inferred ArrowFunction)` | 1 | 0 | Command | `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` (1/0) |
| `useDialogManagerState (inferred ObjectLiteralExpression)` | 1 | 0 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (1/0) |
| `useEventStreamForAgent (inferred ObjectLiteralExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/0) |
| `useInputBuffer (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `useInputCore (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `useInputCore (inferred VariableDeclaration)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `useInputCoreProcessors (inferred ObjectLiteralExpression)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |
| `useInputFinish (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `useInputStartup (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `useInputStream (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `useInputStreamSetup (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `useInputStreamWiring (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `useSessionBrowserHandler (inferred Parameter)` | 0 | 1 | Dialog | `packages/cli/src/ui/components/DialogManager.tsx` (0/1) |
| `useSessionKeypressHandler (inferred Identifier)` | 1 | 0 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserKeypress.ts` (1/0) |
| `useSessionKeypressHandler (inferred Parameter)` | 0 | 1 | Browser | `packages/cli/src/ui/hooks/useSessionBrowserKeypress.ts` (0/1) |
| `useSettingsStoreMirrors (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `useShell (inferred ObjectLiteralExpression)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamOrchestration.ts` (1/0) |
| `useShellCommandSetup (inferred Parameter)` | 0 | 1 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (0/1) |
| `useSlashCommandProcessorCore (inferred ObjectLiteralExpression)` | 1 | 0 | Command | `packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` (1/0) |
| `useToolSchedulerSetup (inferred VariableDeclaration)` | 1 | 0 | Stream | `packages/cli/src/ui/hooks/agentStream/useAgentStreamLifecycle.ts` (1/0) |
| `useTurnStoreMirrors (inferred Parameter)` | 0 | 1 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (0/1) |
| `welcome (inferred ObjectLiteralExpression)` | 1 | 0 | Dialog | `packages/cli/src/ui/containers/AppContainer/hooks/useAppDialogs.ts` (1/0) |
| `wiring (inferred Identifier)` | 1 | 0 | Input | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` (1/0) |

### zed-acp

| Owner type or inferred declaration | B | P | Replacement | Files |
| --- | ---: | ---: | --- | --- |
| `Agent` | 13 | 6 | ACP-build | `packages/zed-acp/src/zed-agent-setup.ts` (0/2)<br>`packages/zed-acp/src/zed-session-agent.ts` (3/1)<br>`packages/zed-acp/src/zed-session-loader.ts` (0/1)<br>`packages/zed-acp/src/zed-session-ports.ts` (3/2)<br>`packages/zed-acp/src/zedIntegration.ts` (7/0) |
| `Promise<ZedSessionAgent>` | 3 | 0 | ACP | `packages/zed-acp/src/zedIntegration.ts` (3/0) |
| `buildZedSessionAgent (inferred ObjectLiteralExpression)` | 2 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (2/0) |
| `Promise<typeof import("packages/providers/src/composition/index")>` | 2 | 0 | ACP-build | `packages/zed-acp/src/runZedIntegration.ts` (1/0)<br>`packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `[{ loadInstalledRuntimePlugins }, { createFileOAuthSettingsProvider }] (inferred ArrayLiteralExpression)` | 1 | 0 | ACP | `packages/zed-acp/src/runZedIntegration.ts` (1/0) |
| `{ manager, oauthManager } (inferred CallExpression)` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `{ manager, oauthManager } (inferred ObjectLiteralExpression)` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `buildZedSessionAgent (inferred CallExpression)` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `composeSessionProviderManager (inferred ObjectLiteralExpression)` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `composeSessionProviderManager (inferred Parameter)` | 0 | 1 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (0/1) |
| `Promise<[typeof import("packages/providers/src/composition/index"), typeof import("packages/providers/src/auth/index")]>` | 1 | 0 | ACP | `packages/zed-acp/src/runZedIntegration.ts` (1/0) |
| `Promise<{ manager: import("packages/providers/index").ProviderManager; oauthManager: OAuthManager; }>` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `Promise<Agent>` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `sessionPolicyInput (inferred ObjectLiteralExpression)` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |
| `ZedSessionAgent` | 1 | 0 | ACP-build | `packages/zed-acp/src/zed-session-agent.ts` (1/0) |

### a2a-server

| Owner type or inferred declaration | B | P | Replacement | Files |
| --- | ---: | ---: | --- | --- |
| `Agent` | 6 | 2 | A2A | `packages/a2a-server/src/agent/executor.ts` (4/0)<br>`packages/a2a-server/src/agent/task-runtime.ts` (0/1)<br>`packages/a2a-server/src/agent/task.ts` (1/1)<br>`packages/a2a-server/src/http/app.ts` (1/0) |
| `Promise<Agent>` | 4 | 0 | A2A | `packages/a2a-server/src/agent/executor.ts` (3/0)<br>`packages/a2a-server/src/config/config.ts` (1/0) |
| `CoderAgentExecutorDependencies` | 1 | 1 | A2A | `packages/a2a-server/src/agent/executor.ts` (1/1) |
| `Promise<import("packages/agents/index").Agent>` | 1 | 0 | A2A | `packages/a2a-server/src/http/app.ts` (1/0) |

## CommandContext decomposition

The 219 bundle and 298 bag findings named CommandContext span 82 files. Its services projection adds 5 bundle findings in three files; additional command/UI witnesses are included in their own inventory rows. This is one shared declaration with many consumers, so functional slices retire each consumer before the final common invocation slice deletes the bag. The UI sub-object is rendering state/actions; session contains stats and shell approvals; todoContext contains task state/actions. Recording integration is separately owned. These are not substitutes for services and cannot gain runtime collaborators during migration.

| Consumer file | CommandContext B | CommandContext P | Step |
| --- | ---: | ---: | --- |
| `packages/cli/src/nonInteractiveCliCommands.ts` | 5 | 0 | 40 |
| `packages/cli/src/services/BuiltinCommandLoader.ts` | 0 | 1 | 39 |
| `packages/cli/src/services/FileCommandLoader.ts` | 1 | 2 | 39 |
| `packages/cli/src/services/McpPromptLoader.ts` | 0 | 2 | 39 |
| `packages/cli/src/services/prompt-processors/argumentProcessor.ts` | 0 | 1 | 39 |
| `packages/cli/src/services/prompt-processors/shellProcessor.ts` | 0 | 1 | 39 |
| `packages/cli/src/services/prompt-processors/types.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/aboutCommand.ts` | 6 | 6 | 39 |
| `packages/cli/src/ui/commands/authCommand.ts` | 5 | 6 | 38 |
| `packages/cli/src/ui/commands/baseurlCommand.ts` | 0 | 1 | 38 |
| `packages/cli/src/ui/commands/bugCommand.ts` | 3 | 4 | 39 |
| `packages/cli/src/ui/commands/chatCommand.ts` | 23 | 17 | 39 |
| `packages/cli/src/ui/commands/chatOwnerCommand.ts` | 15 | 13 | 39 |
| `packages/cli/src/ui/commands/clearCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/compressCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/continueCommand.ts` | 4 | 4 | 39 |
| `packages/cli/src/ui/commands/continuePackageActions.ts` | 2 | 3 | 39 |
| `packages/cli/src/ui/commands/copyCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/debugCommands.ts` | 6 | 12 | 39 |
| `packages/cli/src/ui/commands/diagnosticsCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/directoryCommand.tsx` | 1 | 3 | 39 |
| `packages/cli/src/ui/commands/docsCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/dumpcontextCommand.ts` | 1 | 2 | 39 |
| `packages/cli/src/ui/commands/extensionsCommand.ts` | 9 | 14 | 39 |
| `packages/cli/src/ui/commands/helpCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/historyServiceAccess.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/hooksCommand.ts` | 12 | 13 | 39 |
| `packages/cli/src/ui/commands/ideCommand.ts` | 0 | 3 | 39 |
| `packages/cli/src/ui/commands/imageCommand.ts` | 0 | 2 | 39 |
| `packages/cli/src/ui/commands/initCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/keyCommand.ts` | 5 | 6 | 38 |
| `packages/cli/src/ui/commands/keyfileCommand.ts` | 0 | 1 | 38 |
| `packages/cli/src/ui/commands/loggingCommand.ts` | 1 | 6 | 39 |
| `packages/cli/src/ui/commands/logoutCommand.ts` | 1 | 2 | 38 |
| `packages/cli/src/ui/commands/mcpAuth.ts` | 0 | 2 | 38 |
| `packages/cli/src/ui/commands/mcpCommand.ts` | 5 | 6 | 39 |
| `packages/cli/src/ui/commands/memoryCommand.ts` | 2 | 6 | 39 |
| `packages/cli/src/ui/commands/modelCommand.ts` | 1 | 2 | 38 |
| `packages/cli/src/ui/commands/mouseCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/perfCommand.ts` | 0 | 3 | 39 |
| `packages/cli/src/ui/commands/permissionsCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/policiesCommand.ts` | 6 | 6 | 39 |
| `packages/cli/src/ui/commands/privacyCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/profileCommand.ts` | 3 | 9 | 38 |
| `packages/cli/src/ui/commands/profileLoad.ts` | 0 | 3 | 38 |
| `packages/cli/src/ui/commands/profileSchemas.ts` | 0 | 4 | 38 |
| `packages/cli/src/ui/commands/providerCommand.ts` | 2 | 3 | 38 |
| `packages/cli/src/ui/commands/quitCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/quotaCommand.ts` | 24 | 9 | 38 |
| `packages/cli/src/ui/commands/restoreCommand.ts` | 2 | 4 | 39 |
| `packages/cli/src/ui/commands/schema/index.ts` | 5 | 4 | 39 |
| `packages/cli/src/ui/commands/schema/types.ts` | 0 | 2 | 39 |
| `packages/cli/src/ui/commands/setCommand.ts` | 5 | 6 | 38 |
| `packages/cli/src/ui/commands/setCommandSchema.ts` | 4 | 6 | 38 |
| `packages/cli/src/ui/commands/settingsCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/setupCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/setupGithubCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/skillsCommand.ts` | 0 | 6 | 39 |
| `packages/cli/src/ui/commands/statsCommand.ts` | 2 | 9 | 39 |
| `packages/cli/src/ui/commands/subagentCommand.ts` | 4 | 13 | 39 |
| `packages/cli/src/ui/commands/tasksCommand.ts` | 5 | 8 | 39 |
| `packages/cli/src/ui/commands/themeCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/commands/todoCommand.ts` | 11 | 10 | 39 |
| `packages/cli/src/ui/commands/todoOperations.ts` | 0 | 4 | 39 |
| `packages/cli/src/ui/commands/toolformatCommand.ts` | 0 | 1 | 38 |
| `packages/cli/src/ui/commands/toolkeyCommand.ts` | 0 | 1 | 38 |
| `packages/cli/src/ui/commands/toolkeyfileCommand.ts` | 0 | 1 | 38 |
| `packages/cli/src/ui/commands/toolsCommand.ts` | 3 | 4 | 39 |
| `packages/cli/src/ui/commands/types.ts` | 1 | 2 | 39 |
| `packages/cli/src/ui/commands/uiprofileCommand.ts` | 0 | 1 | 38 |
| `packages/cli/src/ui/commands/vimCommand.ts` | 0 | 1 | 39 |
| `packages/cli/src/ui/components/DialogManager.tsx` | 3 | 0 | 40 |
| `packages/cli/src/ui/components/SubagentManagement/SubagentManagerDialog.tsx` | 2 | 1 | 40 |
| `packages/cli/src/ui/components/inputPromptHooks.ts` | 1 | 0 | 40 |
| `packages/cli/src/ui/hooks/schemaCompletionUtils.ts` | 1 | 1 | 40 |
| `packages/cli/src/ui/hooks/slashCommandHandlers.ts` | 14 | 6 | 40 |
| `packages/cli/src/ui/hooks/slashCommandProcessorSupport.ts` | 1 | 0 | 40 |
| `packages/cli/src/ui/hooks/slashCompletionEffect.ts` | 3 | 4 | 40 |
| `packages/cli/src/ui/hooks/useCommandCompletion.tsx` | 1 | 1 | 40 |
| `packages/cli/src/ui/hooks/useSlashCommandProcessorCore.ts` | 3 | 1 | 40 |
| `packages/cli/src/ui/hooks/useSlashCompletion.tsx` | 4 | 4 | 40 |
| `packages/cli/src/ui/utils/fuzzyFilter.ts` | 1 | 2 | 40 |
