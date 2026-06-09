Review the implementation/refactoring plan for GitHub issue #1588 in `project-plans/issue1588/`.

Context:
- Issue #1588 is "Extract packages/settings". The goal is to extract settings/configuration pieces into a dedicated `packages/settings` workspace package.
- Acceptance criteria include: all relevant code lives in `packages/settings`; clean public interface with no circular dependencies; tests pass in the new package; existing imports updated.
- Requested moves include: `packages/core/src/settings/**`; relevant `packages/core/src/config/**` parsing/profile/storage after god-object decomposition; CLI settings schema/runtime settings after god-object decomposition.
- Dependency rule from the issue: settings should depend on storage for persistence and must not depend on providers, tools, or CLI. In this repository no `packages/storage` currently exists, so the plan must handle that explicitly without inventing unsupported assumptions.
- Existing provider extraction work in `project-plans/issue1584/**` and current `packages/providers/**` are important precedent for package metadata conventions, no-shim policy, dependency direction, and behavioral test planning.
- Planning rules in `dev-docs/PLAN.md`, `dev-docs/PLAN-TEMPLATE.md`, and `dev-docs/RULES.md` are mandatory: TDD, behavioral tests, integration-first planning, preflight verification, semantic verification, and no mock theater.

Your task:
1. Read the issue1588 plan artifacts and relevant source/package files as needed.
2. Check the plan against the actual repository, issue intent, issue1584 precedent, and dev-doc planning rules.
3. Identify missing analysis, incorrect assumptions, dependency cycles, insufficient tests, weak verification, scope mistakes, naming/path mistakes, no-shim violations, or implementation-phase ambiguities.
4. Treat all findings seriously. Do not rubber stamp. Be pedantic about package boundaries, test quality, and refactoring scope.
5. Output a structured review with:
   - Verdict: PASS if only pedantic/nit-level improvements remain; otherwise FAIL.
   - Material issues: numbered list with file/path references and concrete required changes.
   - Pedantic improvements: numbered list.
   - Evidence: key source/plan files inspected.

Do not modify files. Return the review only.