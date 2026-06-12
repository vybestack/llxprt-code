# Phase 07: Scaffold Build And Release TDD

## Phase ID

`PLAN-20260608-ISSUE1585.P07`

## Purpose

Add tests for workspace inclusion, publishable metadata, release process expectations, sandbox/Docker expectations, and forbidden dependencies.

## Prerequisites

- Required: P06a completed (build wiring verified).
- Artifacts: packages/tools builds, lockfile updated.

## Requirements Implemented

### REQ-REL-001, REQ-PKG-001, REQ-RELEASE-PROCESS

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-RELEASE-PROCESS, REQ-PKG-BOUNDARY

**Behavior specification**:
- GIVEN: Build wiring is verified
- WHEN: Release process extension tests are written
- THEN: Tests fail for missing release implementation; package metadata tests verify actual package.json content; no mock theater

**Why it matters**: If release tests only check file existence, they pass even when the release workflow is not updated, causing publish failures.

## Implementation Tasks

### Step 1: Create Release Process Tests Extension

Update `scripts/tests/release-process.test.js` to add tools expectations:

- `@vybestack/llxprt-code-tools` is in the expected publish order BEFORE core/providers/cli
- Tools tarball preparation exists
- Tools sandbox packing exists
- Tools Dockerfile install exists
- bind-release-deps includes tools

These tests should FAIL until P08 implements the release wiring.

### Step 2: Create Package Metadata Test

Create `packages/tools/src/__tests__/package-metadata.test.ts`:

- Verify package.json name is `@vybestack/llxprt-code-tools`
- Verify package.json type is `module`
- Verify package.json has main, types, exports
- Verify package.json has build/lint/format/test/typecheck scripts
- Verify package.json has engines.node >= 20
- Verify package.json files includes `dist`
- Verify package.json has no core/providers/cli dependencies

### Step 3: Create Forbidden Dependencies Test

Create `packages/tools/src/__tests__/forbidden-dependencies.test.ts`:

- Read packages/tools/package.json
- Assert dependencies does not include core, providers, or cli
- Assert devDependencies does not include core or providers (test-utils is OK)

### Files To Create Or Modify

- Modify: `scripts/tests/release-process.test.js` (add tools expectations, should fail)
- Create: `packages/tools/src/__tests__/package-metadata.test.ts`
- Create: `packages/tools/src/__tests__/forbidden-dependencies.test.ts`

## Verification Commands

```bash
# Release tests should fail at this stage (tools not in release.yml yet)
npm run test:scripts 2>&1 | tail -30
# Package metadata tests should pass (package.json exists)
npm run test --workspace @vybestack/llxprt-code-tools
```

## Semantic Verification Checklist

- [ ] Release process tests are real (test metadata text, not file existence).
- [ ] Tests fail for missing implementation (release workflow, sandbox).
- [ ] Package metadata tests verify actual package.json content.
- [ ] No mock theater.

## Success Criteria

- Release process tests exist and fail for missing implementation.
- Package metadata tests pass.

## Failure Recovery

Fix test quality if tests don't fail naturally.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P07.md` with test listing and failure evidence.
