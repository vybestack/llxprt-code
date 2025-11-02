<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P04 @requirement:REQ-SP2-001 -->
<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P05 update ensures per-call auth/settings/isolation/reset coverage -->
1. Resolve the per-call authentication context from call options and environment fallbacks before touching provider clients.
2. Merge the stateless provider base configuration with per-call overrides to resolve execution settings such as model and base URL.
3. Invoke the provider call entry point with the resolved credentials and settings while guaranteeing concurrent invocations stay isolated.
4. Stream and validate the provider response, tagging logs with the call-scoped metadata to preserve isolation and contract checks.
5. Reset transient overrides, scrub sensitive data, and release resources so the next call starts from a clean baseline.
