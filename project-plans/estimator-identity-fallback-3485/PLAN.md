# Plan: Prompt estimator must not block unrecognized model identities (Issue #3485)

Plan ID: PLAN-20260901-ISSUE3485
Generated: 2026-09-01 (amended same day after owner direction)
Total Phases: 1
Requirements: REQ-3485-1 (no-throw), REQ-3485-2 (point releases inherit family calibration), REQ-3485-3 (warn on every degradation), REQ-3485-4 (no other behavior change), REQ-3485-5 (dead code removal)

## Problem

`ModelPromptEstimatorRegistry.estimatePrompt`
(`packages/providers/src/tokenizers/ModelPromptEstimatorRegistry.ts`) throws
`ModelPromptEstimatorError('unresolved-model-identity')` when a model ID is
*claimed* by a registration's claim regex (e.g. `/^claude-fable-5(?:$|-)/i`)
but fails that family's sanctioned-identity check (bare alias, `-latest`, or a
real `-YYYYMMDD` snapshot). A newly released model such as
`claude-fable-5-1` is claimed-but-unsanctioned, so every send throws, the error
propagates through `providerContentEnforcement.estimateProviderProjection`
("Token projection failed at initial stage during provider-content hard-limit
enforcement: ..."), and the request aborts. Users cannot use new model releases
in claimed families at all (issue #3485).

Owner direction (2026-09-01): point releases of a known line (e.g.
`claude-fable-5-1`) must NOT fall back to the legacy estimator — they must use
the family's calibration (fable-5 for fable-5-1) until a dedicated calibration
exists, with a warning. Legacy fallback is only for non-versioned lookalikes.

## Accepted behavior

### REQ-3485-1: No-throw for claimed-but-unsanctioned identities

**Full text**: For a model claimed by a registration whose `matches` check
fails, `estimatePrompt` MUST NOT throw. It MUST either inherit the family
estimate (REQ-3485-2, point releases) or return the legacy-path result
(REQ-3485-3 path): `count` from `request.legacyEstimate()`, `method:
'calibrated'`, `estimatorVersion: 'core-estimate-tokens-v1'`, `assetRevision:
'none'`, `projectionRevision` echoed, family `'legacy-unresolved-identity'`.

**Behavior**:
- GIVEN: provider `claudecode`, model `claude-opus-5-mini`, protocol
  `anthropic-messages`
- WHEN: the runtime estimates the finalized prompt envelope
- THEN: estimation resolves with the legacy count and the request proceeds

**Why**: The registry sits on the request path; any throw blocks usage of the
model entirely.

### REQ-3485-2: Point releases inherit the family calibration

**Full text**: When a claimed-but-unsanctioned model is a *point release* of
the family — the qualifier after the family prefix is one additional numeric
version segment, optionally followed by `-latest` or a real compact
`-YYYYMMDD` date — the registration's estimate MUST be used (the family's
calibration, e.g. fable-5's for `claude-fable-5-1`), after the same
protocol check sanctioned models pass. Only the Claude 5 families declare this
rule (GPT-5.6 and official families keep `matchesPointRelease` unset).

**Behavior**:
- GIVEN: provider `claudecode`, model `claude-fable-5-1`, protocol
  `anthropic-messages` (the issue's exact case)
- WHEN: the runtime estimates the finalized prompt envelope
- THEN: the result comes from the fable-5 calibration — `family
  'anthropic-claude-fable-5'`, `method 'calibrated'`, the real fable-5
  `estimatorVersion`/`assetRevision` — and `legacyEstimate` is NOT called

**Why**: A point release of the same model line keeps the line's tokenizer
characteristics; the calibrated family estimate is far closer than the ~34%
MAPE character heuristic. The owner explicitly directed this over legacy.

### REQ-3485-3: Warn on every degradation

**Full text**: Both degradations (point-release inheritance and
legacy-unregistered fallback) MUST emit one warning per `provider:model` pair
per process through a module-level `DebugLogger`
('llxprt:model-prompt-estimator'). The point-release warning states the model
is not directly calibrated and the family calibration is applied until a
dedicated one exists, so estimates may be less accurate. The legacy warning
states the identity is not sanctioned and the generic estimate may be
inaccurate.

**Behavior**:
- GIVEN: `claude-fable-5-1` estimated twice in one process
- WHEN: each estimate runs
- THEN: the warning fires exactly once; the second estimate is warning-free

**Why**: The issue asks to be warned that estimates could be off; the debug
channel is the providers package's established warning mechanism.

### REQ-3485-4: No other behavior change

**Full text**: Sanctioned identities keep their calibrated estimation
unchanged; sanctioned models (and point releases) on unsupported protocols
still throw `unsupported-protocol`; unclaimed models keep the silent
legacy-unregistered path (no warning); claims on providers the family does not
apply to (e.g. `claude-fable-5-1` via `zai`) keep the silent legacy path;
`claimsModel`/`getEstimatorFamily` stay claim-based; sanctioned-identity rules
in `claudeModelIdentity.ts` (`isSanctionedClaude*`) and `openaiModelPolicy.ts`
are NOT widened; calibration assets, `providerContentEnforcement`,
`promptEnvelopeSendSeam`, and the load-balancer `projection-unavailable` guard
are untouched. The Claude runtime tokenizer
(`createClaudeRuntimeTokenizer`) MUST also accept point releases so per-entry
history accounting uses the same marginal calibration as envelope estimation.

### REQ-3485-5: Dead code removal

**Full text**: Remove the now-unreachable `'unresolved-model-identity'` from
`ModelPromptEstimatorErrorCode`, delete `createIdentityError` in the registry,
and remove the `identityErrorHint` field from
`ModelPromptEstimatorRegistration`, `Claude5FamilySpec`, the Claude specs, the
GPT-5.6 registration, and the official family specs (it existed only to build
the removed error).

## Point-release identity rule (Claude 5)

New helpers in `claudeModelIdentity.ts`, e.g.
`isClaudeOpus5PointReleaseModel` / `isClaudeFable5PointReleaseModel` sharing
one predicate over `(prefix, model)`:

- qualifier after the family prefix (case-insensitive) MUST match
  `-\d+` (one numeric version segment), optionally followed by exactly
  `-latest` or `-\d{8}` where the 8 digits are a real calendar date (reuse
  `isCompactDateSnapshot`)
- anything else (`-mini`, `-thinking`, `-1-20261345` invalid date, `-1-2`
  nested segments, trailing `-`, `-latest` without a numeric segment) is NOT a
  point release → legacy fallback path

Sanctioned identity lists (bare, `-latest`, real `-YYYYMMDD`) are unchanged;
point releases are a separate, explicitly warned category.

## Registration interface change

`ModelPromptEstimatorRegistration` gains an optional
`matchesPointRelease?: (model: string) => boolean`. The registry's
claimed-but-unsanctioned branch becomes:

1. `matchesPointRelease?.(model) === true` → warn-once → protocol check →
   `registration.estimate(request)`
2. otherwise → warn-once → legacy result with family
   `'legacy-unresolved-identity'`

`Claude5FamilySpec` gains the same optional field, wired through
`toRegistration`; `createClaudeRuntimeTokenizer` matches
`matches(m) || matchesPointRelease?.(m)`.

## Boundary cases

- `claude-fable-5-1` — the issue's case; fable-5 calibration, warns once.
- `claude-fable-5-1-latest`, `claude-fable-5-1-20260829` (real date) —
  point releases; same.
- `claude-opus-5-1` — point release of the opus family; opus-5 calibration.
- `CLAUDE-FABLE-5-1` — case-insensitive claim; point release (warning uses the
  reported model string).
- Lookalikes: `claude-opus-5-mini`, `claude-fable-5-mini`, `gpt-5.6-mini`,
  `gpt-5.6-solar`, `gpt-5.6-2026-02-30`, `claude-opus-5-20261345`,
  `claude-fable-5-1-20261345` — legacy fallback, warn once.
- Point release on non-calibrated provider (`claude-fable-5-1` via `zai`):
  registration does not apply — silent legacy path, no warning (unchanged).
- Point release/sanctioned + wrong protocol (`claude-fable-5-1` over
  `openai-chat`): still throws `unsupported-protocol`.
- Unclaimed (`gpt-4.1`, `claude-opus-4-8`): silent legacy path, no warning.

## Test plan (behavioral, TS/Bun)

1. `packages/providers/src/tokenizers/claude/claudeModelIdentity.test.ts`
   - ADD point-release predicate tests: accepts `-1`, `-2`, `-1-latest`,
     `-1-20260829`; rejects `-1-20261345`, `-1-2`, `-mini`, `-1-`, `-latest`,
     `-20260829` (no numeric segment); per-family separation
     (`claude-opus-5-1` is not a fable point release).
   - Existing sanctioned/near-miss lists unchanged.
2. `packages/providers/src/tokenizers/claude/claudePromptEstimator.test.ts`
   - ADD: `claude-fable-5-1` via claudecode resolves with fable-5 family,
     method 'calibrated', real fable-5 estimatorVersion, `legacyEstimate` not
     called; `claude-opus-5-1` → opus family; date-suffixed
     `claude-fable-5-1-20260829` → point release;
     `claude-fable-5-1-20261345` → legacy fallback.
   - REWRITE the three rejection tests ('rejects a Fable 5 lookalike...',
     'rejects an Opus 5 lookalike...', 'still rejects an unsanctioned model
     id on a calibrated provider') to assert legacy fallback: resolves,
     `count` equals the legacy estimate, family
     `'legacy-unresolved-identity'`, `legacyEstimate` called.
   - ADD warning assertions (DebugLogger spy pattern consistent with existing
     prototype spies in the package): point-release warning fires once and not
     on the second estimate; legacy warning fires once.
   - `createClaudeRuntimeTokenizer` block: ADD
     `createClaudeRuntimeTokenizer('claudecode', 'claude-fable-5-1')` defined
     and counting with the fable marginal calibration; keep the
     `claude-opus-5-mini` undefined case.
3. `packages/providers/src/tokenizers/Gpt56O200kPromptEstimator.test.ts`
   - REPLACE 'rejects claimed malformed identity %s without legacy fallback'
     with legacy-fallback assertions for the same model list (family
     `'legacy-unresolved-identity'`, count 999, legacyEstimate called).
   - GPT-5.6 declares no point-release rule, so all lookalikes take the
     legacy path.
4. `packages/providers/src/runtime/providerManagerRuntimeFactories.test.ts`
   - ADD: full `createRuntimeTokenizerFactory().estimatePrompt` with
     `claude-fable-5-1` (anthropic-messages projection, claudecode provider)
     resolves with the fable-5 family — proves the composition wiring lets the
     issue's request through with family calibration (follow the existing
     loader-injection pattern if needed for the encoder).
5. Existing tests that must stay green unchanged: unsupported-protocol
   rejections (Claude + GPT-5.6 + official framing separation), unclaimed
   legacy fallback, sanctioned identity routing, calibration gating,
   runtime-tokenizer provider restriction.

## Files

- Modify: `packages/providers/src/tokenizers/ModelPromptEstimatorRegistry.ts`
  (claimed-but-unsanctioned: point-release inheritance or legacy fallback;
  warn-once via new DebugLogger; delete `createIdentityError`; drop
  `identityErrorHint`; add optional `matchesPointRelease`)
- Modify: `packages/providers/src/tokenizers/ModelPromptEstimatorError.ts`
  (remove the error code)
- Modify: `packages/providers/src/tokenizers/claude/claudeModelIdentity.ts`
  (point-release predicate helpers)
- Modify:
  `packages/providers/src/tokenizers/claude/claudeCalibrationAssets.ts`
  (`Claude5FamilySpec.matchesPointRelease` + both specs)
- Modify: `packages/providers/src/tokenizers/claude/claudePromptEstimator.ts`
  (forward `matchesPointRelease` in `toRegistration`; runtime tokenizer
  accepts point releases)
- Modify: `packages/providers/src/tokenizers/Gpt56O200kPromptEstimator.ts`
  (drop `identityErrorHint` from the registration constant)
- Modify: `packages/providers/src/tokenizers/official/officialPromptEstimators.ts`
  (drop `identityErrorHint` from `OfficialFamilySpec` and registrations)
- Modify tests listed above.

## Out of scope (explicitly)

- Widening sanctioned identity (`isSanctionedClaude*`) or the GPT/official
  identity rules; point releases are a separate warned category, not
  "sanctioned".
- Point-release rules for GPT-5.6 or official families (their versioning is
  different; raise separately if a real release needs it).
- UI-visible notice beyond the debug-channel warning (would need a new
  cross-package event surface; raise separately if wanted).
- Changes to calibration assets, enforcement, send seam, or the load-balancer
  `projection-unavailable` guard.

## Verification

Full cycle per the issue workflow (`npm run test`, `lint`, `typecheck`,
`format`, `build`, bun smoke with profile stepfun-37), plus targeted:
`bun test packages/providers/src/tokenizers/ packages/providers/src/runtime/providerManagerRuntimeFactories.test.ts`
