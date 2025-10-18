# Provider Interface Reference

The stateless provider architecture introduces an explicit runtime contract for provider implementations. This document summarises the updated interface exposed from `@vybestack/llxprt-code-core`.

## `GenerateChatOptions`

```ts
export interface GenerateChatOptions {
  contents: IContent[];
  tools?: ProviderToolset;
  settings?: SettingsService;
  config?: Config;
  runtime?: ProviderRuntimeContext;
  metadata?: Record<string, unknown>;
}
```

- **`settings`** – scoped `SettingsService` bound to the caller. Prefer this over importing global helpers.
- **`config`** – optional `Config` instance with helper methods (`getProvider`, `setEphemeralSetting`, etc.).
- **`runtime`** – the full `ProviderRuntimeContext`. It always includes the `settingsService` and may include `runtimeId` or `metadata` that callers can use for logging.
- **`metadata`** – arbitrary caller-supplied data (for example, CLI feature flags or subagent identifiers).

Providers should treat `runtime` as authoritative. Fallback to `getActiveProviderRuntimeContext()` only when running inside legacy tests.

## Mandatory methods

```ts
interface IProvider {
  name: string;
  isDefault?: boolean;
  getModels(): Promise<IModel[]>;
  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  getDefaultModel(): string;
  getServerTools(): string[];
  invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
  ): Promise<unknown>;
}
```

- `generateChatCompletion` must respect the options object and stream responses through the returned async iterator.
- `getModels` and `getDefaultModel` should read model lists from the provider's metadata or remote API.
- `getServerTools` and `invokeServerTool` expose provider-native capabilities (tool calling, image generation, etc.).

## Deprecated hooks

The following methods remain on the interface for backward compatibility but should be avoided in new code:

- `setConfig(config)` – prefer passing `config` via `GenerateChatOptions`.
- `clearState()` – maintain state in the runtime scope instead.
- `clearAuth()` / `clearAuthCache()` – authentication is managed by runtime-scoped handlers.

## Accessing runtime information

Provider implementations typically pull runtime data from `options.runtime`:

```ts
async *generateChatCompletion(options: GenerateChatOptions) {
  const runtime = options.runtime ?? getActiveProviderRuntimeContext();
  const settings = runtime.settingsService;
  const apiKey = settings.getProviderSetting(this.name, 'apiKey');
  const baseUrl = settings.getProviderSetting(this.name, 'baseUrl');
  // ... build request using runtime data ...
  yield* sendRequest(apiKey, baseUrl, options.contents, options.tools);
}
```

Use `runtime.metadata` for enriched logging or telemetry, and respect any model parameters stored on the `SettingsService` (for example, temperature overrides).

## Testing tips

- Create isolated contexts for each test using `createProviderRuntimeContext()` and set it active with `setActiveProviderRuntimeContext()`.
- Inject fake `SettingsService` instances into the context to assert how providers read/write configuration.
- Leverage `resetCliProviderInfrastructure()` when testing the CLI integration to avoid cross-test contamination.
