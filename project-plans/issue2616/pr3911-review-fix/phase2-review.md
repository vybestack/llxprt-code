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
