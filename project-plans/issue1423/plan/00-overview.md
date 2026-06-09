# Plan: Provider-Agnostic Core Naming for Issue #1423

Plan ID: PLAN-20260608-ISSUE1423
Generated: 2026-06-08
Total Phases: 8 plus verification phases
Requirements: REQ-NAME-001, REQ-NAME-002, REQ-NAME-003, REQ-VERIFY-001

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification in `plan/00a-preflight-verification.md`.
2. Read `specification.md`, `analysis/domain-model.md`, `analysis/integration-contract.md`, and `analysis/pseudocode/rename-refactor.md`.
3. Preserved behavior: this is a rename refactor, not a feature addition.
4. Followed TDD where new verification is added: write the naming regression test/script first and observe it fail before implementation.
5. Avoided aliases/shims: issue #1423 requires renaming and updating callers, not aliasing.

## Execution Model

Execute phases sequentially using `dev-docs/COORDINATING.md`:

- Each worker phase uses LLxprt Code Subagent `typescriptexpert`.
- Each verification phase uses LLxprt Code Subagent `typescriptreviewer`.
- Do not skip phase numbers.
- Do not combine phases.
- If verification fails, run a remediation subagent for the failed phase and re-run the same verification phase before proceeding.

## Refactoring Strategy

1. Verify assumptions and current file/import surface.
2. Add a regression check that proves the targeted old names are gone after implementation.
3. Rename the chat session module and related tests.
4. Rename the CLI entry module and related tests.
5. Rename the agent client class, config field/accessor, callers, and tests.
6. Clean up cross-package leftovers without touching legitimate Gemini provider-specific names.
7. Run full verification and smoke test.

## Out of Scope

- Do not rename `packages/cli/src/auth/gemini-oauth-provider.ts`.
- Do not rename provider aliases/configs that specifically describe the Gemini provider.
- Do not rename `packages/core/src/core/geminiRequest.ts`.
- Do not rename the `packages/cli/src/ui/hooks/geminiStream/` folder as a broad folder/API migration in this issue, except update any imports/types inside it that reference the renamed core `AgentClient`/`ChatSession` symbols.
- Do not rename UI component names solely because they contain Gemini unless they directly refer to the renamed provider-agnostic targets.

## Required Supporting Artifacts

Implementation agents must read:

- `project-plans/issue1423/specification.md`
- `project-plans/issue1423/analysis/domain-model.md`
- `project-plans/issue1423/analysis/integration-contract.md`
- `project-plans/issue1423/analysis/pseudocode/rename-refactor.md`
- The phase file they are executing

## Full Verification Requirement

Before check-in/PR, run from the repository root:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

Fix any failures. Do not claim failures are unrelated without evidence.
