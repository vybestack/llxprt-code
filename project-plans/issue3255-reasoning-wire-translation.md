# Issue 3255: Reasoning wire translation

Status: Accepted behavior and test-first implementation plan
Date: 2026-08-20
Issue: https://github.com/vybestack/llxprt-code/issues/3255

## Purpose

LLxprt exposes provider-neutral reasoning controls, but each request protocol expects a different body shape and each model accepts a different value set. The current OpenAI Chat path selects a shape from a short hostname list. Unknown hosts receive no reasoning field, including local OpenAI-compatible servers. Several shipped aliases set reasoning defaults that the request path then discards.

This change makes request translation configurable through provider alias defaults, matched model defaults, and profile ephemerals. It also applies model-specific value maps and deliberate suppression without introducing an arbitrary request-transformation language.

## Accepted behavior

### REQ-3255-001: Configurable reasoning controls

Register these profile-persistable model-behavior settings:

1. `reasoning.effortWireFormat`
2. `reasoning.enabledWireFormat`
3. `reasoning.effortMap`
4. `reasoning.enabledMap`

The settings must be removed from ordinary model parameters by `separateSettings()`. None may leak onto a provider request under its dotted setting name.

`reasoning.effortWireFormat` accepts:

| Value | Wire representation |
| --- | --- |
| `auto` | Provider and transport detection described below |
| `openai` | Top-level `reasoning_effort` |
| `openai-responses` | `reasoning.effort` on a Responses request |
| `anthropic` | `output_config.effort` |
| `anthropic-budget` | `thinking.budget_tokens`, using a numeric mapped value |
| `openrouter` | `reasoning.effort` on an OpenRouter Chat request |
| `gemini` | Gemini `thinkingLevel` through the existing Gemini adapter |
| `template-kwargs` | `chat_template_kwargs.reasoning_effort` |
| `none` | No effort field |

`reasoning.enabledWireFormat` accepts:

| Value | Wire representation |
| --- | --- |
| `auto` | Provider and transport detection described below |
| `openai` | Top-level `reasoning_effort`, using `reasoning.enabledMap` |
| `openai-responses` | `reasoning.effort` on a Responses request, using `reasoning.enabledMap` |
| `openrouter` | `reasoning.enabled` |
| `thinking` | `thinking.type` |
| `gemini` | Gemini thinking enablement through the existing Gemini adapter |
| `template-kwargs` | `chat_template_kwargs.enable_thinking` |
| `none` | No enablement field |

The two selectors are separate because several supported systems use coordinated fields. Z.AI Chat uses `thinking.type` and top-level `reasoning_effort`. Kimi K3 accepts effort but cannot accept a thinking object. OpenRouter merges enabled and effort into one `reasoning` object.

### REQ-3255-002: Controlled model-specific maps

`reasoning.effortMap` is a JSON object with zero or more keys from:

`minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

Each value is one of:

- a non-empty wire string;
- an integer of at least 1024 for `anthropic-budget`;
- `null` for deliberate suppression.

For string-valued formats, an absent map entry uses the generic effort unchanged. For `anthropic-budget`, a numeric entry is required to derive a budget from effort. `reasoning.budgetTokens` remains the direct, explicit budget control and takes precedence over an effort-derived budget.

`reasoning.enabledMap` is a JSON object with optional `true` and `false` keys. Each value is a non-empty string, a boolean, or `null`. The selected adapter validates the mapped type and allowed value before network I/O. Examples include:

- Anthropic adaptive models: `{ "true": "adaptive", "false": "disabled" }`
- Models that only accept enabled thinking: `{ "true": "enabled", "false": null }`
- Fireworks effort-only disablement: `{ "true": null, "false": "none" }`

A higher-precedence map replaces the lower-precedence map as one setting. Maps are not recursively merged. A partial replacement uses identity or adapter defaults for omitted entries as described above.

The maps are typed reasoning configuration. They may not name arbitrary request fields, paths, headers, endpoints, or transformations.

### REQ-3255-003: Resolution order

Each selector and map resolves through the existing alias and profile machinery:

1. A value explicitly supplied by the loaded profile or session.
2. The last matching `modelDefaults` alias rule.
3. Provider alias `ephemeralSettings`.
4. `auto` for selectors and no map for maps.

Existing ordered `modelDefaults` behavior remains in effect. Later matching rules win. Profile ephemerals are applied after model defaults and win without request preparation reading alias files directly.

Profile save/load and provider/model switching must preserve explicit profile values. Alias defaults may change when the active provider or model changes. An explicit session or profile value must not be overwritten by that change.

### REQ-3255-004: Automatic selection

`auto` retains safe protocol ownership:

- OpenAI Responses and Codex use `openai-responses` effort translation.
- Native Anthropic uses `anthropic` effort translation and the existing adaptive or budgeted thinking behavior when no explicit selector overrides it.
- Native Gemini uses `gemini` translation.
- OpenRouter Chat uses `openrouter` for enabled and effort.
- Z.AI and BigModel OpenAI Chat hosts use `thinking` for enabled and `openai` for effort.
- The official OpenAI API Chat host uses `openai` for effort.
- An unknown OpenAI-compatible Chat host resolves to `none` unless an alias, model rule, profile, or session selects a format.

Unknown hosts remain conservative because strict OpenAI-compatible endpoints have rejected guessed foreign fields in prior defects. The defect fix is configurability plus a warning, not unconditional fan-out.

### REQ-3255-005: Request translation

When generic reasoning is present, each provider adapter emits only the selected representation:

- OpenAI Chat can emit top-level OpenAI effort, nested OpenRouter reasoning, Z.AI's coordinated thinking and effort fields, Anthropic-style thinking, or template kwargs as selected.
- OpenAI Responses emits nested Responses reasoning.
- Anthropic emits `thinking` and `output_config` according to the selected native formats. Modern adaptive models never receive a fabricated `budget_tokens` value.
- Gemini continues to own its native `thinkingConfig`, while honoring effort maps and `none` suppression.

The translator merges coordinated sibling properties in one representation. It also preserves unrelated properties already present in `chat_template_kwargs` and `output_config`.

`reasoning.enabled=false` takes precedence over a generic effort. If the selected format can express disablement, it emits the mapped disabled value and omits the generic effort. If the format cannot express disablement, it omits the effort and logs the warning required by REQ-3255-007.

`reasoning.enabled=true` is considered represented when an effort field is emitted for an effort-controlled or always-thinking model. It does not require a redundant enablement field.

### REQ-3255-006: Explicit native parameters win

Explicit native reasoning parameters in `modelParams` remain authoritative. If a relevant native reasoning field is present, automatic translation stands down so the request does not contain competing representations.

Relevant collisions include:

- `reasoning`
- `thinking`
- `reasoning_effort`
- `chat_template_kwargs.reasoning_effort`
- `chat_template_kwargs.enable_thinking`
- `output_config.effort`
- the provider's native Gemini thinking controls

An unrelated sibling such as `chat_template_kwargs.some_template_option` or `output_config.some_other_option` is not a collision and must survive a merge with translated reasoning settings.

### REQ-3255-007: No silent loss

Use the existing provider logger to warn when a configured generic reasoning control produces no wire value. This includes:

- `auto` resolving to `none` on an unknown Chat host;
- an explicit selector of `none`;
- a map entry of `null`;
- `reasoning.enabled=false` on a model or format that cannot express disablement;
- an effort that cannot produce a numeric `anthropic-budget` value.

The warning identifies the provider, model, selected format, and dropped generic setting without printing credentials. Explicit native `modelParams` do not produce this warning because the request already contains a user-selected native representation.

Warnings may occur per prepared request. This issue does not add warning deduplication, a notification center, or persistent warning state.

An explicit format that is incompatible with the active native provider adapter fails before network I/O with an actionable configuration error. Invalid maps fail settings validation or request preparation rather than falling back to a guessed value.

### REQ-3255-008: Evidence-backed shipped defaults

Update alias defaults only where provider documentation identifies the accepted request shape and model value set.

At minimum, cover:

| Alias/model | Accepted default behavior |
| --- | --- |
| Codex GPT-5.6 Sol, Terra, Luna | Responses `reasoning.effort`; retain the existing `minimal` to `none` policy where supported |
| OpenAI GPT-5.6 family | Responses translation when transport routing selects Responses |
| Anthropic and Claude Code Claude Opus 5 | `thinking.type=adaptive` when enabled, `thinking.type=disabled` when disabled, and `output_config.effort`; map unsupported generic `minimal` to `low` |
| OpenRouter | Nested `reasoning` object |
| Kimi K3 and K3 256K | Top-level `reasoning_effort`; no thinking object; map the generic ladder into `low`, `high`, and `max` |
| Kimi for Coding K2.7 | `thinking.type=enabled`; no effort field; an attempted disable is suppressed with a warning |
| Z.AI GLM-5.3 | Native endpoint-appropriate thinking plus effort; map minimal/low to low, medium/high to high, and xhigh/max to max on the Coding Plan behavior |
| Z.AI GLM-5.2 | Native endpoint-appropriate thinking plus effort; apply the documented GLM-5.2 effort normalization |
| DeepSeek V4 | `thinking.type` plus top-level `reasoning_effort`, with the provider's documented accepted values |
| Fireworks reasoning model defaults | Top-level `reasoning_effort`, with no simultaneous Anthropic thinking field |

Do not add an effort default to model-agnostic local aliases such as llama.cpp or LM Studio. Their served model determines the accepted format. Profiles can select `openai`, `template-kwargs`, or `none` for those endpoints.

### REQ-3255-009: Compatibility

Preserve these existing behaviors:

- No triple reasoning fan-out.
- Existing explicit `modelParams` precedence from issue 2896.
- Existing response-side reasoning extraction and `reasoning.fieldName` behavior.
- Existing OpenAI Responses encrypted-reasoning include and summary handling.
- Existing provider routing between Chat and Responses.
- Existing `reasoning.budgetTokens` and `reasoning.adaptiveThinking` profiles.
- Existing unrelated `chat_template_kwargs`, `output_config`, and model parameters.

### REQ-3255-010: Documentation

Update the user documentation with:

- all four settings and their schemas;
- precedence and map replacement behavior;
- warnings and explicit-native precedence;
- examples for local OpenAI-compatible servers, vLLM template kwargs, OpenRouter, Anthropic, Codex/Responses, Z.AI, Kimi, and explicit suppression;
- a provider/model matrix that separates request shape from model value restrictions.

## Evidence used for defaults

- OpenAI Chat and Responses reasoning parameters: https://platform.openai.com/docs/api-reference/chat and https://platform.openai.com/docs/api-reference/responses
- OpenRouter reasoning parameters: https://openrouter.ai/docs/api/reference/parameters
- Anthropic adaptive thinking and effort: https://platform.claude.com/docs/en/build-with-claude/extended-thinking and https://platform.claude.com/docs/en/build-with-claude/effort
- Z.AI GLM-5.3 and reasoning parameters: https://docs.z.ai/guides/llm/glm-5.3 and https://docs.z.ai/guides/overview/concept-param
- Z.AI Coding Plan protocol behavior: https://docs.z.ai/devpack/latest-model
- Kimi K3 reasoning controls: https://platform.moonshot.ai/docs/guide/kimi-k3-quickstart
- vLLM reasoning effort and template kwargs: https://docs.vllm.ai/en/latest/features/reasoning_outputs/
- Fireworks reasoning controls: https://docs.fireworks.ai/guides/reasoning and https://docs.fireworks.ai/api-reference/post-chatcompletions
- DeepSeek thinking mode: https://api-docs.deepseek.com/guides/thinking_mode/

Provider documentation changes over time. Alias tests must encode the values supported by the cited model generation, not assume that every model behind a provider accepts the provider's full parameter set.

## Boundaries and rejected expansion

This issue does not:

- add a general JSON-path or arbitrary request-body transformation system;
- change response-side reasoning extraction;
- probe servers for capabilities;
- infer model capabilities from model names outside evidence-backed alias rules and existing provider model data;
- add dependencies, workflows, agent memory, or quality-tool configuration;
- mutate user profiles stored outside this repository;
- invent a universal effort-to-token formula for Anthropic;
- send speculative reasoning fields to every unknown OpenAI-compatible host;
- refactor unrelated request preparation or settings code.

A numeric effort-to-budget map is supported only when explicitly configured. Anthropic states that effort and manual thinking budgets are different controls, so no built-in conversion table will be invented.

## Test-first implementation plan

Production changes follow RED, GREEN, REFACTOR. Each phase starts with a behavioral test that fails for the intended reason.

### Phase 0: Preflight

Run on the unchanged branch:

1. `npm run test`
2. `npm run lint:ci`
3. `npm run lint:eslint-guard`
4. `npm run typecheck`

Record any baseline failure before changing production code. Do not encode a baseline defect as expected behavior.

### Phase 1: Settings contract and profile precedence

RED tests:

1. The registry parses and validates both wire-format enums.
2. The registry accepts valid effort and enabled maps.
3. It rejects unknown effort keys, arrays, empty strings, non-integer budgets, and numeric budgets below 1024.
4. `separateSettings()` places all four settings in model behavior and none in request model parameters.
5. Profile snapshot/save/load preserves the settings.
6. Profile application proves profile value over matched model rule over provider alias default over `auto`.
7. Provider/model switching does not overwrite an explicit profile/session value.

GREEN implementation:

- Add registry entries, shared exported setting types where current settings types belong, profile types, and profile persistence keys.
- Reuse alias and model-default application. Do not pass raw alias configuration into request preparation.

### Phase 2: Narrow shared reasoning configuration resolver

RED tests:

1. Auto selection returns the expected effort and enabled formats for official OpenAI Chat, OpenRouter, Z.AI/BigModel Chat, unknown Chat, Responses, Anthropic, and Gemini.
2. Effort maps apply identity, explicit remap, numeric budget, and `null` suppression correctly.
3. Enabled maps apply adapter defaults and explicit values correctly.
4. Invalid mapped types fail before a request is sent.
5. `enabled=false` suppresses generic effort and either emits disablement or reports that disablement cannot be represented.

GREEN implementation:

- Add one internal provider-neutral module for typed selector/map resolution and validation.
- Keep body construction in each provider adapter. The shared module must not accept arbitrary output paths.

### Phase 3: OpenAI Chat translation

RED request-body tests:

1. A custom base URL plus `effortWireFormat=openai` emits only top-level `reasoning_effort`.
2. A custom base URL plus `template-kwargs` emits and merges `chat_template_kwargs.reasoning_effort`.
3. OpenRouter emits one nested `reasoning` object with enabled and effort.
4. Z.AI Chat emits the coordinated `thinking.type` and top-level `reasoning_effort` fields and no foreign third representation.
5. Kimi K3 emits effort and no thinking object.
6. Kimi K2.7 emits enabled thinking and no effort.
7. Anthropic-budget translation uses an explicit numeric map or `reasoning.budgetTokens` and never invents a budget.
8. The official OpenAI Chat host emits top-level effort under `auto`.
9. An unknown host under `auto` emits no reasoning field and logs a warning.
10. Explicit `reasoning`, `thinking`, `reasoning_effort`, or nested template reasoning settings win without automatic additions.
11. Unrelated template kwargs survive translated reasoning.
12. `enabled=false` emits a supported mapped disable value or suppresses effort and warns.

GREEN implementation:

- Replace the one-dimensional hostname dialect with resolved enabled and effort formats.
- Pass the existing logger into translation.
- Keep request preparation's explicit-native precedence.

### Phase 4: OpenAI Responses and Codex

RED request-body tests:

1. GPT-5.6 Sol, Terra, and Luna emit nested `reasoning.effort` through Codex/Responses.
2. Model/profile effort maps apply before the existing GPT-5.6 wire policy.
3. `none` and `null` suppress the effort and warn.
4. A mapped disabled value suppresses ordinary effort.
5. Explicit native `reasoning` remains authoritative.
6. An incompatible explicit selector fails before transport.
7. Summary and encrypted-content include behavior remains unchanged.

GREEN implementation:

- Feed the shared resolved configuration into the Responses reasoning builder.
- Preserve routing and existing request ownership.

### Phase 5: Anthropic and Z.AI's Anthropic-compatible endpoint

RED request-body tests:

1. Claude Opus 5 enabled plus effort emits adaptive thinking and `output_config.effort` without `budget_tokens`.
2. Claude Opus 5 disabled emits disabled thinking and no effort that would make the combination invalid.
3. A legacy budgeted model uses explicit budget tokens or a numeric effort map.
4. Z.AI GLM-5.3 emits endpoint-appropriate thinking and mapped effort without Anthropic budget tokens.
5. Z.AI GLM-5.2 applies its documented effort map.
6. Explicit `thinking` or `output_config.effort` wins.
7. Unrelated output-config properties survive.
8. Incompatible selectors fail before transport.

GREEN implementation:

- Extend the request builder's thinking type only where required by a failing test.
- Retain model capability checks and strict native parameter sanitization.

### Phase 6: Gemini mapping and suppression

RED request-body tests:

1. `auto` retains existing Gemini effort-to-thinking-level behavior.
2. A profile effort map changes the emitted thinking level.
3. `none` or a `null` map entry suppresses the effort and warns.
4. Explicit native Gemini thinking configuration wins.
5. A non-Gemini explicit selector fails before transport.

GREEN implementation:

- Apply shared mapping before the existing Gemini adapter builds `thinkingConfig`.
- Do not change Gemini response handling.

### Phase 7: Alias defaults

RED alias and propagation tests:

1. Codex GPT-5.6 Sol, Terra, and Luna resolve Responses settings.
2. OpenRouter resolves nested reasoning settings.
3. Anthropic and Claude Code Opus 5 resolve adaptive enabled mapping and Anthropic effort.
4. Kimi K3/K3 256K and K2.7 rules resolve different formats.
5. Z.AI GLM-5.3 and GLM-5.2 resolve their documented maps.
6. DeepSeek V4 and the existing Fireworks reasoning defaults resolve supported Chat formats.
7. A profile override beats every alias default in a complete invocation context.

GREEN implementation:

- Update only evidence-backed alias and model rules.
- Keep model-specific rules ordered from broad defaults to narrower overrides.

### Phase 8: Documentation

Update `docs/reference/ephemerals.md` and the most relevant provider reasoning documentation. Include exact JSON examples and the provider/model matrix from REQ-3255-010.

Documentation examples must match behavioral test fixtures.

## Verification

### Focused tests

Run every touched co-located suite during RED/GREEN work. Include at least:

- settings registry and separation tests;
- profile application and alias default tests;
- OpenAI Chat request-preparation tests;
- OpenAI Responses reasoning tests;
- Anthropic thinking tests;
- Gemini thinking-level tests.

Run the test-audit scanner and compare branch findings with the unchanged baseline for touched test files.

### Full local gates

Run the full workflow cycle on the candidate head:

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Also run the repository's CI lint commands:

- `npm run lint:ci`
- `npm run lint:eslint-guard`

Scan touched files for `TODO`, `FIXME`, `HACK`, `STUB`, `eslint-disable`, `@ts-ignore`, and `@ts-expect-error`. Any occurrence introduced by this issue must be removed or justified by an existing repository rule.

### Live profile evidence

After unit and integration gates pass, run selected installed profiles without editing their external files:

```bash
bun scripts/start.ts --profile-load gpt56solhigh -p "read the docs directory and compose a haiku about something in it that inspired you"
bun scripts/start.ts --profile-load opus5 -p "read the docs directory and compose a haiku about something in it that inspired you"
bun scripts/start.ts --profile-load zai -p "read the docs directory and compose a haiku about something in it that inspired you"
bun scripts/start.ts --profile-load chutesglm52 -p "read the docs directory and compose a haiku about something in it that inspired you"
bun scripts/start.ts --profile-load fireworkskimi -p "read the docs directory and compose a haiku about something in it that inspired you"
```

If a named profile lacks credentials or its remote service is unavailable, record the exact failure. Request-body tests remain the proof of wire shape. A successful response from each available live profile is additional transport evidence.

## Review and finding classification

Complete one deep technical review and no more than two local Open Code Review rounds. Later, complete no more than two PR Open Code Review rounds.

Classify every finding:

- `Blocker-Fix`: breaks an accepted behavior, safety rule, build, test, or release gate.
- `In-scope-Fix`: valid defect in the accepted implementation or its evidence.
- `Reject`: factually incorrect, already satisfied, or conflicts with accepted behavior.
- `Defer`: valid adjacent work outside this issue. Record it without implementing it unless the user approves expansion.

Review comments do not add scope. Fix all Blocker-Fix and In-scope-Fix findings, then rerun the required verification cycle.

## Execution evidence

### Test-first implementation

The implementation and its provider-specific remediations were delegated to TypeScript specialists. Focused RED evidence was captured before each behavior change.

- `typescriptexpert-hn4qme` remediated the second deep review's provider-switch ownership, explicit-native collision, and Anthropic budget findings under observed RED/GREEN tests.
- `typescriptexpert-cxm0u2` completed the first OCR remediation and passed 441 tests across 21 separately executed suites, followed by typecheck, lint-policy guard, scoped ESLint, Prettier, focused test audit, and diff checks.
- `typescriptexpert-rck1pe` completed the second OCR remediation. That work began from two observed failures left by an interrupted specialist: a syntax error from an unmatched block in `geminiReasoningConfig.ts`, and ten OpenAI Chat warning failures that did not distinguish suppression, disabled reasoning, an undetected format, and unsupported direct budgets.
- `typescriptexpert-zonk6c` extracted shared Chat test harness code into a test-only helper after the issue test reached the repository's unchanged source-size limit.

The final focused results from the second OCR remediation were produced in separate Bun processes:

- reasoning parser: 61 passed;
- shared resolver: 88 passed;
- OpenAI Chat issue tests: 48 passed;
- OpenAI Responses issue tests: 26 passed;
- Anthropic issue tests: 39 passed;
- Anthropic thinking regressions: 21 passed;
- Gemini issue tests: 43 passed;
- settings registry issue tests: 14 passed;
- alias, profile, switching, ownership, mutation, snapshot, issue 2896, and pipeline suites: 148 passed.

A proposed lint-policy exception was classified `Reject` and removed. The test-only helper kept the Chat issue test within the existing source-size policy. The unchanged lint configuration then passed, and all 48 Chat tests retained their descriptions and assertions.

### Deep technical review

Two reported deep technical reviews were completed:

- `deepthinker-sgry8t`: three `Blocker-Fix` and four `In-scope-Fix` findings. All were remediated and covered by focused tests.
- `deepthinker-t8bs3e`: `Blocker-Fix` findings for provider-switch ownership, explicit OpenAI native collisions, and unsupported Opus 5 manual budgets. All were remediated and covered by focused tests.

A separate deep-review attempt ended without a report and supplied no findings or evidence. It is not counted as a completed review.

### Local Open Code Review

The two permitted local OCR rounds are complete. No third local OCR round will be run.

Round one:

- primary output: `tmp/ocr-review-3255-local-1.json`;
- 41 of 42 selected items completed;
- 24 aggregate comments plus 10 comments recovered from the interrupted attempt;
- the missed OpenAI Responses issue test completed in round two;
- accepted findings covered shared parsing, plain-record validation, Responses enabled-only behavior, Anthropic passthrough, nested own-property checks, dead dialect removal, Gemini warning metadata, and test-spy isolation;
- malformed controlled settings, OpenAI max-token changes, optional invocation state, Responses precedence inversion, and unrelated optimization requests were classified `Reject` or `Defer`.

Round two:

- output: `tmp/ocr-review-3255-local-2.json`;
- 42 of 43 selected items completed;
- 34 aggregate comments;
- the missed `runtimeAccessors.ts` item completed in round one, so cross-round file coverage is complete.

Every round-two comment was classified as follows. Duplicate comments inherit the classification of the cited behavior.

| Classification | Finding groups | Resolution |
| --- | --- | --- |
| `Blocker-Fix` | Ownership release across provider, model, and user layers | Fixed by unconditional layer deletion and ownership-transition tests |
| `Blocker-Fix` | Explicit effort overwritten by enabled-map output in Chat, Responses, or Gemini | Fixed; exact request-body tests prove effort precedence while disabled reasoning still suppresses effort |
| `Blocker-Fix` | Unrestricted simultaneous Chat formats could fan out reasoning controls | Fixed with an evidence-based coordinated-pair matrix and rejection tests |
| `Blocker-Fix` | Explicit native collision checks used inherited properties | Fixed with own-property checks and collision tests |
| `Blocker-Fix` | Class instances could pass controlled map validation | Fixed in shared parsing, Gemini parsing, and settings validation |
| `Blocker-Fix` | Configured Chat budgets and disabled Gemini effort could be dropped without an accurate warning | Fixed with independent provider-local warning tests |
| `In-scope-Fix` | OpenRouter sibling preservation and Z.AI/DeepSeek coordinated output | Preserved and covered by exact-body tests |
| `In-scope-Fix` | Warning prose did not distinguish deliberate suppression from inability to emit | Fixed with reason-specific messages and structured metadata |
| `In-scope-Fix` | Gemini dropped-effort, null-suppression, and same-control precedence coverage | Added deterministic tests |
| `In-scope-Fix` | Chat nested-field helper and `enabledMap.true=null` coverage | Corrected without weakening assertions |
| `In-scope-Fix` | Registry enum/key tests did not prove set equality | Corrected |
| `In-scope-Fix` | Parser error duplicated the minimum budget literal | Replaced with the existing constant |
| `In-scope-Fix` | Unreachable Anthropic enabled guard and duplicated legacy budget literal | Removed and consolidated internally |
| `In-scope-Fix` | Anthropic record unions suggested narrowing they did not provide | Simplified locally without changing request behavior |
| `In-scope-Fix` | Invocation-boundary comment suggested a contract weaker than the type | Corrected; invocation remains required |
| `Reject` | Invert Responses precedence using inconsistent partial fixtures | Conflicts with real invocation construction and explicit-native precedence |
| `Reject` | Warn or degrade on malformed controlled settings and alias maps | Conflicts with accepted fail-fast behavior |
| `Reject` | Make invocation optional | Conflicts with `RuntimeInvocationContext` |
| `Reject` | Accept case-insensitive reasoning setting names | Settings are case-sensitive |
| `Reject` | Preserve generic `reasoning.enabled` and `reasoning.effort` across provider switches | Their model/provider semantics are intentionally switch-local |
| `Reject` | Restrict every custom Anthropic mapped string to built-in literals | Conflicts with the accepted explicit wire-value escape hatch |
| `Reject` | Replace Gemini null suppression with `thinkingBudget: 0` | Null deliberately means no wire output |
| `Reject` | Downgrade incompatible Gemini values to warnings | Conflicts with fail-fast adapter validation |
| `Reject` | Recover from malformed `chat_template_kwargs` | Conflicts with fail-fast request validation |
| `Reject` | Claim an anthropic-budget effort without a numeric map can emit | The resolver already returns `unrepresentable` |
| `Reject` | Freeze empty `Map` or `Set` as a mutation defense | `Object.freeze` does not prevent `Map.set` or `Set.add` |
| `Defer` | Consolidate tiny internal key lists unrelated to a behavior defect | Adjacent cleanup with no issue behavior change |
| Duplicate | Two case-insensitive-key comments and two Anthropic-string comments | Classified with their matching `Reject` rows |

Two OCR-remediation attempts ended without reports after leaving partial workspace edits. Their edits were inspected and completed by reporting specialists. No RED/GREEN or completion claim is attributed to the interrupted attempts.

### Candidate-head verification

The candidate passed the complete repository test command under the controlled test environment with serialized Agents tests. The command exited 0. Workspace summaries included Tools 126/126, Storage 37/37, Auth 43/43, Settings 18/18, Telemetry 42/42, IDE integration 10/10, Policy 12/12, MCP 43/43, Core 393/393, LSP 13/13, Providers 578/578, Agents 374/374 plus 6/6 isolated files, CLI 713/713, A2A 22/22, test-utils 13/13, and VS Code companion 7/7.

Two earlier full runs exposed three unrelated load-sensitive failures. Each failing file passed through its authoritative isolated runner, and the clean full run then passed the same Tools and Agents workspaces without modification to those unrelated tests.

The candidate-wide test audit scanned 2,693 files, 36,107 tests, and 77,730 assertions with no scanner errors. The issue-specific files produced five `DUP_ASSERT` reports in the ownership-transition suite. Those equal-value before-and-after assertions are intentional evidence that user-owned values persist and provider/model-owned values release across transitions.

The final candidate passed full lint, CI lint, standalone typecheck, build, the ESLint policy guard, provider-neutral naming tests, Prettier checks, documentation link and placement guards, settings synchronization, copyright-year validation, the no-new-JavaScript guard, the no-Vitest guard, secret scans, prohibited-marker and prose scans, and `git diff --check`.

Live evidence is externally blocked for the required profiles `synthetic_gpt56`, `antigravity-claude-sonnet-4-5-thinking`, `antigravity-gemini-3-pro`, `codex_gpt56`, and `gemini_gemini3`. Safe filename and reference searches found none in the configured profile locations. The requested `$HOME/.bun/bin/llxprt` executable is also unavailable. Attempts through the installed `llxprt` executable failed with the sanitized classification "missing profile." The separate `stepfun-37` smoke completed with a valid haiku, but it is recorded only as general startup evidence and not as a substitute for the five requested profiles.

Local implementation, verification, deep review, and both permitted local OCR rounds are complete. Remote CI, PR review, ancestry, and conflict checks remain pending until the candidate is committed and the PR is created.

## Completion conditions

The issue is complete only when:

1. Every accepted requirement has behavioral evidence.
2. All local verification gates pass on the candidate commit.
3. Selected available live profiles complete successfully or have exact external failure evidence.
4. Deep review and permitted Open Code Review rounds are complete and triaged.
5. Every Blocker-Fix and In-scope-Fix finding is resolved.
6. CI passes on the candidate head.
7. PR review threads are resolved.
8. The PR has correct ancestry, no conflicts, and is ready to merge.

Do not merge without explicit user approval. Stop when these conditions are met rather than adding optional cleanup or hardening.
