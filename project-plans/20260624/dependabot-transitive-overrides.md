# Dependabot — transitive-only packages fixed via root `overrides`

These vulnerable packages are **not** first-party direct dependencies; they
arrive transitively. Each is pinned to a patched version through the root
`package.json` `overrides` block. Where a package legitimately appears at two
incompatible majors, a range-qualified key pins each major line independently.

| Alerts | Package | Sev | Override |
| --- | --- | --- | --- |
| 176, 177 | form-data | high | `form-data@>=2.0.0 <3`:2.5.6, `form-data@>=4.0.0 <5`:4.0.6 |
| 146 | ws | medium | `ws@>=8.0.0 <9`:8.21.0 |
| 171 | ws | high | (same) |
| 98 | path-to-regexp | high | `path-to-regexp@<1`:0.1.13, `path-to-regexp@>=8.0.0 <9`:8.4.0 |
| 99 | path-to-regexp | medium | (same) |
| 100 | path-to-regexp | high | (same) |
| 93 | brace-expansion | medium | `brace-expansion@>=5.0.0 <6`:5.0.6 |
| 141 | brace-expansion | medium | (same) |
| 121 | ip-address | medium | `ip-address`:">=10.1.1" |
| 181 | markdown-it | medium | `markdown-it`:">=14.2.0" |
| 155 | postcss | medium | `postcss`:">=8.5.10" |
| 81 | flatted | high | `flatted`:">=3.4.2" |
| 144 | tmp | high | `tmp`:">=0.2.6" |
| 143 | qs | medium | `qs`:"^6.15.2" |

## form-data (high)

Two majors in the tree; each pinned to its own patched build:

    "form-data@>=2.0.0 <3": "2.5.6",
    "form-data@>=4.0.0 <5": "4.0.6"

Installed: `form-data@2.5.6` and `form-data@4.0.6` (both patched against
GHSA-hmw2-7cc7-3qxx).

## ws (high + medium)

    "ws@>=8.0.0 <9": "8.21.0"

The `8.x` copy is pinned to `8.21.0` (patched). A separate `7.x` copy resolves
to `ws@7.5.11`, which is already outside the advisory ranges (verified by
reconcile), so no `7.x` override is required.

## path-to-regexp (high + medium)

Advisory ranges: `< 0.1.13` (GHSA-37ch-88jc-xwx2) and `>= 8.0.0 < 8.4.0`
(GHSA-27v5-c462-wpq7, GHSA-j3q9-mxjg-w52f). Overrides:

    "path-to-regexp@<1": "0.1.13",
    "path-to-regexp@>=8.0.0 <9": "8.4.0"

Installed copies after resolution: `6.3.0` and `8.4.0`. Both are outside every
vulnerable range (`6.3.0` is neither `< 0.1.13` nor in `[8.0.0, 8.4.0)`; `8.4.0`
is the patched version). The `path-to-regexp@<1` key is retained as a defensive
no-op (no `0.x` copy is currently requested by the tree); the effective fix is
the `>=8.0.0 <9` pin to `8.4.0`.

## brace-expansion

    "brace-expansion@>=5.0.0 <6": "5.0.6"

The `5.x` copy is pinned to `5.0.6`. Other copies resolve to `1.1.15` / `2.1.1`,
which are already outside the advisory range (verified by reconcile).

## Single-line overrides

    "ip-address": ">=10.1.1",
    "markdown-it": ">=14.2.0",
    "postcss": ">=8.5.10",
    "flatted": ">=3.4.2",
    "tmp": ">=0.2.6",
    "qs": "^6.15.2"

`qs` already had an override (`^6.14.2`); it was raised to `^6.15.2` to clear
GHSA-q8mj-m7cp-5q26.

## Verification

`_reconcile.cjs` confirms every alert in this document FIXED. Multi-version
packages (form-data, ws, brace-expansion, picomatch) were checked against **all**
installed copies, not just one, to ensure no vulnerable copy lingers.
