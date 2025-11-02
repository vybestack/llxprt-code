# Phase 09: Migration & Cleanup

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P09`

## Prerequisites
- Required: `.completed/P08a.md` documented.
- Verification: `test -f project-plans/20251023stateless4/.completed/P08a.md`
- Expected files from previous phase: Integrated runtime and provider updates.

## Implementation Tasks

### Files to Modify
- `packages/core/src/providers/*`
  - Remove unused imports, deleted cache structures, and legacy helper functions replaced during P07 (ensure docblocks updated with `@plan:PLAN-20251023-STATELESS-HARDENING.P09`).
- `packages/core/src/providers/index.ts` or barrel exports
  - Ensure new error class exported where needed.
- `docs/` or `dev-docs/` (if applicable)
  - Update provider configuration guidance to reflect stateless requirements (reference REQ-SP4-001..004).
- `packages/cli/README.md` or CLI docs
  - Document runtime guard behaviour and upgrade notes for CLI users (REQ-SP4-005).

### Activities
- Run repository-wide search to confirm no references remain to removed caches or `getSettingsService()` fallback.
- Update `CHANGELOG.md` (if maintained) highlighting stateless provider hardening.

### Required Code Markers
- Cleanup comments referencing new behaviour must include `@plan:PLAN-20251023-STATELESS-HARDENING.P09` with associated `@requirement:REQ-SP4-00X` IDs.

## Verification Commands

### Automated Checks
```bash
rg "getSettingsService" packages/core/src/providers
rg "runtimeClientCache" packages/core/src/providers
pnpm lint
```

### Manual Verification Checklist
- [ ] No legacy caches or singleton fallbacks remain.
- [ ] Documentation reflects new requirements for runtime-scoped settings.
- [ ] Exports updated for new error types.

## Success Criteria
- Codebase free of obsolete constructs; developer docs aligned with hardened design.

## Failure Recovery
1. Remove lingering references and rerun `rg` commands until clean.
2. Coordinate with documentation owners if additional updates required.

## Phase Completion Marker
- Create `.completed/P09.md` summarising timestamp, cleanup actions, and verification evidence per PLAN-TEMPLATE guidelines.
