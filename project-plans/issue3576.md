# Issue 3576 Plan — Add gpt-6-astra (codex OAuth alias + shared OpenAI surfaces)

Generated: 2026-09-05
Branch: `issue3576`
Issue: https://github.com/vybestack/llxprt-code/issues/3576

## Accepted behavior

1. The `codex` provider alias lists `gpt-6-astra` as a static model with
   `contextWindow: 872000` and display name `GPT-6 Astra`.
2. The effective context limit for `codex:gpt-6-astra` resolves to `872000`
   through a per-model `modelDefaults` rule (pattern `^gpt-6-astra`, ephemeral
   `context-limit: 872000`), following the per-model context-limit precedent
   already shipped in the kimi and anthropic alias configs. The provider-level
   `context-limit: 262144` in `codex.config` ephemeralSettings is unchanged, so
   every existing model keeps its current budget (gpt-5.6 tiers stay 262144,
   gpt-5.3-codex-spark stays 131072).
3. Sampling parameters (`temperature`, `top_p`, `top_k`,
   `frequency_penalty`, `presence_penalty`) are stripped for `gpt-6-astra`
   under the codex alias via a `gpt-6` `modelDefaults` rule carrying the same
   `unallowedParameters` list as the existing `gpt-5` rule (Astra is a
   reasoning model; those parameters are not accepted).
4. `defaultModel` stays `gpt-5.6-sol`. Astra's rollout is staged via Trusted
   Access; flipping the default would break sessions on accounts without
   access.
5. On the plain `openai` (API-key) provider, `gpt-6-astra` is classified as
   **Responses-required** on the canonical OpenAI base URL. Sanctioned GPT-6
   identity accepts `gpt-6-astra` plus documented qualifiers (`-latest`,
   compact `YYYYMMDD`, hyphenated `YYYY-MM-DD` snapshots) and rejects
   lookalikes (`gpt-6-astral`, `gpt-6-astra-mini`, `gpt-6-astra-solar`, bare
   `gpt-6`, malformed dates), mirroring the GPT-5.6 identity tests.
6. The project-canonical `reasoning.effort=minimal` maps to wire value `low`
   for sanctioned GPT-6 models — never `none` (Astra's effort floor is `low`;
   it has no `minimal`/`none` level). All other effort values (`low`, `medium`,
   `high`, `xhigh`, `max`) pass through unchanged. The existing
   minimal→`none` mapping for GPT-5.6+ dotted IDs is untouched.
7. The o200k prompt-estimator family claims `gpt-6-astra` (and its sanctioned
   qualifiers) so prompt token estimation works instead of failing with
   `asset-unavailable` (issue #3217 precedent); lookalikes remain unclaimed.
8. OpenAI fallback model lists include `gpt-6-astra`
   (`RESPONSES_API_MODELS.ts`, `openAIFallbackModels.ts`).
9. Docs mention `gpt-6-astra` with the 872000 OAuth context and its effort
   levels: `docs/providers/models-and-limits.md`,
   `docs/providers/quick-reference.md`, `docs/cli/providers.md`.

## Model facts and the OAuth context decision

- Model string: `gpt-6-astra` (identical on the OpenAI API, Amazon Bedrock,
  and the Codex backend). Released 2026-09-03, staged GA (Trusted Access
  first, then Plus/Pro/Business/Enterprise and API).
- API (key auth) window: 1,050,000 total / 922,000 max input / 128,000 max
  output. Efforts: low, medium, high, xhigh, max (API default low). Text +
  image input, text output.
- OAuth (chatgpt.com/backend-api/codex) window: the ChatGPT backend is
  catalog-driven and enforces product caps below the API window. Verified by
  testing in Codex (anomalyco/opencode#46527): 1,000,000-token total context
  on OAuth, leaving an 872,000-token input budget with 128,000 reserved for
  output. openai/codex#39102 raised the GPT-5.6 `max_context_window`
  override ceiling to 872,000 and openai/codex#41325 proved the remote
  catalog clamps larger client-side values server-side. Shipping third-party
  Codex configurations for Astra use `model_context_window = 872000`.
- Decision: `872000` is the default context for `gpt-6-astra` under the codex
  alias. `1,050,000` must NOT be used — that is the API-key window, not the
  OAuth one.

## Changes

### `packages/providers/src/composition/aliases/codex.config`

- `staticModels`: prepend `{ "id": "gpt-6-astra", "name": "GPT-6 Astra",
  "contextWindow": 872000 }`.
- `modelDefaults`: add a `^gpt-6-astra` rule with
  `ephemeralSettings: { "context-limit": 872000 }` and a `gpt-6` rule
  (anchored like the existing `^gpt-` rule for consistency; must match
  `gpt-6-astra` and sanctioned GPT-6 ids but not `gpt-5.6-sol`) with the same
  `unallowedParameters` array as the `gpt-5` rule. Keep existing rules and
  the provider-level `context-limit: 262144` untouched.

### `packages/providers/src/openai/openaiModelPolicy.ts`

- Add a sanctioned GPT-6 identity (e.g. `isSanctionedGpt6Model`): anchored
  `gpt-6-astra` prefix with qualifier validation reusing
  `isValidQualifier`/snapshot-date helpers (bare, `-latest`, compact or
  hyphenated date). `gpt-6-astra` does not parse as `gpt-MAJOR.MINOR`, so
  `parseOpenAIModelTransport` must return
  `{ supportsResponses: true, requiresResponses: true }` for it.
- `toOpenAIResponsesWireEffort`: for sanctioned GPT-6 models, map `minimal` →
  `low`. Keep the GPT-5.6 dotted-family `minimal` → `none` mapping unchanged.
- Do not sanction bare `gpt-6` or any non-astra GPT-6 id.

### `packages/providers/src/tokenizers/ModelPromptEstimatorRegistry.ts` (+ `Gpt56O200kPromptEstimator.ts` if the claim/identity helpers live there)

- The GPT-5.6 o200k registration claims via `isSanctionedGpt56Model`; extend
  the claim and `matches` to also accept sanctioned GPT-6 ids so the same
  o200k estimator family covers `gpt-6-astra`. Preserve the "exactly one
  GPT-5.6 entry, never duplicated" invariant the registry tests assert —
  widen the existing registration rather than adding a second one that would
  double-claim.

### Fallback lists

- `packages/providers/src/openai/RESPONSES_API_MODELS.ts`: add `'gpt-6-astra'`
  at the top of the list.
- `packages/providers/src/openai/openAIFallbackModels.ts`: add
  `{ id: 'gpt-6-astra', name: 'GPT-6 Astra' }` at the top of
  `FALLBACK_MODEL_SPECS`.

### Docs

- `docs/providers/models-and-limits.md`: codex table row/common-models note
  for `gpt-6-astra` (872000 OAuth context).
- `docs/providers/quick-reference.md`: mention `gpt-6-astra` where the codex
  Responses models are listed.
- `docs/cli/providers.md`: quick-reference table mentions the newest codex
  model.

## Test-first sequence and behavioral mapping

All tests are TS/Bun (`bun:test`), co-located, behavioral (no mock theater;
assert real transformations through real code paths). RED must be confirmed
for each new behavior before its implementation.

| # | Failing behavioral test (RED) | Implementation response (GREEN) |
| --- | --- | --- |
| A | `providerAliases.codex.test.ts`: codex config has staticModel `gpt-6-astra` with `contextWindow: 872000`; provider-level ephemeral `context-limit` is still 262144; `defaultModel` is still `gpt-5.6-sol`. | codex.config staticModels entry. |
| B | `providerAliases.codex.test.ts` (or `.factory` sibling): `computeModelDefaults('gpt-6-astra', rules)` yields `context-limit: 872000` and no other model (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.3-codex-spark`) gains a `context-limit` override; sampling params are in the unallowed union for `gpt-6-astra` but rules leave `gpt-5.6-sol` behavior identical. | modelDefaults `^gpt-6-astra` context-limit rule + `gpt-6` unallowedParameters rule. |
| C | `providerAliases.codex.factory.test.ts`: alias factory `getModels()` returns the new static model id in order; effective context resolution for the alias produces 872000 for astra while the existing 262144 spark/tier assertions still pass. | staticModels flows through the alias factory unchanged. |
| D | `openaiModelPolicy.test.ts`: `parseOpenAIModelTransport('gpt-6-astra')` → requires Responses; sanctioned qualifiers (`-latest`, both date shapes) accepted; lookalikes (`gpt-6-astral`, `gpt-6-astra-mini`, `gpt-6-astra-solar`, `gpt-6`, bad dates) rejected. | Sanctioned GPT-6 identity in `openaiModelPolicy.ts`. |
| E | `openaiModelPolicy.test.ts` (+ `OpenAIResponsesProvider.reasoningEffort.test.ts` where the wire mapping is exercised): `toOpenAIResponsesWireEffort('minimal', 'gpt-6-astra')` → `'low'`; `'medium'/'high'/'xhigh'/'max'` pass through; `('minimal', 'gpt-5.6-sol')` still → `'none'`. | GPT-6 branch in `toOpenAIResponsesWireEffort`. |
| F | Estimator registry test (extend `Gpt56O200kPromptEstimator.test.ts`): registry claims `gpt-6-astra` (+ qualifiers) with the o200k family and `estimatePrompt` counts through the real estimator for `gpt-6-astra`; lookalikes stay unclaimed. | Widened o200k registration claim/matches. |
| G | Fallback-list tests: `RESPONSES_API_MODELS` contains `gpt-6-astra`; `getOpenAIFallbackModels('x')` includes it (extend the existing model-list tests rather than adding new files where neighbors exist). | Fallback list additions. |
| H | Effective-limit integration: extend the context-limit/effective-limit tests to prove `codex:gpt-6-astra` resolves to 872000 with the modelDefaults rule applied, while `codex:gpt-5.6-sol` still resolves to 262144. | No new production code — proves the config wiring end-to-end. |

## Verification

- Per-file targeted runs for every touched test file (each in its own Bun
  process, matching the repo runner design), repeated runs for the alias
  config tests.
- Full cycle on the final tree:
  `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
  `npm run build`, then
  `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
- 2026-09-06 post-crash cycle results: test/lint/typecheck/format/build all
  ran; see the environment-failure record below for the test exceptions.
  The smoke test is currently BLOCKED by sandbox host infrastructure, not
  code: the host-side credential proxy died with the crash
  (`/tmp/llxprt-credential.sock` is a stale socket — connect fails with
  "No such device or address"), so `auth-key-name 'stepfun'` cannot resolve.
  The identical failure occurs on the `main` worktree, and
  `bun scripts/start.ts --version` boots cleanly (0.11.0) on this branch, so
  startup, config validation, and profile load all work; only the
  credential-dependent API round-trip is impossible until the host proxy is
  restored. Additionally, the first smoke attempt failed on
  `Unrecognized key(s) in object: 'logConversations'` because a full-suite
  CLI test had written `{"telemetry":{"logConversations":true}}` into the
  real user-global settings.json (written 15:50 during the test phase),
  and the settings-package startup validation rejects a key that core's
  TelemetrySettings defines — both trees fail identically on that too; the
  local settings file was reset to `{}` to unblock. Follow-up issues filed
  for the schema drift and the test pollution.
- `bun scripts/test-audit/scan.ts` self-check on touched test files: no new
  MOCK_MIRROR / ALWAYS_TRUE / SELF_CONFIRMING / NO_ASSERT findings versus a
  main-baseline scan diff.
- Pre-existing known flakes are not ours: darwin-only
  `sandbox-seatbelt.test.ts` port-contention flake (#3548) and the
  in-process interference between `providerAliases.mediaSupport.test.ts` and
  `providerAliases.unallowedParameters.test.ts` (run per-file). Anything else
  red must be reproduced and fixed, never assumed unrelated.

### Local sandbox environment failures (2026-09-06 full-cycle, proven pre-existing on main)

The post-crash full `npm run test` run had failures beyond the known flakes.
Each was reproduced on a clean `main` worktree (`tmp/main3576`, own `bun
install`) in this same sandbox and failed identically there, so none are
caused by this branch:

- `packages/storage/src/secure-store/secure-store.native-keyring.test.ts` —
  requires a real OS keyring; this sandbox has none
  (`SecureStoreError: Platform failure: Unknown(38)`). CI runs it only on
  Ubuntu with a keyring backend installed
  (`packages/storage` `test:secure-store:keyring` + nightly.yml).
- `packages/providers/src/auth/` 8 files (4 behavioral specs,
  `oauthManager.proactive-renewal`, 2 proactive-renewal specs,
  `proxy/factory-detection-wiring`) — pass per-file in isolation on both
  trees; fail inside the full providers suite run on BOTH branch and main
  with identical signatures (proactive-renewal timer spies never called).
  Main's full providers run failed exactly the same 8 files.
- `packages/cli`: `docsCommand.test.ts` (sandbox detection changes the
  info message; test asserts the non-sandbox text), `Footer.responsive`
  (2), `sandbox-node-modules-preflight` (1), `cli-args.integration` (2) —
  each fails identically on main in isolation in this sandbox.
- `packages/vscode-ide-companion` — Bun 1.3.14 internal error ("directory
  mismatch for tsconfig.bun-test.json ... indicates a bug"); 0 test
  failures. Tooling, not code.

All branch-owned test files (codex alias, factory, policy, estimator,
unallowedParameters, contextLimit integration, oauthRegistration,
runtimeFactories, executor suites) passed in the full run. Evidence logs:
`tmp/verify3576/` (test.log, main-providers-suite.log, per-file
branch-/main-*.log).

## Review record and remediation (2026-09-06)

Deepthinker review round 1 found one HIGH and two MEDIUM issues; all three
were remediated and verified with targeted per-file test runs:

1. HIGH — the `unallowedParameters` alias rule was enforced only in the UI
   layer (`runtimeAccessors.ts` model-config dialog path); the codex
   Responses executor forwarded `temperature` and the other sampling keys on
   the wire. Fix: `applyCodexRequestSettings` in
   `openAIResponsesExecutor.ts` strips request keys via an injected
   `getUnallowedModelParameters(model)` resolver; the alias factory passes
   the entry's `modelDefaults` rules into `OpenAIProvider` and
   `OpenAIResponsesProvider` constructors, which capture the rules once at
   construction (no per-request alias-file reload; the initial draft called
   `loadProviderAliasEntries()` per request and was corrected before
   commit). Plain (non-alias) providers get an empty rule set, so canonical
   OpenAI behavior is unchanged; a mirror test asserts sampling parameters
   survive on plain OpenAI.
2. MEDIUM — the runtime tokenizer factory restricted o200k prepare/select to
   `isSanctionedGpt56Model`, so `gpt-6-astra` fell through to the
   OpenAITokenizer adapter with a silent char-based fallback. Fix: shared
   `isSanctionedOpenAIO200kModel` (= GPT-5.6 or GPT-6 sanctioned identity)
   used by both the factory and the estimator registry; the registry keeps a
   single widened o200k registration (no duplicate GPT-5.6 entry).
3. MEDIUM — effective-context coverage was config-level only. Fix:
   `providerAliases.codex.contextLimit.integration.test.ts` drives the live
   provider-switch path and asserts 872000 (astra) vs 262144 (sol) vs 131072
   (spark, now pinned by an explicit `^gpt-5\.3-codex-spark$` context-limit
   rule); `providerManagerRuntimeFactories.test.ts` gained factory-level
   coverage.

Post-remediation machine cycle found and fixed three mechanical issues:
constructor-arity assertions in `providerManagerInstance.oauthRegistration.test.ts`
(4th/5th constructor args), two TS2345 type errors in the new test files
(bun test does not typecheck), and two `max-lines` violations resolved by
extracting the duplicated resolver closure into
`openai-responses/unallowedModelParameters.ts`.

## Out of scope / follow-ups

- Flipping `defaultModel` to `gpt-6-astra` once rollout is generally
  available.
- Long-context surcharge/pricing metadata beyond context length.
- Astra Pro variants (`gpt-6-astra-pro`) — no sanctioned id yet; deliberately
  rejected as lookalikes for now.
- Experimental cross-window context management (Codex `context_management`
  feature) — client-side opt-in, server-driven; nothing to configure here.
