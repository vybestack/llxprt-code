<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P10 @requirement:REQ-SP2-001 -->
1: Resolve provider variant (anthropic vs gemini) per call metadata and extract request payload plus streaming preferences.
2: Acquire per-call authentication credentials (API key, OAuth token) and abort early if none are present.
3: Compute a cache key from runtime ID + endpoint + auth token and look up a lightweight client; instantiate and memoize one if missing.
4: Normalize model options, safety parameters, and tool declarations using shared BaseProvider helpers so contract alignment is consistent.
5: Format tool payloads into provider-specific schemas (Claude tool schema vs Gemini JSON schema) without mutating shared formatter state.
6: Dispatch the API request (streaming or unary) using the cached client while capturing timing and tracing metadata for diagnostics.
7: Map raw provider responses into the BaseProvider stateless result shape, including tool invocations and usage accounting.
8: Release per-call resources, emit logs, and clear transient overrides so subsequent invocations remain stateless.
