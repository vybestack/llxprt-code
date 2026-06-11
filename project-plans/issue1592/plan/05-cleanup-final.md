# Phase 05: Cleanup and Final Hardening

## Phase ID

`PLAN-20260610-ISSUE1592.P05`

## Prerequisites

- P04a PASS.

## Requirements Implemented

### REQ-CLEAN-001: full cleanup
### REQ-API-001.2/.3: minimal export surfaces, no shims

## Implementation Tasks

1. Prune `packages/core/package.json` exports entries that no longer resolve (moved files) — but KEEP entries agents/providers/cli legitimately use. Verify each removal with a workspace-wide grep.
2. Prune dead exports from `packages/core/src/index.ts` and `packages/agents/src/index.ts` (export only what consumers import — verify by grep; do not over-prune public API used by external consumers of the published packages: keep parity with pre-move public surface for symbols that stayed).
3. Sweep for leftovers:
   ```bash
   grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|for now|placeholder)" packages/agents/src packages/core/src --include="*.ts" | grep -v test   # new occurrences vs main only
   git diff main --name-only | xargs grep -ln "NotYetImplemented" 2>/dev/null
   ```
4. Documentation: if `packages/providers` has a README, add an equivalent `packages/agents/README.md`; update any architecture docs that enumerate packages (`docs/`, `dev-docs/`, root README package lists) — search `grep -rn "packages/providers" docs dev-docs README.md` for lists to extend. Completion notes MUST state whether `packages/providers/README.md` exists and whether an agents README was added or deliberately skipped (with reason).
5. Update `.github/CODEOWNERS` if it has package paths (check).
6. Final full battery + smoke test + bundle.
7. Cycle check: `npx madge --circular --extensions ts packages/agents/src packages/core/src` (or repo-standard equivalent; document output).

## Verification Commands

Full battery (00-overview) + all dependency/anti-shim scans (including the authoritative P03a item 11b workspace-leakage gate: multi-form import inventory + all package.json dependency sections + tsconfig/vitest/esbuild aliases) + smoke test.

## Completion Marker

`.completed/P05.md`.
