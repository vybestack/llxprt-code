# Plan Review Feedback 03

Required corrections:

- Add missing verification phases for P01 and P02. `dev-docs/PLAN.md` requires analysis and pseudocode phases to have independent verification gates (`P01a`, `P02a`) before implementation begins.
- Add required `@plan` / `@requirement` marker requirements and marker verification to every implementation/test phase. The current phase files mostly omit the traceability requirements mandated by `dev-docs/PLAN.md` and `PLAN-TEMPLATE.md`.
- Fix invalid shell commands. Many verification commands use `grep --glob`, which is not valid `grep` syntax on this platform. Replace with `rg --glob ...` or `find ... | xargs grep ...` so the plan is actually executable.
- Correct the public API example in `00-overview.md`: it labels `packages/policy/src/index.ts` but shows `from './src/index.js'`, which would be wrong/recursive for the source barrel. Clearly distinguish:
  - `packages/policy/src/index.ts` exports local modules.
  - `packages/policy/index.ts` re-exports from `./src/index.js`.
- Add a dedicated CLI/consumer migration RED → GREEN → verification cycle. CLI import updates are bundled into P10 without prior RED tests, even though acceptance requires existing imports/consumers to be updated. This should not be buried in cleanup.
- Split P10 into smaller phases. It currently bundles test migration, retained-core test updates, source deletion, CLI import migration, and package dependency updates. That violates the “no bundled implementation phases” requirement and makes failures hard to isolate.
- Remove or replace unsafe/broad recovery guidance. P03 still recommends `rm -rf packages/policy`; use targeted `git checkout -- <specific-file>` / explicit file removal guidance only.
- Fix contradictory RED-test expectations. P04/P06 create stubs “just enough for imports to resolve” but their verification expects import-resolution failures because source does not exist. Specify the intended RED failure mode consistently: either no source files and import failures, or stubs with behavioral assertion failures.
- Add explicit package-boundary verification against `packages/tools` and deep relative tool imports. The issue forbids policy depending on packages/tools; some scans cover package names but not all relative/deep tool paths robustly.
- Add explicit verification that `packages/policy/package.json` does not depend on `packages/core`, `packages/providers`, `packages/tools`, or `packages/cli`, not just source import scans.
- Add explicit circular dependency verification using the actual workspace dependency graph/package manifests, not only grep-based import scans.
- Clarify core backward compatibility strategy for deep imports. The plan alternates between deleting moved core files and maintaining “all existing imports”/“deep imports continue to work.” If deep imports such as `packages/core/src/policy/policy-engine.js` must continue, deleted files need re-export shims; if only barrel imports are supported, state that honestly and align tests.
- Fix final review runtime export checks for TypeScript-only exports. The P11a `node -e` check expects types like `PolicyRule`, `PolicyEngineConfig`, `PolicySettings`, `ConfirmationPayload`, etc. to exist at runtime, but TypeScript types are erased. This verification will fail or give false negatives. Use typecheck/compile-time tests for type exports.
- Add explicit behavioral tests for policy rule loading from files after relocation, including source and built `dist` paths, with expected rule counts/priority values documented.
- Ensure confirmation-bus type design fully removes direct scheduler/tools dependencies by requiring source review of `PolicyToolCallState`, `PolicyFunctionCall`, `ConfirmationOutcome`, and all message types, not just grep checks.
- Add exact worker/verifier prompts or assignments per phase consistent with `dev-docs/COORDINATING.md`; current assignments are summarized by ranges and do not provide one worker + one verifier per phase in the phase documents.
