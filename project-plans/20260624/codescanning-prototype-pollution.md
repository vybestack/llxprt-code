# CodeQL — js/prototype-polluting-assignment & js/prototype-pollution-utility (alerts 142, 143, 144, 145)

**Rules:**
- `js/prototype-polluting-assignment` (alerts 142, 143, 144) — medium
- `js/prototype-pollution-utility` (alert 145) — medium

**File:** `packages/settings/src/settings/SettingsService.ts`
**Alert lines (pre-fix):** 127, 206, 211.

## Status: RESOLVED ON MAIN (alerts already `state=fixed`)

These four alerts were **fixed independently on `main`** by PR #2149 /
issue #2120 ("Harden settings parse boundaries"), which merged into `main`
while this security branch was in progress. As of the rebase onto the updated
`main`, GitHub reports alerts 142, 143, 144, and 145 as `state=fixed`
(`fixed_at` 2026-06-25T02:51:59Z).

Because they are already fixed by reviewed, merged work, **this branch does not
re-fix them.** The notes below document what CodeQL flagged and how main's
`#2120` resolves it, for completeness and traceability.

## What CodeQL flagged

`SettingsService` writes user/plugin-controlled keys into plain objects in two
places:

- `setProviderSetting(provider, key, value)` — assigned
  `this.settings.providers[provider][key] = value` (alert at ~L127).
- `setNestedValue(obj, key, value)` — split a dotted `key` and walked/created
  intermediate objects, finally assigning `current[lastKey] = value`
  (alerts at ~L206 and ~L211).

If a dotted path segment is `__proto__`, `constructor`, or `prototype`, the
assignment could reach and mutate `Object.prototype`, i.e. **prototype
pollution** affecting every object in the process.

## How main's #2120 resolves the alerts

Main's reviewed approach (in `packages/settings/src/settings/validation.ts`
plus the refactored `SettingsService.ts`):

1. A shared guard `isDangerousPropertyKey(key)` backed by
   `new Set(['__proto__', 'constructor', 'prototype'])`.

2. `assertSafePath(keys)` throws `Cannot set dangerous property: <key>` if **any**
   path segment is dangerous. It is called up-front by both `set(...)`
   (dotted-path) and `setProviderSetting(...)` (on the provider segment), so a
   dangerous dotted segment fails fast with no partial mutation.

3. Writes use `Object.defineProperty(container, finalKey, { value, ... })` and
   provider records are created via `createTrustedProviderRecord()` (zod-parsed,
   null-prototype-safe `TrustedProviderRecord`). `isPlainObject` /
   `hasDangerousKey` reject hostile shapes at parse boundaries.

This breaks CodeQL's taint path from a user-controlled key to a
prototype-mutating assignment at every flagged sink.

### Deliberate design nuance (important)

Main intentionally **allows** `setProviderSetting('provider', '__proto__', value)`
to store an *own* property named `__proto__` on a null-prototype provider record
(this is safe — it cannot pollute `Object.prototype`). This is covered by main's
own test `allows provider setting keys that would be dangerous path segments`
in `packages/settings/src/__tests__/SettingsService.test.ts`. Dotted **paths**
(e.g. `providers.__proto__.model`) are still rejected via `assertSafePath`.

## Why this branch carries no SettingsService change

An earlier revision of this branch added a parallel guard
(`FORBIDDEN_KEYS` / `isForbiddenKey`) and a dedicated test file. During the
rebase onto the updated `main`, that work was found to be:

- **Redundant** — main's #2120 already resolves alerts 142–145, and
- **Behaviourally divergent** — our variant threw on a dangerous *provider key*
  in `setProviderSetting`, which contradicts main's deliberate (tested) decision
  to allow it safely on a null-prototype record.

To avoid regressing main's reviewed design, this branch takes main's
`SettingsService.ts` verbatim and **drops** the now-redundant
`SettingsService.prototypePollution.test.ts`. Net diff for this file on the
branch is therefore zero versus `main`.

## Verification

- `gh api /repos/vybestack/llxprt-code/code-scanning/alerts/{142,143,144,145}`
  → all `state=fixed`.
- `packages/settings` test suite passes against main's implementation
  (including main's own dangerous-key tests in `SettingsService.test.ts`).
- `packages/agents` `switch-context.spec.ts` (the property-based T5p test that
  exercises `setModelParam` → `setProviderSetting`) passes unchanged against
  main's implementation.
