# Implementation Checklist for Issue #1575

Quick reference for executing the decomposition plan. Check off each item as completed.

## Phase 0: Baseline Capture

- [ ] Capture export snapshot: `grep "^export " packages/cli/src/runtime/runtimeSettings.ts | sort > /tmp/exports-before.txt`
- [ ] Run coverage baseline: `npm run test -- --coverage` and record summary for runtimeSettings.ts
- [ ] Verify full green: `npm run test && npm run lint && npm run typecheck && npm run build`
- [ ] Commit baseline captures to plan directory

## Phase 1: Leaf Modules

### Step 1.1: statelessHardening.ts
- [ ] Write `statelessHardening.spec.ts` with characterization tests (RED)
  - [ ] Preference normalization tests
  - [ ] Override behavior tests
  - [ ] Default behavior tests
  - [ ] Metadata precedence tests
- [ ] Create `statelessHardening.ts` with moved code (GREEN)
- [ ] Update coordinator with re-exports
- [ ] Export parity check
- [ ] Full verification cycle

### Step 1.2: runtimeRegistry.ts
- [ ] Write `runtimeRegistry.spec.ts` with characterization tests (RED)
  - [ ] Baseline state tests
  - [ ] Entry creation/update tests
  - [ ] Missing entry error tests
  - [ ] Disposal tests
- [ ] Create `runtimeRegistry.ts` with moved code (GREEN)
- [ ] Update coordinator with re-exports (only `resetCliRuntimeRegistryForTesting`)
- [ ] Update `statelessHardening.ts` imports
- [ ] Export parity check
- [ ] Full verification cycle

## Phase 2: Middle-Layer Modules

### Step 2.1: runtimeAccessors.ts
- [ ] Write `runtimeAccessors.spec.ts` with characterization tests (RED)
  - [ ] Missing runtime error tests
  - [ ] Successful retrieval tests
  - [ ] Provider name resolution tests
  - [ ] Ephemeral settings round-trip tests
  - [ ] Model params round-trip tests
  - [ ] Provider status tests
- [ ] Create `runtimeAccessors.ts` with moved code (GREEN)
- [ ] Update coordinator with re-exports
- [ ] Export parity check
- [ ] Full verification cycle

### Step 2.2: runtimeLifecycle.ts
- [ ] Write `runtimeLifecycle.spec.ts` with characterization tests (RED)
  - [ ] Runtime context registration tests
  - [ ] Provider infrastructure lifecycle tests
  - [ ] Isolated runtime activation tests
- [ ] Create `runtimeLifecycle.ts` with moved code (GREEN)
- [ ] **NO DECOMPOSITION** needed for `setCliRuntimeContext` (34 lines)
- [ ] Update coordinator with re-exports
- [ ] Export parity check
- [ ] Full verification cycle

## Phase 3: Top-Layer Modules

### Step 3.1: providerMutations.ts
- [ ] Write `providerMutations.spec.ts` with characterization tests (RED)
  - [ ] Model defaults computation tests
  - [ ] Base URL normalization tests
  - [ ] API key update tests
  - [ ] Base URL update tests
  - [ ] Model change tests
- [ ] Create `providerMutations.ts` with moved code (GREEN)
- [ ] Decompose `setActiveModel` (85 lines -> extract `recomputeAndApplyModelDefaultsDiff`)
- [ ] Update coordinator with re-exports
- [ ] Export parity check
- [ ] Full verification cycle

### Step 3.2: providerSwitch.ts
- [ ] Write `providerSwitch.spec.ts` with characterization tests (RED)
  - [ ] Same provider short-circuit tests
  - [ ] Empty provider name error tests
  - [ ] Preserved ephemerals tests
  - [ ] Provider switch state clearing tests
  - [ ] Provider switch settings application tests
  - [ ] OAuth handling tests
  - [ ] Alias ephemeral settings tests
  - [ ] Model defaults tests
- [ ] Create `providerSwitch.ts` with moved code (GREEN)
- [ ] Decompose `switchActiveProvider` (482 lines -> extract 6-7 helpers):
  - [ ] `clearPreviousProviderState`
  - [ ] `activateNewProvider`
  - [ ] `resolveAndApplyBaseUrl`
  - [ ] `resolveAndApplyModel`
  - [ ] `handleAnthropicOAuth`
  - [ ] `applyAliasEphemerals`
  - [ ] `applyModelDefaultsForProvider`
- [ ] Verify coordinator function is <80 lines
- [ ] Update coordinator with re-exports
- [ ] Export parity check
- [ ] Full verification cycle

### Step 3.3: settingsResolver.ts
- [ ] Write `settingsResolver.spec.ts` with characterization tests (RED)
  - [ ] Named key resolution success tests
  - [ ] Named key not found error tests
  - [ ] Keyring access failure error tests
  - [ ] Precedence chain tests (--key, --key-name, profile auth-key-name, --keyfile)
  - [ ] --set arguments tests
  - [ ] --baseurl argument tests
- [ ] Create `settingsResolver.ts` with moved code (GREEN)
- [ ] Decompose `applyCliArgumentOverrides` (105 lines -> extract `resolveAndApplyApiKey`)
- [ ] Update coordinator with re-exports
- [ ] Export parity check
- [ ] Full verification cycle

### Step 3.4: profileSnapshot.ts
- [ ] Write `profileSnapshot.spec.ts` with characterization tests (RED)
  - [ ] PROFILE_EPHEMERAL_KEYS coverage tests
  - [ ] Profile snapshot building tests
  - [ ] Profile snapshot application tests
  - [ ] Diagnostics snapshot tests
- [ ] Create `profileSnapshot.ts` with moved code (GREEN)
- [ ] **NO DECOMPOSITION** needed for `buildRuntimeProfileSnapshot` (79 lines)
- [ ] Decompose `applyProfileSnapshot` (193 lines -> extract 3 helpers):
  - [ ] `applyStandardProfileSettings`
  - [ ] `wireProactiveOAuthFailover`
  - [ ] `buildProfileLoadResult`
- [ ] Update coordinator with re-exports
- [ ] Export parity check
- [ ] Full verification cycle

## Phase 4: Final Audit & Cleanup

### Step 4.1: Slim the Coordinator
- [ ] Verify coordinator contains only:
  - [ ] License header
  - [ ] Imports from new modules
  - [ ] Re-exports of public symbols
  - [ ] Existing re-exports (runtimeContextFactory, profileApplication, credential-store-factory)
  - [ ] logger instance (if still needed)
  - [ ] **Top-level `registerIsolatedRuntimeBindings` call (MUST REMAIN)**
- [ ] Target: ~150 lines total
- [ ] Export parity check (final)

### Step 4.2: Function Size Audit
- [ ] Use ESLint with `max-lines-per-function: 80` to verify all functions
- [ ] Manually check any flagged functions
- [ ] Expected passes: All functions in all modules <80 lines

### Step 4.3: File Size Audit
- [ ] Run `wc -l` on all new modules
- [ ] Verify all modules <800 lines
- [ ] Expected: All modules pass

### Step 4.4: Circular Dependency Check
- [ ] Verify no new module imports from runtimeSettings.ts
- [ ] Run: `grep -l "from.*runtimeSettings" packages/cli/src/runtime/{statelessHardening,runtimeRegistry,runtimeAccessors,runtimeLifecycle,providerSwitch,providerMutations,settingsResolver,profileSnapshot}.ts`
- [ ] Expected output: (none)

### Step 4.5: Full Verification Suite
- [ ] `npm run test` (all pass)
- [ ] `npm run lint` (all pass)
- [ ] `npm run typecheck` (all pass)
- [ ] `npm run format` (all clean)
- [ ] `npm run build` (success)
- [ ] Smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

### Step 4.6: Coverage Verification
- [ ] Run `npm run test -- --coverage`
- [ ] Compare against Phase 0 baseline
- [ ] Coverage should not decrease
- [ ] If gaps appear, add focused behavioral tests

## Final Sign-Off

- [ ] All modules <800 lines
- [ ] All functions <80 lines
- [ ] No circular dependencies among new modules
- [ ] All tests pass
- [ ] Coverage maintained or improved
- [ ] Export parity verified (coordinator API unchanged)
- [ ] Smoke test passes
- [ ] README/documentation updated (if applicable)
- [ ] Create PR with "Fixes #1575" in description
- [ ] Watch CI checks (`gh pr checks NUM --watch --interval 300`)
- [ ] Address all CodeRabbit comments
- [ ] Wait for all workflows to pass before merge

## Notes

- Remember: Test-first is mandatory per RULES.md. RED -> GREEN -> Refactor.
- Use `afterEach` to reset state in all tests (stateless hardening override, runtime registry)
- The circular dependency with `profileApplication.ts` is safe but fragile. Consider creating a follow-up issue to break the cycle.
- If any unexpected issues arise, pause and consult the plan or create a new issue for scope changes.
