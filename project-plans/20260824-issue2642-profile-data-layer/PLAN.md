# Issue #2642 — Profile data-layer prep

Branch: `issue2642`

## Goal

Prepare the profile data layer so a single resolver (#2643) can be built against
the **existing v1 on-disk format**. No format change, no migration, no version
bump. Existing profiles must load unchanged.

Four deliverables:

1. One profile parser.
2. Delete dead load-balancer schema.
3. Registry `owner` / `propagation` metadata.
4. Stop reading application-owned keys from profiles.

## Grounding: what is actually there today

Verified on `main` at branch point.

### Parse sites

`parseProfile` / `parseLoadBalancerProfile` live in
`packages/settings/src/settings/validation.ts` (L202, L228). Callers and
independent parse paths:

| Site | Note |
| --- | --- |
| `settings/profiles/ProfileManager.ts:197` | `JSON.parse` then dispatch to parseProfile/parseLoadBalancerProfile |
| `settings/profiles/ProfileManager.ts:130,176` | raw `JSON.parse` of **member** files during LB reference validation |
| `settings/profiles/ProfileManager.ts:260` | raw `JSON.parse` in `findLoadBalancersReferencing` |
| `settings/profiles/canonicalProfileRepair.ts:165,211,462` | raw `JSON.parse` + `parseProfile` |
| `cli/config/legacyProfileNormalization.ts:302,317` | raw `JSON.parse` + `parseProfile` |
| `cli/config/profileBootstrap.ts:449` | `parseInlineProfile`, bespoke validation for `--profile` inline JSON |
| `agents/api/control/profilesControl.ts:438` | raw `JSON.parse` of a fixtures dir scan |
| `settings/profiles/profileStore.ts:214` | `readProfileFileSync` JSON parse (low-level read, acceptable) |

### Dead LB schema

- `settings/profiles/types.ts:194` `LoadBalancerSubProfileConfig`
- `settings/profiles/types.ts:205` `LoadBalancerConfig`
- `settings/profiles/types.ts:220` `StandardProfile.loadBalancer?`
- `settings/settings/validation.ts:85` `loadBalancerConfigSchema`
- `settings/settings/validation.ts:106` `loadBalancer: loadBalancerConfigSchema.optional()`

Production readers of `.loadBalancer`: **none**. Only two test files construct
it (`providers/src/runtime/__tests__/profileApplication.lb.detection.test.ts:492`,
`providers/src/__tests__/LoadBalancingProvider.types.test.ts:81`).

### Registry

`SETTINGS_REGISTRY` = 121 entries across `registry-entries-{1,2,3}.ts`.
`SettingSpec` is in `registry/registry-types.ts:20`.

**All 121 entries have `persistToProfile: true`.** The flag currently carries no
information. Category split:

| category | count |
| --- | --- |
| `cli-behavior` | 74 |
| `model-behavior` | 18 |
| `provider-config` | 16 |
| `model-param` | 13 |
| `custom-header` | 2 |

The 74 `cli-behavior` keys are the mixed bucket and need real classification.

### Application-owned keys

`emojifilter` (`registry-entries-2.ts:180`), `dumponerror` (:189),
`dumpcontext` (:198) are `category: 'cli-behavior'`, `persistToProfile: true`.
`ui.showReasoning` is **not** in the registry — confirm where it lives before
touching it; it may be a `settings.json` key only, in which case item 4 covers
three keys, not four.

### LB minimum-member inconsistency

- `validation.ts` `loadBalancerProfileSchema`: `profiles: z.array(...).min(1)` — accepts 1.
- `cli/ui/commands/profileLoadBalancer.ts:346`: rejects `< 2` on save.

A hand-authored 1-member LB therefore loads but cannot be re-saved. Pick one
rule and apply it in both places. Recommend: **accept >= 1 on load** (do not
break existing files) and **require >= 2 on interactive create**, but make the
load path's behavior explicit and tested rather than incidental.

## Test-first approach

TDD per `dev-docs/RULES.md` and the `typescript-test-writing` skill. Bun +
`bun:test` only. No new `.js`. No vitest.

Behavioral tests, not mock theater. For this issue that means: write real
profile JSON to a temp directory and read it back through the real parser and
real `ProfileManager`. Filesystem is infrastructure and may be a temp dir; the
parser and registry are the components under test and must be real.

Use a shared `useTempDir()`-style helper rather than repeating temp-dir
setup/teardown per describe block.

### Required test coverage

**Item 1 — one parser**

- A malformed profile produces the same typed error regardless of which entry
  point read it (ProfileManager load, repair scan, legacy normalization,
  inline `--profile`).
- LB member reference validation rejects a missing member and a nested LB, via
  the shared parser rather than an inline `JSON.parse`.
- `findLoadBalancersReferencing` returns correct results for a directory
  containing a mix of valid, invalid, and non-profile JSON files.
- Inline `--profile` JSON and an on-disk profile with identical content produce
  an identical parsed result.
- Prototype-pollution input (`__proto__`, `constructor`) is rejected, matching
  the current `profileBootstrap` behavior. Do not regress this.

**Item 2 — dead schema removal**

- A profile file containing a legacy `loadBalancer` key still loads
  successfully and the key is ignored (the schema is `.passthrough()`, so
  removing the field must not start rejecting such files).
- Type-level: `StandardProfile` no longer exposes `loadBalancer`.

**Item 3 — registry metadata**

- Drift test: every entry in `SETTINGS_REGISTRY` has an `owner` and a
  `propagation`. This must fail if a new key is added without them.
- `owner` values partition correctly: a representative key from each owner
  returns the expected owner.
- `getProfilePersistableKeys()` no longer returns application-owned keys.

**Item 4 — application keys**

- A profile file containing `emojifilter` / `dumpcontext` / `dumponerror` loads
  without error and those values are NOT applied to profile-scoped state.
- Saving a profile does not write those keys.
- The application setting still works via `/settings` (or its current path).

**Regression guard for the whole issue**

- A fixture set of real-shaped v1 profiles (standard, LB, LB member, profile
  with legacy `loadBalancer`, profile with app keys, profile with unknown keys)
  all load without error and without a version bump.

## Implementation notes

- `owner` and `propagation` should be **required** fields on `SettingSpec` so
  the compiler enforces them on all 121 entries, with the drift test as a
  runtime backstop.
- Proposed `owner` values: `application` | `provider-connection` | `model` |
  `agent-policy`. Proposed `propagation`: `render-immediate` | `next-turn` |
  `service-reconfigure` | `profile-transition` | `restart-required`.
- `category` already maps most non-`cli-behavior` keys. Do NOT delete
  `category`; it has other consumers. Add alongside it.
- The 74 `cli-behavior` keys need per-key judgement. Auth/endpoint/socket/header
  keys are `provider-connection`; reasoning/compression/context keys are
  `model`; tools/shell/loop/timeout keys are `agent-policy`; emoji/dump/UI keys
  are `application`.
- `persistToProfile` becoming meaningful (not all-true) is a consequence of item
  4. Verify no consumer depends on it being all-true.
- Removing keys from profile persistence changes `PROFILE_EPHEMERAL_KEYS` in
  `providers/src/runtime/profileSnapshot.ts:98`. Check that this does not break
  `buildRuntimeProfileSnapshot` for existing saved profiles.

## Out of scope

Do not implement, and reject any suggestion to add:

- `ProfileDocumentV2`, typed section restructuring, or any format version bump
- qualified IDs, scopes, safe-name rules
- etags, reverse references, repository events, read-only forking
- generation/journal migration, locks beyond what `profileStore` already has,
  checksums, backups, rollback
- schema-derived redaction or telemetry serializers
- the single resolver itself (that is #2643)
- deleting any profile applier (that is #2640 / #2637 / #2644)

## Verification cycle

Run in full before commit, before push, and before PR:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus:

```bash
bun scripts/test-audit/scan.ts tmp/scan-branch
```

No new MOCK_MIRROR / ALWAYS_TRUE / SELF_CONFIRMING / NO_ASSERT findings on
touched files.

## Review findings addressed

Open code review raised 9 findings. All actioned except one, noted below.

| Severity | Finding | Action |
| --- | --- | --- |
| bug · high | `getProfilePersistableKeys()` filtered on `owner !== 'application'` as well as `persistToProfile`, silently overriding the flag for `token-usage-log` (application-owned but legitimately persisted) | Removed the blanket owner filter; the per-spec flag is now the single source of truth. Added a regression test pinning `token-usage-log`. |
| bug · high | Same issue from the registry side: `token-usage-log` spec/runtime contract mismatch | Resolved by the above; no behavior change for that key. |
| maintainability · medium | `ProfileManager.parseProfileContent` discarded the JSON position info from the underlying error | Chained via `cause`. |
| test · medium | Exclusion assertions could pass vacuously on an empty persistable set | Added positive controls (`length > 0`, `auth-key` present). |
| test · medium | A test claimed "--context-limit filtering" that does not exist | Rewritten into three accurate tests: arity guard, one-member-after-stripping, and flag-stripping with two members. The flag turned out to matter (it clears the arity guard), so the original assertion was reaching the right branch for the wrong stated reason. |
| test · low | `toBeGreaterThan(100)` headcount was brittle | Relaxed to a non-empty check. |
| maintainability · low | Repair path collapsed `unsafe` into `invalid-json`, losing the distinction | Surfaced kind + message at the user-facing `validateReplacementFile` boundary; documented the deliberate collapse in the internal eligibility path. |
| maintainability · low | `responses-mode` propagation diverged from its `apiMode`/`responsesMode`/`openaiResponsesEnabled` siblings; `api-version` owned by `model` despite describing the connection | Aligned `responses-mode` to `service-reconfigure` and `api-version` to `provider-connection`; added a comment linking the sibling group. |

### Known follow-up (not done here)

`owner`/`propagation` pairs are repeated inline across ~121 registry entries.
Review suggested extracting shared constants
(e.g. `const MODEL_NEXT_TURN = { owner: 'model', propagation: 'next-turn' } as const`).
This is a reasonable drift-reduction refactor and the `responses-mode`
inconsistency above is evidence for it, but it touches every entry and is
mechanical churn unrelated to this issue's behavior. Deferred deliberately.

## Acceptance criteria (from the issue)

- One profile parser. No raw `JSON.parse` of a profile file outside it.
- Minimum-member rule for load balancers consistent between parse and save.
- Dead LB schema deleted with no remaining production or test references.
- Every registry key has `owner` and `propagation`, enforced by a drift test.
- `emojifilter`, `dumpcontext`, `dumponerror`, `ui.showReasoning` have no
  profile read or write path; existing profiles containing them load without
  error.
- No on-disk format version change. Existing standard and LB profiles load
  unchanged.
- Full verification passes.
