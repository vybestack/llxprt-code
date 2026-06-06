Review the project plan at `project-plans/issue1584` for GitHub issue #1584, extracting provider implementations into `packages/providers`.

Use the available file-reading and search tools directly to read the plan files and repository rule documents. If the plan spans many files, use multiple tool calls as needed rather than stopping after one failed or incomplete read.

Read and evaluate the plan against these repository planning rules and project constraints:
- `dev-docs/PLAN.md`
- `dev-docs/PLAN-TEMPLATE.md`
- `dev-docs/RULES.md`
- `dev-docs/COORDINATING.md`
- GitHub issue #1584 intent: provider implementations, tokenizers, ProviderManager, provider interfaces/types, provider utilities/errors/content generator move out of `packages/core/src/providers` into `packages/providers`; callers update imports; no backward compatibility shims.
- Parent issue #1568 intent: refactoring only, no behavior changes, no compatibility shims, package modularization with clean dependency boundaries.

Assess whether the plan is implementable and sufficiently rigorous. Specifically check:
1. It follows the plan system structure, not a single large plan file.
2. It includes mandatory preflight verification, analysis before implementation, pseudocode with numbered lines/contracts, integration-first testing, sequential phases, verification phases, semantic verification, and completion markers.
3. It is adapted correctly for refactoring: behavioral/regression tests preserve existing provider flows instead of inventing new feature behavior.
4. It correctly handles the critical dependency direction risk: `providers -> core`, `cli -> providers`, `cli -> core`, and no final production `core -> providers` cycle unless the plan explicitly changes to a cycle-free shared package design.
5. It addresses practical migration details: exact old code to replace/remove, user access points, import migration, provider tests, package metadata, workspace setup, tsconfig/build conventions, and smoke/full verification commands.
6. It avoids plan anti-patterns: mock theater, reverse testing, NotYetImplemented tests, structure-only assertions, compatibility shims, V2/New parallel implementations, skipped phases, and broadening scope into auth/tools/settings extraction.
7. It is detailed enough for a TypeScript implementation agent to execute without inventing major architecture decisions.

Return a structured review with:
- Overall verdict: PASS, PASS WITH MINOR NOTES, or NEEDS CHANGES.
- Substantive issues that should be fixed before implementation, with file paths and concrete remediation.
- Low-value or pedantic notes separately.
- Any risks that should be consciously accepted rather than fixed.

Do not modify files.