# Phase 03: CLI Regression Test

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P03`

## Prerequisites
- Required: Phase 02a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P02a.md`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/integration-tests/profile-bootstrap.integration.test.ts`
  - Add a new suite tagged with `@plan:PLAN-20251020-STATELESSPROVIDER3.P03` and `@requirement:REQ-SP3-001`/`REQ-SP3-002`.
  - Test should execute `DEBUG=llxprt:* node scripts/start.js --profile-load synthetic --prompt "say hello"` (via helper) and expect **success** (no error thrown, output contains response stub).
  - Reference the synthetic keyfile by path (default `/Users/acoliver/.synthetic_key`) when spawning the CLI. Allow override via `process.env.SYNTHETIC_KEYFILE_PATH` so we never embed key contents in the repo.
  - The test must currently fail by capturing the non-interactive regression: stderr includes `Error when talking to openai API` because the synthetic base URL/keyfile are dropped. (Interactive `/profile load synthetic` still throws `Cannot set properties of undefined (setting 'authMode')` and will be covered later.)

### Required Code Markers
Include inline comments referencing reproduction:
```ts
/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P03
 * @requirement REQ-SP3-001
 * Reproduces current bootstrap failure.
 */
```

## Verification Commands
```bash
npm run test:integration --workspace @vybestack/llxprt-code -- --run src/integration-tests/profile-bootstrap.integration.test.ts
```
The command should fail with the observed OpenAI API error message.

## Manual Verification Checklist
- [ ] Integration test captures the real failure output.
- [ ] Failure message matches observed CLI error (`Error when talking to openai API`).
- [ ] No code changes applied to fix behaviour yet.

## Success Criteria
- Regression test demonstrates current bug before any stub or implementation work.

## Failure Recovery
If the test passes unexpectedly, ensure expectations assert successful output; re-run until it fails with the authentic error.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P03.md` noting the failing command output.
