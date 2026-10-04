# Issue #3803: nightly release preflight failures

## Diagnosis

Release runs 36958700437 (2026-10-02) and 37091360492 (2026-10-03) both fail in `Run Preflight Checks`, specifically `npm run test:ci`. The Oct 3 log reports 13 failures in three CLI test files; the Oct 2 log reports 12 failures in two. The shared failure is `Could not activate explicitly-configured provider 'gemini': Provider 'gemini' not found`, including the installed runtime plugin integration test.

Gemini is provided exclusively by the optional `@vybestack/llxprt-plugin-google-gemini` runtime plugin (#2763). In a source checkout, discovery loads that plugin only when `plugins/google-gemini/node_modules` exists. The release installs root dependencies with `npm ci`, then runs preflight before its later runtime-plugin build/install sequence, so the plugin is absent and provider activation fails. Locally, the current source tree reproduces the same provider-not-found failure in `cli-args.profile-flag.integration.test.ts` when the plugin's local dependencies have not been installed.

## Intended change

Install the Gemini plugin's declared non-peer dependencies using Bun 1.4.2 before preflight. That creates the plugin-local `node_modules` required for checkout discovery and module loading. Do not add the plugin as a CLI dependency: it remains optional for users, and runtime test fixtures already exercise the real plugin-provider contract.

The release workflow also needs to run both integration coverage and release-note generation against the pinned local Ollama 0.31.1 / Gemma 4 E2B model used by E2E. The release setup verifies the runtime archive SHA-256, exact model digest, Intel Haswell selection while leaving AMD variants untouched, and successful CPU-only inference. All integration files continue to run with no E2E exclusions or test-name filters. Provider settings are explicit local OpenAI-compatible endpoint values; the quota-selected API key is removed. The E2E `LLXPRT_LOCAL_MODEL_E2E` switch must not be enabled for release integrations because it changes the harness timeout settings. Preserve npm OIDC, package provenance, Azure and container authentication, and release inventory checks.

## Verification

The local checks completed with these exit codes: format 0, lint 0, typecheck 0, full test suite 0, build 0, and the `lunahigh` startup smoke 0. The full run reported 9,843 passing cases, zero failures, five skipped cases and 13 todo cases. Focused release and local-model workflow tests reported 50 pass, one platform skip and zero failures. The E2E CPU-backend live `/proc` case skips on macOS by its existing platform condition. Logs are in `tmp/verify3803/local-release-migration/`.

No package or GitHub release was published from this working tree. The workflow source and behavior fixtures establish local model wiring, archive and model digest checks, CPU variant policy, inference response validation, full integration invocation, and budget-step retention. Linux runner inference and publication were not run locally. External CI on this candidate and the real 16-package release path remain unverified. The earlier nightly run failed its integration tests on the paid-provider 429; this change removes that provider dependency. Merging requires Andrew’s explicit direction.
