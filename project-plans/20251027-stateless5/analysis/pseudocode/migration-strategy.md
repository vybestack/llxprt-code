# Migration Strategy Pseudocode

**Phase ID**: `PLAN-20251027-STATELESS5.P02`
**Analysis Date**: 2025-10-28

## Purpose

Define the step-by-step migration strategy for transitioning from Config-centric architecture to AgentRuntimeState-based architecture across all 89 touchpoints, including test migration, backward compatibility patterns, and rollback procedures.

---

## Migration Overview

### Three-Wave Migration Strategy

**@requirement:REQ-STAT5-005.2** - Regression tests confirm runtime isolation

```
Wave 1: Foundation (Phases 03-05)
├─ Create AgentRuntimeState abstraction
├─ Add runtime state to GeminiClient/GeminiChat constructors (optional params)
├─ Tests: 100% existing tests pass without modification
└─ Result: Dual-path operation (Config + Runtime State)

Wave 2: Adoption (Phases 06-08)
├─ Create CLI runtime adapter
├─ Update slash commands to use adapter
├─ Migrate runtimeSettings.ts helpers
└─ Result: Runtime state is authoritative, Config mirrors for UI

Wave 3: Cleanup (Phases 09-12)
├─ Migrate all test fixtures to use runtime state
├─ Remove Config mirroring
├─ Deprecate legacy constructors
└─ Result: Pure runtime state architecture
```

---

## Wave 1: Foundation Layer Migration

### Phase 03-05: Core Abstraction Creation

**@requirement:REQ-STAT5-001.1** - Runtime state construction validates inputs

#### Migration Step M01: Create AgentRuntimeState Module

```pseudocode
1. Create file: packages/core/src/runtime/AgentRuntimeState.ts
2. Implement interface from runtime-state.md (Steps 1-14)
3. Export functions:
4.   - createAgentRuntimeState(params)
5.   - createAgentRuntimeStateFromConfig(config, runtimeId)
6.   - updateRuntimeState(state, updates)
7.   - updateRuntimeStateBatch(state, updates)
8.   - subscribeToAgentRuntimeState(runtimeId, callback)
9.   - getAgentRuntimeStateSnapshot(state)
10.
11. Verification:
12.   pnpm test --workspace packages/core -- AgentRuntimeState.spec.ts
13.   All tests pass (100% coverage on Step 1-14 pseudocode)
```

**Rollback**: Delete `AgentRuntimeState.ts` and associated tests

#### Migration Step M02: Extend GeminiClient Constructor

```pseudocode
1. Update: packages/core/src/core/client.ts
2. Change constructor signature:
3.   constructor(
4.     config: Config,
5.     runtimeState?: AgentRuntimeState,      // NEW: Optional
6.     historyService?: HistoryService        // NEW: Optional
7.   )
8. Add internal logic:
9.   if runtimeState provided:
10.    this.runtimeState ← runtimeState
11.    this.preferRuntimeState ← true
12.  else:
13.    // Legacy path: Create from config
14.    this.runtimeState ← createAgentRuntimeStateFromConfig(config, 'foreground-agent')
15.    this.preferRuntimeState ← false
16.
17. Replace all `config.getModel()` calls with `this.runtimeState.model`
18. Replace all `config.getProvider()` calls with `this.runtimeState.provider`
19. Keep `config.getEphemeralSetting()` calls unchanged (Phase 6 migration)
20.
21. Verification:
22.   pnpm test --workspace packages/core -- client.test.ts
23.   All existing tests pass (no constructor changes in tests)
24.   New tests added for runtime state path
```

**Backward Compatibility**: All existing `new GeminiClient(config)` calls continue to work

**Rollback**: Revert client.ts to previous commit, delete runtime state tests

#### Migration Step M03: Extend GeminiChat Constructor

```pseudocode
1. Update: packages/core/src/core/geminiChat.ts
2. Change constructor signature:
3.   constructor(
4.     runtimeState: AgentRuntimeState,          // NEW: First parameter
5.     config: Config,                           // Existing (for ephemeral settings)
6.     contentGenerator: ContentGenerator,
7.     generationConfig: GenerateContentConfig,
8.     initialHistory: Content[],
9.     historyService: HistoryService,           // NEW: Required (was optional)
10.    providerContext?: ProviderRuntimeContext  // NEW: Optional
11.  )
12.
13. Add internal logic:
14.  this.runtimeState ← runtimeState
15.  this.config ← config
16.  this.historyService ← historyService
17.  if not historyService:
18.    throw new Error('HistoryService must be provided')
19.
20. Replace all `config.getModel()` calls with `this.runtimeState.model`
21. Replace all `config.getProvider()` calls with `this.runtimeState.provider`
22.
23. Verification:
24.   pnpm test --workspace packages/core -- geminiChat.test.ts
25.   Expect test failures (constructor signature changed)
26.   Update tests in M04
```

**Breaking Change**: All GeminiChat test constructors must be updated

**Rollback**: Revert geminiChat.ts, skip M04

---

## Wave 2: Adoption Layer Migration

### Phase 06-08: CLI Integration

**@requirement:REQ-STAT5-002.1** - CLI helpers delegate to runtime state

#### Migration Step M04: Create CLI Runtime Adapter

```pseudocode
1. Create file: packages/cli/src/runtime/agentRuntimeAdapter.ts
2. Implement class from cli-runtime-adapter.md (Steps 1-14)
3. Export:
4.   - class AgentRuntimeAdapter
5.   - function setRuntimeAdapter(adapter)
6.   - function getRuntimeAdapter()
7.
8. Verification:
9.   pnpm test --workspace packages/cli -- agentRuntimeAdapter.spec.ts
10.  All tests pass (adapter API coverage)
```

#### Migration Step M05: Update CLI Bootstrap

```pseudocode
1. Update: packages/cli/src/main.ts (or bootstrap.ts)
2. Change startup sequence:
3.   // Old:
4.   config ← createConfig()
5.   client ← new GeminiClient(config)
6.
7.   // New:
8.   config ← createConfig()
9.   flags ← parseCliFlags()
10.  runtimeStateParams ← resolveRuntimeStateFromFlags(flags, config)
11.  runtimeState ← createAgentRuntimeState({
12.    runtimeId: 'foreground-agent',
13.    ...runtimeStateParams
14.  })
15.  adapter ← new AgentRuntimeAdapter(runtimeState, config)
16.  setRuntimeAdapter(adapter)  // Global registration
17.  historyService ← await HistoryService.create(runtimeState.sessionId, settingsService)
18.  client ← new GeminiClient(config, runtimeState, historyService)
19.
20. Verification:
21.   pnpm build --workspace packages/cli
22.   ./dist/cli --model gemini-2.0-flash "test message"
23.   Verify runtime state used (check logs)
```

**Migration Checkpoint**: CLI creates runtime state before GeminiClient

#### Migration Step M06: Migrate runtimeSettings.ts Helpers

**@requirement:REQ-STAT5-002.1** - Runtime helpers delegate to adapter

```pseudocode
1. Update: packages/cli/src/runtime/runtimeSettings.ts
2. Add global adapter reference:
3.   let globalRuntimeAdapter: AgentRuntimeAdapter | null = null
4.
5. Migrate each helper function (27 touchpoints):
6.   // Old:
7.   function setRuntimeProvider(provider: string): void {
8.     config.setProvider(provider)
9.   }
10.
11.  // New:
12.  function setRuntimeProvider(provider: string): void {
13.    adapter ← getRuntimeAdapter()
14.    adapter.setProvider(provider)
15.  }
16.
17. Repeat for:
18.   - setRuntimeModel, getRuntimeModel
19.   - setRuntimeAuthType, getRuntimeAuthType
20.   - setRuntimeBaseUrl, getRuntimeBaseUrl
21.   - switchRuntimeProvider (atomic operation)
22.
23. Verification:
24.   pnpm test --workspace packages/cli -- runtimeSettings.test.ts
25.   All tests pass (helpers delegate to adapter)
```

**Migration Touchpoints**: 27 functions in runtimeSettings.ts

#### Migration Step M07: Migrate Slash Commands

**@requirement:REQ-STAT5-002.1** - Slash commands use adapter API

```pseudocode
1. Update slash command files (17 touchpoints):
2.   - packages/cli/src/ui/commands/setCommand.ts
3.   - packages/cli/src/ui/commands/providerCommand.ts
4.   - packages/cli/src/ui/commands/modelCommand.ts
5.   - packages/cli/src/ui/commands/keyCommand.ts
6.   - packages/cli/src/ui/commands/keyfileCommand.ts
7.   - packages/cli/src/ui/commands/profileCommand.ts
8.
9. Update CommandContext factory:
10.  function createCommandContext(
11.    config: Config,
12.    adapter: AgentRuntimeAdapter,
13.    ui?: UIContext
14.  ): CommandContext {
15.    return {
16.      services: { config, runtimeAdapter: adapter },
17.      ui
18.    }
19.  }
20.
21. Update each command handler:
22.  // Old:
23.  async function providerCommand(context: CommandContext, provider: string) {
24.    context.services.config.setProvider(provider)
25.  }
26.
27.  // New:
28.  async function providerCommand(context: CommandContext, provider: string) {
29.    adapter ← context.services.runtimeAdapter
30.    adapter.switchProvider(provider)  // Atomic operation
31.  }
32.
33. Verification:
34.   pnpm test --workspace packages/cli -- commands/*.test.ts
35.   Integration test: Start CLI, run /provider anthropic, verify state
```

**Migration Touchpoints**: 17 command handlers

---

## Wave 3: Test Migration & Cleanup

### Phase 09-11: Test Fixture Updates

**@requirement:REQ-STAT5-005.2** - Regression tests confirm runtime isolation

#### Migration Step M08: Create Test Helpers

```pseudocode
1. Create file: packages/core/test/helpers/runtimeStateHelpers.ts
2. Implement test utilities:
3.   function createTestRuntimeState(overrides?: Partial<RuntimeStateParams>): AgentRuntimeState
4.     defaults ← {
5.       runtimeId: 'test-runtime',
6.       provider: 'gemini',
7.       model: 'gemini-2.0-flash-exp',
8.       authType: AuthType.API_KEY,
9.       authPayload: { apiKey: 'test-key' },
10.      sessionId: 'test-session'
11.    }
12.    return createAgentRuntimeState({ ...defaults, ...overrides })
13.
14.  function createTestHistoryService(sessionId: string = 'test-session'): HistoryService
15.    return new HistoryService(sessionId, mockSettingsService)
16.
17.  function createTestGeminiClient(overrides?: Partial<TestClientOptions>): GeminiClient
18.    config ← createTestConfig()
19.    runtimeState ← createTestRuntimeState(overrides?.runtimeState)
20.    historyService ← createTestHistoryService()
21.    return new GeminiClient(config, runtimeState, historyService)
22.
23.  function createTestGeminiChat(overrides?: Partial<TestChatOptions>): GeminiChat
24.    runtimeState ← createTestRuntimeState(overrides?.runtimeState)
25.    config ← createTestConfig()
26.    historyService ← createTestHistoryService()
27.    // ... other dependencies
28.    return new GeminiChat(runtimeState, config, contentGenerator, genConfig, [], historyService)
```

**Benefit**: Single source of truth for test fixtures

#### Migration Step M09: Migrate GeminiChat Tests (47 files)

**@requirement:REQ-STAT5-004.1** - GeminiChat tests use runtime state

```pseudocode
1. For each test file in packages/core/src/core/geminiChat.*.test.ts:
2.   Replace constructor calls:
3.     // Old:
4.     chat ← new GeminiChat(config, contentGen, genConfig, [], undefined)
5.
6.     // New:
7.     chat ← createTestGeminiChat({
8.       runtimeState: { provider: 'gemini', model: 'test-model' }
9.     })
10.
11.  Update assertions:
12.    // Old:
13.    expect(config.getModel()).toBe('gemini-2.0-flash')
14.
15.    // New:
16.    runtimeState ← chat.getRuntimeState()
17.    expect(runtimeState.model).toBe('gemini-2.0-flash')
18.
19. Verification per file:
20.   pnpm test --workspace packages/core -- <test-file>
21.   All tests pass
22.
23. Batch verification:
24.   pnpm test --workspace packages/core -- geminiChat
25.   All 47 test files pass
```

**Migration Touchpoints**: 47 test files

**Estimated Effort**: 2-3 hours (semi-automated with codemod)

#### Migration Step M10: Migrate GeminiClient Tests

```pseudocode
1. For each test file in packages/core/src/core/client.*.test.ts:
2.   Replace constructor calls:
3.     // Old:
4.     client ← new GeminiClient(config)
5.
6.     // New:
7.     client ← createTestGeminiClient({
8.       runtimeState: { provider: 'anthropic', model: 'claude-3-5-sonnet' }
9.     })
10.
11. Verification:
12.   pnpm test --workspace packages/core -- client
13.   All tests pass
```

**Migration Touchpoints**: ~20 test files

#### Migration Step M11: Migrate Integration Tests

```pseudocode
1. Update: integration-tests/*.test.ts
2. Replace Config-only test setup:
3.   // Old:
4.   config ← createConfig()
5.   client ← new GeminiClient(config)
6.
7.   // New:
8.   config ← createConfig()
9.   runtimeState ← createAgentRuntimeState({
10.    runtimeId: 'integration-test',
11.    provider: 'gemini',
12.    model: 'gemini-2.0-flash-exp',
13.    authType: AuthType.API_KEY,
14.    authPayload: { apiKey: process.env.TEST_API_KEY },
15.    sessionId: generateSessionId()
16.  })
17.  historyService ← await HistoryService.create(runtimeState.sessionId, settingsService)
18.  client ← new GeminiClient(config, runtimeState, historyService)
19.
20. Add runtime isolation tests:
21.  test('Multiple runtime states remain isolated', async () => {
22.    state1 ← createAgentRuntimeState({ runtimeId: 'test-1', provider: 'gemini' })
23.    state2 ← createAgentRuntimeState({ runtimeId: 'test-2', provider: 'anthropic' })
24.    updateRuntimeState(state1, { model: 'new-model' })
25.    expect(state2.model).not.toBe('new-model')  // Isolation verified
26.  })
27.
28. Verification:
29.   pnpm test --workspace integration-tests
30.   All tests pass
```

**Migration Touchpoints**: ~15 integration test files

---

## Backward Compatibility Patterns

### Pattern BC-01: Optional Runtime State Constructor

**@requirement:REQ-STAT5-005.2** - Tests pass without modification

```pseudocode
1. Phase 5 Implementation:
2.   constructor(config: Config, runtimeState?: AgentRuntimeState)
3.
4. If runtimeState not provided:
5.   Create from config (legacy path)
6.   this.runtimeState ← createAgentRuntimeStateFromConfig(config, 'foreground-agent')
7.
8. Phase 6 Implementation:
9.   constructor(config: Config, runtimeState: AgentRuntimeState)  // Required
10.
11. Deprecation warning:
12.  if not runtimeState:
13.    console.warn('GeminiClient constructor called without runtime state. This is deprecated.')
```

### Pattern BC-02: Dual-Path Field Access

```pseudocode
1. Phase 5 Implementation:
2.   getModel(): string {
3.     return this.preferRuntimeState ?
4.       this.runtimeState.model :
5.       this.config.getModel()
6.   }
7.
8. Phase 6 Implementation:
9.   getModel(): string {
10.    return this.runtimeState.model
11.  }
```

### Pattern BC-03: Config Mirroring

```pseudocode
1. Phase 5: All runtime state updates mirror to Config
2.   newRuntimeState ← updateRuntimeState(oldState, updates)
3.   config.setProvider(newRuntimeState.provider)
4.   config.setModel(newRuntimeState.model)
5.
6. Phase 6: Remove mirroring
7.   newRuntimeState ← updateRuntimeState(oldState, updates)
8.   // No config updates
```

---

## Rollback Procedures

### Rollback Level 1: Module-Level (Low Risk)

```pseudocode
1. If AgentRuntimeState tests fail:
2.   git revert <commit-hash>  // Revert AgentRuntimeState.ts
3.   pnpm test  // Verify rollback
4.   No impact on existing code (module not used yet)
```

### Rollback Level 2: Constructor-Level (Medium Risk)

```pseudocode
1. If GeminiClient constructor changes break tests:
2.   git revert <commit-hash>  // Revert client.ts changes
3.   git revert <commit-hash>  // Revert geminiChat.ts changes
4.   pnpm test --workspace packages/core
5.   Impact: New tests for runtime state path are lost
6.   Existing tests continue to pass
```

### Rollback Level 3: CLI Integration (High Risk)

```pseudocode
1. If CLI adapter causes runtime failures:
2.   git revert <commit-range>  // Revert adapter + bootstrap + runtimeSettings
3.   pnpm build --workspace packages/cli
4.   pnpm test --workspace packages/cli
5.   Impact: CLI reverts to Config-only architecture
6.   User workflows unchanged (Config still works)
```

### Rollback Level 4: Full Revert (Emergency)

```pseudocode
1. If catastrophic failure (data loss, crashes):
2.   git revert <entire-phase-branch>
3.   pnpm install  // Reinstall dependencies
4.   pnpm build  // Rebuild all packages
5.   pnpm test  // Run full test suite
6.   Impact: All Phase 5 work reverted
7.   User data preserved (history/settings unchanged)
```

---

## Verification Checkpoints

### Checkpoint V01: Foundation Complete

```pseudocode
1. Verify AgentRuntimeState module:
2.   pnpm test --workspace packages/core -- AgentRuntimeState
3.   Expected: 100% pass, 100% coverage on Steps 1-14
4.
5. Verify GeminiClient integration:
6.   pnpm test --workspace packages/core -- client
7.   Expected: All existing tests pass + new runtime state tests pass
8.
9. Verify GeminiChat integration:
10.  pnpm test --workspace packages/core -- geminiChat
11.  Expected: Test failures (constructor signature changed)
12.  Action: Proceed to Wave 2 (test migration)
```

### Checkpoint V02: CLI Integration Complete

```pseudocode
1. Verify CLI adapter:
2.   pnpm test --workspace packages/cli -- agentRuntimeAdapter
3.   Expected: 100% pass
4.
5. Verify runtime helpers:
6.   pnpm test --workspace packages/cli -- runtimeSettings
7.   Expected: All tests pass (delegate to adapter)
8.
9. Verify slash commands:
10.  pnpm test --workspace packages/cli -- commands
11.  Expected: All tests pass (use adapter API)
12.
13. Integration test:
14.  Start CLI: ./dist/cli
15.  Run: /provider anthropic
16.  Run: /model claude-3-5-sonnet
17.  Run: /diagnostics
18.  Expected: Diagnostics show runtime state snapshot
```

### Checkpoint V03: Test Migration Complete

```pseudocode
1. Verify core tests:
2.   pnpm test --workspace packages/core
3.   Expected: 100% pass (all fixtures use runtime state)
4.
5. Verify CLI tests:
6.   pnpm test --workspace packages/cli
7.   Expected: 100% pass
8.
9. Verify integration tests:
10.  pnpm test --workspace integration-tests
11.  Expected: 100% pass + new isolation tests pass
12.
13. Full workspace verification:
14.  pnpm test  // All workspaces
15.  Expected: 100% pass
```

### Checkpoint V04: Production Readiness

```pseudocode
1. Run full verification cycle:
2.   pnpm format:check  // Code formatting
3.   pnpm lint:ci  // Zero warnings
4.   pnpm typecheck  // Type safety
5.   pnpm build  // Build all packages
6.   pnpm test:ci  // All tests
7.   Expected: All checks pass
8.
9. Manual integration testing:
10.  Test provider switching workflow
11.  Test model selection workflow
12.  Test diagnostics display
13.  Test session persistence
14.  Expected: All workflows functional
```

---

## Risk Mitigation Timeline

### Week 1: Foundation (Low Risk)

- Days 1-2: Implement AgentRuntimeState module (M01)
- Days 3-4: Extend GeminiClient constructor (M02)
- Day 5: Extend GeminiChat constructor (M03)
- Risk: Module-level failures (Rollback Level 1)

### Week 2: CLI Integration (Medium Risk)

- Days 1-2: Create CLI runtime adapter (M04)
- Day 3: Update CLI bootstrap (M05)
- Days 4-5: Migrate runtimeSettings.ts (M06)
- Risk: CLI runtime failures (Rollback Level 2-3)

### Week 3: Slash Commands (Medium Risk)

- Days 1-3: Migrate slash commands (M07)
- Days 4-5: Integration testing
- Risk: Command handler failures (Rollback Level 3)

### Week 4: Test Migration (Low Risk)

- Days 1-2: Create test helpers (M08)
- Days 3-4: Migrate GeminiChat tests (M09)
- Day 5: Migrate GeminiClient tests (M10)
- Risk: Test fixture issues (Rollback Level 1)

### Week 5: Integration Tests & Polish (Low Risk)

- Days 1-2: Migrate integration tests (M11)
- Days 3-5: Full verification cycle (V04)
- Risk: Minor issues (no rollback needed)

---

## Success Metrics

**@requirement:REQ-STAT5-005.2** - Regression tests confirm success

1. **Code Coverage**: 95%+ on AgentRuntimeState module
2. **Test Pass Rate**: 100% across all workspaces
3. **Zero Regressions**: All existing workflows functional
4. **Performance**: Runtime state operations <2ms (per specification)
5. **Type Safety**: Zero TypeScript errors
6. **Lint Compliance**: Zero warnings (--max-warnings 0)
7. **Build Success**: All packages build without errors

---

**@plan:PLAN-20251027-STATELESS5.P02**

## Cross-References
- **Runtime State Pseudocode**: Steps 1-14 (runtime-state.md)
- **Gemini Runtime Pseudocode**: Steps 1-13 (gemini-runtime.md)
- **CLI Adapter Pseudocode**: Steps 1-14 (cli-runtime-adapter.md)
- **Risk Register**: All 12 risks (risk-register.md)
- **State Coupling**: All 89 touchpoints (state-coupling.md)
- **Next Phase**: Phase 03 (stub implementation begins)
