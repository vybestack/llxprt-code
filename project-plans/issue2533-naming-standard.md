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
