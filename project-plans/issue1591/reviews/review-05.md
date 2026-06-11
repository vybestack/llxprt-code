# Plan Review Feedback 05

Required corrections:

- Fix the extraction/deletion sequencing. P05 says “MOVE” core policy files into `packages/policy`, which would delete/break `packages/core` before P09 integration and makes P10d redundant. P05 should copy source into `packages/policy`; only delete old core source after all imports/shims/tests are green in P10d.
- Add a clear backward-compatibility strategy for deep imports to files such as `packages/core/src/policy/types.ts` and `packages/core/src/confirmation-bus/types.ts`. P10d deletes these files, but the overview also claims deep imports continue to resolve. Deleting them breaks deep imports unless replacement shim files are kept.
- Correct impossible/unsafe marker requirements for JSON files. P09 requires `@plan` comments in `package.json`/`tsconfig.json`; JSON cannot contain comments. Specify marker tracking in phase completion docs or nearby TS shims instead.
- Fix RED-test design that relies mainly on import-resolution failures. dev-docs require behavioral tests; import-missing failures are structural, not behavioral. Keep behavioral assertions and ensure RED fails due missing behavior/integration, not just missing files.
- P03’s “tests pass with no tests” is not guaranteed unless `vitest.config.ts` explicitly sets `passWithNoTests: true` or the package has an initial test. Add that exact config or adjust the command/expectation.
- Make the `packages/settings` gap explicit in implementation phases, not only overview/spec: no new `packages/settings`; policy config must use injected interfaces and core orchestration until a settings workspace exists.
- Reconcile CLI migration with specification: spec says “no CLI changes required” but P10b/P10c require CLI direct imports and manifest dependency. Choose one safe approach and update requirements/phases consistently.
- Strengthen confirmation-bus type migration details: specify exact `PolicyFunctionCall`, `PolicyToolCallState`, `ConfirmationOutcome`, and `ConfirmationPayload` shapes from current source so workers do not accidentally lose fields or behavior.
- Ensure final verification is exactly the required full gate: `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"` after remediation, not only package-local checks.
