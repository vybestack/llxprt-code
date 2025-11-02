<!-- @plan:PLAN-20250218-STATELESSPROVIDER.P02 @requirement:REQ-SP-003 -->

1: Receive chatRequest from CLI/UI layer containing userPrompt, toolContext, runtimeOverrides.
2: Acquire active runtime pair via getProviderRuntimeContext(); throw InitializationError if missing.
3: Read providerName override from chatRequest or use settingsService.getActiveProvider().
4: Resolve provider registration from providerManager using providerName; fail fast with UserFacingError if missing.
5: Determine modelId by checking chatRequest override, then settingsService.getModel(providerName), then provider default.
6: Collect modelParams, tool configuration, and safety settings from settingsService scoped to providerName and modelId.
7: Fetch userMemory snapshot and conversation state from config to supply additionalPrompt context when applicable.
8: Invoke getCoreSystemPromptAsync with providerName, modelId, tools, additionalPrompt, userMemory to generate system prompt text.
9: Construct ProviderInvocationContext with settingsService, config, providerName, modelId, tools, userPrompt, systemPrompt, streaming preference, trace metadata.
10: Append request audit entry to telemetry pipeline capturing providerName, modelId, token budget, conversation id.
11: Await provider.generateChatCompletion(context) and stream results back to caller, piping partial tokens when streaming enabled.
12: Capture provider response metadata (usage, finishReason) and persist to conversation history in config/session store.
13: On ProviderError with retryable flag, apply exponential backoff using config retry policy before re-invoking provider up to allowed attempts.
14: If invocation ultimately fails, surface structured error with providerName/modelId for CLI display and log sanitized details.
15: Emit post-call metrics (latency, token usage) and notify observers (e.g., analytics hooks) before returning final response payload.
16: Update runtime telemetry ledger with any auth refresh events returned by provider context.
