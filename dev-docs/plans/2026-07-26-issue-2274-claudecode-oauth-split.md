# Issue #2274 — Split Claude Code OAuth from Anthropic API-key access

This plan applies the bounded issue-delivery requirements supplied with issue
#2274. The referenced `dev-docs/workflow/ISSUE-DELIVERY.md` is not present on
the candidate base (`8cc033748`), in repository history, or at that path on
GitHub; the issue's explicit acceptance/scope policy is therefore the governing
policy for this effort.

## Problem

The `anthropic` identity currently combines two authentication products:
Anthropic API keys and Claude.ai subscription OAuth. Its model-listing behavior
branches on OAuth state/token shape, while the analogous OpenAI architecture
separates the subscription identity (`codex`, static configured models) from
the API-key identity (`openai`, dynamic models).

## Decision summary

- Add `claudecode` as the Claude.ai subscription identity and provider alias.
- Keep `anthropic` as the Anthropic API-key identity.
- Bind OAuth and token storage to the exact `claudecode` identity, not the API
  hostname or the `anthropic` base-provider implementation name.
- Keep `/auth` an OAuth-only command. `/auth anthropic` will return a targeted
  redirect explaining that Claude subscription users must use
  `/auth claudecode` and API-key users must select `/provider anthropic` and
  configure `/key` or `/keyfile`. Adding API-key entry to `/auth` is not part of
  this issue.
- Move the subscription model catalog into `claudecode.config.staticModels`.
  Remove both `claude-opus-4-1` entries from hardcoded catalogs, retain
  `claude-sonnet-4-20250514`, and retain the already-present
  `claude-fable-5`.
- Reuse the existing Anthropic protocol/device-flow implementation; do not add
  a new public protocol abstraction.

## Acceptance matrix

| ID  | Accepted behavior                                                                                                                                                                                                    | Behavioral evidence                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Built-in provider alias `claudecode` resolves to base provider `anthropic` at `https://api.anthropic.com`.                                                                                                           | Alias-loader/factory test reads the real config and instantiates the alias with name `claudecode` and Anthropic tool format.                                                                |
| A2  | `claudecode` exposes a config-owned static subscription model list rather than calling Anthropic `/models`.                                                                                                          | Factory behavior test observes `getModels()` results from `staticModels`; config test/assertions cover catalog identity and defaults.                                                       |
| A3  | The static catalog retains the current subscription models except retired Opus 4.1 entries; it includes `claude-sonnet-4-20250514` and `claude-fable-5`.                                                             | Real-config behavioral assertions inspect model IDs and model geometry.                                                                                                                     |
| A4  | OAuth registration, enablement, login, token lookup, refresh, logout, and browser-profile association use identity key `claudecode`. `anthropic` is not a registered OAuth identity.                                 | OAuth-provider and standard-registration tests assert provider name/key and supported-provider list. Existing provider-flow tests are updated to the new identity.                          |
| A5  | `/auth claudecode` uses the normal OAuth command path.                                                                                                                                                               | Auth command behavior tests execute status/enable/login/logout operations for `claudecode`.                                                                                                 |
| A6  | `/auth anthropic` no longer initiates OAuth and gives an actionable split message: use `/auth claudecode` for subscription OAuth or `/provider anthropic` plus `/key`/`/keyfile` for API-key access.                 | Auth command behavior test invokes `/auth anthropic` and asserts the redirect without calling OAuth manager operations.                                                                     |
| A7  | The `anthropic` alias remains API-key-capable and has no configured OAuth identity.                                                                                                                                  | Alias/provider behavior test inspects binding and exercises API-key-backed model listing.                                                                                                   |
| A8  | `AnthropicProvider.getModels()` has no OAuth/static-catalog branch: with an API key it dynamically enumerates the Anthropic models endpoint; with no credential it preserves the existing default fallback behavior. | Provider behavioral tests use the real provider with network infrastructure stubbed, asserting dynamic response mapping/pagination and no-auth fallback. OAuth-list assertions are removed. |
| A9  | `OAUTH_MODELS` is deleted from TypeScript; there are no production or test imports/references.                                                                                                                       | Typecheck/build plus repository search; model-data tests cover only remaining model utilities/default fallback data.                                                                        |
| A10 | Existing `anthropic` OAuth token keys are not copied, renamed, or migrated. Users authenticate again under `claudecode`.                                                                                             | Diff/source review confirms no migration path; OAuth tests seed/read only the `claudecode` key.                                                                                             |
| A11 | User-facing OAuth provider choices and focused provider documentation identify Claude Code OAuth separately from Anthropic API keys.                                                                                 | Component/command tests plus documentation review cover the exact command paths.                                                                                                            |

## Explicit non-goals

- No migration, fallback read, copy, or rename of stored `anthropic` OAuth
  tokens or OAuth-enabled settings.
- No codex base-URL-sniffing retrofit or other codex refactor.
- No API-key capture or storage feature inside the OAuth-only `/auth` command.
- No redesign of alias composition, OAuth manager interfaces, provider registry,
  token store, device flow, or authentication precedence.
- No provider-wide model-currency project beyond the issue-named Opus 4.1,
  Sonnet 4 snapshot, and Fable 5 decisions.
- No unrelated test moves, test framework changes, workflow changes, dependency
  changes, quality-tool changes, lint/complexity changes, or agent-memory
  changes.
- No optional hardening, broad terminology sweep, or unrelated documentation
  cleanup after accepted behavior and gates pass.

## Bounded vertical slices

1. **Alias catalog slice** — add failing real-config/factory tests, add
   `claudecode.config`, and teach the existing Anthropic alias factory to apply
   `staticModels` and the exact alias OAuth identity.
2. **OAuth identity slice** — update failing registration/provider-flow tests,
   make the Anthropic device-flow provider expose/store `claudecode`, register
   `claudecode`, and remove `anthropic` from standard OAuth registration.
3. **Model-list split slice** — change OAuth-list tests first, move the catalog
   to config, delete `OAUTH_MODELS`, and reduce `getModels()` to the API-key
   dynamic path plus existing unauthenticated fallback.
4. **Command/UI slice** — add failing `/auth` and OAuth-choice tests, route
   `claudecode` normally, add the targeted `anthropic` redirect, and update
   bounded provider-facing labels/help.
5. **Documentation/verification slice** — update focused setup documentation,
   run targeted tests, full required verification, review, and scope audit.

Each production change must follow RED → GREEN → focused refactor. Tests must
exercise real alias/provider/command behavior; network/browser/token-store
infrastructure may be stubbed, but the component under test may not be mocked.

## Expected execution paths

### Claude Code subscription

`/auth claudecode enable` → `OAuthManager` provider registry identity
`claudecode` → Anthropic device flow → token store key `claudecode` →
`/provider claudecode` → alias factory creates `AnthropicProvider` bound to
identity `claudecode` → alias `staticModels` supplies model choices → prompt
execution resolves the `claudecode` OAuth token and sends Anthropic-format
requests to `https://api.anthropic.com`.

### Anthropic API key

`/provider anthropic` → `/key` or `/keyfile`/`ANTHROPIC_API_KEY` → alias factory
creates `AnthropicProvider` without an OAuth identity → `getModels()` calls the
Anthropic dynamic models endpoint → prompt execution uses API-key SDK auth.

### Misrouted authentication command

`/auth anthropic` → command-level targeted error/redirect → no OAuth-manager
state change and no token migration.

## Expected path ledger

The implementation is expected to stay within these paths. A path may be
removed from the final ledger if source inspection proves no change is needed;
adding an unlisted subsystem requires approval.

| Path or bounded area                                                                     | Planned change                                                                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `dev-docs/plans/2026-07-26-issue-2274-claudecode-oauth-split.md`                         | Acceptance/scope ledger and final evidence.                                                                  |
| `packages/providers/src/composition/aliases/claudecode.config`                           | New OAuth alias and static model catalog.                                                                    |
| `packages/providers/src/composition/aliasProviderFactory.ts`                             | Apply Anthropic-alias static models and exact identity binding.                                              |
| `packages/providers/src/composition/providerAliases.*claudecode*.test.ts`                | Real alias/config behavior evidence.                                                                         |
| `packages/providers/src/composition/oauth-provider-registration.ts` and focused test     | Standard identity registration.                                                                              |
| `packages/providers/src/auth/anthropic-oauth-provider.ts` and its existing focused tests | Reidentify the existing Anthropic device-flow implementation as `claudecode`; no second flow implementation. |
| `packages/providers/src/auth/index.ts`                                                   | Export the renamed identity provider if needed by current public wiring/tests.                               |
| `packages/providers/src/auth/provider-usage-info.ts` and focused test if required        | Read usage credentials from `claudecode` identity without redesigning quota APIs.                            |
| `packages/providers/src/anthropic/AnthropicProvider.ts`                                  | Dynamic-only `getModels()` and correct alias auth identity behavior.                                         |
| `packages/providers/src/anthropic/AnthropicModelData.ts`                                 | Delete `OAUTH_MODELS`; remove retired Opus 4.1 fallback entry.                                               |
| `packages/providers/src/anthropic/AnthropicModelData.test.ts`                            | Remaining model-data behavior.                                                                               |
| `packages/providers/src/anthropic/AnthropicProvider.getModels.test.ts`                   | Dynamic and unauthenticated model-list behavior.                                                             |
| `packages/providers/src/anthropic/AnthropicProvider.issue276.test.ts`                    | Remove obsolete OAuth-catalog expectations while preserving applicable regression behavior.                  |
| `packages/cli/src/ui/commands/authCommand.ts` and focused tests                          | Claude Code OAuth path and Anthropic split redirect.                                                         |
| `packages/cli/src/ui/components/AuthDialog.tsx` and focused test                         | OAuth choice uses `claudecode`.                                                                              |
| `packages/cli/src/ui/components/ProfileCreateWizard/constants.ts`                        | Expose the new alias with OAuth support if this list is authoritative.                                       |
| `packages/cli/src/ui/commands/{logoutCommand,quotaCommand,statsCommand}.ts`              | Bounded OAuth identity/help labels only where behavior requires it.                                          |
| `packages/cli/{test-setup-base.ts,bun-test-setup.ts}`                                    | Add the alias only if the CLI's established alias mock requires it for tests.                                |
| `packages/cli/vitest.test-groups.ts`                                                     | Advance the exact test-file manifest for the new collected AuthDialog behavior test.                         |
| `docs/providers/quick-reference.md`                                                      | Separate Claude Code OAuth from Anthropic API-key instructions.                                              |

Initial estimate: no more than 25 changed files and well below 1,500 net changed
lines. The static config moves existing data and should keep net growth modest.
If implementation reaches more than 25 files or 1,500 net lines, perform and
record a mandatory scope review before continuing. Stop for approval before
exceeding 40 files or 2,500 net lines.

## Scope ledger

| Entry                                           | Classification                                 | Status   |
| ----------------------------------------------- | ---------------------------------------------- | -------- |
| `claudecode` alias + static model catalog       | In scope                                       | Done     |
| Exact-name OAuth registration/token identity    | In scope                                       | Done     |
| `anthropic` dynamic API-key model listing       | In scope                                       | Done     |
| Targeted `/auth anthropic` redirect             | In scope                                       | Done     |
| Focused provider UI/help/docs updates           | In scope                                       | Done     |
| Identity-distinct recovery text (review #1)     | In scope (Blocker-Fix)                         | Done     |
| Exact static-model catalog geometry (review #2) | In scope                                       | Done     |
| OAuth provider identity/token key (review #3)   | In scope                                       | Done     |
| `/auth` login/logout routing (review #4)        | In scope                                       | Done     |
| Real alias binding evidence (review #5)         | In scope                                       | Done     |
| AuthDialog runnable test (review #6)            | In scope                                       | Done     |
| Stored-token/settings migration                 | Reject — explicit non-goal                     | Excluded |
| Codex identity/base-URL retrofit                | Defer — separate concern                       | Excluded |
| API-key workflow inside `/auth`                 | Reject — outside accepted command architecture | Excluded |
| Generic OAuth/alias public abstraction          | Reject unless separately approved              | Excluded |
| Unrelated model catalog cleanup                 | Defer                                          | Excluded |
| Workflow/dependency/quality-tool/memory changes | Reject unless separately approved              | Excluded |

## Stop-and-ask triggers

Stop before adding an unplanned subsystem or public abstraction; changing a
workflow, dependency, quality tool, agent memory, lint/complexity rule, or CI
requirement; moving unrelated tests/refactors into scope; implementing behavior
outside A1–A11; or crossing the stated scope budgets.

## Verification and exact-head completion

Required local candidate-head gates:

- Focused providers and CLI behavioral tests for A1–A11.
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load ollamakimi "write me a haiku and nothing else"`
- Open Code Review no more than two local and two PR runs.
- DeepThinker review within the two-cycle total review limit.
- Review findings classified as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or
  `Defer`; all accepted fixes resolved.
- `git diff --stat`/`git diff --numstat` scope review and clean scope ledger.
- Candidate head descends from current `origin/main`, PR is conflict-free, CI
  passes on the exact head, and review threads are resolved.

Stop successfully once every accepted behavior has evidence and all listed
gates pass. Do not continue optional cleanup or hardening.

## Post-remediation scope audit (review cycle)

User approval was granted to continue beyond the original target to remediate
validated review findings (#1–#7). The remediation stayed within the five
bounded slices and introduced no unplanned subsystem, public abstraction,
workflow, dependency, quality-tool, agent-memory, lint/complexity, or CI
change.

### Final changed-path count

- 39 tracked files modified against HEAD.
- 4 new files added (`claudecode.config`, two new focused test files, and this
  plan document).
- 1 untracked standalone redirect test
  (`authCommand.anthropic-redirect.test.ts`) was deleted; its coverage was
  merged into `authCommand.test.ts`.
- `AuthDialog.test.tsx` was restored to its exact HEAD content (excluded by the
  normal Vitest config, so changes there provided no runnable coverage).
- The final full-suite remediation updated the isolated Agents registration
  behavior test and the CLI logout integration test to assert the new
  `claudecode` identity instead of the retired `anthropic` OAuth identity.
- **Total: 43 changed paths** (39 modified + 4 added). The user explicitly
  approved continuing beyond the original hard file target while keeping the
  implementation lean. The additional tracked path is the CLI's exact
  test-file manifest, advanced by one for the new collected behavior test.

### Churn

- Final churn remains below the 1,500-net-line target and 2,500-net-line hard
  budget; exact figures are recorded in the refreshed scope below.

### Slice-to-path mapping

| Slice                      | Representative paths                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Alias catalog              | `claudecode.config`, `aliasProviderFactory.ts`, `providerAliases.claudecode.factory.test.ts`                                          |
| OAuth identity             | `anthropic-oauth-provider.ts/.test.ts`, `oauth-provider-registration.ts/.test.ts`, `oauth-manager*.spec.ts`                           |
| Model-list split           | `AnthropicProvider.ts`, `AnthropicModelData.ts/.test.ts`, `AnthropicProvider.getModels.test.ts`, `AnthropicProvider.issue276.test.ts` |
| Command/UI                 | `authCommand.ts/.test.ts`, `AuthDialog.tsx`, `AuthDialog.issue2274.test.tsx`, `ProfileCreateWizard/constants.ts`                      |
| Identity-distinct recovery | `AnthropicProvider.issue2411.test.ts`                                                                                                 |
| Cross-package integration  | `registerProviders-oauth.behavior.test.ts`, `authCommand-logout.test.ts`                                                              |
| Documentation/verification | `docs/providers/quick-reference.md`, this plan                                                                                        |

### No unplanned changes

- No new public OAuth/alias abstraction.
- No stored-token/settings migration or fallback read.
- No codex retrofit.
- No workflow, dependency, quality-tool, agent-memory, lint/complexity, or CI
  requirement change.
- No Vitest config change; the new `AuthDialog.issue2274.test.tsx` lives under
  an already-collected CLI test directory.

## Final review-triage table

This section records the disposition of every DeepThinker finding (D1–D7) and
every OCR finding (O1–O15). No second OCR cycle is being launched under the
two-cycle cap.

### OCR scope and coverage

- **Snapshot**: workspace pre-remediation state at review time.
- **Files reviewed**: 38 source/test files.
- **Unsupported-extension files excluded**: 3.
- **Coverage**: `complete_best_effort`.
- **Artifact directory**:
  `/Users/acoliver/Library/Logs/llxprt-code/opencodereview/runs/20260727T024323Z-c4688a01`.
- Config, docs, and plan were separately reviewed during DeepThinker/source
  inspection.

### DeepThinker findings

| ID  | Finding                                         | Classification | Status   |
| --- | ----------------------------------------------- | -------------- | -------- |
| D1  | Identity-distinct recovery text (review #1)     | Blocker-Fix    | Resolved |
| D2  | Exact static-model catalog geometry (review #2) | In-scope-Fix   | Resolved |
| D3  | OAuth provider identity/token key (review #3)   | In-scope-Fix   | Resolved |
| D4  | `/auth` login/logout routing (review #4)        | In-scope-Fix   | Resolved |
| D5  | Real alias binding evidence (review #5)         | In-scope-Fix   | Resolved |
| D6  | AuthDialog runnable test (review #6)            | In-scope-Fix   | Resolved |
| D7  | Post-remediation scope audit (review #7)        | In-scope-Fix   | Resolved |

### OCR findings

| ID  | Finding                                                                                                           | Classification  | Status    |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------- | --------- |
| O1  | Rename all-caps test desc `/auth ANTHROPIC` → `/auth CLAUDECODE` in authCommand.test.ts                           | In-scope-Fix    | Resolved  |
| O2  | Rename mixed-case test desc `/auth Anthropic ENABLE` → `/auth Claudecode ENABLE`                                  | In-scope-Fix    | Resolved  |
| O3  | Add explicit `claudecode` entry to `PARAMETER_DEFAULTS`; assert via exported constants                            | In-scope-Fix    | Resolved  |
| O4  | Expand `claudecode.knownModels` to all 15 config models                                                           | Reject          | Dismissed |
| O5  | Update issue276 header: both tokens use dynamic model listing; OAuth uses token auth/beta headers/tool prefixing  | In-scope-Fix    | Resolved  |
| O6  | Rename stale OAuth `getModels` test; assert dynamic mock model ID; avoid redundant duplicate assertions           | In-scope-Fix    | Resolved  |
| O7  | Assert `listBuckets('claudecode')` in provider-usage-info.spec.ts in addition to getToken                         | In-scope-Fix    | Resolved  |
| O8  | Update oauth-manager-initialization.spec.ts fixture `anthropic: false` → `claudecode: false`                      | In-scope-Fix    | Resolved  |
| O9  | Update oauth-manager.wiring.spec.ts test name: claudecode provider not registered (retain Anthropic usage naming) | In-scope-Fix    | Resolved  |
| O10 | OCR finding against deleted authCommand.anthropic-redirect.test.ts                                                | Obsolete/Reject | Dismissed |
| O11 | Rename `registeredAnthropic` → `registeredClaudecode` in oauthRegistration test                                   | In-scope-Fix    | Resolved  |
| O12 | Strengthen supplementary constructor test: exactly one AnthropicProvider call receives OAuth manager              | In-scope-Fix    | Resolved  |
| O13 | Rename test title: registers Anthropic OAuth provider → registers claudecode OAuth provider                       | In-scope-Fix    | Resolved  |
| O14 | Old false-claim test in providerAliases.claudecode.factory.test.ts                                                | Obsolete/Reject | Dismissed |
| O15 | Old dead fetchSpy finding                                                                                         | Obsolete/Reject | Dismissed |

### Refreshed final scope (after rebase verification)

- **43 changed paths** total (39 modified tracked files + 4 added files).
- **Total churn**: 1,592 lines added, 683 lines deleted (net +909 versus the
  rebased `origin/main`).
- **Added files**: plan (308 lines), AuthDialog.issue2274.test.tsx (199 lines),
  claudecode.config (141 lines), and
  providerAliases.claudecode.factory.test.ts (291 lines).
- **Total net growth**: 909 lines, below both line budgets.
- No new abstractions, migrations, broad cleanup, suppressions, or
  config/workflow/dependency changes were introduced in the final remediation.
- No new lint or TypeScript suppressions.
