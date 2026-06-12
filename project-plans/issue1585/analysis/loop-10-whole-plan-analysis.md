# Whole-Plan Analysis After Loop 10 Review

## Context

The tenth review loop returned substantive FAIL feedback. Per user instruction, review/revision looping stops here and the planning set is analyzed as a whole instead of continuing to an eleventh loop.

## Root Causes of Remaining Issues

1. **Migration group dependencies were not formally sequenced against adapter availability.**
   P11 groups are compile-safe on paper, but not all tools in a group are constructible at that point. For example, key-storage-dependent web tools were listed before the key-storage adapter exists. The P10/P11 test sequencing problem has the same root cause: all tests are planned before all constructors/adapters are available.

2. **Verification commands were drafted without being validated against actual tooling behavior.**
   P13 uses ripgrep negative lookahead patterns even though ripgrep uses Rust regex without lookaround support. Cleanup scans focused on `*.ts` and missed non-TypeScript artifacts like fixtures and snapshots.

3. **Ownerless known issues persisted across loops.**
   Some items were identified but never assigned a clear phase owner: exact trusted-publishing fields, `zod-to-json-schema` core dependency remediation, and the incorrect overview path to the trusted publishing artifact.

## Fundamental Assessment

The plan is **architecturally sound but over-documented and fragile**.

The core design remains right for issue #1585:

- `packages/tools` owns tool abstractions and implementation code.
- `packages/tools` must not depend on core, CLI, providers, or future absent packages.
- Core provides adapters for runtime-specific dependencies.
- Providers migrate away from core deep tool imports.
- Release, sandbox, Docker, package-lock, and trusted publishing are covered.

The fragility is in the execution layer: many phases and cross-referenced artifacts make small corrections easy to miss. The remaining feedback is localized and mechanical, not a sign that the target architecture needs to be redesigned.

## Recommended Remediation Strategy

Do **manual targeted edits**, not another review/revision loop. The remaining issues are concrete and localized.

Recommended edit set:

1. `plan/11-tool-move-impl.md`
   - Add a group-scoped test rule: P10 may create all tests, but P11 group verification runs only current-plus-completed group tests until all groups finish.
   - Move `codesearch.ts`, `exa-web-search.ts`, and `google-web-search.ts` from Group 3 to the group where `CoreToolKeyStorageAdapter` exists, or create that adapter before those tools move.
   - Split MCP and LSP prerequisite text into two clear gates with exact commands and required fields.

2. `plan/13-consumer-migration.md`
   - Replace all ripgrep lookaround commands with separate scans or Perl-compatible commands.
   - Keep old-path scans separate from symbol-aware `tool-key-storage` checks.

3. `plan/15-cleanup-no-shims.md`, `plan/15a-cleanup-no-shims-verification.md`, and `plan/16-full-verification.md`
   - Replace TypeScript-only cleanup checks with all-file scans: `find packages/core/src/tools -type f | sort`.
   - Require every remaining file, including fixtures/snapshots/non-TS artifacts, to be classified against an approved allowlist.

4. `manual-trusted-publishing.md`
   - Replace placeholder/verify fields with an explicit manual release gate: first release is blocked until exact npm UI baseline values from existing packages are recorded.

5. `plan/00-overview.md`
   - Fix the artifact path to `project-plans/issue1585/manual-trusted-publishing.md`.

6. `plan/08-package-scaffold-impl.md` and/or `plan/09-tool-inventory-and-move-map.md`
   - Assign the `zod-to-json-schema ^3.25.1` remediation explicitly: add it to `packages/tools/package.json` for moved `activate-skill.ts`, and ensure `packages/core/package.json` declares it while core still uses it.

## Highest-Risk Execution Areas

1. **P11 migration groups and adapter availability.**
   Tools must be constructible and testable per group, not merely typecheckable.

2. **Config replacement exhaustiveness.**
   P09/P11 scans can go stale. Implementers must rerun scans before moving each group.

3. **Provider import and `vi.mock()` rewrites.**
   String-literal mocks are easy to miss and may fail only at runtime.

4. **Release order reconciliation.**
   Release order must stay consistent across root workspace order, `release.yml`, release tests, version scripts, sandbox workflow/script, Dockerfile, and bind-release-deps behavior.

5. **Cleanup allowlists.**
   Non-TS artifacts can remain after source files move unless all-file scans are required.

## Convergence Recommendation

Do not run another broad review/revision loop. The max loop limit has been reached, and another loop is likely to re-raise previously addressed points or introduce new inconsistency across the large planning set.

A focused manual edit pass across the files listed above is more likely to converge than another automated revision pass.

## Prioritized Checklist

1. **P1:** Fix P11 group sequencing and adapter availability.
2. **P1:** Add P11 group-scoped test execution rule.
3. **P1:** Split P11 MCP/LSP gates.
4. **P2:** Replace invalid P13 ripgrep lookaround checks.
5. **P2:** Add all-file cleanup verification in P15/P15a/P16.
6. **P2:** Assign `zod-to-json-schema` dependency remediation to explicit phases.
7. **P3:** Convert trusted publishing placeholders into a blocking manual gate.
8. **P3:** Fix `manual-trusted-publishing.md` artifact path in the overview.
