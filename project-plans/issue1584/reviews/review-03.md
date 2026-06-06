# Review Iteration 03

## Verdict

NEEDS CHANGES

## Substantive Issues

1. packages/providers direct dependencies are under-specified. Files: project-plans/issue1584/specification.md, plan/06-package-scaffold-stub.md, plan/08-package-scaffold-impl.md, analysis/dependency-audit.md. Remediation: add an explicit external dependency inventory for moved provider production/test code; require providers package dependencies/devDependencies for direct imports such as openai, @anthropic-ai/sdk, @google/genai, @dqbd/tiktoken, etc.; verify with npm ls and package.json checks.

2. Core deep-import resolution for providers -> core is not specified enough. Files: specification.md, analysis/final-architecture.md, analysis/integration-contract.md, plan/08-package-scaffold-impl.md, plan/11-provider-move-impl.md. Remediation: define whether core package subpaths are supported via package exports or tsconfig/source-to-dist mapping; list every allowed core deep import prefix; verify both TypeScript and built runtime imports.

3. The plan lacks a concrete complete provider file inventory at review time. Files: analysis/provider-file-classification.md, analysis/provider-move-map.md, plan/01-analysis.md, plan/09-provider-move-stub.md, plan/11-provider-move-impl.md. Remediation: create analysis/provider-file-inventory.txt and a complete classification artifact before P03/P09; add a machine-checkable P01a gate proving every file under packages/core/src/providers is covered by an explicit row or deterministic rule plus exception table.

4. Package metadata/workspace setup needs exact dependency-direction instructions. Files: plan/06-package-scaffold-stub.md, plan/08-package-scaffold-impl.md, plan/12-consumer-migration-stub.md, plan/14-consumer-migration-impl.md, analysis/anti-shim-policy.md. Remediation: explicitly require providers depends on core, cli depends on providers and core, core does not depend on providers, core tsconfig does not reference providers, cli/package-lock workspace metadata are updated, and add node checks for these package.json constraints.

5. Core structural contracts are allowed but need naming/location constraints to prevent accidental shims. Files: analysis/final-architecture.md, analysis/anti-shim-policy.md, plan/03-contracts-stub.md, plan/05-contracts-impl.md. Remediation: specify allowed names/locations such as packages/core/src/runtime/contracts/RuntimeProvider.ts, RuntimeProviderManager.ts, RuntimeTokenizer.ts, RuntimeContentGeneratorFactory.ts; forbid new core files named IProvider.ts, IProviderManager.ts, ProviderManager.ts, ProviderContentGenerator.ts unless explicitly approved.

6. Pseudocode is numbered but too high-level for riskiest work. Files: analysis/pseudocode/package-boundary.md, consumer-migration.md, verification.md, plan/05-contracts-impl.md, plan/11-provider-move-impl.md, plan/14-consumer-migration-impl.md. Remediation: add component-specific pseudocode for HistoryService tokenizer injection, content generator boundary, runtime provider contracts, tool ID normalization, and CLI provider wiring with exact files, inputs/outputs, ownership, and forbidden imports.

7. Verification matrix should include package-level lint/format earlier. Files: analysis/phase-verification-matrix.md, plan/16-full-verification.md. Remediation: add npm run lint/typecheck/build/test --workspace checks for providers during scaffold/move phases and CLI during consumer migration, not only at final P16.

## Pedantic Notes

1. Plan markers in moved code may create noisy diffs. The repository plan system asks for them, but for a large move-only refactor they may conflict with the goal of minimizing behavior-changing edits. Prefer markers on new/changed tests and new boundary contracts if acceptable.
2. Many phase files repeat generic semantic checklists. This is acceptable, but phase-specific semantic questions would be more useful.
3. analysis/preflight-results.md is not present yet. That is fine if execution starts at P00a/P01 and creates it, but it must exist before P03+ implementation.
4. Parent issue #1568 is broader than #1584, but this plan correctly scopes to provider extraction and avoids broader auth/tools/settings extraction.

## Accepted Risks

1. Temporary providers -> core deep imports are acceptable for #1584. This is not the ideal final modular architecture, but it avoids expanding scope into auth/settings/tools/config/history extraction while maintaining a cycle-free final state.
2. Core-owned structural contracts are acceptable if they are genuinely runtime contracts and not old provider API shims. They must not import/re-export provider package symbols or preserve old core provider paths.
3. Breaking old provider imports from core is intentional and should be accepted. The issue and parent explicitly require no backward compatibility shims; repository callers must migrate to @vybestack/llxprt-code-providers directly.
4. The plan’s phased approach is larger than a simple folder move, but that is warranted by the current bidirectional dependency graph and the no-shim/no-cycle requirements.
