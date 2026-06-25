# Dependabot — vite + vitest (6 alerts, dev toolchain)

| Alerts | Package | Sev | GHSA |
| --- | --- | --- | --- |
| 162 | vitest | critical | GHSA-5xrq-8626-4rwp |
| 173 | vite | high | GHSA-fx2h-pf6j-xcff |
| 102 | vite | high | GHSA-p9ff-h696-f583 |
| 101 | vite | high | GHSA-v2wj-q39q-566r |
| 174 | vite | medium | GHSA-v6wh-96g9-6wx3 |
| 103 | vite | medium | GHSA-4w7w-66w2-5vf9 |

These are **dev/test toolchain** packages (not shipped in the runtime bundle),
but they are still remediated to reach 0 alerts.

## Fix

**vitest — direct bump** (it is a direct `devDependency` in the root and in
every workspace package):

- root + all `packages/*` : `vitest ^3.1.1 / ^3.2.4 -> ^3.2.6`
- root : `@vitest/coverage-v8 ^3.1.1 -> ^3.2.6` (keep coverage tool in lockstep
  with vitest)

The critical vitest advisory (GHSA-5xrq-8626-4rwp) is patched in the `3.2.x`
line; `3.2.6` clears it without a major bump.

**vite — root `overrides`** (transitive via the vitest/build stack):

    "overrides": {
      "vite": ">=7.3.5 <8"
    }

`vite 7.3.5+` clears all four vite advisories within major 7.

## Verification

`_reconcile.cjs` confirms all 6 alerts FIXED (vitest@3.2.6, vite resolved into
`>=7.3.5 <8`).
