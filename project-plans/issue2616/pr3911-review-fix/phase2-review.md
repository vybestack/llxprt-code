# Phase 2 review

Scope: commits after `3872f9deb` through `a74449687`, assessed against A3/A7 and Phase 2 tasks. Findings are appended as verified.

## Findings

### 1. Medium: the manager drops per-request headers deadlines

- **Task:** T2.6b (with T2.6a manager forwarding)
- **Commit:** `3083c13a0`; forwarding implementation in `6c65587db`
- **Location:** `packages/providers/src/ProviderManager.ts:517-521`; `packages/providers/src/openai/OpenAIClientFactory.ts:176`
- **Problem:** `fetchWithHeadersTimeout` now communicates the deadline exclusively through the third `NetworkFetch` argument. Every production manager exposes `fetchNetwork(input, init)` and forwards only those two arguments to the bound root fetch. Consequently `openai-headers-timeout-ms` is discarded on both model-list and generation requests; the dispatcher default applies instead. The rewritten factory test passes `owner.fetch` directly through a three-argument test wrapper, bypassing the manager and missing the production failure.
- **Concrete fix:** Forward the third argument through `ProviderManager.fetchNetwork` and represent it in the runtime manager contract wherever callers use that transport. Add a real manager/provider delayed-header test proving a short deadline rejects and a longer deadline succeeds on the same root, including the proxy route.


### 2. Medium: metadata discovery treats the first failed address as authoritative

- **Task:** T2.7b
- **Commit:** `1ddaff9ae`
- **Location:** `plugins/google-gemini/src/gemini/vertexCredentialSource.ts:475-531`, especially `527`
- **Problem:** `probeMetadataBase` resolves `{ present: false }` for DNS/connection failures, 404s and timeouts. `Promise.race(attempts)` therefore lets a fast failed DNS probe cancel a valid IP probe, and vice versa. The installed `gcp-metadata` implementation uses `Promise.any` over the requests, so a failed address does not defeat a successful peer. This prevents metadata ADC authentication on hosts where only one address works. A read-only inline probe against the real selector, with immediate `ENOTFOUND` from the DNS address and a valid IP response delayed 100 ms, returned `NO_ADC_FOUND` with `DNS unavailable` as its cause.
- **Concrete fix:** Select the first successful, flavor-validated probe and declare absence only after every address has failed. Abort and join the remaining probe after a success, preserving owner-abort propagation. Add factory-path cases for fast DNS failure with successful IP and fast IP failure with successful DNS, as well as both absent.


### 3. Medium: environment-file ADC ignores the quota-project override

- **Task:** T2.7a, A7 credential-selection fidelity
- **Commit:** `dff69332d`
- **Location:** `plugins/google-gemini/src/gemini/vertexCredentialSource.ts:668-674`; `plugins/google-gemini/src/gemini/geminiApiClientFactory.ts:120-123`
- **Problem:** `credentialEnvironment.credentialsFile` represents `GOOGLE_APPLICATION_CREDENTIALS`, but this selector branch returns the client without applying `credentialEnvironment.quotaProject`. Only the well-known-file and metadata branches apply it. For environment-file ADC, installed `GoogleAuth.getApplicationDefaultAsync` also calls `#prepareAndCacheClient`, which applies `GOOGLE_CLOUD_QUOTA_PROJECT`. A local comparison using an authorized-user file with `quota_project_id: file-quota` and environment override `env-quota` returned `env-quota` from GoogleAuth and `file-quota` from this selector. The factory consequently sends the wrong `x-goog-user-project`, or omits it if the file contains none. This follows the written A7 decision, but that decision incorrectly excludes environment-file ADC from the override rule; it should not be treated as fidelity to GoogleAuth.
- **Concrete fix:** Apply `withEnvironmentQuotaProject` to the environment-file branch as well. Keep explicit credential JSON distinct, since a cached explicit client does preserve its own quota preference in the library. Add factory-path tests for an environment-file override with and without a file quota project, retaining the explicit HTTP-header precedence tests.


## Summary

- High: 0
- Medium: 3
- Low: 0

Independent checks: `vertex-owner-transport.test.ts` passed 27 tests; `owner-transport-two-roots.behavior.test.ts` passed 13 tests, each in its own Bun process. A local delayed-header reproduction returned `UND_ERR_HEADERS_TIMEOUT` through `OwnedFetch.fetch` but returned `ready` through the real manager with the same 100 ms option and 1500 ms server delay, confirming finding 1. The metadata and quota reproductions described above confirmed findings 2 and 3. No package suites were run, and no source or plan files were edited.

## Follow-up

Verified on 2026-10-24 at `5c0a4b997`, limited to the three findings above and the four-file T2.F5 cleanup. All four items are resolved. No source files were edited.

### 1. Manager per-request headers deadline: resolved

Fix: `5e692b4a3`. `packages/providers/src/ProviderManager.ts:517-521` accepts and forwards the third `NetworkFetch` argument unchanged. `packages/core/src/runtime/contracts/RuntimeProviderManager.ts:90` exposes `fetchNetwork` as `NetworkFetch`, preserving that argument in the runtime contract.

`packages/providers/src/__tests__/manager-headers-timeout.behavior.test.ts:104-160` constructs a real manager, binds the root's fetch, registers a real OpenAI provider and invokes generation through the manager's active provider. Both direct and local-proxy cases reuse the same root for a 100 ms deadline that rejects with `Request timed out.` and a 4000 ms deadline that returns `ready`, against 1500 ms delayed headers. The test does not replace manager forwarding with a test wrapper.

Verification: ran `exec < /dev/null; bun test ./src/__tests__/manager-headers-timeout.behavior.test.ts` from `packages/providers`: **2 pass, 0 fail**, exit 0.

### 2. Metadata discovery race: resolved

Fix: `e1ece5ef8`. `plugins/google-gemini/src/gemini/vertexCredentialSource.ts:475-529` validates the metadata flavor before reporting success. `firstPresentProbe` selects the first present result; absent results decrement the pending count and resolve absence only after every attempt reports absent. Rejections, including owner aborts, propagate rather than being converted into missing credentials. At lines 555-561 the selector aborts the probes in `finally` and awaits `Promise.allSettled(attempts)`, joining the loser before returning or throwing.

The passing `vertex-owner-transport.test.ts` covers fast DNS failure with delayed IP success, fast IP failure with delayed DNS success, both addresses absent, cancellation of a held losing probe, and owner closure during held discovery. The owner-closure case asserts the owner error is retained rather than `NO_ADC_FOUND`. Joining is additionally verified by inspection of the awaited cleanup above.

Verification: ran `bun test ./src/gemini/vertex-owner-transport.test.ts` from `plugins/google-gemini`: **32 pass, 0 fail**, exit 0.

### 3. Environment-file quota project: resolved

Fix: `ae33a1d46`. `plugins/google-gemini/src/gemini/vertexCredentialSource.ts:698-703` applies `withEnvironmentQuotaProject` to the client loaded from `environment.credentialsFile`. The explicit JSON branch at lines 691-696 still returns its client directly, keeping its quota project distinct from the environment override.

The same passing Vertex test run covers environment-file credentials both with and without a file quota project, explicit JSON retaining `explicit-quota` despite `env-quota`, and explicit HTTP quota-header precedence in differing letter cases. These cases assert the outgoing `x-goog-user-project` values.

### 4. T2.F5 dead fetch checks: resolved

Fix: `5c0a4b997`. Inspected all four changes: `CompressionProfileResolver.readRootFetch` still returns the prepared invocation's fetch; the session-child test still retains that fetch; the two-roots test still registers once under `!this.started` and calls `readFetch()`; the admitted-fetch test still exercises the request and rejection after owner closure. Only unreachable undefined branches and redundant local variables were removed. The invocation contracts require `fetch: NetworkFetch`, and `BaseProvider.bindOwnerAuthentication` requires `readFetch: () => NetworkFetch`, so no supported behavior was lost.

Verification: ran `npx eslint --max-warnings 0 packages/agents/src/api/__tests__/owner-transport-session-child.behavior.test.ts packages/agents/src/api/__tests__/owner-transport-two-roots.behavior.test.ts packages/agents/src/core/CompressionProfileResolver.ts packages/providers/src/__tests__/admitted-fetch-normalization.test.ts` from the worktree root: **exit 0**, no warnings or errors. No broader review or package-suite run was performed.
