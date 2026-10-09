# Gemini registration and Luna smoke are fixed; prereview quality remains failed

October 1, 2026. Branch `issue3781`, uncommitted. The user authorized this
follow-up to resolve the 12 integration failures tracked by #3784 and select
an existing Luna profile. Evidence is retained in `tmp/verify3781-gemini-fix/`.
No OCR, independent review, model-quality experiment, commit, push, PR,
Actions dispatch or merge was performed. The cause, fix and completed checks
were posted to [#3784](https://github.com/vybestack/llxprt-code/issues/3784#issuecomment-5925469569)
under the verified `acoliver` identity.

## Cause and correction

Gemini is supplied by `@vybestack/llxprt-plugin-google-gemini`, outside the root
workspaces. The base provider registry intentionally does not include it.
Root installation and builds leave optional plugin dependencies uninstalled.
This checkout had no `plugins/google-gemini/node_modules`.

`packages/providers/src/composition/runtimePlugins/discoverRuntimePlugins.ts`
requires a checkout plugin to declare its marker and have its own
`node_modules` before returning its source entry. Consequently the startup
loader had no Gemini contribution. `cliSessionBootstrap.ts` passes the loaded
registry through profile bootstrap and the post-Config runtime assembly;
`createProviderManager()` then correctly rejects an explicitly selected but
unregistered provider. Neither `NODE_ENV=production` in the subprocess helper
nor a successful root build can supply an uninstalled plugin.

The existing CI test job already installs plugin dependencies with Bun 1.4.2
and `--omit=peer`. Local verification had omitted this prerequisite, including
in the retained pristine-main reproduction. The fix was a plugin-local
`bun install --omit=peer` using a workspace-local Bun 1.4.2 executable. Both
installer exits were 0. The CLI and test runtime remain Bun 1.3.14. The plugin
lockfile, root lockfiles, package declarations and provider production sources
are unchanged. No provider shim, automatic hosted fallback or mandatory
Gemini dependency was added.

`CONTRIBUTING.md` now documents that test setup and explicit relative test
paths. `plugins/google-gemini/README.md` no longer describes the extracted
provider as a placeholder or claims it remains built into the base CLI.

## Test-first evidence

The exact original suites were run before installing plugin dependencies:

| Suite | Before | After |
| --- | --- | --- |
| `cli-args.integration.test.ts` | 11 pass, 9 fail; exit 1 | 20 pass, 0 fail; exit 0 |
| `cli-args.profile-flag.integration.test.ts` | 8 pass, 3 fail; exit 1 | 11 pass, 0 fail; exit 0 |
| New `cli-plugin-provider.integration.test.ts` | 0 pass, 1 fail; exit 1 | 1 pass, 0 fail; exit 0 |

The original suites and all their assertions are unchanged. Logs use
`red-exact-*`, `green-*`, and `green-plugin-provider-http-final.log`. An initial
bare-path invocation also matched the retained pristine-main copies; those
logs are retained separately as `red-*` and are not used for the exact counts.
No retained worktree or evidence was removed.

The new Bun test runs the real CLI with `--provider gemini`, `--model`,
`--keyfile` and `--baseurl`. A local HTTP server returns an invalid-key 401.
The test requires the actual server to receive a request for
`/models/gemini-2.5-flash:...` and the CLI to report the configured endpoint in
its provider request error. This verifies discovery, registry threading,
explicit provider activation, model routing and endpoint precedence without
a live Gemini key or mocked provider. Before setup it failed at registration;
after setup it reached the HTTP fixture.

Nine related discovery, plugin-loader, alias-composition, runtime-wiring,
provider-switching, endpoint and Gemini behavioral suites passed 144 tests
with 0 failures and individual exit codes 0. `related-status.txt` and
`related-summary.json` contain the inventory. The AST audit exited 0 and
reported no finding on the new test.

## Existing Luna profile

The existing profile `gpt-6-luna.json` declares provider `codex` and model
`gpt-6-luna`; it has a context-limit setting and no review/high-reasoning or
localhost override. It is the ordinary Luna profile. `lunahigh` selects
`gpt-5.6-luna` with high reasoning; `praxis-luna` selects that older model at a
localhost endpoint; `gpt6luna-review` adds review-oriented reasoning settings
to `gpt-6-luna`. The credential-free inventory is `profile-inventory.json`.
No user profile or configuration was created or edited.

The command is:

```bash
bun scripts/start.ts --profile-load gpt-6-luna "write me a haiku and nothing else"
```

The completed-cycle smoke exited 0 and produced:

```text
[gpt-6-luna:gpt-6-luna]
Soft rain taps the leaves
Moonlight pools along the path
Night holds its breath still
```

The actual output is retained in `smoke-complete.log`. Earlier successful
smokes and their responses remain in the same evidence directory.

## Full verification

The complete full cycle on the final HTTP-fixture source passed every required
command. `complete-status.txt` contains the actual subprocess exit codes;
`verification-gemini-fix.json` is the durable check manifest.

| Check | Exit | Evidence |
| --- | --- | --- |
| `npm run format` | 0 | `format-complete.log` |
| `npm run lint` | 0 | `lint-complete.log` |
| `npm run typecheck` | 0 | `typecheck-complete.log` |
| `npm run test` | 0 | `test-complete.log` |
| `npm run build` | 0 | `build-complete.log` |
| Corrected Luna smoke | 0 | `smoke-complete.log` |
| Final AST audit | 0 | `test-audit-complete.log` |

The final full package run passed all 765 CLI files with 9812 passing cases,
0 failures, 5 existing skips and 13 existing todo cases. No test was newly
skipped or disabled. The first full package run also passed before the fixture
implementation was refined. Initial format, lint, build and smoke exited 0.
Initial full typecheck
exited 2 because the CLI's no-emit configuration does not expose Bun as an
ambient global in the new test. An explicit `bun` server import then polluted
the CLI compilation with Bun's global fetch augmentation, causing type and
lint failures in otherwise unchanged source. These intermediate failures are
retained in `typecheck.log`, `typecheck-final.log` and `lint-final.log`.

The final Bun regression uses the existing `node:http` infrastructure API,
without importing Bun's server types or changing compiler settings. Its real
request assertions are unchanged. The full CLI no-emit project and scoped lint
now exit 0. A fixture cleanup failure was corrected by closing the listening
server once, rather than calling `closeAllConnections()` first. The final
fixture passes 1 test with 4 assertions. The completed full cycle and audit
cover this final source. There is no remaining format, lint, type, package-test,
build, registration or smoke failure.

## Preserved state and remaining acceptance

The prior F3 source/test hashes and retained independent follow-up report
match `verification-final-reference.json`. `preserved-source.json` records the
comparison. `.llxprt`, provider production sources, root/plugin manifests and
lockfiles, the original two integration suites and their subprocess helper
have no diff. No enforcement or threshold was changed.

This task resolves registration/test-setup and smoke-name failures. The
separate local-prereview quality verdict remains FAILED and acceptance stays
NOT READY. No trusted Linux Actions prereview proves setup, CPU residency,
useful complete output, publication and owned cleanup together. The manual
pilot remains separate from automatic production. No new model experiment or
production promotion was performed.
