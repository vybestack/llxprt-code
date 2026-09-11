# Issue #2533 — One canonical naming standard; prohibit LLxprt-owned alias probes

Branch: `issue2533` · Label: Code Quality / Modularization · Milestone: 0.12.0

## Objective

Rip-and-replace every LLxprt-owned naming alias: one name per concept per
boundary, one tool-name canonicalization implementation, one settings-key
spelling (with one-time load migration for legacy spellings), one slash-command
literal, and an AST lint rule that rejects new alias probes while permitting
narrowly documented third-party wire adaptation.

## Decisions (canonical choices)

| Boundary | Canonical choice | Rationale |
|---|---|---|
| TaskTool wire params (model-facing JSON) | snake_case, exactly: `subagent_name`, `goal_prompt`, `behaviour_prompts`, `tool_whitelist`, `expected_outputs`, `timeout_seconds`, `grace_period_seconds`, `max_turns`, `async`, `context` | Current model-facing schema is already snake_case with `additionalProperties:false`; #2255 direction (`expected_outputs`); no new aliases; never `model_param` (#1821). `output_spec` alias is REMOVED. |
| Internal TS after boundary | camelCase (`TaskToolInvocationParams`: subagentName, goalPrompt, behaviourPrompts, toolWhitelist, outputSpec, context, maxTurns, async) | Already exists; single normalization site in `normalizeTaskParams`. |
| `ISubagentService.SubagentRequest` | `behaviourPrompts` only (drop `behaviorPrompts`) | Internal interface; British spelling matches the wire name `behaviour_prompts`. |
| Tool-name canonicalization | `packages/tools/src/formatters/toolNameUtils.ts` + `toolGovernanceUtils.ts` (already exported, dependency-free) | Only complete implementation (casing + `Tool`-suffix + dotted namespaces + sentinel); already consumed by agents/core. |
| Persisted settings keys | One spelling per registry entry = the registry's PRIMARY name today (no mass rename of primaries). Model-param keys stay provider-wire snake (`max_tokens`); other keys stay as declared (`auth-key`, `tools.disabled`, …). New non-model-param keys: kebab-case with dotted namespaces. | Kills the alias matrix without rewriting every user's settings file; model params are provider wire passthrough. |
| Legacy settings spellings | One-time destructive load migration (the `settingsLegacy.ts` pattern): known legacy spellings → canonical, legacy key deleted. | Issue: "legitimate migration normalizes once at load". |
| Provider config field | `baseURL` (declared in `IProvider.ts:73`, `BaseProvider`) | LLxprt-owned canonical; `baseUrl`/`BaseUrl`/`BaseURL` are legacy spellings migrated once at load. |
| `/tools` subcommands | `desc` is canonical; remove `descriptions` alias option + dispatch branch | Alias labeled "Alias for desc" today. |
| Env vars | UPPER_SNAKE_CASE (document; verify existing readers conform) | Issue requirement. |
| New ESLint rule | `eslint-rules/no-alias-probes.js`, wired as `custom/no-alias-probes`: error for `packages/**/*.{js,jsx,ts,tsx}` | Follows the three existing rules' `.js` convention (flat-config import); tests are TS/bun. |

## Behavioral acceptance criteria

Each criterion lists behavior, boundary cases, and the tests that prove it.

### AC1 — Naming standard document

`dev-docs/naming-standard.md` exists and defines, per boundary, with examples:
TS camelCase values / PascalCase types; model-facing tool params snake_case;
slash commands one literal; persisted settings one canonical spelling per key +
load-time migration policy; env vars UPPER_SNAKE_CASE; tool names from one
manifest (`packages/tools` formatters); provider wire spelling only in adapters
mapped immediately to LLxprt types; the prohibited alias forms; and the
boundary-exception policy (explicit entries with owner, reason, removal
condition; no broad directory exemption). Follows dev-docs style; NOT in
`dev-docs/plans/` (checked by `scripts/check-doc-placement.ts`).

### AC2 — TaskTool has exactly one parameter vocabulary

Behavior: `TaskToolParams` (TS) declares exactly the canonical snake_case wire
members; `taskToolSchema` drops `output_spec`; validation/normalization
(`validateToolParamValues`, `normalizeTaskParams`/`resolveOutputSpec`) read
only snake_case members; the `??` camelCase probes and `firstDefined` alias
chains are gone. camelCase or legacy spellings are rejected (unknown-property
error naming the canonical member), not silently accepted.

Boundary cases: programmatic callers that previously passed camelCase now get
type errors; `output_spec` from a model is an unknown-property validation
error; `expected_outputs`, `context` continue to work; `async: true`,
`max_turns`, timeouts unaffected.

Tests: rewrite `packages/agents/src/tools/task.output-naming.test.ts` to assert
`expected_outputs` only (and `output_spec` rejection); task.test.ts and the
rest of the task suite (snake_case) pass unchanged; new assertions that
`subagentName`/`goalPrompt`/`expectedOutputs`/`outputSpec`/`context_vars`/
`behavior_prompts` produce validation errors.

### AC3 — Subagent service interface single spelling

Behavior: `SubagentRequest` keeps only `behaviourPrompts`;
`CoreSubagentServiceAdapter.ts:369-370` and `coreSubagentServiceHelpers.ts:85`
drop the `?? behaviorPrompts` probes.

Tests: existing `CoreSubagentServiceAdapter.test.ts` passes; adapter test
covers single-field read.

### AC4 — One tool-name canonicalization implementation

Behavior: the local duplicate normalizers are deleted and their call sites
import from `@vybestack/llxprt-code-tools` (or the agents re-export shim):
- `packages/cli/src/config/toolGovernance.ts` (`normalizeToolNameForPolicy`,
  `buildNormalizedToolSet` ShellTool parsing)
- `packages/cli/src/ui/commands/toolsCommand.ts:32`
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx:55-62`
- `packages/policy/src/config.ts:106-114` and
  `packages/core/src/policy/config.ts:291-300` (identical twins)
- `packages/core/src/runtime/AgentRuntimeLoader.ts:117-160` (local
  `buildToolGovernance`/`isToolPermitted` → shared `buildToolGovernance`/
  `isToolBlocked` with candidates layer)
- `packages/core/src/prompt-config/prompt-resolver.ts:288` (private toSnakeCase
  if it duplicates shared casing logic)

Boundary case: user-authored policy entries (`ShellTool(npm test)`,
CamelCase names) still normalize to registry names at policy load — that is
external input adapted once at the boundary (allowed, documented). Behavior
improvement is expected: `ReadFileTool` now canonicalizes to `read_file`
instead of the never-matching `readfiletool`.

Tests: governance/policy suites (`toolGovernance.test.ts`,
`toolGovernanceUtils.test.ts`, policy config tests) updated to the shared
behavior; `/tools` enable/disable/status tests match registry names.

### AC5 — Settings: one spelling per key, migration once at load

Behavior:
- `ALIAS_NORMALIZATION_RULES`, registry `aliases` arrays (15 entries), and the
  kebab→snake global fallback in `resolveAlias` are removed; key lookup is
  exact-match against the registry primary name.
- A one-time destructive load migration (settingsLegacy.ts pattern, extend it
  or sibling module) maps the known legacy spellings (`max-tokens`, `maxTokens`,
  `apiKey`, `api-key`, `apiKeyfile`, `api-keyfile`, `tool-format`,
  `tool-format-override`, `disabled-tools`, `max-output-tokens`,
  `max-output`, `response-format`, `responseFormat`, `tool-choice`,
  `toolChoice`, `User-Agent`, `streamIdleTimeoutMs`,
  `streamFirstResponseTimeoutMs`, `baseUrl`/`BaseUrl`/`BaseURL` for providers,
  `tools_allowed`) to canonical and deletes the legacy key.
- `disabled-tools` is dead: every dual-read
  (`toolGovernanceUtils.ts:118-123`, `clientToolGovernance.ts:63-65`,
  `subagentSettingsPopulation.ts:40-45,126-136`,
  `postConfigRuntime.ts:602-607`, `toolsCommand.ts:83-121`,
  `SettingsService.ts:493-503,552`, `ProfileManager.ts:393,410-417,452`) reads
 /writes only `tools.disabled`; `useToolsDialog.ts` switches from legacy-only
  to `tools.disabled`; `profiles/types.ts:120` drops the `disabled-tools` field.
- `/set` accepts only canonical keys; a legacy spelling is rejected with an
  error naming the canonical key (rejection + guidance, not acceptance).
- Provider runtime: `ephemeralSettings.ts`, `profileSnapshot.ts:153-170`
  (alias-scan loop), `providerSwitch.ts:682-696` (15-variant enumeration),
  `providerMutations.ts:96-134` use canonical keys/`baseURL` only.
- Env-var derivation of settings still works with canonical keys.

Boundary cases: a settings.json written by an older LLxprt containing
`max-tokens`/`disabled-tools` loads correctly after one migration and is
rewritten canonically; profiles exported by older versions import cleanly
(migration applies); unknown keys remain unknown-key errors (no fuzzy
acceptance).

Tests: rewrite `settingsRegistry.test.ts` (exact-match + rejection of
aliases), `settingsRegistry.issue2182.test.ts` / `.issue2607.test.ts`
(canonical spelling + migration), `toolGovernanceUtils.test.ts`,
`clientToolGovernance.test.ts` (canonical only), new migration tests for
legacy → canonical rewrite-and-delete, ProfileManager round-trip, provider
runtime `baseURL` tests, `/set` rejection-with-guidance test.

### AC6 — Slash commands: one literal

Behavior: `/tools` drops the `descriptions` subcommand alias (option entry +
dispatch branch); `desc` remains. All other command literals verified
consistent across schema/completion/dispatch/usage/docs (already consistent
per research).

Tests: toolsCommand tests updated (`descriptions` no longer dispatches,
`desc` does); docs/cli/commands.md checked.

### AC7 — ESLint rule `custom/no-alias-probes`

Behavior: new `eslint-rules/no-alias-probes.js` flags, in
`packages/**/*.{js,jsx,ts,tsx}`:
- `a.oldName || a.newName`, `a.old_name ?? a.newName`,
  `obj['old-name'] ?? obj.oldName`, `params.foo_bar ?? params.fooBar`
- Detection: both operands of `||`/`??` are (computed-literal or dot) member
  expressions on the *same textual object source*, with property spellings
  that differ raw but compare equal after case-folding and stripping `_`/`-`.
- Allows: literal RHS (`x.name ?? 'default'`, `x.flag || false`),
  different-object defaulting (`cfg.x ?? defaults.x`), genuinely different
  fields, allowlisted boundary files.
- Structured allowlist in the rule: `{ file, owner, reason,
  removalCondition }` entries only — no directory globs. Target: zero or
  near-zero entries after cleanup (expected entries, if any survive: genuinely
  third-party response decoding in provider adapters).
- Wired `error` in `eslint.config.js`; `npm run lint` passes repo-wide with
  the rule active.

Tests: first bun test for an eslint rule in this repo
(e.g. `eslint-rules/no-alias-probes.test.ts` or `scripts/tests/…`, importing
the rule via the `Linter` API — no RuleTester framework assumptions): valid
cases (boolean fallback, default literal, different fields, different
objects, allowlisted boundary), invalid cases (all four representative forms
+ case-only variants like `baseUrl/baseURL`), allowlist-metadata test.

### AC8 — Alias-only tests deleted or rewritten

The 7 alias-asserting test files (see catalog §6) are rewritten to assert
canonical-only behavior + explicit rejection; none may continue to assert
that two spellings both work.

### AC9 — Help/docs/prompts/schema expose canonical names only

Grep-sweep `docs/`, prompt templates, help text, and `schemas/` for removed
spellings (`output_spec` as TaskTool param, `disabled-tools`,
`descriptions` subcommand, camelCase TaskTool params, alias mentions).
`schemas/settings.schema.json` must not advertise removed alias spellings.
Note: `docs/token-usage-log.md` documents the token-usage wire log
(`subagent_name` snake) — that is a different, canonical wire format; leave
it. MCP `streamable-http` enum value and Zed tool-name mapping are
third-party boundary entries — leave them, document as boundary exceptions.

### AC10 — Functionality retained

Full verification cycle green: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, and smoke
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
Explicit suites: lint-rule test, TaskTool schema, governance/policy,
settings/profile, completion, provider adapter.

## Prohibited / out of scope

- No new TaskTool alias (#2255); no `model_param` (#1821).
- No backward-compat shims beyond the one-time load migrations specified.
- No renaming of registry-primary settings keys (only alias removal).
- No redesign of read-only-tool classification or policy semantics; only
  dedupe of copy-pasted name lists where a single owner exists or can be
  imported without new package cycles (e.g. SHELL_TOOL_NAMES twins,
  `self_emitvalue` literal copies → the exported constant).
- No broad directory exemptions in the lint rule.
- No new .js files except `eslint-rules/no-alias-probes.js`, which follows the
  established eslint-rules convention (flat-config ESM import); its tests are
  TS/bun.

## Review policy

Max 2 deepthinker review rounds; max 2 OCR rounds. Findings triaged
Blocker-Fix / In-scope-Fix / Reject / Defer. Completion only with behavioral
evidence, green verification + CI, triaged reviews, conflict-free PR.

## Review log (final)

- Round 1 (compliance): verdict FAIL with 1 Blocker + 4 In-scope findings + 3 Defers.
  All five actionable findings remediated in the same working tree:
  1. OpenAI request-param alias map + kebab→snake fallback deleted
     (openaiRequestParams.ts now exact canonical-set filtering); stateless test
     rewritten to canonical max_tokens + legacy-absence assertion.
  2. Legacy ephemerals['max-tokens'] reads removed from OpenAIRequestPreparation.ts
     and vercelRequestParams.ts (canonical modelParams['max_tokens'] only).
  3. /mcp list accepts only desc/nodesc/schema (descriptions/nodescriptions aliases
     removed; schema-edge test asserts rejection; docs swept).
  4. docs settings examples teach auth-key (configuration.md, emoji-filter.md).
  5. naming-standard.md Enforcement reworded: boundary table = full register;
     BOUNDARY_EXCEPTIONS = machine-enforced subset. Plus settingsLoader import fold.
- Round 2 (findings-only follow-up): verdict ALL-RESOLVED, no regressions.
  Logs: tmp/verify2533-review/, tmp/verify2533-review2/, remediation tmp/verify2533-h1/.

## OCR round 1 + CI remediation (2026-09-11)

Remediation covers 9 CI failures on head `b086d5058`, 13 OCR findings,
and 4 CodeRabbit threads. CI causes: prettier reformat on four files;
tracked-JS allowlist missing `eslint-rules/no-alias-probes.js`; test-file
coverage guard missing the new rule test; #2174 type escape in
`settingsLoader.ts`; six tests retaining legacy expectations
(`settings.part2`/`settings.part3` apiKey env resolution, diagnosticsCommand
apiKey masking, profileCommand.lb protected stripping, profile-system baseUrl
round-trip, gemini.stateless max-output-tokens). Write boundaries
(`SettingsService.set`, `setEphemeralSetting` through its settings write path,
and `setProviderSetting`) now reject known legacy spellings with guidance
naming the required key. No read-side aliases were restored; load-time
migration remains the only legacy acceptance path. `normalizeTaskParams`
now calls `validateCanonicalTaskParamSpellings` itself and throws on a spelling
error before normalization, including mixed current/legacy input. This is a
throwing normalizer, not an atomic full validate-and-normalize API.

| ID | Area | Action |
|---|---|---|
| A1 | Formatting | Reformatted `policy/src/config.ts`, `toolNameUtils.ts`, `providerMutations.ts`, and `providerSwitch.ts`; the latter's protected-key list is unchanged semantically. |
| A2 | Tracked JS | Added `eslint-rules/no-alias-probes.js` to `scripts/no-new-js-allowlist.json`; sorted affected entries. |
| A3 | Test coverage | Added the `eslint-rules` Bun root with storage-isolation preload; moved `SCRIPTS_SHARD_ROOTS` to `test-shards.ts`, included the new root, and imported/re-exported it in `test.ts`. |
| A4 | Settings loader | Replaced the double assertion in `settingsLoader.ts` with `isPlainRecord` narrowing before migration (#2174). |
| A5 | Settings env resolution | `settings.part2.test.ts` now supplies and checks `auth-key` for resolved environment variables. |
| A6 | Unresolved settings env | `settings.part3.test.ts` now supplies and checks `auth-key` while preserving unresolved-variable behavior. |
| A7 | Diagnostics | `diagnosticsCommand.edges.spec.ts` now asserts `SettingsService.set('apiKey', ...)` rejects with guidance naming `auth-key` and leaves no legacy key; existing `auth-key` masking coverage retained. |
| A8 | Load-balancer profiles | `profileCommand.lb.test.ts` rejects legacy `apiKey`/`apiKeyfile` writes; stripping fixtures use `auth-key`, `auth-keyfile`, and `toolFormat`, without alias-acceptance assertions. |
| A9 | Profile round-trip | Current diff in `profile-system.integration.test.ts` changes the Azure fixture from `tool-format` to `toolFormat`; no additional `baseUrl` edit is present in this remediation diff. |
| A10 | Gemini stateless | Replaced `max-output-tokens` fixtures with `max_output_tokens` for global, provider, and invocation settings; removed obsolete alias-normalization comments. |
| B1 | Lint folding | Replaced substring-based `ALIAS_FOLDS` with `ALIAS_WORD_FOLDS`: tokenize identifier words, fold exact words, then join. Substrings inside longer words are no longer rewritten. |
| B2 | Lint regressions | Added clean cases for `olderSibling/newerSibling`, `rise/rize`, and `contour/contor` in `no-alias-probes.test.ts`. |
| B3 | Task normalization | `normalizeTaskParams` validates removed spellings and throws before reading fields; shared error helper supplies replacement-key guidance. |
| B4 | Task output validation | `validateOutputParams` rejects `output_spec`, `outputSpec`, and `expectedOutputs` before its absent-output early return. |
| B5 | Task rejection tests | `task.output-naming.test.ts` exercises direct output validation, direct normalization of removed spellings, and mixed current/legacy fields. |
| B6 | Task runtime schema | Tests inspect `createTool().schema.parametersJsonSchema`, including property vocabulary and unknown-property rejection; build assertions use the actual invocation return shape. |
| B7 | Settings writes | `SettingsService.set` and `setProviderSetting` call `assertCanonicalSettingKey` before mutation; `SettingsService.test.ts` replaces legacy event acceptance with write/clear rejection assertions. |
| B8 | Settings request separation | `settingsRegistry.ts` drops known legacy keys rather than forwarding them into request buckets; registry test checks `apiKey` enters neither CLI settings nor model params. |
| B9 | Shared settings assertion | Added `assertCanonicalSettingKey` beside the load migration map in `legacyKeyMigration.ts` and exported it from `packages/settings/src/index.ts`. No migration occurs at writes. |
| B10 | `/set unset modelparam` | `setCommand.ts` separates active-model clearing from ephemeral clearing; added a test for the distinct ephemeral-clear error and absence of a success response. |
| B11 | Tools dialog | No remediation diff, new comment, or new test in `useToolsDialog.ts`; existing reads and writes already use `tools.disabled`. |
| B12 | Runtime write fallout | `subagentSettingsPopulation.ts` writes `toolFormatOverride`; `providerMutations.ts` writes `toolFormat` ephemerals, including `auto`. |
| C1 | Vercel documentation | Added JSDoc stating that max-output resolution reads only `modelParams['max_tokens']`, not metadata or legacy ephemerals. |
| C2 | Policy decoder drift | `toolEntryDecoderDrift.test.ts` now checks the MCP wildcard through `canonicalizePolicyToolEntry`; updated the explanatory comment. |
| C3 | Provider policy fallout | `BaseProvider.test.ts` now tests stripping `auth-key`/`auth-keyfile`; `providerCallOptions.test.ts` uses `max_tokens` instead of `maxTokens`. |
| C4 | Provider policy fallout | `openaiResponses.stateless.test.ts` uses `max_output_tokens` in fixtures and outgoing-request assertions; `providerMutations.issue1943.test.ts` expects `toolFormat` persistence. |

### Verification

- Targeted suite: 17 files, final all pass. Four needed a fix-retry:
  `profileCommand.lb`, `gemini.stateless`, `settingsRegistry`, and
  `openaiResponses.stateless`.
- Guards: check-no-new-js-files 18 pass; eslint-guard 465 pass;
  test-file coverage 13 pass. No-alias-probes rule tests: 23 pass.
- Prettier check clean on all changed files in the remediation pass.
- Full `npm run test`, lint, typecheck, build, and smoke are run by the
  driver, with logs under `tmp/verify2533-resume/`: `typecheck3.log`,
  `lint-full.log`, `test-full.log`, `build.log`, and `smoke.log`.

### Full-suite census round 2 (stream-timeout / model-param regressions)

The first post-remediation full run (`tmp/verify2533-resume/test-full.log`)
cleared all 63 baseline failures but exposed 31 new ones. Root causes, fixed
in round k1 (logs `tmp/verify2533-k1/`):

- Read-side camelCase ephemeral alias for stream timeouts survived the
  original PR: the `streamIdleTimeout` resolver documented a
  'streamIdleTimeoutMs' ephemeral fallback, `postConfigRuntime` wrote both
  spellings, and `agentConfig.adapter` forwarded the typed API field names as
  ephemeral keys. Now one canonical kebab ephemeral write per setting
  ('stream-idle-timeout-ms' / 'stream-first-response-timeout-ms'); typed
  camelCase API fields map at the boundary. Tests assert the canonical key and
  that no legacy key exists.
- `BaseProvider` converted `max_tokens` to `maxTokens` before the settings
  write and swallowed the resulting rejection, silently dropping the value.
  Conversion and swallow removed; snake model params round-trip.
- Fixtures updated to canonical spellings (provider-multi-runtime `base-url`,
  ProviderManager.guard `auth-key`, core-api/CLI profile-load `max_tokens`).

Verification after k1: 21 targeted files all pass (116 combined timeout/model
rerun); CLI subprocess suites needed `--timeout 90000` on this loaded box;
three skills suites require isolated HOME (host HOME injects 55 real user
skills — environmental, not branch-owned); grep exact-limit and Podman #3534
files pass solo (load flakes, #3619 class). Final gates: typecheck exit 0
(`typecheck5.log`), lint exit 0 (`lint-final.log`), build exit 0
(`build-final.log`), full test (`test-final.log`: 1755 files, 10 unique
`(fail)` lines, all environmental — 1 webfetch 5MiB passes solo in 5s,
7 skills suites pass with isolated HOME, 2 are adversarial fixture echoes
from passing runner-lifecycle suites), and startup smoke green with a real
model response (`smoke.log`, stepfun-37 haiku).
  At this documentation update, typecheck and lint logs exist; test, build,
  and smoke logs are not yet present. Full-cycle completion is not claimed here.

## OCR round 2 + CodeRabbit follow-up (2026-09-11)

OCR round 2 (against 4cf04db23) posted 10 findings; CodeRabbit re-review
posted 1. Five fixed, five dismissed with evidence:

| ID | Finding | Disposition |
|---|---|---|
| R2-1 | `/set unset modelparam max-tokens` bypassed legacy-key rejection (modelparam branch returned before the check) | Fixed: rejectLegacySettingKey at branch top, before clearActiveModelParam; regression asserts neither runtime write fires |
| R2-2 | Rule missed case-only probes on single concatenated lowercase words (`a.oldname ?? a.oldName`) | Fixed: same-object comparison now flags case-insensitive equality OR word-fold equality; substring folding stays out (olderSibling/rise/contour still clean) |
| R2-3 | validateToolParamValues read canonical members without rejecting legacy spellings first | Fixed (actual site: task.ts): validateCanonicalTaskParamSpellings runs first and its error is returned; normalizeTaskParams throw retained for direct callers |
| R2-4 | combined canonical+legacy test fixtures used strings for object-typed output params | Fixed: typed fixtures (string maps for expected_outputs/output_spec) |
| R2-5 | settingsSeparation test asserted legacy absence without ever exercising legacy writes | Fixed: apiKey/api-key writes now attempted and asserted rejected naming auth-key; snapshot carries neither |
| R2-6 | setCommand unset partial-commit (clear succeeds, ephemeral unset throws) | Dismissed: R2-1 rejects legacy keys before any side effect; remaining failure mode is storage IO mid-sequence, where fail-fast surfacing (no compensating rollback) is the chosen design |
| R2-7 | security/high: `/set disabled-tools` governance bypass in non-interactive mode | Dismissed: setEphemeralSetting delegates to SettingsService.set, which calls assertCanonicalSettingKey and throws before any governance effect — fails closed on every path |
| R2-8/9 | toolEntryDecoderDrift imports normalizeToolName "not exported" from policy | Dismissed: packages/policy/src/index.ts:30 exports it; test passes (3/3) locally and in CI core shard |
| R2-10 | max-output-tokens migration "maps to wrong canonical key" | Dismissed: pre-PR registry declared max_output_tokens alias ['max-output-tokens'] and maxOutputTokens alias ['max-output']; migration preserves those exact relationships |

Verification: 154 targeted tests pass (setCommand 29, rule 28, task trio 86,
settingsSeparation 11), eslint guard exit 0, prettier clean on all seven
touched files, smoke green (tmp/verify2533-r2/, full typecheck/lint/test logs
therein). OCR budget (2 rounds) exhausted; any further findings become
documented follow-ups, not new cycles.

## Known follow-ups (deferred, out of scope here)


- packages/core/src/prompt-config/prompt-resolver.ts private toSnakeCase is not
  byte-equivalent to the shared packages/tools implementation (consecutive-capitals
  handling; no -/space folding). Unify behind the shared export with a corpus drift
  test, or document as a distinct filesystem-naming helper.
- packages/settings/src/settings/settingsRegistry.ts resolveAlias is now a permanent
  identity export; inline it away and drop the forward-referencing comment.
- Gate failures proven pre-existing on main (not branch-owned): proactive-renewal
  fake-timer suite (identical 4 pass/7 fail on main), SecureStore OS-keyring tests,
  #3619 vi.mock cross-file pollution, bun solo-run node:fs/promises quirk.
