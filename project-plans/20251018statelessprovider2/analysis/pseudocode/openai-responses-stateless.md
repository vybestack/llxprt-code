<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P07 @requirement:REQ-SP2-001 -->
# OpenAI & OpenAIResponses Stateless Flow

1. Receive a stateless invocation from the orchestration layer and extract provider type (chat vs responses), request payload, and tool declarations.
2. Resolve authentication details by checking per-call credentials first, then falling back to configured environment variables; raise a provider error immediately if no API key is available.
3. Look up a cached OpenAI client instance keyed by provider variant + API key + endpoint options; create and memoize a fresh lightweight client when no cache hit is found.
4. Normalize request options (model, temperature, max tokens, metadata) using shared BaseProvider helpers so the stateless contract stays consistent across OpenAI variants.
5. Format tool definitions into the shape expected by the target OpenAI API (chat `functions` vs responses `tools` objects), ensuring arguments schemas remain JSON-serializable.
6. Dispatch the API call with the cached client, handling either standard responses or streaming callbacks, and capture raw provider output plus timing metadata.
7. Map raw outputs onto the BaseProvider stateless contract (messages array, tool calls, usage metrics) while preserving provider-specific fields for downstream consumers.
8. Run cleanup hooks: release any per-call resources, log metrics, and emit diagnostic traces without mutating shared state so the provider stays stateless.
