# Issue #3803: nightly release preflight failures

## Diagnosis

Release runs 36958700437 (2026-10-02) and 37091360492 (2026-10-03) both fail in `Run Preflight Checks`, specifically `npm run test:ci`. The Oct 3 log reports 13 failures in three CLI test files; the Oct 2 log reports 12 failures in two. The shared failure is `Could not activate explicitly-configured provider 'gemini': Provider 'gemini' not found`, including the installed runtime plugin integration test.

Gemini is provided exclusively by the optional `@vybestack/llxprt-plugin-google-gemini` runtime plugin (#2763). In a source checkout, discovery loads that plugin only when `plugins/google-gemini/node_modules` exists. The release installs root dependencies with `npm ci`, then runs preflight before its later runtime-plugin build/install sequence, so the plugin is absent and provider activation fails. Locally, the current source tree reproduces the same provider-not-found failure in `cli-args.profile-flag.integration.test.ts` when the plugin's local dependencies have not been installed.

## Intended change

Install the Gemini plugin's declared non-peer dependencies using Bun 1.4.2 before preflight. That creates the plugin-local `node_modules` required for checkout discovery and module loading. Do not add the plugin as a CLI dependency: it remains optional for users, and runtime test fixtures already exercise the real plugin-provider contract.

## Verification

- Re-run the CLI profile and runtime-plugin integration tests after plugin dependency installation.
- Run format, lint, typecheck, full tests, build, and the installed `lunahigh` startup smoke test (`bun scripts/start.ts --profile-load lunahigh 'write me a haiku and nothing else'`).
- Inspect release dependency binding, package publish order, runtime plugin packaging, and duplicate-nightly behavior for any further bounded blockers.
- No package or GitHub release was published from this working tree. The `lunahigh` Codex profile smoke test passed and returned a haiku. Format, lint, typecheck, and build passed; focused release, Podman diagnostics, and ProfileSaveStep tests passed. The full test command exited 1 only on the previously recorded #3790 `SessionDiscovery` property-test timeout; the unchanged test files match main exactly. See `tmp/verify3803/final-verification-current/` for raw logs. An external CI run and validation of the real 16-package publish path remain outstanding. The trust read independently requires 2FA; the authorized release OIDC path is available for actual CI validation. This branch does not establish that publishing succeeded. Merging requires Andrew’s explicit direction.
