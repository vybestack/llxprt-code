<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P16 @requirement:REQ-SP2-004 -->
<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P17 @requirement:REQ-SP2-004 -->
1: When a runtime session initialises, derive `runtimeAuthScopeId` from the isolation context and allocate an in-memory credential cache map keyed by `{runtimeAuthScopeId, providerId, profileId}`.
2: On token acquisition, check the scoped cache first; if a fresh token entry exists and is not expired, return it immediately and record a hit metric on the runtime context.
3: If the scoped cache miss occurs, call the provider-specific authenticator with runtime-scoped configuration, annotating the request with `runtimeAuthScopeId` so downstream listeners can emit scope-aware audit logs.
4: Persist the newly acquired token into the scoped cache with expiry metadata, cancellation hooks, and a pointer to the originating runtime context so that shutdown hooks can revoke or scrub it.
5: Subscribe to runtime lifecycle events (`onProfileChange`, `onProviderOverride`, `onRuntimeDispose`) and purge cache entries whose scope identifiers intersect the change payload to prevent credential bleed across runtimes.
6: When invalidation happens, enqueue asynchronous revocation where supported; otherwise, mark entries as stale so the next acquisition triggers a controlled refresh under the same runtime scope.
7: On runtime disposal, flush remaining scoped cache entries, ensuring secrets are wiped in-memory, telemetry is finalised, and optional persistence (e.g., encrypted disk cache) is gated behind scope-specific teardown policies.
