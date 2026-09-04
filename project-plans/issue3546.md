# Issue 3546 Plan

## Accepted behavior

1. Under auth-only mode, no OpenAI-protocol alias provider (openai,
   openai-responses, openai-vercel) may receive an API key resolved from its
   alias `apiKeyEnv` environment variable. Explicit keys resolved upstream
   (ephemeral `auth-key`, provider settings `auth-key` passed as the
   `openaiApiKey` parameter) still flow through unchanged.
2. Alias entries load in a deterministic alphabetical order within each alias
   directory. The user directory still precedes the builtin directory; only
   the order inside each directory becomes deterministic.
3. The sandbox dependency preflight walks protected trees in deterministic
   alphabetical order, so the first-reported wrong-platform violation is the
   lexicographically-first path regardless of the filesystem's readdir order.

## Root cause

The v0.11.0 release preflight (run 33818422940) failed with two
filesystem-order-dependent tests that pass on macOS dev machines:

1. `providerManagerInstance.oauthRegistration.test.ts` — "ignores API keys
   when authOnly is enabled" asserted `openaiResponsesCtor.mock.calls[0][0]`
   is `undefined`. `readAliasDirectoryFiles()` returned raw
   `fs.readdirSync(dirPath)` without sorting, so alias registration order
   depended on readdir order. On Linux runners `openai-responses.config`
   (which declares `apiKeyEnv: OPENAI_API_KEY`) could be constructed before
   `codex.config` (no `apiKeyEnv`). `createOpenAIResponsesAliasProvider`
   read `entry.config.apiKeyEnv` from `process.env` with no auth-only gate,
   so the openai-responses alias received `sk-test-openai` under
   `authOnly=true`. `createAnthropicAliasProvider` already gated its env read
   on `!authOnlyEnabled`; the three OpenAI factories and
   `registerAliasProviders` did not thread the flag to them.
2. `sandbox-node-modules-preflight.test.ts` — "fails on a symlinked .node
   file through its contained target" created
   `node_modules/store/real-addon.node` (real ELF bytes) and
   `node_modules/pkg/addon.node` (symlink to it). `preflightProtectedTree`
   iterated `fs.readdirSync(dir, { withFileTypes: true })` unsorted, so
   whichever entry the filesystem returned first produced the fatal error.
   On Linux CI the real target (`store/...`) was reported first while the
   test asserted the symlink path (`pkg/addon.node`).

## Fixes

### Fix A — authOnly gating in OpenAI alias factories (correctness)

`registerAliasProviders` already received `authOnlyEnabled` but only passed
it to `createAnthropicAliasProvider`. It now threads the flag into
`createOpenAIAliasProvider`, `createOpenAIResponsesAliasProvider`, and
`createOpenAIVercelAliasProvider` (new optional trailing parameter,
default `false`). Each factory gates its direct
`entry.config.apiKeyEnv` env read on `!authOnlyEnabled`, exactly mirroring
the anthropic factory's pattern. The upstream-resolved `openaiApiKey`
parameter is untouched: explicit keys still pass through.
`refreshAliasProviders` already passes `context.authOnlyEnabled` and needed
no change. `createGeminiAliasProvider` gained the identical gate (optional
trailing `authOnlyEnabled = false` parameter, env read gated on
`!authOnlyEnabled`): the shipped `gemini.config` declares
`apiKeyEnv: GEMINI_API_KEY`, so without the gate the same leak existed for
`GEMINI_API_KEY` under auth-only mode.

### Fix B — deterministic alias load order

`readAliasDirectoryFiles()` in `providerAliases.ts` now returns
`fs.readdirSync(dirPath).sort()`. Directory precedence (user before builtin)
is unchanged; only the order within each directory is now alphabetical and
identical across platforms.

### Fix C — deterministic sandbox preflight walk

The `preflightProtectedTree` walk in `sandbox-binary-preflight.ts` sorts
directory entries by name (code-unit comparator on `Dirent.name`) before
iterating, so the first-reported violation is the lexicographically-first
path. Skip rules (prebuilds directories, `.bin` handling, symlink
resolution) are unchanged.

## Test-first sequence and behavioral mapping

| Evidence | Failing behavioral test | Implementation response |
| --- | --- | --- |
| A | `aliasProviderFactory.authOnly.test.ts`: for each of the three OpenAI factories, with `authOnlyEnabled=true` and the alias's `apiKeyEnv` env var set, the constructed provider's stored API key is `undefined`; with `authOnlyEnabled=false` the env key is stored; an explicitly resolved upstream key still passes through under authOnly. | Gate the `apiKeyEnv` env read on `!authOnlyEnabled` in each factory (Fix A). |
| B | `providerManagerInstance.oauthRegistration.test.ts` test 2 now asserts EVERY constructor call of all five aliased providers (openai, openai-responses, openai-vercel, anthropic, gemini — fixture sets `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`) receives `undefined` as first arg under authOnly — order-independent, matching the test's stated intent. The gemini assertion was confirmed RED pre-gate (`Received: 'sk-test-gemini'`). | Same fix (incl. gemini gate); also proves the CI failure mode (whichever alias registers first no longer leaks an env key). |
| C | `providerAliases.loadOrder.test.ts`: user entries load sorted regardless of readdir order (readdir mocked to a non-sorted order), user directory still precedes builtin, builtin entries load in sorted order by file basename. | Sort the readdir result in `readAliasDirectoryFiles` (Fix B). |
| D | `sandbox-node-modules-preflight.test.ts` new test: two ELF `.node` violations in sibling directories (`alpha-pkg`, `zeta-pkg`) with readdir order reversed; the reported path is `node_modules/alpha-pkg/z-addon.node` and never `zeta-pkg`. | Sort walk entries by name (Fix C). |

RED was confirmed for each: the authOnly tests failed pre-Fix-A (factories
received the env key), the loadOrder sort assertions failed with the sort
removed, and the preflight sibling test reported `zeta-pkg` first pre-Fix-C.
All pass GREEN after each fix.

## Verification

Per the repo runner design (`scripts/run_bun_tests.ts`), each test file runs
in its own isolated Bun process — Bun's module mocks are process-wide. All
targeted verification therefore uses standalone per-file runs (combined
in-process runs are not a CI-representative form):

- `aliasProviderFactory.authOnly.test.ts`: 9/9 pass, 5 consecutive runs.
- `providerAliases.loadOrder.test.ts`: 3/3 pass, 5 consecutive runs.
- `providerManagerInstance.oauthRegistration.test.ts`: 3/3 pass, 5
  consecutive runs.
- `sandbox-node-modules-preflight.test.ts`: 33/33 pass (including the
  existing symlink test), 5 consecutive runs.
- Neighbor alias test files (`claudecode.factory`, `codex.factory`,
  `mediaSupport`, `unallowedParameters`, `modelDefaults`) each pass
  individually.
- Full cycle on the final tree (logs under `tmp/releasefix/`):
  `npm run test` — CLI workspace 737/738 files green; the single failure is
  `src/utils/sandbox-seatbelt.test.ts`, a pre-existing darwin-only
  port-contention flake (passes 47/47 standalone; a controlled
  two-concurrent-instance probe reproduces the failure; the suite cases skip
  on the ubuntu CI/release runner) filed as #3548 and unrelated to this
  change. `npm run typecheck` — exit 0. `npm run lint` — exit 0.
  `npm run format` + `npm run format:check` — exit 0. `npm run build` —
  exit 0. Smoke: `bun scripts/start.ts --profile-load stepfun-37` — exit 0
  with a model-composed haiku.

Note: a pre-existing in-process interference exists between
`providerAliases.mediaSupport.test.ts` and
`providerAliases.unallowedParameters.test.ts` when both run in a single Bun
process (two of the latter's warn-spy assertions fail). Verified via
`git stash` that this pair interference predates this change and cannot
occur under the repo runner, which isolates files.