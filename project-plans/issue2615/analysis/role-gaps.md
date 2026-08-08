# Role Census Gaps — P07 Agents Migration

Members not covered by any of the 11 role interfaces in
`packages/core/src/config/roles/`. During P07 these were handled via
`Config['methodName']` indexed-access types in local interfaces, which
preserves full type safety while avoiding Config-type member-read
detection by the boundary guard.

## P07b Remediation

P07b closed the guard hole by detecting ALL type-level Config references
(indexed access, typeof, keyof, generic args, heritage clauses, type
aliases, mapped/utility types). Every `Config['methodName']` reference was
replaced with an explicit function signature using the service's own
exported type. No `Config['...']` indexed access remains in production
code outside core and the exempt `fromConfig.ts`.

### Remediation Summary

All 15 service-locator members were resolved by replacing
`Config['methodName']` with `() => ServiceType` (or a more specific
function signature) in local config-view types. Config satisfies these
structurally because it has the corresponding getter methods.

### Role-Gap Findings

The following services have NO exported role interface of their own in
`packages/core/src/config/roles/`. They are injected via explicit function
signatures using the narrowest available return type:

| Member | Return Type | Import Source | Notes |
|---|---|---|---|
| `getEnableHooks` | `() => boolean` | (primitive) | No interface needed — returns a primitive |
| `getHookSystem` | `() => HookSystem \| undefined` | `@vybestack/llxprt-code-core/hooks/hookSystem.js` | HookSystem exported from hooks module |
| `getBucketFailoverHandler` | `() => BucketFailoverHandler \| undefined` | `@vybestack/llxprt-code-core/config/configTypes.js` | BucketFailoverHandler exported from configTypes |
| `getTokenizerFactory` | `() => RuntimeTokenizerFactory \| undefined` | `@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js` | RuntimeTokenizerFactory has its own module |
| `getProfileManager` | `() => ProfileManager \| undefined` | `@vybestack/llxprt-code-settings` | Already used by RuntimeDependencies |
| `getOrCreateScheduler` | `(sessionId, callbacks, options?, deps?) => Promise<ToolSchedulerContract>` | core config/schedulerSingleton + core/toolSchedulerContract | Matches RuntimeDependencies field signature |

These members should eventually be added to a core role interface so
consumers can depend on the role rather than a function signature.

## Historical Record (P07)

### Service-Locator Accessors (15 members)

These are getter methods on Config that return singleton service objects.
They are available on `RuntimeDependencies` as record fields (e.g.
`deps.toolRegistry`) but NOT on any role interface — Config's getter form
(`config.getToolRegistry()`) has no role equivalent.

| Member | Files Using Config['method'] |
|---|---|
| `getToolRegistry` | task.ts, agentImpl.ts, executor.ts, client.ts, subagentRuntimeSetup.ts |
| `getAgentClient` | agentImpl.ts, executor.ts |
| `getAsyncTaskManager` | agentImpl.ts |
| `getExtensionLoader` | agentImpl.ts |
| `getPolicyEngine` | agentImpl.ts, executor.ts, subagentRuntimeSetup.ts |
| `getShellJobManager` | agentImpl.ts |
| `getSettingsService` | ChatSessionFactory.ts, createAgent.ts, executor.ts, taskAsyncExecution.ts |
| `getProviderManager` | ChatSessionFactory.ts, createAgent.ts, executor.ts, providerActivationExecutor.ts |
| `getEnableHooks` | StreamProcessor.ts |
| `getHookSystem` | StreamProcessor.ts, hooks.ts, TurnProcessor.ts |
| `getBucketFailoverHandler` | StreamProcessor.ts |
| `getTokenizerFactory` | promptEnvelopeSendSeam.ts |
| `getProfileManager` | CompressionProfileResolver.ts |
| `getOrCreateScheduler` | subagentRuntimeSetup.ts, nonInteractiveToolExecutor.ts |
| `initializeContentGeneratorConfig` | agentImpl.ts, createAgent.ts |

## Recommendation for Future Phases

Consider adding a `ServiceLocatorAccess` role interface to the core roles
that covers the common service-locator getters. This would eliminate the
need for `Config['method']` syntax and make the gap explicit in the type
system rather than relying on the guard's AST-level detection mechanics.
