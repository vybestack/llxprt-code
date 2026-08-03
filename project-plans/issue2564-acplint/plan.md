# Issue 2564 Test-First Implementation Plan

Plan ID: PLAN-20260801-ACP-CONFORMANCE

## Preflight

1. Verify the current SDK, launcher, ACP flag/dispatch path, lifecycle behavior, CI action pins, workflow aggregator conventions, Python requirement, and acplint source revision.
2. Reproduce the deterministic selected-category baseline in an isolated temporary environment and preserve only summarized evidence in durable documentation.

## Sequential TDD Phases

### P01: Lifecycle RED

Add behavioral coverage through the real `ZedAgent`/`SessionLifecycle` path for:

- new → close → delete before a recording exists;
- unknown delete;
- close unknown → delete unknown;
- second delete after success;
- persisted deletion;
- ordered serialized close/delete.

Run the focused test and record that the regression fails before production code changes.

### P02: Lifecycle GREEN

Modify only the existing lifecycle implementation to retain connection-scoped known-closed IDs and satisfy REQ-ACP-002/003. Preserve serialization, public interfaces, and error mappings. Run focused and adjacent ACP tests.

### P03: Validator RED

Add process-level tests for the internal report validator. Cover valid Full/status 0, valid Partial/status 1, status 2, unexpected status, missing/malformed JSON, Non-Conformant level, missing category/result, empty/truncated results, selected FAIL/ERROR, and status/level mismatch.

### P04: Validator GREEN

Add the minimal internal TypeScript executable that parses the pinned report schema and fails closed according to REQ-ACP-005. Do not create a reusable public framework.

### P05: Workflow RED

Add semantic workflow tests using established YAML helpers. Prove permissions, timeout, dependencies, pinned action/tool revisions, Python/Node/Bun setup, build prerequisites, real launcher and exact arguments/categories, isolated homes, JSON output, raw status capture, always-run artifact upload, and fail-closed required-check wiring.

### P06: Workflow GREEN

Modify `.github/workflows/ci.yml` minimally to satisfy the workflow tests and REQ-ACP-004/006/007.

### P07: Real integration evidence

Build and run pinned acplint against the real launcher in isolated temporary homes. Capture the actual raw status and report, validate it with the committed script, and confirm every expected selected row passes.

### P08: Documentation and verification

Write `dev-docs/acp-conformance.md` from actual baseline/post-fix evidence. Run focused tests, all script tests, project test/lint/typecheck/format/build, the required smoke test, and final pinned acplint validation.

## Review Triage Policy

Classify every finding as:

- **Blocker-Fix**: prevents an accepted behavior or required gate from being correct.
- **In-scope-Fix**: improves correctness, tests, maintainability, or diagnostics strictly within the accepted implementation.
- **Reject**: factually incorrect, conflicts with repository behavior, or weakens requirements.
- **Defer**: valid but outside the explicit accepted scope.

Resolve all Blocker-Fix and In-scope-Fix findings before completion. Review suggestions do not authorize new subsystems, public abstractions, dependencies, workflow expansion, adjacent cleanup, or optional hardening.

## Verification Commands

```bash
npm --prefix packages/cli test -- src/zed-integration/zedIntegration.loadSession.test.ts
npx vitest run --config scripts/tests/vitest.config.ts scripts/tests/validate-acplint-report.test.ts scripts/tests/ci-acplint-workflow.test.ts
npm run test:scripts
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

The real pinned acplint invocation and committed validator run after build are also mandatory evidence.
