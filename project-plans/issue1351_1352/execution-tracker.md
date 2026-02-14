# Execution Tracker: KeyringTokenStore & Wire as Default

Plan ID: `PLAN-20260213-KEYRINGTOKENSTORE`
Issues: #1351 (KeyringTokenStore), #1352 (Wire as Default)

## Execution Status

| Phase | ID | Title | Status | Started | Completed | Verified | Semantic? | Notes |
|---|---|---|---|---|---|---|---|---|
| 01 | P01 | Preflight Verification | [ ] | - | - | - | N/A | Verify deps, types, call paths, test infra |
| 01a | P01a | Preflight Results | [ ] | - | - | - | N/A | Record verification results |
| 02 | P02 | Domain Analysis | [ ] | - | - | - | [ ] | Entity relationships, state transitions, business rules |
| 02a | P02a | Analysis Verification | [ ] | - | - | - | [ ] | Verify analysis completeness |
| 03 | P03 | Pseudocode Development | [ ] | - | - | - | [ ] | Numbered lines, contracts, anti-patterns |
| 03a | P03a | Pseudocode Verification | [ ] | - | - | - | [ ] | Verify pseudocode coverage |
| 04 | P04 | KeyringTokenStore Stub | [ ] | - | - | - | [ ] | Compile-only skeleton |
| 04a | P04a | Stub Verification | [ ] | - | - | - | [ ] | Verify compilation, structure |
| 05 | P05 | KeyringTokenStore TDD | [ ] | - | - | - | [ ] | 40+ behavioral tests, 30% property-based |
| 05a | P05a | TDD Verification | [ ] | - | - | - | [ ] | Verify test quality, no anti-patterns |
| 06 | P06 | KeyringTokenStore Impl | [ ] | - | - | - | [ ] | Full implementation referencing pseudocode |
| 06a | P06a | Impl Verification | [ ] | - | - | - | [ ] | All tests pass, pseudocode compliance |
| 07 | P07 | Integration Stub | [ ] | - | - | - | [ ] | Update exports in core + CLI |
| 07a | P07a | Integration Stub Verification | [ ] | - | - | - | [ ] | Verify export chain |
| 08 | P08 | Integration TDD | [ ] | - | - | - | [ ] | End-to-end flow tests, concurrent process tests |
| 08a | P08a | Integration TDD Verification | [ ] | - | - | - | [ ] | Verify integration test quality |
| 09 | P09 | Integration Impl | [ ] | - | - | - | [ ] | Swap all instantiation sites |
| 09a | P09a | Integration Impl Verification | [ ] | - | - | - | [ ] | Zero legacy references, all tests pass |
| 10 | P10 | Eliminate Legacy | [ ] | - | - | - | [ ] | Delete MultiProviderTokenStore |
| 10a | P10a | Elimination Verification | [ ] | - | - | - | [ ] | Verify complete removal |
| 11 | P11 | Final Verification | [ ] | - | - | - | [ ] | Full suite, smoke test, traceability |
| 11a | P11a | Final Verification Review | [ ] | - | - | - | [ ] | Meta-verification, plan completion |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] Zero MultiProviderTokenStore references in codebase
- [ ] Full test suite passes
- [ ] Build succeeds
- [ ] Smoke test passes
- [ ] No phases skipped

## Key Metrics

| Metric | Target | Actual |
|---|---|---|
| Unit tests (Phase 05) | 40+ | - |
| Property-based tests | 30%+ | - |
| Integration tests (Phase 08) | 15+ | - |
| Plan markers in code | 50+ | - |
| Requirement markers in code | 30+ | - |
| Legacy references remaining | 0 | - |
| Test pass rate | 100% | - |

## File Change Summary

### Files Created
- [ ] `packages/core/src/auth/keyring-token-store.ts`
- [ ] `packages/core/src/auth/__tests__/keyring-token-store.test.ts`
- [ ] `packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`

### Files Modified (Production)
- [ ] `packages/core/index.ts` — export swap
- [ ] `packages/core/src/auth/token-store.ts` — class deletion (interface preserved)
- [ ] `packages/cli/src/auth/types.ts` — re-export swap
- [ ] `packages/cli/src/runtime/runtimeContextFactory.ts` — instantiation swap
- [ ] `packages/cli/src/ui/commands/authCommand.ts` — instantiation swap (2 sites)
- [ ] `packages/cli/src/ui/commands/profileCommand.ts` — instantiation swap (2 sites)
- [ ] `packages/cli/src/providers/providerManagerInstance.ts` — instantiation swap
- [ ] `packages/cli/src/providers/oauth-provider-registration.ts` — type update

### Files Modified (Tests)
- [ ] `packages/cli/src/integration-tests/oauth-timing.integration.test.ts`
- [ ] `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts`
- [ ] `packages/cli/src/auth/oauth-manager-initialization.spec.ts`
- [ ] `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts`
- [ ] `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts`
- [ ] `packages/cli/test/auth/gemini-oauth-fallback.test.ts`
- [ ] `packages/cli/test/ui/commands/authCommand-logout.test.ts`
- [ ] `packages/cli/src/ui/commands/__tests__/profileCommand.bucket.spec.ts`

### Files Deleted
- [ ] `packages/core/src/auth/token-store.spec.ts` (or replaced)
- [ ] `packages/core/src/auth/token-store.refresh-race.spec.ts` (or replaced)
- [ ] MultiProviderTokenStore class body (~250 lines from token-store.ts)

## Risk Log

| Risk | Mitigation | Status |
|---|---|---|
| Codex token fields lost by .parse() | Enforced .passthrough() in pseudocode + tests | Pending |
| Raw provider names in logs | SHA-256 hashing enforced in pseudocode + tests | Pending |
| Test files still import old class | Phase 09 updates all test imports | Pending |
| Lock directory missing on first use | ensureLockDir() in pseudocode + tests | Pending |
| Concurrent refresh race | File-based locks tested in Phase 05 + 08 | Pending |
