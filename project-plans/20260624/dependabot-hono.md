# Dependabot — hono (21 alerts)

**Alerts:** 70, 105, 106, 107, 108, 109, 114, 122, 123, 127, 128, 129, 156,
157, 158, 159, 182, 183, 184, 185, 186
**Severity:** 1 high (184), 19 medium, 1 low (128)
**Representative GHSAs:** GHSA-88fw-hqm2-52qc (high), and a long tail of medium
advisories (path-confusion, body-limit bypass, header parsing, etc.).

## Root cause

`hono` is pulled in **transitively** (it is not a direct dependency of any
workspace manifest — it arrives via the dev/server toolchain in the lockfile).
The installed copy sat on an old `4.x` build that accumulated many advisories.

## Fix — root `overrides` (transitive)

Since hono is transitive, the root `package.json` `overrides` pins it to a
patched `4.x` line that clears every listed advisory while staying within the
same major (no breaking change):

    "overrides": {
      "hono": ">=4.12.25 <5"
    }

The range form (`>=4.12.25 <5`) lets npm pick the latest patched `4.x`
(resolved to `4.12.27`) while preventing an accidental jump to a future `5.x`
major.

## Verification

Installed `hono@4.12.27`. `_reconcile.cjs` confirms all 21 alerts FIXED — no
installed hono version remains within any of the advisories' vulnerable ranges.
