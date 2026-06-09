# Phase 03a: Naming Regression TDD Verification

## Phase ID

`PLAN-20260608-ISSUE1423.P03a`

## Prerequisites

- Required: Phase 03 completed.
- Verification: `test -f project-plans/issue1423/.completed/P03.md`.

## Verification Scope

Verify the P03 regression check is meaningful, fails before implementation, and will not produce false failures for legitimate Gemini provider-specific code.

## Required Checks

```bash
grep -r "@plan:PLAN-20260608-ISSUE1423.P03" packages project-plans/issue1423
grep -r "@requirement:REQ-VERIFY-001.2" packages project-plans/issue1423
```

Read the created test/script and answer the semantic questions.

## Holistic Functionality Assessment

The reviewer must explain:

- What paths and identifiers the regression check scans.
- Why it fails before implementation.
- Why it would catch aliases/shims.
- Why legitimate Gemini provider-specific files do not fail the check.

## PASS Criteria

PASS only if the test would fail with old provider-agnostic names and pass only after direct rename/no-alias implementation.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P03a.md` with PASS/FAIL and assessment.
