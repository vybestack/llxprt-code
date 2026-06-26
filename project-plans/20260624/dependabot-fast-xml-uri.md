# Dependabot — fast-xml-parser / fast-xml-builder / fast-uri (6 alerts)

| Alerts | Package | Sev | GHSA |
| --- | --- | --- | --- |
| 84 | fast-xml-parser | high | GHSA-8gc5-j5rx-235r |
| 110 | fast-xml-parser | medium | GHSA-jp2q-39xq-3w4g |
| 116 | fast-xml-parser | medium | GHSA-gh4j-gqv2-49f6 |
| 124 | fast-xml-builder | high | GHSA-5wm8-gmm8-39j9 |
| 125 | fast-uri | high | GHSA-q3j6-qgpj-74h6 |
| 126 | fast-uri | high | GHSA-v39h-62p7-jpjc |

## fast-uri — direct bump

`fast-uri` is a **direct** dependency of the root `package.json`. Bumped
directly:

- root : `fast-uri ^3.0.6 -> ^3.1.2`

`3.1.2` clears both high advisories within major 3. It is **not** added to
`overrides` (it is a root direct dependency; an override would trigger npm
`EOVERRIDE`).

## fast-xml-parser / fast-xml-builder — root `overrides` (transitive)

Both arrive transitively (AWS SDK / XML-handling chain). Pinned via overrides:

    "overrides": {
      "fast-xml-parser": ">=5.7.0 <6",
      "fast-xml-builder": ">=1.1.7"
    }

- `fast-xml-parser >=5.7.0 <6` clears the high + two medium advisories within
  major 5.
- `fast-xml-builder >=1.1.7` clears the high advisory.

## Verification

Installed `fast-xml-parser@5.9.3`. `_reconcile.cjs` confirms all 6 alerts FIXED.
