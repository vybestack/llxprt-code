# Issue #3531: Add Claude Fable 5.1 (claude-fable-5-1) to provider configs and model lists

Branch: `issue3531`. Researched from Anthropic platform docs (Fable 5.1 overview
and What's new pages, published with the September 1, 2026 release).

## Researched specs (evidence)

| Spec | Value | Source |
| --- | --- | --- |
| Model ID | `claude-fable-5-1` (Bedrock: `anthropic.claude-fable-5-1`); no date suffix | Model IDs table |
| Context window | 1M tokens, default and maximum, standard pricing across the window | Capabilities table |
| Max output | 128K tokens | Capabilities table |
| Thinking | Adaptive, always on. `budget_tokens` and `disabled` both 400. Unchanged from Fable 5 | "Unchanged from Claude Fable 5" |
| Effort | Default `high`; accepts low/medium/high/xhigh/max | Effort docs |
| Sampling | Non-default `temperature`/`top_p`/`top_k` return 400 | "Unchanged from Claude Fable 5" |
| Forced tool use | `tool_choice` type `any`/`tool` returns 400. New vs Fable 5 | Breaking changes |
| Prefill | Prefilling assistant response returns 400 | "Unchanged from Claude Fable 5" |
| Caching | 1h cache writes $20/MTok supported; reads $0.25/MTok | Pricing table |
| Tokenizer | Identical to Fable 5 (Opus 4.7-era tokenizer) | What's new |
| Availability | Claude API all customers; client gate 2.1.251+ (server-enforced, live 400), staff-confirmed minimum 2.1.255, changelog adds in 2.1.257 | Issue comment (live error), anthropics/claude-code#91331, changelog |

Two repo facts make most of this a parity exercise:

1. `modelDefaults` rule matching in `providerAliases.ts` (line 63-64) is an
   unanchored case-insensitive `RegExp.test`, so the existing alternation
   `claude-(opus-5|opus-4-8|fable-5|sonnet-4-6|sonnet-5)` already matches
   `claude-fable-5-1` as a prefix. The 1M `context-limit` and 128K
   `maxOutputTokens` ephemeral defaults apply without pattern edits.
2. The token estimator already resolves `claude-fable-5-1` through the #3485
   point-release path to the fable-5 family calibration
   (`claudePromptEstimator.test.ts` asserts `method: 'calibrated'` for
   `claude-fable-5-1`). No tokenizer change is needed.

The real gaps: the OAuth static catalog has no `claude-fable-5-1` entry, and
`AnthropicModelData.ts` identity functions miss it, which breaks adaptive
thinking classification, budget rejection, and subscription-tier geometry
defaults for the new ID.

## Behavior specification

### REQ-1: OAuth static catalog includes Fable 5.1

- GIVEN: the `claudecode` alias config
- WHEN: `getModels()` is served from `staticModels`
- THEN: `claude-fable-5-1` appears directly above `claude-fable-5` with
  `contextWindow: 1000000` and `maxOutputTokens: 128000`

### REQ-2: modelDefaults explicitly name fable-5-1

- GIVEN: the `claudecode` and `anthropic` alias configs
- WHEN: the 1M-context rule pattern is read
- THEN: the alternation lists `fable-5-1` explicitly (matching still works by
  prefix, but the config documents the model it intends)
- NOTE: the explicit `fable-5-1` spelling is intentionally unpinned — no
  removal-sensitive guard asserts its presence, because rule matching is
  prefix-based and behavior is identical without it (readability-only edit,
  review finding 3, accepted as-is)

### REQ-3: AnthropicModelData recognizes fable-5-1

- GIVEN: `claude-fable-5-1`, `claude-fable-5-1-latest`,
  `claude-fable-5-1-YYYYMMDD` (real date), case-insensitive
- WHEN: `isFable5` / `supportsAdaptiveThinking` / `getMaxTokensForModel` /
  `getContextWindowForModel` are called
- THEN: they behave exactly as for `claude-fable-5` (adaptive thinking true,
  40000 max output default, 200000 context default), and near-misses
  (`claude-fable-5-1-mini`, `claude-fable-50`, `claude-fable-51`) still miss

### REQ-4: adaptive-only enforcement covers fable-5-1

- GIVEN: a request pinned to `claude-fable-5-1` carrying
  `reasoning.budgetTokens` (or `effortWireFormat: anthropic-budget`)
- WHEN: the request is built
- THEN: it is rejected before transport with the same adaptive-only error text
  shape used for `claude-fable-5` (issue #3255 behavior)

### REQ-5: core model limits list fable-5-1 explicitly

- GIVEN: `model-limits.json`
- WHEN: the exact map is read
- THEN: `claude-fable-5-1` and `claude-fable-5-1-latest` are present at 200000,
  matching the fable-5 entries (the substring rule already catches them; the
  explicit entries mirror how fable-5 itself is listed), and the legacy limits
  expected file agrees with the parity test

### REQ-6: docs mention fable-5-1

- GIVEN: `docs/providers/models-and-limits.md`
- WHEN: the 1M-context model lists are read
- THEN: `claude-fable-5-1` appears alongside the other 1M models

### REQ-7: OAuth User-Agent meets the server-side Fable 5.1 client gate

- GIVEN: an OAuth (`claudecode`) request to the Anthropic API
- WHEN: headers are built by `buildAnthropicCustomHeaders`
- THEN: `User-Agent` is `claude-cli/2.1.257 (external, cli)` (was 2.1.2)
- Evidence ladder: a live request pinned to `claude-fable-5-1` returned 400
  `claude_code_version_too_old` ("version 2.1.251 or newer is required", issue
  comment, req_011CefZkUxiwi9ZmyKCHTJFq); Anthropic staff in
  anthropics/claude-code#91331 confirmed 2.1.255 is the minimum CLI version
  for Fable 5.1; the Claude Code changelog added Fable 5.1 in 2.1.257. The
  User-Agent is the only version-bearing header in the request path. 2.1.257
  is above all three stated minimums.

## Out of scope (documented follow-ups, not this PR)

- Promoting `claude-fable-5-1` to a sanctioned estimator identity (drops the
  warn-once from the #3485 point-release path; estimation is already correct).
- Fable 5.1 beta API surface: per-message effort, turn-scoped system messages,
  `thinking.display: "updates"`.
- `tool_choice` forced-tool-use restriction: the Anthropic provider never sends
  `tool_choice` (verified by search), so no code change is required.

## Phases

Single-phase change (config + identity + tests + docs); no interface changes.

P01: Update configs, AnthropicModelData pattern, model-limits.json, docs, and
all affected tests (factory catalog, modelDefaults, AnthropicModelData, oauth
sentinel, core token limits parity).

## Verification

Full cycle per the issue workflow:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

All green on the pre-remediation tree and re-run green after remediation
(test/lint/typecheck/format/build EXIT 0; logs in tmp/verify3531/ and
tmp/verify3531-remediation/, gitignored).

## Review record

- Round 1 (deepthinker): FAIL. HIGH — OAuth UA `claude-cli/2.1.2` below the
  Fable 5.1 client gate (cited the live 400 on the issue). Remediated: bumped
  to `claude-cli/2.1.257` in `AnthropicApiExecution.ts` + pinned test
  (REQ-7). LOW — oauth sentinel test did not assert fable-5-1 absent from the
  Anthropic API-key catalog. Remediated: both assertions added, tagged
  @issue:3531. LOW — no removal-sensitive guard for the explicit fable-5-1
  alternation spelling. Accepted as-is (REQ-2 NOTE: readability-only edit;
  prefix matching makes behavior identical without it).
- Round 2: verification-only re-run of the full cycle on the remediated tree
  (green); no new findings sought, per the two-cycle cap.
