# Behavioral Regression Test Matrix

Plan ID: PLAN-20260603-ISSUE1584

## Required Refactoring Tests

| Behavior | Existing/New Test Location | Real Code Exercised | Allowed Mock Boundary | Preserved Behavior |
|----------|----------------------------|---------------------|-----------------------|--------------------|
| CLI provider manager creation | Existing CLI provider tests plus new test near `packages/cli/src/providers/providerManagerInstance.*` | CLI factory, concrete `ProviderManager`, concrete provider constructors from providers package | Environment/settings/profile data may be faked; provider classes should be real. | CLI can create the same providers after import migration. |
| Provider switching command | Existing/new test near `packages/cli/src/ui/commands/providerCommand.*` | Provider command, manager structural API, CLI settings flow | UI shell may be harnessed; no fake-only provider manager if real FakeProvider can be used. | Provider command changes active provider as before. |
| History token accounting | Existing HistoryService tests plus new injection test | `HistoryService` and injected tokenizer contract | Tokenizer can be a small deterministic test tokenizer; provider tokenizers tested in providers package. | History token counting remains deterministic and core does not construct provider tokenizers. |
| Tool ID normalization | Existing/new core tool tests and provider conversion tests | Core-owned normalization utility and provider tool conversion paths | None beyond normal test data. | OpenAI-safe tool IDs are normalized identically before/after move. |
| ProviderContentGenerator with FakeProvider | New provider package test and CLI/runtime integration test | `ProviderContentGenerator`, `FakeProvider`, structural content generator contract | No network. FakeProvider is real provider implementation. | Provider-backed content generation still produces expected fake response through existing call path. |
| Provider package public API | New package-boundary test | Actual imports from `@vybestack/llxprt-code-providers` after workspace install/build | None. | Public provider APIs import from providers, not core. |
| No core provider shims | New boundary test/script | Source tree scans and package metadata | None. | Core has no production providers dependency, no provider re-exports, no wrapper files. |
| Smoke startup | Phase 16 command | Built CLI/core/providers packages | Real configured `ollamakimi` profile; external service behavior only where existing smoke requires it. | Startup still answers prompt after extraction. |

## Test Quality Rules

- Tests must fail if the migrated provider implementation is absent.
- Tests must not assert only that files exist or imports resolve.
- Mocking is allowed at HTTP, filesystem, UI harness, and environment boundaries only.
- Existing provider tests may be moved if they remain behavioral and are reviewed for mock theater.
