# Issue #1569d — Batch Inventory

Canonical execution queue. Coordinator picks the next open batch from this
file. Subagents do not pick files. Every batch must be executed using the
workflow defined in [`PLAN.md`](./PLAN.md) (implementer = `typescriptexpert`;
verifier = `deepthinker`).

Two kinds of batch appear below:

- **Repo sweep (RS)**: the rule is already localized and easy. The batch
  drives the rule to zero repo-wide, then promotes it globally to `'error'`
  in `eslint.config.js` in the same commit. File list is *every currently
  offending file for that rule* as captured in the batch's pre-flight lint
  run. The coordinator freezes that list before the implementer starts.
- **Fixed batch (FB)**: the file list is hand-picked in advance (high-risk
  rules and god-object decomposition).

---

## Phase 0 — Baseline

### B0
- **Purpose**: capture the global warning baseline before any fix.
- **Owner**: coordinator (no subagent).
- **Deliverable**: `project-plans/issue1569d/BASELINE.md` with:
  - total warnings,
  - per-rule counts sorted descending,
  - date/commit hash.
- **Blocks**: every other batch.

---

## Phase 1 — Test discipline (vitest)

All vitest rules are already scoped to `**/*.{test,spec}.{ts,tsx}` in
`eslint.config.js`. Each batch below is a repo sweep within the test glob.

### RS-V1 — `vitest/require-to-throw-message`
- Pre-flight: run lint, freeze the offending-file list.
- Promotion target: global `'error'` in the vitest block.

### RS-V2 — `vitest/expect-expect`
- Same structure.

### RS-V3 — `vitest/no-conditional-expect`
- Same structure.

### RS-V4 — `vitest/no-conditional-in-test`
- Same structure.

### RS-V5 — `vitest/require-top-level-describe`
- Same structure.

### RS-V6 — `vitest/max-nested-describe`
- Same structure; cap stays at 3.

---

## Phase 2 — Readability

### RS-R1 — `no-else-return`
- Repo sweep.
- Promote to global `'error'`.

### RS-R2 — `no-lonely-if`
- Repo sweep.
- Promote to global `'error'`.

### RS-R3 — `no-unneeded-ternary`
- Repo sweep.
- Promote to global `'error'`.

### RS-R4 — `@typescript-eslint/prefer-optional-chain`
- Repo sweep.
- Promote to global `'error'`.

---

## Phase 3 — Boolean / nullish correctness

These are riskier. Coordinator may split any of them into per-package sub-
batches if the pre-flight count exceeds what a single subagent pass can
safely handle. The cap per sub-batch is 25 production files or 40 test
files. The coordinator will document any split in this file before the
implementer starts.

### RS-BN1 — `@typescript-eslint/switch-exhaustiveness-check`
- Repo sweep.
- Promote to global `'error'`.

### RS-BN2 — `@typescript-eslint/prefer-nullish-coalescing`
- Repo sweep.
- Promote to global `'error'`.

### RS-BN3 — `@typescript-eslint/no-misused-promises`
- Repo sweep.
- Promote to global `'error'`.

### RS-BN4 — `@typescript-eslint/no-unnecessary-condition`
- Expected large (~2000+ warnings). Will almost certainly be split into
  per-package sub-batches. Coordinator freezes the split before starting.
- Promote to global `'error'` only after every sub-batch is green.

### RS-BN5 — `@typescript-eslint/strict-boolean-expressions`
- Expected large (~2000 warnings). Same split-before-start rule as BN4.
- Promote to global `'error'` only after every sub-batch is green.

---

## Phase 4 — Sonar maintainability / anti-slop (non-complexity)

### RS-S1 — `sonarjs/todo-tag`
- Repo sweep.
- Policy: do not hide TODOs merely to satisfy lint. TODOs that reference a
  real follow-up should be converted to a linked issue reference comment
  (`// TODO(#NNNN): …`) or resolved. Deletions of TODOs must be justified in
  the commit.
- Promote to global `'error'`.

### RS-S2 — `sonarjs/no-ignored-exceptions`
- Repo sweep. Each ignored-exception site must either log or intentionally
  swallow with an explanatory `// eslint-disable-next-line` plus reason.
- Promote to global `'error'`.

### RS-S3 — `sonarjs/regular-expr`
- Repo sweep.
- Promote to global `'error'`.

### RS-S4 — `sonarjs/slow-regex`
- Repo sweep.
- Promote to global `'error'`.

### RS-S5 — `sonarjs/os-command` + `sonarjs/no-os-command-from-path`
- Repo sweep. These may share a batch since they co-occur on shell/process
  boundary files.
- Promote both to global `'error'`.

### RS-S6 — Remaining sonar anti-slop bundle
Coordinator groups these into sub-batches based on pre-flight count:

- `sonarjs/nested-control-flow`
- `sonarjs/expression-complexity`
- `sonarjs/no-nested-conditional`
- `sonarjs/no-collapsible-if`
- `sonarjs/no-identical-functions`
- `sonarjs/no-duplicated-branches`
- `sonarjs/no-all-duplicated-branches`
- `sonarjs/no-inconsistent-returns`
- `sonarjs/too-many-break-or-continue-in-loop`

Each rule ends at global `'error'`. Coordinator freezes the sub-batch plan
before the first of these runs.

---

## Phase 5 — Complexity / size (god-object decomposition)

These are the batches where real decomposition happens. The plan's global
targets are:

- `complexity`: 15
- `max-lines-per-function`: 80
- `max-lines`: 800 (must first be enabled as `warn` globally — see C5-PREP)
- `sonarjs/cognitive-complexity`: 30

### C5-PREP
- Add `max-lines: ['warn', 800]` globally to `eslint.config.js`.
- Re-run lint, record offending files to `project-plans/issue1569d/MAX_LINES_OFFENDERS.md`.
- Owner: coordinator, single commit. No subagent needed.
- Blocks: C5-ML-* batches.

### C5-CC — `complexity` repo sweep / decomposition
- Pre-flight: pick the worst offenders per package (top-N by current cyclomatic).
- Each fixed batch: at most 3 files, one subsystem.
- **Before the coordinator hands a hotspot file to the implementer**, the
  coordinator produces a short "responsibility map" for that file (names of
  the new helpers/modules the refactor should extract) and includes it in
  the implementer prompt. The implementer may refine names but not scope.
- Promote to global `'error'` only when all offenders are cleared.

### C5-MLF — `max-lines-per-function` repo sweep / decomposition
- Same structure as C5-CC.
- Promote to global `'error'` only when all offenders are cleared.

### C5-CogC — `sonarjs/cognitive-complexity` repo sweep / decomposition
- Same structure.
- Promote to global `'error'` only when all offenders are cleared.

### C5-ML — `max-lines` repo sweep / decomposition
- Same structure. This is the most surgical: every file >800 lines must be
  split or justified.
- Promote to global `'error'` only when all offenders are cleared.

If any single file in Phase 5 requires a design decision that the
coordinator cannot make unilaterally (e.g. "split `task.ts` into these three
modules with these names"), the coordinator stops and asks the user. The
coordinator does not let a subagent unilaterally redesign a public API.

---

## Phase 6 — Final wrap

### F1 — Final verification
- Full verification suite green.
- `npm run lint` reports `0 errors, 0 warnings`.
- Smoke command passes.
- Verifier: `deepthinker` (blind to prior context).

### F2 — PR
- Coordinator opens PR titled:
  `refactor(lint): finish #1569 lint hardening (Fixes #1569)`
- Body includes:
  - link to `BASELINE.md`
  - per-rule promotion table with pre/post counts
  - confirmation of the full verification suite
- Watch PR checks with `gh pr checks NUM --watch --interval 300`.
- Handle CodeRabbit comments via the standard project rules.

---

## Rule-level commit message convention

- When a rule is promoted to `'error'` globally for the first time in this
  plan: `refactor(lint): promote <rule> to error (Fixes #1569)`.
- When a rule is already at error but this batch pays down more offenders:
  `refactor(lint): pay down <rule> in <scope> (Fixes #1569)`.
- When a batch does pure decomposition of a god object:
  `refactor(<area>): decompose <file> to satisfy <rule> (Fixes #1569)`.
