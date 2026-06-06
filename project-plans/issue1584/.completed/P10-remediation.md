# Phase 10 Remediation

## Reason

P10a verification found that expected-red tests were failing during Vite package resolution instead of reaching their test bodies and emitting explicit `P10 EXPECTED RED` messages.

## Fix

Updated `packages/providers/vitest.config.ts` with a test-time alias mapping `@vybestack/llxprt-code-providers` to the package source entry point `packages/providers/index.ts`. This is test/build configuration only; it does not export provider implementations and does not create a compatibility shim.

## Verification

Targeted P10 provider tests now execute all five P10 test files:

- 57 tests pass.
- 8 tests fail with explicit `P10 EXPECTED RED` messages for missing post-P11 provider package exports.
- No suite fails during import analysis.

Providers typecheck passes. Providers lint exits 0 with warnings only in expected-red tests. Generated artifacts were removed after verification and are ignored by `packages/providers/.gitignore`.

## Scope

- No provider files moved.
- No CLI imports migrated.
- No core provider exports removed.
- No `.llxprt/` files touched.

## Additional Test Correctness Fix

P10a also found that provider-public-api.behavior.test.ts incorrectly asserted TypeScript type-only exports at runtime. The test now splits type-only API documentation from runtime value export checks; P11 must satisfy type-only exports through typecheck/import tests, while runtime checks only assert value exports. import-boundary-expectations.test.ts also now has a direct P10 marker block for the ProviderManager expected-red test.

Updated expected-red result after this fix:

- 58 tests pass.
- 8 tests fail with explicit P10 EXPECTED RED messages for missing post-P11 runtime exports.
- Providers lint exits 0 with warnings only in expected-red conditional tests.

## Tokenizer Runtime Check Fix

P10a found import-boundary-expectations.test.ts still checked type-only ITokenizer at runtime. The expected-red import-boundary test now checks runtime tokenizer classes only: OpenAITokenizer or AnthropicTokenizer. Type-only tokenizer interface validation remains deferred to typecheck/import-type coverage after P11.
