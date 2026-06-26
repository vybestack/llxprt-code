# Security Remediation — 2026-06-24

Branch: `20260624security`
Scope: All open **Dependabot** (94) and **CodeQL code-scanning** (7) alerts on
`vybestack/llxprt-code` as of 2026-06-24.

## Outcome summary

| Class | Open at start | Fixed | Dismiss-with-evidence | Net open after |
| --- | --- | --- | --- | --- |
| Dependabot | 94 | 91 | 3 | 0 |
| Code-scanning (CodeQL) | 7 | 7 (3 this branch + 4 on main) | 0 | 0 |
| **Total** | **101** | **98** | **3** | **0** |

> The 4 prototype-pollution CodeQL alerts (142–145) were fixed independently on
> `main` by PR #2149 / issue #2120, which merged while this branch was in
> progress; after rebasing onto that `main` they report `state=fixed`. This
> branch fixes the remaining 3 `js/clear-text-logging` alerts (154, 155, 158)
> and all 91 fixable Dependabot alerts, and dismisses 3 Dependabot alerts with
> evidence. Net open after merge across both classes: **0**.

"Fixed" = the vulnerable version is no longer present in `package-lock.json`,
proven by reconciling each advisory's vulnerable range against the actually
installed versions (`_reconcile.cjs`). "Dismiss-with-evidence" = no non-breaking
fix exists; the residual exposure is dev/test-only and documented below; the
alert is closed via the GitHub API with a reason.

## How the Dependabot fixes were applied

Two mechanisms, preferring direct bumps over overrides:

1. **Direct dependency bumps** — where the vulnerable package is a direct
   dependency of the root or a workspace package, the version range in that
   `package.json` was raised to a patched line (e.g. `undici`, `simple-git`,
   `shell-quote`, `tar`, `uuid`, `picomatch`, `js-yaml` direct, `lodash`,
   `fast-uri`, `@hono/node-server`, the entire `@opentelemetry/*` set).
2. **Root `overrides`** — where the vulnerable package is only reachable
   transitively, a root-level npm `overrides` entry pins the nested copy to a
   patched version (e.g. `hono`, `protobufjs`, `@grpc/grpc-js`, `form-data`,
   `ws`, `path-to-regexp`, `brace-expansion`, `vite`, `fast-xml-parser`,
   `markdown-it`, `postcss`, `ip-address`, `flatted`, `tmp`, `qs`).

   Range-qualified override keys (e.g. `form-data@>=4.0.0 <5`) are used where a
   package legitimately appears at two incompatible major lines so each line is
   pinned to its own patched build without forcing an incompatible major on a
   consumer that cannot accept it.

Note: a root override for a package that is *also* a root direct dependency is
rejected by npm (`EOVERRIDE`) unless the `$name` self-reference form is used.
For `@hono/node-server` and `fast-uri` the direct-dependency bump already covers
the advisory, so no override entry is used for them.

## Verification artifacts

- `_reconcile.cjs` — reconciles every alert's `vulnerable_version_range`
  against the installed versions in `package-lock.json` (semver-based), emitting
  a FIXED / REMAINING verdict per alert.
- `_reconcile_result.json` — machine-readable per-alert verdict.

Re-run from the repo root:

    node project-plans/20260624/_reconcile.cjs

## Per-package map (alert numbers)

| Package | Alerts | Verdict | Doc |
| --- | --- | --- | --- |
| hono | 70,105,106,107,108,109,114,122,123,127,128,129,156,157,158,159,182,183,184,185,186 | FIXED (override) | `dependabot-hono.md` |
| protobufjs | 115,134,135,136,137,138,139,140,145,178,179 | FIXED (override) | `dependabot-protobufjs-grpc.md` |
| undici | 71,72,73,74,75,76,188,189,190,191,192 | FIXED (direct) | `dependabot-undici.md` |
| @grpc/grpc-js | 165,166 | FIXED (override) | `dependabot-protobufjs-grpc.md` |
| @protobufjs/utf8 | 133 | FIXED (override) | `dependabot-protobufjs-grpc.md` |
| @opentelemetry/core | 180,187 | FIXED (direct) | `dependabot-opentelemetry.md` |
| @opentelemetry/sdk-node | 131,164 | FIXED (direct) | `dependabot-opentelemetry.md` |
| @opentelemetry/exporter-prometheus | 130 | FIXED (direct) | `dependabot-opentelemetry.md` |
| @hono/node-server | 104 | FIXED (direct) | `dependabot-opentelemetry.md` |
| vite | 101,102,103,173,174 | FIXED (override) | `dependabot-vite-vitest.md` |
| vitest | 162 | FIXED (direct) | `dependabot-vite-vitest.md` |
| fast-xml-parser | 84,110,116 | FIXED (override) | `dependabot-fast-xml-uri.md` |
| fast-xml-builder | 124 | FIXED (override) | `dependabot-fast-xml-uri.md` |
| fast-uri | 125,126 | FIXED (direct) | `dependabot-fast-xml-uri.md` |
| simple-git | 69,113,120 | FIXED (direct) | `dependabot-direct-bumps.md` |
| shell-quote | 163 | FIXED (direct) | `dependabot-direct-bumps.md` |
| tar | 175 | FIXED (direct) | `dependabot-direct-bumps.md` |
| uuid | 142 | FIXED (direct) | `dependabot-direct-bumps.md` |
| picomatch | 85,87,94,95 | FIXED (override) | `dependabot-direct-bumps.md` |
| lodash | 111,112 | FIXED (direct, dev) | `dependabot-direct-bumps.md` |
| form-data | 176,177 | FIXED (override) | `dependabot-transitive-overrides.md` |
| ws | 146,171 | FIXED (override) | `dependabot-transitive-overrides.md` |
| path-to-regexp | 98,99,100 | FIXED (override) | `dependabot-transitive-overrides.md` |
| brace-expansion | 93,141 | FIXED (override) | `dependabot-transitive-overrides.md` |
| ip-address | 121 | FIXED (override) | `dependabot-transitive-overrides.md` |
| markdown-it | 181 | FIXED (override) | `dependabot-transitive-overrides.md` |
| postcss | 155 | FIXED (override) | `dependabot-transitive-overrides.md` |
| flatted | 81 | FIXED (override) | `dependabot-transitive-overrides.md` |
| tmp | 144 | FIXED (override) | `dependabot-transitive-overrides.md` |
| qs | 143 | FIXED (override) | `dependabot-transitive-overrides.md` |
| **js-yaml** | **172** | **DISMISS** | `dependabot-REMAINING-dismissals.md` |
| **@ai-sdk/provider-utils** | **147, 160** | **DISMISS** | `dependabot-REMAINING-dismissals.md` |

## Code-scanning (CodeQL)

| Alert | Rule | File | Fixed by | Doc |
| --- | --- | --- | --- | --- |
| 154, 155, 158 | js/clear-text-logging | packages/auth/src/oauth-errors.ts | this branch | `codescanning-clear-text-logging.md` |
| 142, 143, 144, 145 | js/prototype-pollut* | packages/settings/src/settings/SettingsService.ts | main (PR #2149 / #2120) | `codescanning-prototype-pollution.md` |

> Note: code-scanning alert numbers are a **separate number space** from
> Dependabot alert numbers, so e.g. CodeQL alert 142 (prototype pollution) and
> Dependabot alert 142 (uuid) are unrelated. The prototype-pollution CodeQL
> alerts (142–145) were fixed independently on `main` by PR #2149 / issue #2120
> while this branch was in progress (confirmed `state=fixed`); this branch fixes
> the three `js/clear-text-logging` alerts (154, 155, 158). Net code-scanning
> open after merge: 0.

## Build-side regressions caused by the bumps (and fixed here)

Bumping `@types`-bearing dependencies surfaced compile/lint breakage that did
**not** exist on `origin/main` (proven by a clean build of a pristine baseline
worktree). These were fixed as part of this PR — see
`build-regressions-from-bumps.md`:

- `packages/telemetry/src/telemetry/file-exporters.ts` — OTEL `0.203 -> 0.219`
  added a required `forceFlush()` member to `LogRecordExporter`.
- `packages/a2a-server/src/http/app.ts` — `@types/express-serve-static-core`
  `5.0.7 -> 5.1.1` typed `req.params.taskId` as `string | string[]`.
- `packages/vscode-ide-companion/src/*.test.ts` — `typescript-eslint` bump made
  two type assertions detectably unnecessary.
- `packages/{a2a-server,core,cli,agents,providers,vscode-ide-companion}/vitest.config.ts`
  — `ajv` was hoisted from a nested `ajv-formats/node_modules/ajv@8` to a
  top-level `ajv@8.20.0` (and `fdir` likewise moved), deleting the hardcoded
  nested paths these configs referenced. Replaced the hardcoded
  `node_modules/...` paths with hoisting-independent `createRequire` dynamic
  resolution (`require.resolve('ajv/dist/2020.js')`, etc.).
- `packages/agents/src/api/__tests__/switch-context.spec.ts` — left unchanged
  versus `main`. An earlier revision of this branch modified its T5p generator
  to suit a branch-local `SettingsService` reject-on-key guard, but that guard
  was dropped when main's #2120 (which deliberately *allows* dangerous keys as
  safe null-prototype own-properties via `setProviderSetting`) superseded it.
  The test passes unchanged against main's implementation.
- `package-lock.json` (cli `merge-stream`/`is64bit`) — the lockfile regeneration
  dropped the top-level `merge-stream`, `is64bit`, and `system-architecture`
  nodes that the nested `packages/cli/node_modules/execa@8` (via
  `clipboardy@4`) relies on through hoisting, breaking 49 cli test files with
  `Cannot find package 'merge-stream'`. Freeing and re-resolving that subtree
  restored all three nodes; verified by a completeness scan (0 unresolved
  declared deps) and a clean `npm ci`.
