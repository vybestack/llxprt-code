# P03 — Boundary Guard: Behavioural Tests First

> **SUPERSEDED — DO NOT EXECUTE.** See `../STATUS.md`. This plan targeted type
> width; the real problem is that `Config` mixes configuration, construction,
> injection and service location. Kept for the reasoning and the recorded dead
> ends only.

Plan ID: PLAN-20260808-ISSUE2615.P03
Requirements: REQ-001.1, REQ-004.1

## Goal

`scripts/tests/check-config-boundary.test.ts`, written before the guard exists.
Bun + `bun:test`.

## Behaviours to pin

1. Flags a production file outside core importing the `Config` type, whether via
   `import type { Config }`, `import { Config }`, `import { type Config }`, a
   renamed import, or a deep vs root specifier.
2. Does NOT flag a file inside `packages/core`.
3. Does NOT flag a file that constructs `new Config(...)` — factories and test
   harnesses legitimately need the class.
4. Does NOT flag test files.
5. Flags a role interface in `core/config/roles/` that declares a member
   matching `/^get[A-Z].*(Manager|Service|Registry|Client|Factory|Engine)$/`
   (REQ-004).
6. Report-only mode exits 0 and prints; enforcing mode exits 1.
7. Fails closed on a parse error rather than silently passing.

## Rules

- Real fixture files in a temp dir. No mocking the filesystem.
- Assert on behaviour and exit codes, not on internal function names.
- Tests must fail naturally against the absent implementation, not with
  `NotYetImplemented`.

## Acceptance

- Tests exist and fail for the right reason
- Zero lint errors, typechecks under `tsconfig.scripts.json`
