# Dependabot — dismiss-with-evidence (no non-breaking fix)

These 3 alerts cannot be remediated without a **major-version breaking change**,
and the residual exposure is **dev/test-only**. Each is to be closed via the
GitHub API with an explicit reason and the evidence below. This still yields
**0 open** Dependabot alerts.

---

## js-yaml — alert 172 (GHSA-h67p-54hq-rp68, medium)

**Advisory:** "Quadratic-complexity DoS in merge key handling via repeated
aliases." Vulnerable range `<= 4.1.1`. First patched: `4.2.0`.

**Why it is still present after remediation**

- The only vulnerable copy in the tree is `js-yaml@3.14.2`, pulled in by
  `depcheck@1.4.7` (a dev tool), which hard-depends on `js-yaml@^3.14.1`.
- `depcheck@1.4.7` is the **latest** published version of depcheck and still
  pins `js-yaml ^3.14.1` — there is no newer depcheck to bump to.
- Our own first-party `js-yaml` usage is already overridden to `4.2.0` (the
  patched line); that override resolves correctly for everything **except** the
  `depcheck` subtree.

**Why an override to 4.2.0 is NOT safe for the depcheck copy**

`depcheck` calls the **`yaml.safeLoad()`** API in three modules
(`utils/cli-tools.js`, `utils/get-scripts.js`, `special/serverless.js`).
`safeLoad` was **removed in js-yaml 4** and now throws:

    Function yaml.safeLoad is removed in js-yaml 4. Use yaml.load instead,
    which is now safe by default.

Verified directly:

    $ node -e "require('js-yaml').safeLoad('a: 1')"
    -> throws "Function yaml.safeLoad is removed in js-yaml 4."

So forcing `depcheck`'s nested `js-yaml` to `4.2.0` would **break depcheck**.

**Exposure assessment**

- `depcheck` is a `devDependency`; it is **not** part of any runtime code path
  and is **not** invoked by any CI workflow (no reference in
  `.github/workflows/*`).
- It only ever parses our own first-party, trusted YAML (package configs); it
  never processes attacker-controlled input. The DoS vector (malicious YAML with
  repeated merge-key aliases) is not reachable.

**Decision:** dismiss as `tolerable_risk` (dev-only tool, latest version,
no patched 3.x exists, no untrusted input). Revisit if depcheck ships a release
that migrates to js-yaml 4.

---

## @ai-sdk/provider-utils — alerts 147 & 160 (GHSA-866g-f22w-33x8, low)

**Advisory:** "Uncontrolled Resource Consumption" (CVSS 4.3, **low**).
Vulnerable range `<= 3.0.97`. First patched: **`null`** (the advisory lists no
patched version for the entire `<= 3.0.97` line).

**Installed copies**

- `@ai-sdk/provider-utils@3.0.27` — pinned transitively by `ai@5.0.206` and
  `@ai-sdk/openai@2.0.109` (both depend on exactly `3.0.27`).
- `@ai-sdk/provider-utils@2.2.8` — nested under `packages/providers`, declared
  `^2.0.6`; **test-only** (the sole import is
  `packages/providers/src/openai-vercel/messageConversion.test.ts`).

**Why there is no non-breaking fix**

- The advisory has `first_patched_version: null`; **every** `3.0.x` release
  (including the latest `3.0.27`) and all `2.x` are in the vulnerable range.
- The only release line that escapes the advisory is
  `@ai-sdk/provider-utils@4.0.0`, which is first required by **`ai@6`**
  (`ai@6 -> @ai-sdk/provider-utils@4.0.0`). Moving from `ai@5` to `ai@6` is a
  **major breaking upgrade of the entire Vercel AI SDK** surface used across the
  providers package — far outside the scope of a dependency-security PR and a
  significant functional risk.
- An npm override forcing `provider-utils@4.x` under `ai@5`/`@ai-sdk/openai@2`
  would violate those packages' internal API expectations (3.x vs 4.x are not
  interchangeable) and is expected to break at runtime/build.

**Exposure assessment**

- Severity **low** (CVSS 4.3). The `2.2.8` copy is reachable only from a test
  file. The `3.0.27` copy is internal to the AI SDK request pipeline.
- No first-party production code imports `@ai-sdk/provider-utils` directly
  (grep of `packages/providers/src` excluding tests returns nothing).

**Decision:** dismiss as `tolerable_risk` until the project upgrades to the
`ai@6` SDK line on its own schedule. Two alerts (147 = root lockfile, 160 =
`packages/providers/package.json` manifest) cover the same GHSA and are
dismissed together.

---

## Dismissal commands (for the record)

Closed via the REST API (state `dismissed`):

    gh api -X PATCH /repos/vybestack/llxprt-code/dependabot/alerts/172 \
      -f state=dismissed -f dismissed_reason=tolerable_risk \
      -f dismissed_comment="depcheck@1.4.7 (latest) requires js-yaml ^3.x and uses the removed safeLoad() API; js-yaml 4 breaks it. Dev-only tool, not in CI, only parses trusted first-party YAML. No patched 3.x exists."

    gh api -X PATCH /repos/vybestack/llxprt-code/dependabot/alerts/147 \
      -f state=dismissed -f dismissed_reason=tolerable_risk \
      -f dismissed_comment="GHSA-866g-f22w-33x8 has no patched version (<=3.0.97, first_patched=null). Escaping it requires ai@6 + provider-utils@4 (major breaking AI SDK upgrade). Severity low (CVSS 4.3); 3.0.27 pinned by ai@5/openai, 2.2.8 is test-only."

    gh api -X PATCH /repos/vybestack/llxprt-code/dependabot/alerts/160 \
      -f state=dismissed -f dismissed_reason=tolerable_risk \
      -f dismissed_comment="Same GHSA-866g-f22w-33x8 as alert 147, manifest packages/providers (provider-utils@2.2.8, test-only). No patched version exists; fix requires major ai@6 upgrade."

**Status:** all three (172, 147, 160) were dismissed via the API on
2026-06-25 with `dismissed_reason=tolerable_risk`; each returned
`state -> dismissed`. They are the exact three `REMAINING` rows in
`_reconcile_result.json`.

> Note on the other 91: Dependabot evaluates the repository's **default
> branch**, so the 91 fixed alerts continue to show as "open" until this PR is
> merged into `main` and Dependabot re-scans, at which point they auto-resolve.
> Their fixes are proven now against the branch lockfile by `_reconcile.cjs`
> (91 FIXED) and a clean `npm ci`/`npm audit` (down to the residual low/moderate
> dev-only items covered above).
