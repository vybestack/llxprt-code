# gmerge/0.26.0 Remediation Plan (Post-Merge Integrity)

## Goal

Address all currently-audited UNCLEAR/MISSING batches after merge commit `96ca183f6` using a strict execution loop:

1. Implement/remediate with `typescriptexpert`
2. Verify with `deepthinker`
3. If FAIL, loop remediation + verification until PASS (max 5 loops per batch)
4. Proceed to next batch only after PASS

Coordinator does not self-implement; all implementation and verification are delegated to subagents.

## Scope (from post-merge per-batch audits)

### Must Remediate

- **P3** — remove lingering unsupported `DiffModified` from theme docs
- **R9** — ensure `MOVE_UP` / `MOVE_DOWN` keybinding commands are actually used by text-buffer handling
- **R32** — remove hardcoded `'unknown'` MCP client version and plumb real CLI version
- **R33** — finish hooks schema split gaps
- **R39** — wire MCP status/message queue hooks into active app flow
- **R40** — implement runtime clearContext propagation for AfterAgent hooks

### Reconfirm and potentially remediate (if deepthinker still flags gaps)

- **R1** — extension config setting gate consistency
- **R14** — non-null merged settings optional chaining leftovers
- **R17** — MCP discovery state behavior alignment
- **R21** — disable* → enable* migration leftovers and consistency

### Note on P1/P2

- P1/P2 had audit ambiguity mostly due to docs/architecture divergence and ModelInfo-event architecture changes.
- No immediate runtime-breaking defect was flagged from those ambiguities in the remediation set.
- Keep out of this remediation pass unless new verifier evidence identifies concrete regressions.

## Execution Order

1. P3
2. R1
3. R9
4. R14
5. R17
6. R21
7. R32
8. R33
9. R39
10. R40

Rationale: low-risk/fast docs+input fixes first, then settings/migration, then high-risk hooks/MCP architecture changes.

## Per-Batch Delegation Template

### A) typescriptexpert (implementation)

For each batch, coordinator launches `typescriptexpert` with:

- Batch ID and upstream intent + playbook path
- Current audit finding(s) to remediate
- Explicit target files to inspect
- Requirement to run at least quick verification (`npm run lint && npm run typecheck`) for code batches
- No commit

### B) deepthinker (verification)

For each batch, coordinator launches `deepthinker` with:

- Batch ID and expected post-fix outcomes
- Read-only inspection of current HEAD code
- Required verdict: `PASS` / `FAIL`
- Concrete file evidence for any fail

### C) Loop policy

- If deepthinker returns `FAIL`:
  - Launch `typescriptexpert` remediation with verifier evidence
  - Re-run deepthinker
  - Repeat up to 5 cycles per batch
- If 5 cycles fail: pause and request human intervention

## Batch-specific remediation targets

### P3

- Remove unsupported `DiffModified` entry from `docs/cli/themes.md` custom theme example.

### R1

- Reconfirm extension config gate consistency across:
  - `packages/cli/src/commands/extensions/config.ts`
  - `packages/cli/src/config/extension.ts`
  - related tests and docs
- If stale/un-gated paths remain, align behavior with intended `experimental.extensionConfig` gate.

### R9

- Replace direct up/down key-name checks with command matcher wiring in text buffer path so `MOVE_UP/MOVE_DOWN` bindings are honored.
- Update/add tests to validate command-based behavior.

### R14

- Remove remaining optional chaining on guaranteed-present non-null merged settings subobjects only where type guarantees exist.
- Keep genuinely optional fields optional.

### R17

- Reconcile MCP discovery behavior with intended flow from playbook.
- Ensure non-slash submission gating/behavior during discovery is explicit and test-covered (or documented deliberate divergence if LLxprt architecture requires it).

### R21

- Eliminate inconsistent stale disable* usage where enable* semantics should apply.
- Ensure migration + docs + runtime callers are aligned and coherent.

### R32

- Plumb actual CLI version into `McpClientManager` construction (remove hardcoded `'unknown'`).
- Ensure version source comes from established version utility path.

### R33

- Complete hooks schema split:
  - ensure `hooksConfig`/`hooks` semantics are clean and merge strategy behavior is correct
  - ensure command persistence paths target correct keys
  - update schema artifacts/tests as needed

### R39

- Ensure `useMcpStatus` + `useMessageQueue` are wired into active runtime submission flow, not dead code.
- Ensure desired behavior for pending messages / MCP readiness is active and covered by tests.

### R40

- Implement actual runtime consumption of `shouldClearContext()` for AfterAgent outputs.
- Propagate `contextCleared` in emitted stream events.
- Ensure reset/clear behavior and messaging are test-covered.

## Verification cadence

- Per batch quick verify (for code batches):
  - `npm run lint`
  - `npm run typecheck`
- After all batches:
  - `npm run test`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run format`
  - `npm run build`
  - `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Commit strategy

- Single remediation commit after all batches PASS verification.
- Commit message draft:
  - `fix: remediate post-merge gaps for gmerge/0.26.0 high-risk batches`

## Coordinator invariants

- Use todo list status updates throughout.
- Do not stop until all listed remediation tasks complete or a hard blocker is reached.
- Do not delete/alter `.llxprt/` contents.
