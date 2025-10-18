# Provider Runtime Context

`ProviderRuntimeContext` encapsulates the state LLxprt Code needs to execute provider calls without relying on global singletons. Each runtime (CLI session, subagent, automation worker) owns one context.

```ts
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setProviderRuntimeContextFallback,
} from '@vybestack/llxprt-code-core';
```

## Shape

```ts
export interface ProviderRuntimeContext {
  settingsService: SettingsService;
  config?: Config;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}
```

- **`settingsService`** – scoped instance used to read/write provider settings, model parameters, and feature toggles.
- **`config`** – optional `Config` object bound to the runtime (CLI bootstrap attaches its own instance).
- **`runtimeId`** – optional, caller-defined identifier (shown in debug logs and telemetry).
- **`metadata`** – arbitrary record for caller identifiers (subagent name, job id, etc.).

## Lifecycle helpers

| Helper                                       | Description                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `createProviderRuntimeContext(init?)`        | Constructs a context. If `settingsService` is omitted a fresh `SettingsService` is created.                                                     |
| `setActiveProviderRuntimeContext(context)`   | Marks a context as the active one for the current async call stack.                                                                             |
| `clearActiveProviderRuntimeContext()`        | Unsets the active context (use before restoring a parent).                                                                                      |
| `peekActiveProviderRuntimeContext()`         | Returns the currently active context or `null` without touching fallbacks.                                                                      |
| `getActiveProviderRuntimeContext()`          | Resolves the active context, creating one with the fallback factory if needed.                                                                  |
| `setProviderRuntimeContextFallback(factory)` | Registers a factory used when `getActiveProviderRuntimeContext()` is called while no active context is set. Passing `null` clears the fallback. |

> **Note:** `getActiveProviderRuntimeContext()` lazily initialises a "legacy-singleton" context if nothing else is registered. Modern code should always create an explicit context during bootstrap and avoid relying on the fallback.

## Nested runtimes

The runtime helpers support stacking contexts—useful when launching subagents or parallel automation tasks:

```ts
const previous = peekActiveProviderRuntimeContext();
const runtime = createProviderRuntimeContext({
  runtimeId: 'subagent-reviewer',
  metadata: { agentId: 'reviewer', origin: 'cli' },
});
setActiveProviderRuntimeContext(runtime);
try {
  await runReviewerWorkflow(runtime);
} finally {
  clearActiveProviderRuntimeContext();
  if (previous) {
    setActiveProviderRuntimeContext(previous);
  }
}
```

Each context maintains its own `SettingsService` instance, preventing provider switches or credential updates in one workflow from leaking into another.
