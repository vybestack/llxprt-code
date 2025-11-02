# Phase 10: Deprecation & Communication

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P10`

## Prerequisites
- Required: `.completed/P09a.md` recorded.
- Verification: `test -f project-plans/20251023stateless4/.completed/P09a.md`
- Expected files from previous phase: Cleanup-confirmed codebase and updated docs.

## Implementation Tasks

### Files to Modify
- `docs/release-notes/2025-10.md` (or equivalent)
  - Document stateless provider hardening, migration notes, and error messaging (REQ-SP4-001..005).
- `packages/cli/src/runtime/messages.ts` (or CLI messaging module)
  - Add user-facing warning referencing new guard requirement and remediation steps.
- `dev-docs/RULES.md` or `dev-docs/PLAN.md`
  - Update internal guidance to reflect stateless enforcement expectations.

### Activities
- Draft communication plan for teams consuming providers (SDK, CLI, integrations) explaining required runtime context injection.
- Ensure release artifacts highlight tests covering multi-runtime isolation to reassure consumers.

### Required Code Markers
- Added documentation/messaging must include `@plan:PLAN-20251023-STATELESS-HARDENING.P10` and relevant `@requirement:REQ-SP4-00X` references.

## Verification Commands

### Automated Checks
```bash
rg "PLAN-20251023-STATELESS-HARDENING.P10" docs dev-docs packages/cli/src/runtime
```

### Manual Verification Checklist
- [ ] Release notes describe new error (`MissingProviderRuntimeError`) and migration path.
- [ ] CLI messaging instructs users to supply runtime context when invoking providers.
- [ ] Internal rules reference updated stateless requirements.

## Success Criteria
- Stakeholders informed; documentation and messaging prepared for rollout.

## Failure Recovery
1. Expand documentation to cover missing audiences.
2. Update messages for clarity and rerun verification command.

## Phase Completion Marker
- Create `.completed/P10.md` capturing timestamp, communication deliverables, and verification notes per PLAN-TEMPLATE guidelines.
