# Phase 10: Documentation & Release

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P10`

## Prerequisites

- Required: Phase 09a completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P09a" project-plans/statelessprovider/analysis/verification/P09-decommission-report.md`
- Expected files: Codebase free of legacy APIs, tests green.

## Implementation Tasks

### Documentation

- Update `docs/architecture.md` with the new runtime context design, including diagrams for multi-context/subagent usage.
- Refresh `docs/settings-and-profiles.md` to describe per-runtime `SettingsService` instances and CLI helper workflows.
- Add a migration guide (`docs/migration/stateless-provider.md`) outlining steps external integrators must take to adopt the new API.
- Provide API reference updates for `ProviderRuntimeContext`, `runtimeSettings` helpers, and provider interfaces.

### Release Preparation

- Draft release notes capturing breaking changes, migration steps, and testing guidance.
- Update `CHANGELOG.md` with highlights and upgrade instructions.
- Ensure `package.json` (core + CLI) version bumps are coordinated with release strategy.
- Audit TypeScript declaration files (`*.d.ts`) to confirm new exports are documented.

### Samples & Tooling

- Refresh sample configurations/subagent examples (if any) to use the new helpers.
- Add a minimal code snippet demonstrating multiple contexts operating simultaneously.
- Update CI scripts or templates referencing deprecated commands.

### Quality Gates

- Run full CI suite (lint, test, typecheck) to confirm release readiness.
- Gather metrics or telemetry adjustments if the new architecture changes logging.

## Verification Commands

```bash
npm run lint -- --cache
npm run typecheck
npm run test
```

## Manual Verification Checklist

- [ ] Documentation reflects final architecture and migration paths.
- [ ] Release notes reviewed by stakeholders.
- [ ] Sample code builds/tests successfully.
- [ ] Versioning decisions recorded (if required).

## Success Criteria

- Project artefacts (code, docs, release notes) are aligned for publishing the stateless provider architecture.

## Failure Recovery

1. Address documentation or release gaps, rerun verification commands.
2. Obtain stakeholder review before closing the phase.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P10.md`

```markdown
Phase: P10
Completed: YYYY-MM-DD HH:MM
Files Modified:
- <list>
Verification:
- <paste outputs>
```
