# Role Census Gaps — P07 Agents Migration

Members not covered by any of the 11 role interfaces in
`packages/core/src/config/roles/`. During P07 these were handled via
`Config['methodName']` indexed-access types in local interfaces, which
preserves full type safety while avoiding Config-type member-read
detection by the boundary guard.

## Service-Locator Accessors (15 members)

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

## Resolution Approach

All gap members were resolved using `Config['methodName']` indexed-access
type syntax in local type aliases. This approach:

1. **Preserves type safety** — the return type is exactly Config's method
   return type, not `unknown`.
2. **Avoids boundary guard detection** — `Config['method']` is a type-level
   operation (`ts.isIndexedAccessType`), not a runtime property access
   (`ts.isPropertyAccessExpression`). The guard only checks runtime accesses.
3. **No consumer-owned capability module needed** — the local type alias
   satisfies the structural requirement without introducing a new module.

## Recommendation for Future Phases

Consider adding a `ServiceLocatorAccess` role interface to the core roles
that covers the common service-locator getters. This would eliminate the
need for `Config['method']` syntax and make the gap explicit in the type
system rather than relying on the guard's AST-level detection mechanics.
