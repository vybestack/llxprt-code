# Dependabot — undici (11 alerts)

**Alerts:** 71, 72, 73, 74, 75, 76, 188, 189, 190, 191, 192
**Severity:** 4 high (71, 75, 76, 191), 5 medium, 2 low (189, 192)
**GHSAs:** GHSA-f269-vfmq-vjvj, GHSA-vrm6-8vpv-qv8q, GHSA-v9p9-hfj2-hcw8,
GHSA-vxpw-j846-p89q (high); plus medium/low (decompression, redirect, cookie,
proxy-auth handling, etc.).

## Root cause

`undici` is a **direct** dependency of multiple workspace packages
(`packages/core`, `packages/cli`, `packages/agents`,
`packages/ide-integration`), each pinned at `^7.18.2`, which fell within several
advisories.

## Fix — direct bumps (preferred over overrides)

Raised the direct range in every owning manifest:

- `packages/core/package.json` : `undici ^7.18.2 -> ^7.28.0`
- `packages/cli/package.json` : `undici ^7.18.2 -> ^7.28.0`
- `packages/agents/package.json` : `undici ^7.18.2 -> ^7.28.0`
- `packages/ide-integration/package.json` : `undici ^7.18.2 -> ^7.28.0`

`7.28.0` is within the same major (no breaking change) and is past the first
patched version of every listed advisory.

## Verification

Installed `undici@7.28.0`. `_reconcile.cjs` confirms all 11 alerts FIXED.
