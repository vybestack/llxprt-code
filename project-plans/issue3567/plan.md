# Issue #3567 — Extend CodeQL coverage: security-and-quality suite + mechanism-class query pack for TS

Branch: `issue3567`. Issue: https://github.com/vybestack/llxprt-code/issues/3567

## Goal

Move CodeQL off the CWE-only default suite for non-PR events: run GitHub's
maintained `security-and-quality` suite plus a local four-rule
mechanism-class query pack (cancellation propagation, cleanup symmetry on
error paths, unbounded accumulation, unbounded retry), with the PR path
(pull_request, merge_group) unchanged on the default security suite until
#3495/#3187/#2702 settle PR-path budgets. Validate offline with posted
numbers before merge.

## Inputs and constraints from the issue

- Current state (verified on main): `ci.yml` codeql job uses
  `languages: 'javascript'`, no config file, PR timeout already 15 min
  (the #3495 one-line fix landed; that issue remains open only for
  disposition tracking).
- Placement: quality suite + custom pack run on push-to-main (and scheduled
  events — none exist in ci.yml, see Decisions); PR runs unchanged.
- Alerts advisory (non-blocking) initially — code scanning alerts never fail
  the analyze step by default; nothing extra required.
- Overfit gate: no query may reference project-internal API names, file
  paths, or identifiers. Anchors are TS standard types, standard lifecycle
  pairings resolved through standard type definitions (`lib.dom`,
  `@types/node`), standard collection mutation kinds, and control-flow
  structure. A rule that cannot be so expressed is rejected, not
  specialized.
- Validation: run the four rules offline against current main (repo-wide
  alert count as precision proxy) and against the 36 historical introducer
  diffs (recall). Numbers posted in the issue before the config lands
  (i.e. before merge).

## Decisions

1. **Event scoping.** Full config (security-and-quality + local pack) on
   `push` and `workflow_dispatch`. PR config (default suite) on
   `pull_request` and `merge_group` — merge_group is the PR merge path, so
   it stays on the plain security set to protect the #2702 verdict budget.
   Satisfies the issue's "security-and-quality active on non-PR events at
   minimum".
2. **Two config files** (config files cannot branch on event): 
   - `.github/codeql/codeql-config.yml` — `queries:
     [{uses: security-and-quality}]`, `packs: [<local pack>]`.
   - `.github/codeql/codeql-config-pr.yml` — no `queries` key (selects the
     default suite), no `packs`.
   Selected via a `config-file: ${{ ... }}` expression on the init step.
3. **No schedule trigger added.** ci.yml has no `schedule:`; adding one is a
   workflow-behavior change beyond this issue's config ask and is deferred
   pending explicit approval. Deferred item recorded in the issue comment.
4. **No GHCR publishing yet.** Only if per-run pack compile time proves
   material. Measured during validation.
5. **Local pack path form** (`./queries` vs `./.github/codeql/queries` in
   the config `packs:` entry) is resolved empirically with the local
   CodeQL CLI against the same directory layout the action will see.
6. **Historical recall is data-blocked.** The 36-diff/40-defect mining
   enumeration is not in this repo (searched). We validate alert counts on
   current main + sampled precision classification, post those numbers, and
   explicitly ask the author for the enumeration (or approval to proceed
   without recall). No recall numbers are fabricated.
7. **Validation execution environment.** The sandbox is linux aarch64 with
   no root, and CodeQL ships no linux-arm64 build. The numbers the issue
   requires (per-rule alert counts) are not obtainable from CI from this
   sandbox (code-scanning/artifact/log APIs require auth; no `gh` CLI; the
   built-in GitHub tool has no dispatch or artifact access). Therefore
   offline validation runs the x86_64 CodeQL bundle v2.26.4 under
   qemu-user emulation assembled in `tmp/verify3567/` (qemu-user-static
   extracted from Ubuntu debs, amd64 guest sysroot from libc6/libgcc/
   libstdc++/zlib1g debs, `dpkg-deb -x`, no root). A tiny pilot
   (fixture database + trivial query) gates the full-repo run. If the
   emulation path fails, stop and report: the fallbacks (author runs
   validation locally, or an approved branch-run reporting mechanism)
   both need explicit user sign-off.

## Acceptance criteria

### AC-1 — Config files exist and are wired per event
- **GIVEN** `.github/codeql/codeql-config.yml` and
  `.github/codeql/codeql-config-pr.yml` as in Decisions 1-2,
- **WHEN** the CodeQL init step evaluates `config-file`,
- **THEN** push/workflow_dispatch resolve to the full config and
  pull_request/merge_group resolve to the PR config,
- **AND** `languages: 'javascript'`, the 15/360 timeout expression,
  `needs: [skip_check]`, the duplicate-only `if`, least-privilege
  permissions, pinned 40-hex SHAs, and `# ratchet:` comments are all
  unchanged.

### AC-2 — Mechanism pack exists, compiles, and passes the overfit gate
- **GIVEN** `.github/codeql/queries/qlpack.yml` plus four `.ql` files
  (R1 cancellation propagation, R2 cleanup symmetry on error paths, R3
  unbounded accumulation, R4 unbounded retry),
- **WHEN** compiled against `codeql/javascript-all` with the local
  CodeQL CLI (x86_64 bundle v2.26.4 under qemu-user, `tmp/verify3567/`),
- **THEN** every query compiles (exit 0),
- **AND** no query text contains project-internal identifiers or repo paths
  (contract-checked: no `packages/`, `src/`, or repo file-path strings),
- **AND** each carries unique `@id`, `@kind problem`, severity, and a
  description that names the mechanism, not a historical instance.

### AC-3 — Validation numbers posted before merge
- All four rules run against a CodeQL database of current main; per-rule
  alert counts recorded.
- A sample of each rule's alerts is read and classified true/false positive;
  any rule whose output is indefensible noise is dropped or refined with
  reason recorded.
- Counts + classification summary posted to issue #3567 before merge; the
  missing historical enumeration is flagged there (Decisions 6).

### AC-4 — PR-path safety and green gates
- The PR path runs the same default query suite as before (pinned by
  contract test: PR config has no `queries`/`packs`; only config-file
  selection differs).
- Verification cycle passes (test/lint/typecheck/format/build + stepfun-37
  smoke); CI green on the candidate head.

## Test plan (behavioral, no mocks — parses the real files)

1. Update `scripts/tests/ci-codeql-latency.bun.test.ts`:
   - init `with` is exactly `{ languages: 'javascript', config-file:
     <expression> }`;
   - step-level forbidden keys reduce to `queries`, `paths`,
     `paths-ignore`, `packs` (config-file now allowed and required).
2. New `scripts/tests/ci-codeql-config.bun.test.ts` pinning:
   - both config files exist and parse as YAML;
   - full config has `queries == [{uses: security-and-quality}]` and the
     local pack under `packs`; PR config has neither key;
   - the init `config-file` expression routes each event name
     (push/workflow_dispatch → full; pull_request/merge_group → PR) —
     evaluate the `&&`/`||` logic in TS against the literal expression;
   - pack layout: `qlpack.yml` + exactly the four `.ql` files;
   - each `.ql` file has unique `@id`, `@kind problem`, severity metadata;
   - overfit gate: `.ql` contents contain no repo-internal path strings.

Boundary cases: merge_group routing; malformed/missing config file fails
the test; a fifth `.ql` file fails the layout pin; `queries` on the init
step remains forbidden.

## Validation procedure (offline, before PR merge)

1. Harness in `tmp/verify3567/`: qemu-x86_64-static + amd64 sysroot +
   `codeql-bundle-linux64.tar.gz` v2.26.4 (Decisions 7). Pilot gate:
   `codeql version`, `codeql pack install` in the pack dir, fixture-dir
   database create, trivial query compile — all under emulation.
2. Resolve pack deps: `codeql pack install` inside `.github/codeql/queries`
   (fetches `codeql/javascript-all` from GHCR, anonymous).
3. `codeql database create tmp/verify3567/db --language=javascript
   --source-root=.` (extractor skips node_modules by default; long run
   under emulation — background).
4. `codeql query compile` each rule; `codeql database analyze` per rule
   (or `codeql query run`) with SARIF/CSV output into `tmp/verify3567/out/`;
   count results per rule.
5. Read a sample of alerts per rule; classify precision.
6. Record pack compile time (Decisions 4 input).

## Validation results (2026-09-11)

Environment: CodeQL CLI 2.26.4 (native macOS; the Sep 9 qemu harness artifacts
do not run on this host). Database of branch HEAD `2aac6841e` (1,368,696 LOC
including `tmp/` scratch trees from concurrent sessions); counts are given as
total/alerts-in-tracked-files (12,159 tracked paths). Eval walls measured on a
heavily loaded machine, `--threads=0`.

| Rule | Initial | Round 1 | Round 2 | Final eval | Disposition |
| --- | --- | --- | --- | --- | --- |
| R1 cancellation-propagation | 859/200 | 57/11 (sampled 0 TP: controller escapes via return/object/field/alias) | 1/0 | 26s | **Kept** |
| R2 cleanup-symmetry | 1/0 (query run; untracked location) | — | 0/0 | 13s | **Kept** |
| R3 unbounded-accumulation | 21,725 raw; 1,980/475 fresh | — | 475/120 | 17s | **Kept (advisory)** |
| R4 unbounded-retry | 402 | 238/77 (111s) | 98/20 (359s) | 359s | **Dropped** |

- **R1 final:** the single remaining alert is the deliberately-dead pilot
  fixture under `tmp/verify3567/pilot/` (non-vacuity proof); zero alerts in
  tracked files on main. Round-2 suppressions: controller passed as argument,
  stored in a field, returned, embedded in an object literal, or aliased
  one-hop into a call.
- **R2 final:** zero alerts; the type-resolved standard-listener pairing
  (EventTarget/EventEmitter only) finds no unprotected release on main. Perf
  post-mortem: the "slow original" was a mismeasurement during the concurrent
  DB-access era (two `database analyze` on one DB interlock badly); a
  name-first restructure (947s, killed) and a getContainer+location-interval
  rewrite (3,608s, OOM) were both regressions. Restored original: 13s.
  Lesson recorded: serialize DB access; measure on an idle DB.
- **R3 final:** sampled 9 tracked alerts: 2 plausible minor TPs
  (`operationLifecycle.ts` finalised-signal Set grows for process lifetime;
  `lsp-client.ts` documentVersions Map retains closed documents), 7 FPs in
  three residual classes: cap/input-bounded accumulators (byte-capped
  buffers, budget-capped outputs, input-bounded pattern lists), short-lived
  per-scan visitor fields (analysis visitors, test fakes), bounded-domain
  registries (per-profile state maps). Classes documented in the issue.
- **R4 dropped:** three refinement rounds (bound recognition: property-path
  guards, body decrements, compound assignment, body-side deadlines,
  `.read()` pumps) reduced 402 → 98/20, but sampling 15 sites found zero TPs.
  Remaining FPs are irreducible at this analysis level: termination delegated
  to cross-method mutable state (`this.isWriting`, `state.completionSettled`),
  pumps hidden behind helpers (`nextPerfEntry`), call-based termination
  predicates (`isStopped()`), `+=` timers with body-side timeout checks, and
  intentional driver loops. Per the issue's gate (indefensible noise → drop
  with reason), the query file was deleted and the contract test now pins
  three queries.
- **Historical recall:** still data-blocked (the 36-diff/40-defect
  enumeration is not in this repo); no recall numbers are claimed.

## Remediation and final verification (2026-09-11, round 2)

A full review round (deepthinker) on the three surviving rules found 4 HIGH
and 2 MEDIUM soundness gaps. All were fixed and re-validated on a clean
database: `git archive HEAD` extraction (tracked files only, no `tmp/`
scratch trees) with `node_modules` symlinked in for `@types/node` import
resolution — the earlier repo-root DB mixed 1.37M LOC including concurrent
sessions' scratch trees and lacked import resolution entirely.

Fixes applied (each verified by a compile + pilot control):

- R1: empty-body functions now qualify (body existence, not child presence);
  constructor resolution requires the global binding, not just the name;
  TS parameter-property constructors (empty body, `this.signal` observable
  elsewhere) are suppressed via a same-file `this.<name>` join.
- R2: return/throw escapes must belong directly to the function (nested
  closures excluded via `getContainer`); catch clauses count only when their
  body contains a real exit; finally protection requires the try to start at
  or before the escape; acquire/release pairing requires equal string-literal
  event names; `@types/node` `EventEmitter` receivers resolve via lexical
  import resolution (qualified-name checks never matched them).
- R3: appends/evictions require the standard collection type (TS class
  fields carry no type binding — resolved through same-class then same-file
  field initializers, which also distinguishes `WeakSet` from `Set`);
  constructor/class-field initialization is not eviction (only resets in
  named non-constructor methods count); `x = x.slice(...)` self-replacement
  counts as eviction; closure-held accesses keep field resolution; keys are
  per-file (`<file>:this.NAME`), so same-named fields in other files no
  longer cross-suppress.
- Config: the `packs:` entry is now a `uses:` mapping (bare strings are
  workflow-input syntax, invalid in a config file); the two config tests pin
  the exact parsed objects so `disable-default-queries`/path filters cannot
  sneak in.

Final clean-DB numbers (12,159 tracked paths, typed, `--threads=0`):

| Rule | Alerts | Eval | Disposition |
| --- | --- | --- | --- |
| R1 cancellation-propagation | 0 | 32s | **Kept** |
| R2 cleanup-symmetry | 0 | ~30s | **Kept** |
| R3 unbounded-accumulation | 137 (87 test/spec/example files, 50 production) | ~60s | **Kept (advisory)** |

Pilot composite controls (typed pilot DB): R1=2 (unused param in bodied
function; empty-body function), R2=1 (unguarded pair skipped by throw),
R3=1 (Map field, set-only); negatives silent: finally-protected pair,
closure-return pair, WeakSet tracker, parameter-property constructor.

R3 production classification (sampled): 1 genuine TP-class
(`result-cache.ts:65` — memoization keyed by arbitrary user query strings,
no eviction); remainder are the documented residual classes — finite-domain
registries (skills, providers, profiles, commands, tasks), stream/lifetime
scoped accumulators, and explicit cap-guarded buffers. The round-2
"plausible TPs" from the old DB were re-examined: `finalised` is a
`WeakSet` (GC-eligible, correctly excluded by Set-type resolution) and
`documentVersions` is constructor-initialized (correctly excluded).

## Out of scope (guards)

- Adding `schedule:` to ci.yml or moving CodeQL into nightly.yml.
- Publishing the pack to GHCR.
- Changing PR timeouts, event coverage, or moving CodeQL off any event.
- `security-extended`, path exclusions, caches, runners, triage rules.
- Any runtime/package source change; any ESLint suppression.

## Review-findings triage table

| # | Finding | Disposition | Action |
| --- | --- | --- | --- |
| 1 | R1: empty-body params escape detection (HIGH) | Fixed | body-existence test; pilot control added |
| 2 | R1: shadowed AbortController name match (HIGH) | Fixed | global-binding qualified-name resolution |
| 3 | R1: parameter-property constructors flagged (post-fix FP) | Fixed | same-file `this.<name>` observability join |
| 4 | R2: nested-closure returns counted as escapes (HIGH) | Fixed | `getContainer` direct-exit requirement |
| 5 | R2: catch clauses always escapes; finally over-suppression; event-name pairing (HIGH/MED) | Fixed | exit-in-catch-body; try-start ordering; equal string literals |
| 6 | R2: `@types/node` receivers never resolved (MED) | Fixed | lexical import resolution |
| 7 | R3: name-only method matching; constructor-init suppression; repo-wide field keying (HIGH) | Fixed | standard-type resolution; named-method resets only; per-file keys |
| 8 | R3: class fields carry no type binding; slice-eviction missed; closure-held delete missed | Fixed | field-initializer resolution (same-class, then same-file); `x = x.slice()` arm; file-scoped field resolution |
| 9 | Config `packs:` bare string invalid in config files (HIGH) | Fixed | `uses:` mapping; exact-object test pins |

## OCR final review and resolution

OCR (open-code-review, glm-5.3 on zai) produced exactly 2 findings; both resolved:

| # | OCR finding | Verification | Resolution |
| --- | --- | --- | --- |
| 1 | `packs: [{uses: './.github/codeql/queries'}]` — claim: action resolves config-file pack paths relative to the config file's directory | Fetched the pinned action (SHA `bce182f857edf1feab116e9795a3393d21977282` tarball) and read `src/db-config-schema.json`, `src/config/db-config.ts`, and the action's own `codescanning-config-cli.yml` integration tests | The mapping form for `packs` is not attested anywhere in the pinned action; its schema wants plain string pack-specs and its own tests reference LOCAL query directories under `queries: [{uses: './dir'}]` with workspace-relative paths. Dropped `packs` entirely; the local pack runs as a second `queries` entry (`uses: './.github/codeql/queries'`). Verified the CLI resolves that directory to exactly the 3 queries (`codeql resolve queries`). Test pin updated to the exact 2-entry queries object with no `packs` key. |
| 2 | Overfit-gate test extension list asymmetric (`.tsx` bare, `.ts` only as `".ts'"`, `.mts/.cts/.js/.jsx/.mjs/.cjs` unblocked) | Read the test | Replaced extension substring checks with one extension-family regex `/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)\b/` over query file contents; `packages/`, `src/`, `vybestack` substring checks unchanged. |

Post-fix verification: `bun test ./scripts/tests/ci-codeql-config.bun.test.ts ./scripts/tests/ci-codeql-latency.bun.test.ts` — 29 pass, 0 fail; prettier clean on both test files.

Note: finding 1 supersedes triage row 9's resolution (the `uses:` mapping under `packs` worked locally only because our CLI invocations passed query files directly; the pinned action's config pipeline was never exercised by that shape).
