# Issue #2831 — ModelConfigDialog two-phase save for staged edits

Branch: `issue2831`. Milestone 0.12.0. Labels: Ink UI, model configuration.

## Problem

`commitPendingEdits` in `packages/cli/src/ui/components/ModelConfigDialog.tsx`
iterates staged edits and applies each one to the runtime immediately
(`commitFieldEdit` → `applyFieldEdit` performs parse/validate + write fused per
field). If a LATER field fails validation or its runtime write throws, fields
earlier in field order are already committed: the runtime ends up half-saved.

Origin: PR #2753 OCR review (partial-commit comment), deferred as out of scope.

## Shaped acceptance criteria

### Behavior

`[s]ave` in list mode becomes two-phase:

1. **Phase 1 — validate all, write none.** Every staged edit is planned
   (parsed + validated) with zero runtime mutation. If ANY staged edit is
   invalid, the save stops before any write: first invalid field (in field
   order) is reported as `<field.key>: <message>`, the dialog stays open, all
   pending edits remain staged, and the runtime is unchanged.
2. **Phase 2 — apply all, roll back on throw.** Prior values of every planned
   write are snapshotted before the first write. Planned writes apply in field
   order. If any runtime write throws mid-loop, every already-applied write is
   restored from the snapshot, the throwing field is reported as
   `<field.key>: <message>`, the dialog stays open, pending edits remain
   staged, and the runtime ends exactly where it started.
3. **Full success** behaves as today: all writes applied, pending edits
   cleared, validation error cleared, dialog closes.

### Inputs and boundary cases

- Multi-field save where a later field fails validation (e.g. valid
  `temperature=9.9` staged before invalid `prompt-caching=bogus`): zero
  runtime writes, error names the later field.
- Runtime write throwing on the second of two staged edits: first write rolled
  back to its prior value; throwing field unwritten.
- Staged CLEAR of a param (`clearActiveModelParam` path) rolled back when a
  later write throws: prior param value present again.
- Ephemeral prior value `undefined` restored via `setEphemeralSetting(key,
  undefined)` (same call the existing clear path uses).
- Boolean/enum staged edits: never fail validation; still planned writes that
  participate in snapshot/rollback.
- No-op staged edits (boolValue === null, enumIndex === null): no write, no
  snapshot entry.
- Staged edits survive a failed save so the user can correct and re-save;
  re-save after correction commits everything exactly once.

### Design (agreed shape, implementation detail may flex)

- `modelConfigParamCommit.ts`: replace fused validate+write `commitModelParam`
  with pure `validateModelParam(key, raw)` returning
  `{ success: true; value: unknown } | { success: false; message: string }`
  (parse + registry numeric guard, throw-safe). Keep `NOT_A_NUMBER_MESSAGE`.
  The dialog is the only caller today; module filename and docstring stay
  (docstring updated to the validation contract).
- Dialog: `planFieldEdit(field, edit)` returns a planned write
  (`set-param` value / `clear-param` / `set-ephemeral` value), a skip (no-op),
  or a validation error — no runtime calls. `commitPendingEdits` runs phase 1
  over all staged fields, snapshots prior state per planned write (the inverse
  write: param with prior → `set-param` prior; param absent → `clear-param`;
  ephemeral → `set-ephemeral` prior), then applies phase 2 in order inside a
  try/catch; on throw it applies the inverse writes for everything already
  applied and reports the throwing field. `commitFieldEdit`, `applyFieldEdit`,
  and `commitEphemeral` are replaced by plan/apply/restore functions.
- Rollback (inverse) writes are NOT individually guarded — a restore throwing
  means a genuinely broken runtime and propagates (fail-fast preference; the
  restore targets keys whose forward writes just succeeded).
- Snapshot source is `d.params` / `d.ephemeral` (runtime reads from the last
  render — current by construction, since writes only happen at save).

### Tests (behavioral, bun:test; stateful fake runtime, no mock theater)

`ModelConfigDialog.test.tsx` (extend `createStatefulRuntime` with a minimal
fail-on-key mode for writes, e.g. `failSetParamKeys` / `failSetEphemeralKeys`):

- T1 multi-field save, later field fails validation → zero runtime writes
  (params AND ephemerals unchanged), error shows failing key, dialog open,
  staged values still rendered.
- T2 recovery: after T1-style failure, correct the invalid field and re-save →
  both values land exactly once.
- T3 runtime write throws on the second staged edit → first edit rolled back
  to prior value, throwing field unwritten, error names throwing key, dialog
  open, staged edits retained.
- T4 staged clear rolled back when a later write throws → cleared param
  present again with its prior value.
- T5 multi-kind success (param edit + ephemeral enum + boolean + a clear in
  one save) → all land, dialog closes.

`modelConfigParamCommit.spec.ts`: migrate rows from `commitModelParam` +
recorder to `validateModelParam` (assert returned typed value on success rows;
`{ success: false; message }` on rejection rows; recorder no longer needed).
The "runtime write failure" row is removed — that path now lives in dialog
phase 2 and is covered by T3/T4.

## Scope guardrails

- Files: `ModelConfigDialog.tsx`, `ModelConfigDialog.test.tsx`,
  `modelConfigParamCommit.ts`, `modelConfigParamCommit.spec.ts`. Nothing else.
- No new public abstractions (no new exports beyond `validateModelParam`
  replacing `commitModelParam` in the dialog-local helper module); runtime API
  untouched; staging/key handling/rendering/field building untouched.
- No persistence-level transactions; runtime `set*`/`clear*` remain the write
  primitives.

## Verification

Full cycle per workflow: `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, smoke test
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
Targeted: `bun test packages/cli/src/ui/components/ModelConfigDialog.test.tsx`
and `.../modelConfigParamCommit.spec.ts`, plus
`bun scripts/test-audit/scan.ts` diff vs main for touched files.

## Review plan

- deepthinker compliance review (max 2 rounds).
- OCR (open-code-review, `zai` profile, glm-5.3) — max 2 local + 2 PR rounds;
  findings triaged Blocker-Fix / In-scope-Fix / Reject / Defer.

## Status log

### Implementation + local evidence (2026-09-08)

- Implementation done via subagent (`codeanalyzer`, glm) after
  `fallbacktypescriptcoder` (quota), `deepthinker` (quota), and `architect`
  (rate limit) were all unavailable; its 1800s task timeout cut off the final
  report, but the working tree contains the complete change (driver-verified
  against this plan via `git diff`).
- RED→GREEN evidence (regenerated by driver): with the two production files
  stashed, the new dialog tests fail T1/T3/T4 (23 pass / 3 fail) — proving the
  partial-commit bug and that the new tests detect it; with the new code both
  files pass 48/48.
- Test-audit scan vs main baseline: only NEW findings were two SELF_CONFIRMING
  rows in T1 (pre-save maps captured from the same accessors used in the
  assertion). Fixed by asserting literal default runtime state
  (`{ temperature: 0.7 }` / `{ 'reasoning.enabled': true }`); re-scan clean.
  The remaining DUP_ASSERT row pre-exists on main (line shift only).
- packages/cli eslint: 11 errors, all in untouched files (mcp/*, consent.ts) —
  verified identical with changes stashed (pre-existing on main).
- Root cycle environmental notes: `node_modules/bun` postinstall had been
  skipped (bun binary missing) — fixed via `cd node_modules/bun && node install.js`.
  First typecheck pass shows stale-`dist` errors across workspaces (broader
  than the 6 pre-existing TS6305 already documented); rerunning typecheck
  AFTER `npm run build` regenerates dist.

### Compliance review round 1 (2026-09-08) — rustcoder (substitute)

Designated deepthinker + fallbacks (typescriptreviewer/reviewer gpt56,
rustreviewer/architect opusthinking) all quota/rate-dead at review time;
rustcoder (zai-glm-flash, different model from implementer) substituted.
Verdict: **APPROVE-WITH-NOTES**, zero HIGH/MEDIUM findings. Confirmed: both
failure modes atomic; rollback inverse-write semantics exact (presence-based
param restore, `undefined` ephemeral restore); throw attribution correct via
un-incremented `applied`; export surface changed 1:1; success path identical;
48/48 tests pass.

Findings triage:

- LOW — no failure-mode test exercising `failSetEphemeralKeys` /
  `failClearParamKeys` (ephemeral/clear-param throw paths) → **In-scope-Fix**
  (add T6: staged ephemeral edit + staged clear with a later ephemeral write
  throwing → both rolled back).
- LOW — throwing field's own write not restored if a runtime mutated before
  throwing → **Defer** (matches the issue letter "restores every field it
  already wrote"; documented stance).
- LOW — throw-attribution loop subtlety (for-loop update clause must not run
  after a throw) uncommented → **In-scope-Fix** (one comment sentence).

### OCR round 1 local (2026-09-08, glm-5.3 on zai via credential proxy) — 8 findings

- **Blocker-Fix** — unguarded restore loop: restore throw would skip remaining
  restores, mask the original error, and escape to the keypress handler
  (Ink-teardown regression vs the deleted `commitFieldEdit` guard). FIXED:
  per-restore guard, failed keys recorded, remaining restores continue,
  original error always surfaced (`(rollback incomplete: <keys>)` suffix).
- **In-scope-Fix** — rollback snapshot read render-time `d.params`/`d.ephemeral`
  (stale on external mutation). FIXED: fresh `getActiveModelParams()` /
  `getEphemeralSettings()` read once at phase-2 start.
- **In-scope-Fix** — `priorWriteFor` branched on `field.kind` while
  `planFieldEdit` branches on `field.editor`. FIXED: prior derived from the
  planned write's own kind.
- **In-scope-Fix** — `parseEphemeralSettingValue` lost the old inline-catch
  contract. FIXED: guarded in `planFieldEdit`, returns invalid-plan.
- **In-scope-Fix (tests)** — added T7 (later ephemeral parse failure, zero
  writes, staged edits retained), T2 write counters proving exactly-once, T4
  vacuous `(not set)` assertion replaced with targeted rollback assertions.
- **In-scope-Fix (tests)** — T8: first planned write throwing (applied===0
  case, `failClearParamKeys`).
- **In-scope-Fix (tests)** — T9: prior-absent ephemeral rollback restores
  present-but-`undefined` (matches real SettingsService + dialog clear idiom).

### OCR round 2 local (2026-09-08, glm-5.3) — 2 findings, both on round-1 remediation code

- **In-scope-Fix** — `(rollback incomplete: ...)` branch untested → T10 added
  (forward set-param lands, later write throws, clear-param restore also
  throws → suffix surfaced, degraded state asserted honestly).
- **In-scope-Fix** — `planned[applied]` index-arithmetic coupled error
  attribution to the for-loop throw rule → per-entry loop captures the failing
  entry lexically; rollback extracted to `restoreAppliedWrites` (nested-
  control-flow lint limit); behavior identical.

Final state: 53/53 targeted tests (31 dialog incl. T1-T10, 22 spec);
eslint/prettier/test-audit scan clean on all touched files; budgets 34/80
(commitPendingEdits) and 798/800 (test file, counted). Local OCR cap (2)
reached; proceeding to PR.
