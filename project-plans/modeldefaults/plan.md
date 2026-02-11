# PLAN: Configurable Model Defaults via Provider Alias Config

## 1. Overview

### Problem Statement

PR #1325 / Issue #1323 introduced `MODEL_EPHEMERAL_DEFAULTS` — a hardcoded TypeScript
constant in the `switchActiveProvider` function of `runtimeSettings.ts` that pattern-matches
model names to ephemeral settings. This works but has fundamental problems:

1. **Not configurable** — adding defaults for new models requires code changes, rebuild, release
2. **Mislocated** — model personality is split away from the provider alias `.config` files
   that already define per-provider behavior
3. **Not user-overridable** — users cannot customize model defaults without forking
4. **Too broad** — the regex `claude.*opus|claude-opus` matches all Opus models ever,
   but only `claude-opus-4-6` supports `reasoning.effort`

Additionally, the core default for `reasoning.includeInContext` is `false`
(in the `EPHEMERAL_DEFAULTS.reasoning` object in `createAgentRuntimeContext.ts`),
which means the model cannot see its own previous reasoning between turns — undermining
multi-turn thinking.

### Solution

1. Add a `modelDefaults` field to the `ProviderAliasConfig` interface / `.config` files
2. Replace the hardcoded `MODEL_EPHEMERAL_DEFAULTS` constant with config-driven logic
3. Apply model defaults in both `switchActiveProvider` AND `setActiveModel`
4. Fix the core `includeInContext` default to `true`
5. Profiles (`skipModelDefaults: true`) continue to have full authority

### Precedence Rules (Most Specific Wins)

The general precedence is:

1. **User/session values** — untouchable (user explicitly set something)
2. **Model defaults** (`modelDefaults` in alias config) — override alias-level settings
3. **Alias `ephemeralSettings`** — provider-wide baseline, fills gaps

However, the mechanism for determining "user/session values" differs between the two
code paths:

#### In `switchActiveProvider`:

Preserved keys (from the `preserveEphemerals` list that survived the ephemeral clear) are
untouchable. These are captured in the `preAliasEphemeralKeys` snapshot AFTER the ephemeral
clearing but BEFORE alias `ephemeralSettings` are applied. Any key in this snapshot represents
user/profile intent and model defaults must not override it.

#### In `setActiveModel`:

Keys whose current value differs from the old model's computed default are treated as
user-owned and untouchable. This is a heuristic — `setActiveModel` does NOT clear ephemerals,
so there is no `preserveEphemerals` list. Instead, the stateless recomputation compares
each key's current value against what the old model's defaults would have set. If they match,
the key is treated as model-defaulted (safe to clear/replace). If they differ, the key is
treated as user-set (untouchable). See "Ambiguous User-Set Equals Old Default Policy" for the
known limitation of this heuristic.

**Implementation in `switchActiveProvider`:**

Snapshot existing ephemeral keys AFTER the ephemeral clearing (which clears everything
except `activeProvider` and `preserveEphemerals`) but BEFORE alias `ephemeralSettings`
are applied. This snapshot (`preAliasEphemeralKeys`) captures exactly the preserved
keys — i.e., the keys from the `preserveEphemerals` list that survived the clear.
These are the only keys that existed before the alias/model-defaults application,
so they represent user-intent (either user-set values or profile-preserved values).
Model defaults must not override these preserved keys.

After alias ephemeral settings are applied, model defaults are applied. Model defaults
can override alias-level ephemeral settings (because those keys were set AFTER our
snapshot, so they're not in `preAliasEphemeralKeys`), but they cannot override
preserved/user-set keys (which ARE in the snapshot).

### WARNING: Intentional Precedence Behavior Change

**This plan intentionally CHANGES the precedence order from the current implementation.**

**Current behavior (PR #1325):** Alias-level `ephemeralSettings` win over model defaults.
The existing `MODEL_EPHEMERAL_DEFAULTS` loop in `switchActiveProvider` (line 1961) only
applies a model default if the key is `undefined` after alias ephemerals are applied.
This means if the alias sets `reasoning.effort: "medium"`, the model default of `"high"`
is silently suppressed.

**New behavior:** Model defaults (more specific — per-model) override alias-level
ephemeral settings (less specific — per-provider). The `preAliasEphemeralKeys` snapshot
captures only user/profile-preserved keys. Alias-level ephemerals are applied first,
then model defaults overwrite them freely (since alias-applied keys are NOT in the
snapshot). Only user-preserved keys are protected.

**Tests that must be updated or inverted:**

- `provider-alias-defaults.test.ts` → `"does not override existing reasoning settings
  with model defaults"` (line 432): This test currently asserts that alias-level
  `reasoning.effort: "medium"` survives when the model default is `"high"`. Under the
  new design, the model default `"high"` SHOULD win (alias `"medium"` is not a
  user-preserved value). This test must be **inverted** to assert that model defaults
  override alias-level ephemerals.

- Search the full codebase (`grep -r 'MODEL_EPHEMERAL_DEFAULTS\|model.*default.*alias\|alias.*ephemeral.*override' packages/`)
  for any other tests that assert the old precedence. Currently no other tests outside
  `provider-alias-defaults.test.ts` assert this behavior, but the subagent must verify
  at implementation time.

**Implementation in `setActiveModel`:**

Unlike `switchActiveProvider`, `setActiveModel` does NOT clear ephemerals. So ALL
current ephemeral keys are present. The guard for `setActiveModel` must use the
**stateless recomputation approach** (see below) to determine which keys should be
cleared (old model defaults) and which should be applied (new model defaults), while
protecting any key whose current value differs from what the old model defaults would
have set (indicating the user or alias changed it).

### Stateless Recomputation for Model Changes

Instead of tracking model-defaulted keys in a mutable `Set<string>` (which doesn't
fit the runtime-scoped architecture in `runtimeSettings.ts` that uses runtime IDs),
use a **stateless recomputation approach**:

When `/model` changes via `setActiveModel`:

1. **Load alias config** for the current active provider
2. **Compute old model defaults** by matching the OLD model name (from `config.getModel()` before
   the change) against the `modelDefaults` patterns in the alias config
3. **Compute new model defaults** by matching the NEW model name against the same patterns
4. **For keys in old defaults but NOT in new defaults:** Clear them, but ONLY if the current
   ephemeral value exactly matches what the old defaults would have set. If the value differs,
   the user or alias overrode it — leave it alone.
5. **For keys in new defaults:** Apply them, but ONLY if either:
   - The key is not currently set (undefined), OR
   - The key's current value matches the old model default for that key (it was model-defaulted,
     not user-overridden)
   Do NOT override keys whose current value differs from the old model default — those are
   user/alias-set values.

### Ambiguous "User-Set Equals Old Default" Policy

**Policy: if the current value equals the old model's default value, treat it as
model-defaulted and allow it to be cleared/replaced.**

This is an acceptable trade-off because:

- **Common case (user hasn't touched the setting)** works perfectly — the value matches the
  old default because it WAS the model default, so it's correctly identified as model-defaulted
  and replaced/cleared as appropriate.
- **Rare case (user explicitly set a value that coincidentally matches the old default)** results
  in the value being replaced by the new model's default — a benign outcome since the user
  can re-set it with `--set` or `/set`.
- **The alternative (stateful tracking via a mutable `Set<string>`)** adds complexity,
  cross-runtime contamination risk, and doesn't survive process restarts or profile reloads.
  The stateless approach is simpler, more predictable, and correct in the vast majority of cases.

This policy MUST be documented with a test that explicitly exercises the edge case:
user sets a value equal to the old model default, switches models, and the value IS replaced
by the new default (confirming the policy, not a bug).

### Profile Authority

All profile-load paths pass `skipModelDefaults: true` to `switchActiveProvider`.
Model defaults from alias config are NEVER applied when a profile is loaded.
This covers:

- `/profile load` → `loadProfileByName` → `applyProfileSnapshot` → `applyProfileWithGuards` → `switchActiveProvider({ skipModelDefaults: true })`
- `--profile-load` CLI flag → `applyProfileSnapshot` in `config.ts` bootstrap → same chain
- Subagents → load profiles through the same `applyProfileSnapshot` path
- Zed integration → calls `loadProfileByName` → same chain

### TDD Approach

All implementation follows strict Test-Driven Development per `dev-docs/RULES.md`:
1. Write failing tests first (RED)
2. Implement minimum code to pass (GREEN)
3. Refactor if valuable
4. Verify full suite + lint + typecheck + build + smoke

### Subagent Coordination

Per `dev-docs/COORDINATING.md`: ONE PHASE = ONE SUBAGENT.
Each phase gets a worker subagent + a verification step.
Phases execute sequentially — never skip, never batch.

**Subagent roles:**
- `typescriptexpert` — implements code changes (tests + production code)
- `deepthinker` — deep review of phase output for correctness, compliance, and
  issue-intent alignment

**Coordinator responsibilities (NOT delegated to subagents):**
- Running `npm run test`, `npm run lint`, `npm run typecheck` between phases
- Basic sanity checks (file existence, grep for removed constants)
- The coordinator does NOT need a subagent just to run verification commands

**Verification phases use `deepthinker`** for deep review: checking that the
implementation matches the plan's intent, that edge cases are covered, that no
regressions were introduced, and that the behavioral change (precedence flip) is
correctly implemented. This is a code-review level check, not just "do tests pass."

---

## 2. Coordinator TodoWrite Protocol

The coordinator MUST create ALL phase todos upfront (including verification phases)
before dispatching the first subagent. Each todo MUST include the assigned subagent name.
Execution is strictly sequential: a phase's verification must PASS before the next
phase begins.

### Required TodoWrite Call at Plan Start

The coordinator creates the following todos IMMEDIATELY before any work begins:

```typescript
TodoWrite({
  todos: [
    {
      id: 'P01',
      content: 'Phase 01: Schema — Add modelDefaults to ProviderAliasConfig (Subagent: typescriptexpert)',
      status: 'pending',
    },
    {
      id: 'P01a',
      content: 'Phase 01a: Verify Phase 01 (Subagent: deepthinker)',
      status: 'pending',
    },
    {
      id: 'P02',
      content: 'Phase 02: Config — Update anthropic.config with modelDefaults (Subagent: typescriptexpert)',
      status: 'pending',
    },
    {
      id: 'P02a',
      content: 'Phase 02a: Verify Phase 02 (Subagent: deepthinker)',
      status: 'pending',
    },
    {
      id: 'P03',
      content: 'Phase 03: Core Default — Fix includeInContext to true (Subagent: typescriptexpert)',
      status: 'pending',
    },
    {
      id: 'P03a',
      content: 'Phase 03a: Verify Phase 03 — HARD GATE (Subagent: deepthinker)',
      status: 'pending',
    },
    {
      id: 'P04',
      content: 'Phase 04: Runtime — Replace MODEL_EPHEMERAL_DEFAULTS in switchActiveProvider (Subagent: typescriptexpert)',
      status: 'pending',
    },
    {
      id: 'P04a',
      content: 'Phase 04a: Verify Phase 04 (Subagent: deepthinker)',
      status: 'pending',
    },
    {
      id: 'P05',
      content: 'Phase 05: Runtime — Apply Model Defaults in setActiveModel (Subagent: typescriptexpert)',
      status: 'pending',
    },
    {
      id: 'P05a',
      content: 'Phase 05a: Verify Phase 05 (Subagent: deepthinker)',
      status: 'pending',
    },
    {
      id: 'P06',
      content: 'Phase 06: Cleanup — Remove Dead Code and Update Test Setup (Subagent: typescriptexpert)',
      status: 'pending',
    },
    {
      id: 'P06a',
      content: 'Phase 06a: Verify Phase 06 (Subagent: deepthinker)',
      status: 'pending',
    },
    {
      id: 'P07',
      content: 'Phase 07: End-to-End Verification and Smoke Test (Subagent: typescriptexpert)',
      status: 'pending',
    },
    {
      id: 'P07a',
      content: 'Phase 07a: Verify Phase 07 (Subagent: deepthinker)',
      status: 'pending',
    },
  ],
});
```

### Execution Rules

1. **Mark `in_progress`** when dispatching a subagent for a phase
2. **Mark `completed`** only after verification PASSES
3. **If verification FAILS:** send back to `typescriptexpert` for remediation, then
   re-verify with `deepthinker` — loop until PASS or blocked
4. **NEVER advance** to phase N+1 until phase N's verification is `completed`
5. **Between phases:** the coordinator itself runs `npm run test && npm run typecheck && npm run lint`
   to confirm the build is healthy. If accumulated changes are complex or a phase required
   multiple remediation attempts, use `deepthinker` for a broader review.
6. **RED before GREEN:** Each verification MUST confirm that tests were written test-first
   (RED before GREEN). The `deepthinker` reviewer should verify that the new tests would
   fail without the corresponding implementation changes — e.g., by checking git diff
   ordering (test files changed before production files), or by confirming the tests assert
   behavior that only exists after the implementation. If the reviewer cannot confirm
   test-first ordering, the phase fails verification and must be remediated.

---

## 3. Anthropic Model Defaults

Based on actual available models:

| Model | reasoning.enabled | reasoning.adaptiveThinking | reasoning.includeInContext | reasoning.effort |
|---|---|---|---|---|
| `claude-opus-4-6` | `true` | `true` | `true` | `"high"` |
| `claude-opus-4-5-20251101` | `true` | `true` | `true` | — |
| `claude-opus-4-1-20250805` | `true` | `true` | `true` | — |
| `claude-sonnet-4-5-20250929` | `true` | `true` | `true` | — |
| `claude-haiku-4-5-20251001` | `true` | `true` | `true` | — |

Config representation (rules merge in order, later rules override earlier for same key):

```json
"modelDefaults": [
  {
    "pattern": "claude-(opus|sonnet|haiku)",
    "ephemeralSettings": {
      "reasoning.enabled": true,
      "reasoning.adaptiveThinking": true,
      "reasoning.includeInContext": true
    }
  },
  {
    "pattern": "claude-opus-4-6",
    "ephemeralSettings": {
      "reasoning.effort": "high"
    }
  }
]
```

**Note on pattern matching:** Patterns use `RegExp.test()`, which performs partial
matching — i.e., the pattern only needs to match a substring of the model name. For
example, `claude-opus-4-6` would technically also match a hypothetical model named
`claude-opus-4-60` or `xcloud-opus-4-6y`. Pattern authors should use anchors (`^`, `$`)
if they need exact matching (e.g., `^claude-opus-4-6$`). For the builtin
`anthropic.config` patterns this is acceptable:
- `claude-(opus|sonnet|haiku)` is intentionally broad to catch dated variants like
  `claude-opus-4-5-20251101`
- `claude-opus-4-6` is specific enough that false positives are extremely unlikely
  (no known model name contains `claude-opus-4-6` as a substring other than the
  intended model)

---

## 4. Files Affected Summary

| File | Change |
|------|--------|
| `packages/cli/src/providers/providerAliases.ts` | Add `ModelDefaultRule` interface, add `modelDefaults?` to `ProviderAliasConfig`, add validation in `readAliasFile` (strip invalid rules at parse time, log warning once per invalid rule per parse call) |
| `packages/cli/src/providers/aliases/anthropic.config` | Add `modelDefaults` array with Claude reasoning rules |
| `packages/cli/src/runtime/runtimeSettings.ts` | Delete the `MODEL_EPHEMERAL_DEFAULTS` constant; update the model-defaults application block inside `switchActiveProvider` to read from `aliasConfig.modelDefaults`; update `setActiveModel` to apply model defaults using stateless recomputation; extract a shared `computeModelDefaults` helper |
| `packages/cli/src/runtime/profileApplication.ts` | No changes needed (already passes `skipModelDefaults: true`) |
| `packages/core/src/runtime/createAgentRuntimeContext.ts` | Change `includeInContext` in the `EPHEMERAL_DEFAULTS.reasoning` object from `false` to `true` |
| `packages/cli/src/runtime/provider-alias-defaults.test.ts` | Rewrite tests to verify defaults come from config, not hardcoded constant; **invert** the precedence test (model defaults now override alias ephemerals) |
| Test file for `EPHEMERAL_DEFAULTS` / `createAgentRuntimeContext` (see Phase 03 for exact path instructions) | Test for updated `includeInContext` default |
| `packages/cli/test-setup.ts` | Update mock alias entries if needed |

---

## 5. Implementation Phases

### Phase 01: Schema — Add `modelDefaults` to `ProviderAliasConfig`

**Subagent:** `typescriptexpert`

**Test first (RED):**

Create/extend tests in a new file `packages/cli/src/providers/providerAliases.modelDefaults.test.ts`:

- Test that `loadProviderAliasEntries()` parses `modelDefaults` from a `.config` file
  that contains a valid `modelDefaults` array
- Test that `modelDefaults` with an invalid regex `pattern` (e.g., `"["` — unclosed bracket)
  is **stripped from the parsed config** and a warning is logged. The returned
  `ProviderAliasEntry.config.modelDefaults` should NOT contain the invalid rule.
- Test that after loading a config with one valid rule and one invalid-pattern rule,
  the returned `modelDefaults` array contains only the valid entry (length === 1)
- Test that `modelDefaults` with `pattern` that is not a string are skipped with warning
- Test that `modelDefaults` with missing `ephemeralSettings` are skipped with warning
- Test that `modelDefaults` with empty array works (no crash)
- Test that configs without `modelDefaults` still load correctly (backward compat)
- Test that `modelDefaults` is present but not an array → field is dropped entirely
  (set to `undefined`), warning is logged
- Test that `modelDefaults` is an array but contains non-object entries (e.g., strings,
  numbers, `null`) → those entries are skipped, warning is logged per skipped entry
- Test that entry has `pattern` field but it's not a string → entry is skipped, warning
  is logged
- Test that entry has `ephemeralSettings` but it's not a plain object (e.g., it's an
  array or a string) → entry is skipped, warning is logged
- Test that entry has `ephemeralSettings` with non-scalar values (e.g., nested objects,
  arrays) → these are **allowed through** at parse time (runtime can handle objects/arrays
  if needed in the future; current alias ephemeral settings already reject non-scalars
  at application time)
- Test that entry has an empty `pattern` string (`""`) → entry is skipped, warning is
  logged (empty regex would match everything)

**Implementation (GREEN):**

1. In `providerAliases.ts`, add the interface:
   ```typescript
   export interface ModelDefaultRule {
     pattern: string;
     ephemeralSettings: Record<string, unknown>;
   }
   ```

2. Add to `ProviderAliasConfig`:
   ```typescript
   modelDefaults?: ModelDefaultRule[];
   ```

3. Add validation in the `readAliasFile` function. The validation contract:

   - **`modelDefaults` is present but not an array** → drop the field entirely (set to
     `undefined` on the returned config), log warning:
     `[ProviderAliases] Ignoring non-array modelDefaults in ${filePath}`

   - **`modelDefaults` is an array but contains non-object entries** → skip those entries,
     log warning per skipped entry:
     `[ProviderAliases] Skipping non-object modelDefaults entry in ${filePath}`

   - **Entry has `pattern` but it's not a string** → skip entry, log warning:
     `[ProviderAliases] Skipping modelDefaults entry with non-string pattern in ${filePath}`

   - **Entry has empty `pattern` string (`""`)** → skip entry, log warning:
     `[ProviderAliases] Skipping modelDefaults entry with empty pattern in ${filePath}`
     (empty regex would match everything, which is almost certainly not intended)

   - **Entry has `ephemeralSettings` but it's not a plain object** → skip entry, log warning:
     `[ProviderAliases] Skipping modelDefaults entry with invalid ephemeralSettings in ${filePath}`

   - **Entry has `ephemeralSettings` with non-scalar values** → these are **allowed through**
     at parse time. Runtime code (`switchActiveProvider`, `setActiveModel`) is responsible for
     filtering at application time. Current alias ephemeral settings already reject non-scalars
     at application time via the `isScalar` check in `switchActiveProvider`.

   - **Entry has valid `pattern` string** → attempt `new RegExp(pattern)` — if it throws,
     log warning **once per invalid rule per parse call**, strip the rule from the returned
     `modelDefaults` array:
     `[ProviderAliases] Skipping modelDefaults entry with invalid regex pattern "${pattern}" in ${filePath}`

   - Only valid, regex-compilable rules survive into the returned `ProviderAliasEntry.config`

   **Logging contract:** Invalid patterns are logged once PER FILE PARSE CALL per
   invalid rule. Since `loadProviderAliasEntries()` may be called multiple times per
   session (e.g., on each provider switch and each model change), the warning may appear
   multiple times across the session — but that's correct because each call to
   `readAliasFile` is a fresh parse. The invalid rule is stripped from the returned
   config so runtime code in `switchActiveProvider` and `setActiveModel` never encounters
   invalid patterns — no try/catch needed around `new RegExp()` at runtime.

   **Note on regex partial matching:** Since `RegExp.test()` performs partial matching,
   pattern authors should use anchors (`^`, `$`) if they need exact model name matching.
   This is a documentation concern, not a validation concern — the parser should NOT
   reject patterns that lack anchors.

**Verification:**
- `npm run test -- packages/cli/src/providers/providerAliases.modelDefaults.test.ts`
- `npm run typecheck`
- `npm run lint`

---

### Phase 02: Config — Update `anthropic.config` with `modelDefaults`

**Subagent:** `typescriptexpert`

**Test first (RED):**

Add tests to `packages/cli/src/providers/providerAliases.modelDefaults.test.ts`:

- Test that the built-in `anthropic.config` has a `modelDefaults` array
- Test that `claude-opus-4-6` matches a rule with `reasoning.effort: "high"`
- Test that `claude-sonnet-4-5-20250929` matches a rule with `reasoning.enabled: true`
  but does NOT have `reasoning.effort` set
- Test that `claude-haiku-4-5-20251001` matches a rule with `reasoning.enabled: true`
- Test that a non-Claude model like `gpt-4o` does NOT match any rule
- Test that rules merge in order (broad rule first, specific rule second)
- Test that if a user has their own `anthropic.config` in `~/.llxprt/providers/` with
  different `modelDefaults`, the user's config wins. This is because the user alias
  directory is checked first in `loadProviderAliasEntries` (via `getAliasDirectories()`),
  and once an alias name is found, the builtin is shadowed. Verify this by mocking
  the user alias dir to contain an `anthropic.config` with a different `modelDefaults`
  and asserting the user's rules are loaded, not the builtin ones.

**Implementation (GREEN):**

Update `packages/cli/src/providers/aliases/anthropic.config`:

```json
{
  "name": "anthropic",
  "modelsDevProviderId": "anthropic",
  "description": "Anthropic Claude API",
  "baseProvider": "anthropic",
  "base-url": "https://api.anthropic.com",
  "defaultModel": "claude-opus-4-6",
  "apiKeyEnv": "ANTHROPIC_API_KEY",
  "ephemeralSettings": {
    "maxOutputTokens": 40000
  },
  "modelDefaults": [
    {
      "pattern": "claude-(opus|sonnet|haiku)",
      "ephemeralSettings": {
        "reasoning.enabled": true,
        "reasoning.adaptiveThinking": true,
        "reasoning.includeInContext": true
      }
    },
    {
      "pattern": "claude-opus-4-6",
      "ephemeralSettings": {
        "reasoning.effort": "high"
      }
    }
  ]
}
```

**Verification:**
- `npm run test -- packages/cli/src/providers/providerAliases.modelDefaults.test.ts`
- `npm run typecheck`
- `npm run lint`

---

### Phase 03: Core Default — Fix `includeInContext` to `true`

**Subagent:** `typescriptexpert`

**WARNING: HARD GATE: Phase 03 is a migration gate. The FULL test suite MUST pass with zero
failures before Phase 04 can start. No exceptions.**

**Pre-implementation triage (REQUIRED before writing any code):**

The subagent MUST run the following grep to identify all tests asserting the old default:

```bash
grep -rn 'includeInContext.*false\|includeInContext.*:.*false' packages/
```

Then categorize EACH hit into one of two breakage classes:

**Class A (safe — will NOT break):** Tests that explicitly set `includeInContext: false`
in their setup. These tests intentionally test the `includeInContext=false` behavior path.
They explicitly call `settingsService.set('reasoning.includeInContext', false)` or set it
in a test fixture/constructor before exercising the code under test. These are FINE — they
override the default and will NOT break from this change.

Known Class A files (confirmed from codebase grep):
- `core/src/providers/openai/OpenAIProvider.reasoning.test.ts` — lines 506, 655, 679:
  explicitly sets `'reasoning.includeInContext': false` in test fixtures
- `core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts` — line 577:
  explicitly calls `settings.set('reasoning.includeInContext', false)`
- `core/src/providers/openai/OpenAIProvider.mistralCompatibility.test.ts` — lines 67, 110, 149, etc.:
  explicitly sets `'reasoning.includeInContext': false` in SettingsService constructor
- `core/src/providers/openai/OpenAIProvider.emptyResponseRetry.test.ts` — line 44:
  explicitly calls `settingsService.set('reasoning.includeInContext', false)`
- `core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts` — lines 471, 656:
  explicitly calls `settingsService.set('reasoning.includeInContext', false)`
- `core/src/providers/anthropic/AnthropicProvider.thinking.test.ts` — line 1158:
  explicitly calls `settingsService.set('reasoning.includeInContext', false)`
- `core/src/providers/openai-vercel/OpenAIVercelProvider.reasoning.test.ts` — line 640:
  explicitly sets `'reasoning.includeInContext': false` in settings
- `core/src/core/geminiChat.issue1150.integration.test.ts` — explicit test

**Class B (will break — needs updating):** Tests that rely on the implicit default being
`false` without explicitly setting it. These tests will BREAK because they depend on
the old default value. The subagent must identify and update these tests.

Known Class B candidates:
- `core/src/providers/openai/OpenAIProvider.ts` line 1172: reads
  `(options.settings.get('reasoning.includeInContext') as boolean) ?? false` — this
  is production code, not a test, but it uses `?? false` as a fallback. After the
  default changes to `true`, the `??` fallback is never reached for normal paths,
  but the logic is still correct (explicit `false` still works).

**The subagent MUST report the categorized list of ALL affected tests before proceeding
to implementation.** Format: a table with columns [File, Line(s), Class, Rationale].

**Test first (RED):**

Find and update the relevant test(s) for the `EPHEMERAL_DEFAULTS` object in
`createAgentRuntimeContext.ts`. The subagent MUST first search for existing tests:

```bash
grep -rn 'EPHEMERAL_DEFAULTS\|createAgentRuntimeContext' packages/ --include='*.test.ts'
```

Use whatever test file already exists for `EPHEMERAL_DEFAULTS` or `createAgentRuntimeContext`.
If no test file exists for this specific constant, create one at:
`packages/core/src/runtime/createAgentRuntimeContext.defaults.test.ts`

The test should assert that the default for `reasoning.includeInContext` is `true`.

Also check and update any tests in `packages/cli/test-setup.ts` that mock
`reasoning.includeInContext` as `true` (these should already be correct since the
test-setup already has `'reasoning.includeInContext': true`).

**Implementation (GREEN):**

In `createAgentRuntimeContext.ts`, in the `EPHEMERAL_DEFAULTS.reasoning` object,
change:

```typescript
// Before:
includeInContext: false, // REQ-THINK-006.2
// After:
includeInContext: true, // REQ-THINK-006.2
```

**IMPORTANT — Post-implementation full suite run (REQUIRED):**

After making the change, the subagent must:

1. Run `npm run test` to find ALL failing tests
2. For each failing test, confirm its class from the triage above
3. Update Class B tests — those that relied on the old default without setting it
4. Class A tests should still pass — they explicitly set the value to `false`
5. If any Class A test unexpectedly fails, investigate (it may have a secondary
   assertion path that depended on the default)
6. Run `npm run test` again — **ALL tests must pass with zero failures**
7. Run `npm run typecheck` and `npm run lint` — both must pass

**Phase 03a verification (HARD GATE):**

The `deepthinker` verification for Phase 03a MUST confirm:
- The FULL test suite passes with zero failures (`npm run test` exit code 0)
- `npm run typecheck` passes
- `npm run lint` passes
- The subagent's categorized test list was produced and is accurate
- No Class B tests were missed (grep output was exhaustive)

**Phase 04 CANNOT start until Phase 03a is marked `completed`.** If any test fails,
the subagent must fix it before the gate opens.

**Verification:**
- `npm run test` (full suite — this is a core change)
- `npm run typecheck`
- `npm run lint`

---

### Phase 04: Runtime — Replace `MODEL_EPHEMERAL_DEFAULTS` in `switchActiveProvider`

**Subagent:** `typescriptexpert`

**WARNING: Pre-implementation verification checkpoint (REQUIRED before writing any code):**

Before making any changes, the subagent MUST:

1. **Re-read** the `switchActiveProvider` function in `runtimeSettings.ts` (currently at
   line 1538, but may have shifted due to Phase 01–03 changes). Read the FULL function
   from its signature to its closing brace.
2. **Verify** the function signature matches what this plan assumes:
   ```typescript
   export async function switchActiveProvider(
     providerName: string,
     options: {
       autoOAuth?: boolean;
       preserveEphemerals?: string[];
       skipModelDefaults?: boolean;
       addItem?: (...) => number;
     } = {},
   ): Promise<ProviderSwitchResult>
   ```
3. **Verify** the ephemeral clearing loop is still at approximately the same location
   (currently lines 1596–1604), and that alias ephemeral settings are still applied
   after the clearing (currently lines 1878–1956).
4. **Verify** the `MODEL_EPHEMERAL_DEFAULTS` loop is still present (currently lines
   1961–1971) and matches the expected structure.
5. **If there are discrepancies** (e.g., line numbers shifted, function signature changed,
   new parameters added by earlier phases), **adapt the implementation accordingly** and
   **report the discrepancies** to the coordinator before proceeding.

This checkpoint prevents stale assumptions in a 2293-line file that may have been
modified by Phases 01–03.

**Test first (RED):**

Rewrite/update `packages/cli/src/runtime/provider-alias-defaults.test.ts`:

- **Delete** tests that reference the `MODEL_EPHEMERAL_DEFAULTS` constant directly
- Test: switching to `anthropic` provider resolves to `claude-opus-4-6` (the default
  model) and gets `reasoning.enabled: true`, `reasoning.adaptiveThinking: true`,
  `reasoning.includeInContext: true`, `reasoning.effort: "high"` from the alias config's
  `modelDefaults`
- Test: when model is `claude-sonnet-4-5-20250929`, gets `reasoning.enabled: true`,
  `reasoning.adaptiveThinking: true`, `reasoning.includeInContext: true` but NOT
  `reasoning.effort`
- Test: when model is a non-Claude model (e.g. via openrouter), no model defaults apply
- Test: `skipModelDefaults: true` suppresses model defaults (profile path)
- Test: **[PRECEDENCE FLIP]** alias-level `ephemeralSettings` sets `reasoning.effort: "medium"`,
  model default sets `reasoning.effort: "high"` — model default WINS because alias keys
  are NOT in the `preAliasEphemeralKeys` snapshot. **This is the inverse of the current
  test `"does not override existing reasoning settings with model defaults"` (line 432)
  which must be rewritten.**
- Test: pre-existing (preserved) ephemeral settings are NOT overridden by model defaults
  (snapshot protection — e.g. a `preserveEphemerals` key survives the clear, ends up
  in `preAliasEphemeralKeys`, and model defaults skip it)
- Test: multiple rules merge in order — broad pattern sets base, specific pattern
  adds/overrides

**`--set` interaction tests (switchActiveProvider context):**

- Test: `--set reasoning.effort=low` applied BEFORE provider switch (via
  `applyCliArgumentOverrides` from a previous session or bootstrap) is preserved in
  `preserveEphemerals`. After `switchActiveProvider('anthropic')`, the model default
  `reasoning.effort: "high"` does NOT override the user's `--set` value `"low"`.
  Setup: call `applyCliArgumentOverrides` with `set: ['reasoning.effort=low']`, then
  call `switchActiveProvider('anthropic', { preserveEphemerals: ['reasoning.effort'] })`.
  Assert `reasoning.effort` is `"low"`.

- Test: `--set reasoning.effort=low` applied AFTER provider switch overrides a model
  default. Setup: switch to anthropic (model defaults apply `reasoning.effort: "high"`),
  then call `applyCliArgumentOverrides` with `set: ['reasoning.effort=low']`. Assert
  `reasoning.effort` is now `"low"`. This proves CLI `--set` overrides win.

- Test: `--profile-load X --set reasoning.effort=low` keeps `low` regardless of
  alias/model defaults. Setup: call `switchActiveProvider('anthropic', { skipModelDefaults: true })`
  (simulating profile load), then call `applyCliArgumentOverrides` with
  `set: ['reasoning.effort=low']`. Assert `reasoning.effort` is `"low"`. This validates
  that `--set` survives because the profile path skips model defaults AND
  `applyCliArgumentOverrides` runs after.

**Profile/subagent path tests (verifying `skipModelDefaults: true` end-to-end):**

- Test: `/profile load` path — model defaults are NOT applied. Set up an alias with
  `modelDefaults` containing `reasoning.effort: "high"`. Call `applyProfileWithGuards`
  (which internally calls `switchActiveProvider({ skipModelDefaults: true })`). Assert
  that `reasoning.effort` is NOT set (or retains the profile's value, not the model default).
  This verifies the end-to-end profile load path, not just that `switchActiveProvider`
  was called with the right flag.
- Test: `--profile-load` bootstrap path — model defaults are NOT applied. Simulate the
  bootstrap flow: call `applyProfileSnapshot` with a profile, then verify that model
  defaults from the alias config are absent.
- Test: subagent profile load — model defaults are NOT applied. Use a fixture that
  simulates a subagent loading a profile via `applyProfileSnapshot`, verify model
  defaults are not applied.

**Implementation (GREEN):**

In the `switchActiveProvider` function in `runtimeSettings.ts`:

1. **Delete** the `MODEL_EPHEMERAL_DEFAULTS` constant (the `ReadonlyArray` of
   `{ pattern: RegExp; settings: Record<string, unknown> }`)
2. **Delete** the import/export of `MODEL_EPHEMERAL_DEFAULTS` if any

3. **Capture the snapshot** of preserved keys. This goes AFTER the ephemeral clearing
   loop (which clears everything except `activeProvider` and `preserveEphemerals` keys)
   but BEFORE alias ephemeral settings are applied:

   ```typescript
   // Snapshot of keys that survived the ephemeral clear.
   // These are exactly the preserveEphemerals-listed keys that had values.
   // Model defaults must NOT override these — they represent user/profile intent.
   const preAliasEphemeralKeys = new Set(
     Object.keys(config.getEphemeralSettings()),
   );
   ```

   **Why this works:** `switchActiveProvider` clears all ephemerals at the start
   (except `activeProvider` and those in `preserveEphemerals`). So by the time we
   take this snapshot, the ONLY surviving keys are the preserved ones. These represent
   user/profile intent (e.g., auth keys, reasoning settings from profile). When we
   later apply model defaults, we skip any key in this snapshot — ensuring model
   defaults never clobber user-preserved values.

4. **Replace the model-defaults application block** (the loop over
   `MODEL_EPHEMERAL_DEFAULTS` inside `switchActiveProvider`):

   ```typescript
   if (!skipModelDefaults && modelToApply && aliasConfig?.modelDefaults) {
     for (const rule of aliasConfig.modelDefaults) {
       // Invalid rules were already stripped at parse time in readAliasFile
       const regex = new RegExp(rule.pattern, 'i');
       if (regex.test(modelToApply)) {
         for (const [key, value] of Object.entries(rule.ephemeralSettings)) {
           if (!preAliasEphemeralKeys.has(key)) {
             config.setEphemeralSetting(key, value);
           }
         }
       }
     }
   }
   ```

   Note: no try/catch needed for `new RegExp` here because `readAliasFile` already
   stripped invalid patterns at parse time (Phase 01).

**Verification:**
- `npm run test -- packages/cli/src/runtime/provider-alias-defaults.test.ts`
- `npm run test` (full suite)
- `npm run typecheck`
- `npm run lint`

---

### Phase 05: Runtime — Apply Model Defaults in `setActiveModel`

**Subagent:** `typescriptexpert`

**WARNING: Pre-implementation verification checkpoint (REQUIRED before writing any code):**

Before making any changes, the subagent MUST:

1. **Re-read** the `setActiveModel` function in `runtimeSettings.ts` (currently at
   line 2182, but may have shifted due to Phase 01–04 changes). Read the FULL function
   from its signature to its closing brace.
2. **Verify** the function signature matches what this plan assumes:
   ```typescript
   export async function setActiveModel(
     modelName: string,
   ): Promise<ModelChangeResult>
   ```
3. **Verify** the function still captures `previousModel` from
   `providerSettings.model || config.getModel()` before calling `config.setModel(modelName)`.
4. **Verify** the `ModelChangeResult` return type still has: `providerName`,
   `previousModel`, `nextModel`, `authRefreshed`.
5. **Also re-read** `switchActiveProvider` to verify that the `computeModelDefaults`
   helper (if extracted in Phase 04) is available, or if Phase 04 used inline code
   instead. Adapt accordingly.
6. **If there are discrepancies** (e.g., function was refactored, new parameters added,
   `computeModelDefaults` wasn't extracted), **adapt the implementation accordingly** and
   **report the discrepancies** to the coordinator before proceeding.

This checkpoint prevents stale assumptions in a 2293-line file that may have been
modified by Phases 01–04.

**Test first (RED):**

Create or extend tests (e.g. in `provider-alias-defaults.test.ts` or a new
`model-defaults-on-model-change.test.ts`):

**Core model-change behavior:**

- Test: calling `setActiveModel('claude-opus-4-6')` on the `anthropic` provider
  applies model defaults (`reasoning.effort: "high"`, etc.)
- Test: calling `setActiveModel('claude-sonnet-4-5-20250929')` applies reasoning
  defaults but NOT `reasoning.effort`
- Test: calling `setActiveModel('claude-sonnet-4-5-20250929')` after previously
  having `claude-opus-4-6` (which set `reasoning.effort: "high"`) clears the
  `reasoning.effort` that was model-defaulted — it should not persist from the
  old model. **Stateless recomputation approach:** the old model's defaults are
  recomputed from the alias config, the new model's defaults are computed, and
  `reasoning.effort` (in old defaults but not in new defaults, and current value
  matches old default) is cleared.
- Test: if the user manually set `reasoning.effort` to `"low"` (overriding the
  `claude-opus-4-6` model default of `"high"`), then switching to
  `claude-sonnet-4-5-20250929` does NOT clear `reasoning.effort` — the current
  value `"low"` differs from the old model default `"high"`, so it's user-owned.
- Test: user-set ephemeral settings are NOT overridden by model defaults on model change
- Test: when there is no alias config for the active provider, model change works
  without error (no model defaults applied)
- Test: when model is `undefined` (no previous model), `setActiveModel('claude-opus-4-6')`
  applies defaults normally (old defaults are `{}`)

**Ambiguous "user-set equals old default" edge case (documenting the policy):**

- Test: **[POLICY DOCUMENTATION]** User explicitly sets `reasoning.effort` to `"high"`
  (which happens to equal the `claude-opus-4-6` model default). Then user switches to
  `claude-sonnet-4-5-20250929`. The stateless recomputation sees
  `current value ("high") === old default ("high")` and treats it as model-defaulted,
  so it clears `reasoning.effort`. **This is expected behavior per the ambiguous-case
  policy** — the stateless approach cannot distinguish user-set-to-same-value from
  model-defaulted. The test name should explicitly reference this policy, e.g.:
  `"clears value matching old default even if user-set (stateless policy trade-off)"`.

**Alias-set value vs model-default edge case:**

- Test: **[ALIAS-SET EQUALS MODEL DEFAULT]** Alias `ephemeralSettings` sets
  `reasoning.enabled: true` at provider level. Model default also sets
  `reasoning.enabled: true` (via the broad `claude-(opus|sonnet|haiku)` pattern).
  User switches from `claude-opus-4-6` to a non-Claude model (no `modelDefaults`
  entries match). `reasoning.enabled` IS cleared because the current value (`true`)
  matches the old model default (`true`), so the stateless recomputation treats it
  as model-defaulted. **This is correct behavior** — within the same provider, the
  model default was the authoritative source for this value (applied after alias
  ephemerals per the precedence rules). The alias-level value would be re-applied
  on the next `switchActiveProvider` call. The test name should reference this, e.g.:
  `"clears alias-set value that matches model default on switch to non-matching model"`.

  Note: this edge case only matters for keys that appear in BOTH alias `ephemeralSettings`
  and a `modelDefaults` rule. For keys like `maxOutputTokens` that only appear in alias
  `ephemeralSettings` (and not in any `modelDefaults` rule), the stateless recomputation
  ignores them entirely — they are not in `oldDefaults` or `newDefaults`, so they persist
  unchanged across model switches.

**Model-change transition matrix:**

- Test: **Opus-4-6 → Sonnet-4-5**: `reasoning.effort` is cleared (was in Opus-4-6's
  model defaults, not in Sonnet-4-5's, and current value matches old default).
  `reasoning.enabled` stays `true` (in both models' defaults, value unchanged).
  `reasoning.adaptiveThinking` stays `true` (in both). `reasoning.includeInContext`
  stays `true` (in both).

- Test: **Sonnet-4-5 → Opus-4-6**: `reasoning.effort` is added (not in Sonnet's defaults,
  IS in Opus's defaults, key was `undefined` → new default applied).
  `reasoning.enabled` stays `true` (in both, value unchanged).

- Test: **Opus-4-6 → non-Claude model** (e.g., `gpt-4o` on a hypothetical openrouter
  alias with no `modelDefaults`): ALL Claude model defaults are cleared
  (`reasoning.enabled`, `reasoning.adaptiveThinking`, `reasoning.includeInContext`,
  `reasoning.effort`) because old defaults exist but new defaults are `{}`, and all
  current values match old defaults.

- Test: **non-Claude → Opus-4-6**: All applicable defaults are applied fresh
  (`reasoning.enabled: true`, `reasoning.adaptiveThinking: true`,
  `reasoning.includeInContext: true`, `reasoning.effort: "high"`) because old defaults
  are `{}` and all new default keys are `undefined`.

**`--set` interaction tests (setActiveModel / `/model` context):**

- Test: after `--set reasoning.effort=low` (applied via `applyCliArgumentOverrides`),
  calling `setActiveModel('claude-opus-4-6')` should NOT overwrite the user-set
  `reasoning.effort=low` with the model default `high`. Setup: switch to anthropic
  (model defaults apply `reasoning.effort: "high"`), then simulate `--set` by calling
  `config.setEphemeralSetting('reasoning.effort', 'low')`, then call
  `setActiveModel('claude-opus-4-6')`. Assert `reasoning.effort` is still `"low"`.
  Rationale: the current value `"low"` differs from the old model default `"high"`,
  so the recomputation treats it as user-owned and does not overwrite.

- Test: `/model claude-opus-4-6` (applies model default `reasoning.effort: "high"`)
  then user runs `--set reasoning.effort=low` → user's value wins and sticks.
  Setup: switch to anthropic (model defaults apply), confirm `reasoning.effort` is
  `"high"`, then call `config.setEphemeralSetting('reasoning.effort', 'low')`.
  Assert `reasoning.effort` is `"low"`. Then call `setActiveModel('claude-opus-4-6')`
  again. Assert `reasoning.effort` is still `"low"` (current value `"low"` ≠ old
  default `"high"`, so it's treated as user-owned).

- Test: `--set reasoning.effort=low` then `/model claude-opus-4-6` → model default
  does NOT override user's `--set` value. Setup: switch to anthropic with a different
  model (e.g., `claude-sonnet-4-5-20250929`), then call
  `config.setEphemeralSetting('reasoning.effort', 'low')`, then call
  `setActiveModel('claude-opus-4-6')`. Assert `reasoning.effort` is still `"low"`.
  Rationale: old model (sonnet) has no `reasoning.effort` default, so current value
  `"low"` doesn't match any old default → treated as user-owned → not overwritten.

**`--profile-load` bootstrap interaction with `--set`:**

- Test: `--profile-load X --set reasoning.effort=low` keeps `low` regardless of
  alias/model defaults. Setup: call `switchActiveProvider('anthropic', { skipModelDefaults: true })`
  (simulating profile load), then call `applyCliArgumentOverrides` with
  `set: ['reasoning.effort=low']`. Assert `reasoning.effort` is `"low"`. Then
  call `setActiveModel('claude-opus-4-6')`. Assert `reasoning.effort` is still `"low"`.
  This validates the full `--profile-load` + `--set` bootstrap sequence.

**Implementation (GREEN):**

In `runtimeSettings.ts`:

1. **Extract a shared helper** used by both `switchActiveProvider` and `setActiveModel`:
   ```typescript
   /**
    * Compute merged ephemeral settings from modelDefaults rules that match a model name.
    * Rules are applied in order — later rules override earlier for the same key.
    * Returns a flat Record of the merged settings.
    */
   function computeModelDefaults(
     modelName: string,
     modelDefaultRules: ModelDefaultRule[],
   ): Record<string, unknown> {
     const merged: Record<string, unknown> = {};
     for (const rule of modelDefaultRules) {
       const regex = new RegExp(rule.pattern, 'i');
       if (regex.test(modelName)) {
         for (const [key, value] of Object.entries(rule.ephemeralSettings)) {
           merged[key] = value;
         }
       }
     }
     return merged;
   }
   ```

2. **Update `setActiveModel`** to apply model defaults using stateless recomputation.

   Concrete pseudocode showing exactly where in the current function the recomputation
   happens (referencing the current `setActiveModel` at line 2182 of `runtimeSettings.ts`):

   ```typescript
   export async function setActiveModel(
     modelName: string,
   ): Promise<ModelChangeResult> {
     const { config, settingsService, providerManager } = getCliRuntimeServices();

     const activeProvider = providerManager.getActiveProvider();
     if (!activeProvider) {
       throw new Error('No active provider is available.');
     }

     const providerSettings = getProviderSettingsSnapshot(
       settingsService,
       activeProvider.name,
     );

     // ---- STEP 1: Capture oldModel BEFORE mutation ----
     const previousModel =
       (providerSettings.model as string | undefined) || config.getModel();

     // ---- STEP 2: Set/validate new model (existing code) ----
     const authRefreshed = false;
     try {
       settingsService.set('activeProvider', activeProvider.name);
       await settingsService.updateSettings(activeProvider.name, {
         model: modelName,
       });
     } catch (error) {
       logger.warn(
         () =>
           `[cli-runtime] Failed to persist model change via SettingsService: ${error}`,
       );
     }

     config.setModel(modelName);

     // ---- STEP 3: Load alias config for current provider ----
     let aliasConfig: ProviderAliasConfig | undefined;
     try {
       aliasConfig = loadProviderAliasEntries().find(
         (entry) => entry.alias === activeProvider.name,
       )?.config;
     } catch {
       // If alias loading fails, skip model defaults silently (no error)
       aliasConfig = undefined;
     }

     // ---- STEP 4: Stateless recomputation of model defaults ----
     // Only proceed if the alias has modelDefaults defined.
     // If aliasConfig is undefined (alias not found) or modelDefaults is missing:
     //   → no-op, no error. Model change completes normally without defaults.
     // If previousModel is undefined (first model set, no prior model):
     //   → oldDefaults is {}, so all newDefaults are applied unconditionally.
     if (aliasConfig?.modelDefaults) {
       // STEP 4a: Compute oldDefaults by matching OLD model name
       const oldDefaults = previousModel
         ? computeModelDefaults(previousModel, aliasConfig.modelDefaults)
         : {};

       // STEP 4b: Compute newDefaults by matching NEW model name
       const newDefaults = computeModelDefaults(
         modelName,
         aliasConfig.modelDefaults,
       );

       // STEP 4c: For keys in oldDefaults but NOT in newDefaults —
       //   clear them ONLY if current value equals the old default value.
       //   If current value differs → user/alias overrode it → leave it alone.
       //
       //   NOTE (Ambiguous Case Policy): If the user explicitly set a value
       //   that happens to equal the old model default, the stateless approach
       //   cannot distinguish this from a model-defaulted value. Per policy,
       //   we treat it as model-defaulted and clear/replace it. See §1
       //   "Ambiguous User-Set Equals Old Default Policy" for rationale.
       for (const [key, oldValue] of Object.entries(oldDefaults)) {
         if (!(key in newDefaults)) {
           const currentValue = config.getEphemeralSetting(key);
           if (currentValue === oldValue) {
             config.setEphemeralSetting(key, undefined);
           }
           // else: current value differs from old default — user-set, don't clear
         }
       }

       // STEP 4d: For keys in newDefaults — apply using precedence logic:
       //   - If key is not currently set → apply new default
       //   - If key's current value matches old model default → it was model-defaulted,
       //     safe to overwrite with new default
       //   - If key's current value differs from old model default → user/alias set it,
       //     do NOT override
       for (const [key, newValue] of Object.entries(newDefaults)) {
         const currentValue = config.getEphemeralSetting(key);
         if (currentValue === undefined) {
           config.setEphemeralSetting(key, newValue);
         } else if (key in oldDefaults && currentValue === oldDefaults[key]) {
           config.setEphemeralSetting(key, newValue);
         }
         // else: current value differs from old default — user/alias set it, don't override
       }
     }

     return {
       providerName: activeProvider.name,
       previousModel,
       nextModel: modelName,
       authRefreshed,
     };
   }
   ```

   **Behavior when alias not found:** If `loadProviderAliasEntries().find(...)` returns
   `undefined` (no alias config for the active provider), `aliasConfig` is `undefined`,
   the `if (aliasConfig?.modelDefaults)` guard short-circuits, and no model defaults are
   applied. No error is thrown. This is correct for providers like `openai` that may not
   have a `modelDefaults` section.

   **Behavior when model is undefined:** If `previousModel` is `undefined` (e.g., first
   model set on a fresh provider), `oldDefaults` is `{}`. This means all `newDefaults`
   keys will hit the `currentValue === undefined` branch and be applied unconditionally.

3. **Refactor `switchActiveProvider`** to also use `computeModelDefaults` internally
   (optional cleanup — the Phase 04 inline loop is equivalent, but using the helper
   is cleaner).

**Verification:**
- `npm run test` (full suite)
- `npm run typecheck`
- `npm run lint`

---

### Phase 06: Cleanup — Remove Dead Code and Update Test Setup

**Subagent:** `typescriptexpert`

**Tasks:**

1. Verify the `MODEL_EPHEMERAL_DEFAULTS` constant is no longer exported or referenced
   anywhere (it should have been deleted in Phase 04, but check for stale
   imports/references throughout the codebase)
2. Update `packages/cli/test-setup.ts` if the mock alias entries need `modelDefaults`
3. Update any other test files that referenced `MODEL_EPHEMERAL_DEFAULTS`
4. Ensure the `anthropic.config` no longer has the old reasoning settings at the
   alias-level `ephemeralSettings` (only `maxOutputTokens: 40000` should remain there)

**Verification:**
- `npm run test` (full suite — all tests must pass)
- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npm run build`

---

### Phase 07: End-to-End Verification and Smoke Test

**Subagent:** `typescriptexpert`

**Tasks:**

1. Run full verification cycle:
   ```bash
   npm run test
   npm run lint
   npm run typecheck
   npm run format
   npm run build
   node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
   ```

2. Verify no regressions in:
   - Profile loading (model defaults NOT applied)
   - Provider switching (model defaults applied from config)
   - Model switching via `/model` (model defaults applied, old ones cleaned up)
   - Non-anthropic providers (no model defaults, no errors)

**Verification:**
- All commands above exit cleanly
- Smoke test produces a haiku response

---

## 6. Phase Execution Checklist (for Coordinator)

Per `dev-docs/COORDINATING.md`, the coordinator MUST:

```
P01  → typescriptexpert (schema + validation + tests) → P01a deepthinker verify (test + typecheck + lint + RED-before-GREEN check)
P02  → typescriptexpert (config + tests)              → P02a deepthinker verify (test + typecheck + lint + RED-before-GREEN check)
P03  → typescriptexpert (core default + triage)       → P03a deepthinker verify (FULL test suite HARD GATE + typecheck + lint + RED-before-GREEN check)
P04  → typescriptexpert (switchActiveProvider)         → P04a deepthinker verify (FULL test suite + typecheck + lint + RED-before-GREEN check)
P05  → typescriptexpert (setActiveModel)               → P05a deepthinker verify (FULL test suite + typecheck + lint + RED-before-GREEN check)
P06  → typescriptexpert (cleanup)                      → P06a deepthinker verify (FULL suite + format + build + RED-before-GREEN check)
P07  → typescriptexpert (e2e + smoke)                  → P07a deepthinker verify (smoke test output + RED-before-GREEN check)
```

The coordinator itself runs basic checks (`npm run test && npm run typecheck && npm run lint`)
between phases to confirm the build is healthy. The coordinator does NOT need a subagent
just to run these verification commands.

`deepthinker` is used for verification phases to perform deep review: checking that the
implementation matches the plan's intent, edge cases are covered, no regressions were
introduced, and the behavioral change (precedence flip) is correctly implemented.

If ANY phase fails verification:
1. Do NOT proceed to next phase
2. Send failed phase back to `typescriptexpert` for remediation
3. Re-verify with `deepthinker`
4. Repeat until PASS or blocked

---

## 7. Risk Assessment

### Low Risk
- Schema addition to `ProviderAliasConfig` is additive
- `anthropic.config` change is the same data, just moved to the right place
- `skipModelDefaults` profile protection is already proven

### Medium Risk
- `includeInContext` core default change may cause test failures that need
  careful triage (incidental vs. intentional `false` assertions)
- `setActiveModel` stateless recomputation logic adds new behavior that
  must be carefully tested for edge cases
- Ambiguous "user-set equals old default" case is a known trade-off that
  must be documented with an explicit test

### High Risk
- Precedence flip (model defaults > alias ephemerals) changes observable behavior.
  Must be carefully communicated through inverted tests and documentation.
- Phase 03 `includeInContext` change is a core default affecting multiple
  packages — requires exhaustive triage and a hard gate before proceeding.
