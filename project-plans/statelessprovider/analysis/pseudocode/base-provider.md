<!-- @plan:PLAN-20250218-STATELESSPROVIDER.P02 @requirement:REQ-SP-001 -->

1: Define ProviderInvocationContext containing settingsService, config, requestMetadata, traceContext.
2: Add requestMetadata fields for providerName, modelId, tools, userPrompt, additionalPrompt, streaming flag.
3: Ensure BaseProvider constructor receives logger, telemetry, metrics, and vendor SDK factory.
4: On BaseProvider.generateChatCompletion(context): validate context contains settingsService and config instances.
5: Read provider config from context.settingsService (auth key, base URL, model params, tool format override).
6: Derive runtime defaults when required fields missing (use config defaults or provider-specific fallbacks) without touching globals.
7: Call getCoreSystemPromptAsync with providerName, modelId, context.requestMetadata.tools, additionalPrompt, config.userMemory.
8: Merge system prompt and userPrompt into vendor-ready message array or equivalent structure.
9: Retrieve cached API client from in-memory map keyed by providerName + auth key + base URL; create new client via vendor SDK factory if cache miss.
10: Build request envelope with temperature, maxTokens, tool definitions, and streaming preference from settingsService data.
11: Initiate vendor SDK request; if streaming requested, return async iterator that yields incremental IContent chunks.
12: Wrap vendor errors into standardized ProviderError including providerName, modelId, and retryable flag.
13: Emit telemetry using context.traceContext before yielding final response or raising errors.
14: On completion, update auth cache if vendor response rotates credentials; do not persist non-auth state on the provider instance.
15: Expose helper resolveRequestOptions(context) to consolidate lines 5-10 for child providers to reuse.
16: Ensure provider shutdown/dispose hooks clear cached clients keyed to invalidated auth tuples without touching global state.
17: Reference ProviderRuntimeContext helpers to acquire per-call settingsService/config without relying on global singletons.
18: Document fallback behaviour so legacy callers using getSettingsService() still resolve the active runtime context.
