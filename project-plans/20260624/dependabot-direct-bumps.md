# Dependabot — direct first-party bumps (simple-git, shell-quote, tar, uuid, picomatch, lodash)

These vulnerable packages are declared **directly** in first-party manifests, so
each was fixed by raising the range in the owning `package.json` (preferred over
overrides). `picomatch` is included here because it spans two majors and is
pinned via range-qualified overrides as well.

| Alerts | Package | Sev | GHSA | Fix |
| --- | --- | --- | --- | --- |
| 69 | simple-git | critical | GHSA-r275-fr43-pm7q | direct bump |
| 113 | simple-git | high | GHSA-jcxm-m3jx-f287 | direct bump |
| 120 | simple-git | high | GHSA-hffm-xvc3-vprc | direct bump |
| 163 | shell-quote | critical | GHSA-w7jw-789q-3m8p | direct bump |
| 175 | tar | medium | GHSA-vmf3-w455-68vh | direct bump |
| 142 | uuid | medium | GHSA-w5hq-g745-h8pq | direct bump |
| 85, 94 | picomatch | high | GHSA-c2c7-rcm5-vvqj | direct + override |
| 87, 95 | picomatch | medium | GHSA-3v7f-55p6-f55p | direct + override |
| 111 | lodash | high | GHSA-r5fr-rjxr-66jc | direct bump (dev) |
| 112 | lodash | medium | GHSA-f23m-r3pf-42rh | direct bump (dev) |

## simple-git (critical)

- root + `packages/core` + `packages/cli` : `simple-git ^3.28.0 -> ^3.36.0`

Clears the critical RCE/argument-injection advisory and the two high advisories
within major 3.

## shell-quote (critical)

- `packages/core`, `packages/cli`, `packages/mcp`, `packages/tools` :
  `shell-quote ^1.8.3 -> ^1.8.4`

Clears the critical command-injection advisory.

## tar

- `packages/cli` + `packages/a2a-server` : `tar ^7.5.2 -> ^7.5.16`

## uuid

- `packages/a2a-server` : `uuid ^11.1.0 -> ^11.1.1`

## picomatch

`picomatch` exists at two majors in the tree. The direct bump covers the
`packages/core` copy, and range-qualified overrides pin both major lines so the
transitive copies are patched without forcing an incompatible major:

- `packages/core` : `picomatch ^4.0.1 -> ^4.0.4`
- root overrides:

      "picomatch@>=2.0.0 <3": "2.3.2",
      "picomatch@>=4.0.0 <5": "4.0.4"

Installed: `picomatch@2.3.2` and `picomatch@4.0.4` (both patched).

## lodash (dev only)

- root `devDependencies` : `lodash ^4.17.21 -> ^4.18.0`

`lodash` is a dev-only dependency; still bumped to clear both advisories.

## Verification

`_reconcile.cjs` confirms all of the above alerts FIXED (simple-git@3.36.0,
shell-quote@1.8.4, uuid@11.1.1, picomatch@{2.3.2,4.0.4}).
