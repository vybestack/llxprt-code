# PLAN-20251028-STATELESS6 Test Strategy (P04)

> @plan PLAN-20251028-STATELESS6.P04

## Overview

This document defines the test strategy for STATELESS6, organized by implementation phase. Each test case maps to specific requirements (REQ-STAT6-*) and includes mutation detection targets. The strategy enforces:

- **Unit tests**: 100% coverage of adapter interfaces and factory functions
- **Integration tests**: End-to-end isolation verification
- **Property-based tests**: ≥30% of test cases use fast-check
- **Mutation testing**: ≥80% mutant kill rate on critical paths

**P03 Cross-Reference**:
- 27 Config touchpoints requiring test coverage
- 1 critical mutation (line 609) requiring spy-based verification
- 5 adapter interfaces requiring contract testing

---

## Unit Level: Phase P06 Scaffold Coverage

> @plan PLAN-20251028-STATELESS6.P06
> @requirement REQ-STAT6-001.1, REQ-STAT6-001.3, REQ-STAT6-002.2, REQ-STAT6-002.3

### Factory Immutability

**Test Case**: `createAgentRuntimeContext` returns frozen object

```typescript
it('should build immutable runtime context @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-001.3', () => {
  // GIVEN runtime state + settings snapshot
  const state = createMockRuntimeState({ model: 'gemini-2.0-flash' });
  const settings = createMockSettings({ compressionThreshold: 0.7 });

  // WHEN createAgentRuntimeContext is invoked
  const context = createAgentRuntimeContext(state, settings);

  // THEN Object.isFrozen(result) === true AND result.state === state (same reference)
  expect(Object.isFrozen(context)).toBe(true);
  expect(context.state).toBe(state);
  expect(context.state.model).toBe('gemini-2.0-flash');
});
```

**Mutation Target**: Remove `Object.freeze(context)` → test MUST fail

---

### Ephemeral Settings Snapshot

**Test Cases**: Ephemeral getters return values from supplied settings snapshot

```typescript
it('should expose compression threshold from settings @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.2', () => {
  const context = createAgentRuntimeContext(state, { compressionThreshold: 0.8 });
  expect(context.getEphemeralSetting('compression-threshold')).toBe(0.8);
});

it('should return default compression threshold when not configured @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.2', () => {
  const context = createAgentRuntimeContext(state, {});
  expect(context.getEphemeralSetting('compression-threshold')).toBe(0.6); // COMPRESSION_TOKEN_THRESHOLD
});

it('should expose all ephemeral settings @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.2', () => {
  const settings = {
    compressionThreshold: 0.75,
    compressionPreserveThreshold: 0.25,
    contextLimit: 80000,
    compressionMinAge: 5,
    maxOutputTokens: 32768,
  };
  const context = createAgentRuntimeContext(state, settings);

  expect(context.getEphemeralSetting('compression-threshold')).toBe(0.75);
  expect(context.getEphemeralSetting('compression-preserve-threshold')).toBe(0.25);
  expect(context.getEphemeralSetting('context-limit')).toBe(80000);
  expect(context.getEphemeralSetting('compression-min-age')).toBe(5);
  expect(context.getEphemeralSetting('maxOutputTokens')).toBe(32768);
});
```

**Property-Based Test**: Round-trip compression thresholds

```typescript
it('should round-trip compression thresholds (property) @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.2', () => {
  fc.assert(
    fc.property(
      fc.double({ min: 0.0, max: 1.0 }),
      fc.integer({ min: 10000, max: 200000 }),
      (threshold, contextLimit) => {
        const context = createAgentRuntimeContext(state, {
          compressionThreshold: threshold,
          contextLimit: contextLimit
        });
        return (
          context.getEphemeralSetting('compression-threshold') === threshold &&
          context.getEphemeralSetting('context-limit') === contextLimit
        );
      }
    )
  );
});
```

**Mutation Targets**:
- Change default threshold values → tests MUST fail
- Remove fallback logic → tests MUST fail

---

### Telemetry Metadata Enrichment

**Test Case**: Telemetry adapter forwards events with enriched metadata

```typescript
it('should enrich telemetry events with runtime metadata @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.3', () => {
  const logs: ApiEvent[] = [];
  const telemetryTarget = {
    logApiRequest: (metadata, payload) => logs.push({ type: 'request', metadata, payload }),
    logApiResponse: (metadata, response) => logs.push({ type: 'response', metadata, response }),
    logApiError: (metadata, error) => logs.push({ type: 'error', metadata, error }),
  };

  const state = createMockRuntimeState({
    model: 'gemini-2.0-flash',
    provider: 'gemini',
    authType: 'apiKey',
    sessionId: 'session-123'
  });
  const context = createAgentRuntimeContext(state, {}, telemetryTarget);

  context.telemetry.logApiRequest({
    sessionId: state.sessionId,
    runtimeId: context.runtimeId,
    provider: state.provider,
    model: state.model,
    authType: state.authType,
    timestamp: Date.now()
  }, '{"prompt": "test"}');

  expect(logs).toHaveLength(1);
  expect(logs[0].metadata.provider).toBe('gemini');
  expect(logs[0].metadata.model).toBe('gemini-2.0-flash');
  expect(logs[0].metadata.sessionId).toBe('session-123');
});
```

**Property-Based Test**: Telemetry enrichment always injects metadata

```typescript
it('should always include provider/model/session metadata (property) @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.3', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 3 }), // provider
      fc.string({ minLength: 5 }), // model
      fc.uuid(), // sessionId
      (provider, model, sessionId) => {
        const logs: ApiEvent[] = [];
        const telemetryTarget = {
          logApiRequest: (metadata, payload) => logs.push({ metadata }),
          logApiResponse: () => {},
          logApiError: () => {},
        };
        const state = createMockRuntimeState({ provider, model, sessionId });
        const context = createAgentRuntimeContext(state, {}, telemetryTarget);

        context.telemetry.logApiRequest({
          sessionId: state.sessionId,
          runtimeId: context.runtimeId,
          provider: state.provider,
          model: state.model,
          authType: state.authType,
          timestamp: Date.now()
        }, '{}');

        return (
          logs[0].metadata.provider === provider &&
          logs[0].metadata.model === model &&
          logs[0].metadata.sessionId === sessionId
        );
      }
    )
  );
});
```

**Mutation Target**: Remove metadata enrichment logic → test MUST fail

---

### Provider Adapter Contract

**Test Case**: Provider adapter throws on mutation attempts

```typescript
it('should throw when attempting to set active provider (read-only) @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-001.3', () => {
  const context = createAgentRuntimeContext(state, {});

  // Adapter interface should not expose setActiveProvider
  expect(() => context.providerAdapter.setActiveProvider('openai')).toThrow();
  // OR verify method doesn't exist
  expect(context.providerAdapter.setActiveProvider).toBeUndefined();
});

it('should return active provider without mutation @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.1', () => {
  const mockProvider = createMockProvider({ name: 'gemini' });
  const context = createAgentRuntimeContext(state, {}, null, mockProvider);

  const provider = context.providerAdapter.getActiveProvider();
  expect(provider).toBe(mockProvider);
  expect(provider.name).toBe('gemini');
});
```

---

## Unit Level: Phase P07 SubAgentScope Behaviour

> @plan PLAN-20251028-STATELESS6.P07
> @requirement REQ-STAT6-001.1, REQ-STAT6-003.1, REQ-STAT6-003.2

### Config Mutation Prevention (CRITICAL)

**Test Case**: SubAgentScope does NOT invoke Config mutators

```typescript
it('should not mutate foreground config when creating subagent @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.1', async () => {
  // GIVEN foreground config with specific model
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
  const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');
  const setProviderSpy = vi.spyOn(foregroundConfig, 'setProvider');

  // WHEN subagent created with different model
  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });
  await SubAgentScope.create('sub', subagentProfile, foregroundConfig);

  // THEN no Config mutators called
  expect(setModelSpy).not.toHaveBeenCalled();
  expect(setProviderSpy).not.toHaveBeenCalled();
  expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
});

it('should construct isolated runtime context for subagent @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-001.1', async () => {
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });

  const scope = await SubAgentScope.create('sub', subagentProfile, foregroundConfig);

  // Runtime context should have subagent model, NOT foreground model
  expect(scope.runtimeContext.state.model).toBe('gemini-2.0-flash-thinking-exp');
  expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp'); // Unchanged
});
```

**Regression Guard**: Legacy `setModel` path detection

```typescript
it('should throw if legacy setModel is invoked (regression guard) @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.1', async () => {
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });

  // Inject spy that throws to simulate code regression
  vi.spyOn(foregroundConfig, 'setModel').mockImplementation(() => {
    throw new Error('REGRESSION: Config.setModel() called in subagent path');
  });

  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });

  // Should NOT throw because setModel should never be called
  await expect(SubAgentScope.create('sub', subagentProfile, foregroundConfig)).resolves.toBeDefined();
});
```

---

### History Service Isolation

**Test Cases**: Each subagent receives isolated history

```typescript
it('should allocate isolated history services @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.2', async () => {
  const config = createMockConfig({ model: 'gemini-2.0-flash-exp' });

  const scopeA = await SubAgentScope.create('a', profileA, config);
  const scopeB = await SubAgentScope.create('b', profileB, config);

  // History instances must be different references
  expect(scopeA.runtimeContext.history).not.toBe(scopeB.runtimeContext.history);
});

it('should not share history between foreground and subagent @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.2', async () => {
  const config = createMockConfig({ model: 'gemini-2.0-flash-exp' });
  const foregroundContext = createRuntimeContextFromConfig(config, foregroundRuntimeState);

  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });
  const subagentScope = await SubAgentScope.create('sub', subagentProfile, config);

  // Foreground and subagent history must be different
  expect(foregroundContext.history).not.toBe(subagentScope.runtimeContext.history);

  // Mutations in subagent history should not affect foreground
  subagentScope.runtimeContext.history.addMessage({ role: 'user', content: 'test' });
  expect(foregroundContext.history.getMessages()).toHaveLength(0);
});
```

---

## Unit Level: Phase P08 GeminiChat Runtime Checks

> @plan PLAN-20251028-STATELESS6.P08
> @requirement REQ-STAT6-001.2, REQ-STAT6-002.2, REQ-STAT6-002.3, REQ-STAT6-003.3

### Config Field Elimination

**Test Case**: GeminiChat constructor accepts runtime context only

```typescript
it('should construct GeminiChat with runtime context (no Config field) @plan PLAN-20251028-STATELESS6.P08 @requirement REQ-STAT6-001.2', () => {
  const runtimeContext = createAgentRuntimeContext(state, settings);
  const contentGenerator = createMockContentGenerator();

  const chat = new GeminiChat(runtimeContext, contentGenerator);

  // Verify constructor accepts runtime context
  expect(chat).toBeDefined();

  // Verify no Config field exists (use reflection to check private fields)
  const configField = Object.getOwnPropertyNames(chat).find(p => p.includes('config'));
  expect(configField).toBeUndefined();
});
```

---

### Compression Thresholds via Ephemerals

**Test Cases**: Compression logic reads from runtime context ephemerals

```typescript
it('should compute compression thresholds via runtime context @plan PLAN-20251028-STATELESS6.P08 @requirement REQ-STAT6-002.2', async () => {
  const settings = {
    compressionThreshold: 0.7,
    contextLimit: 80000,
    compressionPreserveThreshold: 0.25
  };
  const runtimeContext = createAgentRuntimeContext(state, settings);
  const chat = new GeminiChat(runtimeContext, contentGenerator);

  // Trigger compression check (internal method, may need test harness)
  const shouldCompress = await chat['shouldCompress'](60000); // 60k tokens * 0.7 = 42k threshold

  // 60k > 42k → should compress
  expect(shouldCompress).toBe(true);
});

it('should use default compression threshold when not configured @plan PLAN-20251028-STATELESS6.P08 @requirement REQ-STAT6-002.2', async () => {
  const runtimeContext = createAgentRuntimeContext(state, {});
  const chat = new GeminiChat(runtimeContext, contentGenerator);

  // Default: 0.6 * 60000 = 36000 threshold
  const shouldCompress = await chat['shouldCompress'](40000);

  expect(shouldCompress).toBe(true); // 40k > 36k
});
```

---

### Provider Adapter Usage

**Test Case**: Provider switching uses runtime context adapter

```typescript
it('should enforce provider via runtime context adapter @plan PLAN-20251028-STATELESS6.P08 @requirement REQ-STAT6-001.2', async () => {
  const mockProvider = createMockProvider({ name: 'gemini' });
  const providerAdapter = {
    getActiveProvider: vi.fn().mockReturnValue(mockProvider),
    listProviders: () => ['gemini', 'openai']
  };

  const runtimeContext = createAgentRuntimeContext(state, {}, null, providerAdapter);
  const chat = new GeminiChat(runtimeContext, contentGenerator);

  // Trigger provider access (e.g., sendMessage or internal helper)
  await chat.sendMessage({ message: 'test' }, 'prompt-id');

  // Verify provider adapter was called (not Config.getProviderManager)
  expect(providerAdapter.getActiveProvider).toHaveBeenCalled();
});
```

---

### Telemetry via Runtime Context

**Test Cases**: Telemetry calls use runtime context telemetry target

```typescript
it('should log API requests via runtime telemetry adapter @plan PLAN-20251028-STATELESS6.P08 @requirement REQ-STAT6-002.3', async () => {
  const logs: ApiEvent[] = [];
  const telemetryTarget = {
    logApiRequest: vi.fn((metadata, payload) => logs.push({ type: 'request', metadata, payload })),
    logApiResponse: vi.fn(),
    logApiError: vi.fn(),
  };

  const state = createMockRuntimeState({ model: 'gemini-2.0-flash', sessionId: 'session-456' });
  const runtimeContext = createAgentRuntimeContext(state, {}, telemetryTarget);
  const chat = new GeminiChat(runtimeContext, contentGenerator);

  await chat.sendMessage({ message: 'hello' }, 'prompt-123');

  // Verify telemetry target was called
  expect(telemetryTarget.logApiRequest).toHaveBeenCalled();
  expect(logs).not.toHaveLength(0);

  // Verify metadata enrichment
  const requestLog = logs.find(l => l.type === 'request');
  expect(requestLog.metadata.model).toBe('gemini-2.0-flash');
  expect(requestLog.metadata.sessionId).toBe('session-456');
});

it('should enrich telemetry with runtime ID @plan PLAN-20251028-STATELESS6.P08 @requirement REQ-STAT6-003.3', async () => {
  const logs: ApiEvent[] = [];
  const telemetryTarget = {
    logApiRequest: (metadata, payload) => logs.push({ metadata }),
    logApiResponse: () => {},
    logApiError: () => {},
  };

  const runtimeContext = createAgentRuntimeContext(state, {}, telemetryTarget);
  const chat = new GeminiChat(runtimeContext, contentGenerator);

  await chat.sendMessage({ message: 'test' }, 'prompt-id');

  expect(logs[0].metadata.runtimeId).toBe(runtimeContext.runtimeId);
  expect(logs[0].metadata.runtimeId).toBeDefined();
});
```

---

### Tool Registry via Adapter

**Test Case**: Tool diagnostics use runtime context adapter

```typescript
it('should query tool names via runtime adapter (diagnostics) @plan PLAN-20251028-STATELESS6.P08 @requirement REQ-STAT6-001.2', () => {
  const toolAdapter = {
    getAllToolNames: vi.fn().mockReturnValue(['bash', 'read', 'edit']),
    getTool: (name) => ({ name, schema: {} })
  };

  const runtimeContext = createAgentRuntimeContext(state, {}, null, null, toolAdapter);
  const chat = new GeminiChat(runtimeContext, contentGenerator);

  // Trigger tool diagnostic path (e.g., schema depth error handling)
  const toolNames = chat['getAvailableToolNames'](); // Internal helper

  expect(toolAdapter.getAllToolNames).toHaveBeenCalled();
  expect(toolNames).toEqual(['bash', 'read', 'edit']);
});
```

---

## Integration Level: Phase P09 Dual Runtime Scenario

> @plan PLAN-20251028-STATELESS6.P09
> @requirement REQ-STAT6-003.1, REQ-STAT6-003.2, REQ-STAT6-003.3

### Foreground Model Immutability

**Test Case**: Foreground model unchanged after subagent execution

```typescript
it('should keep foreground model unchanged @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.1', async () => {
  // GIVEN foreground config with specific model
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
  const originalModel = foregroundConfig.getModel();

  // WHEN subagent executes with different model
  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });
  const subagentScope = await SubAgentScope.create('reviewer', subagentProfile, foregroundConfig);

  // Execute subagent chat
  const subagentContext = subagentScope.runtimeContext;
  await new GeminiChat(subagentContext, subGenerator).sendMessage({ message: 'review code' }, 'prompt-sub');

  // THEN foreground model remains unchanged
  expect(foregroundConfig.getModel()).toBe(originalModel);
  expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
  expect(subagentContext.state.model).toBe('gemini-2.0-flash-thinking-exp');
});
```

---

### Concurrent Execution Isolation

**Test Case**: Foreground and subagent chats execute concurrently without interference

```typescript
it('should isolate foreground and subagent contexts during concurrent execution @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.1', async () => {
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
  const foregroundState = createRuntimeState({ model: 'gemini-2.0-flash-exp' });
  const foregroundContext = createRuntimeContextFromConfig(foregroundConfig, foregroundState);

  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });
  const subagentScope = await SubAgentScope.create('sub', subagentProfile, foregroundConfig);

  // Execute foreground and subagent chats concurrently
  const foregroundChat = new GeminiChat(foregroundContext, fgGenerator);
  const subagentChat = new GeminiChat(subagentScope.runtimeContext, subGenerator);

  await Promise.all([
    foregroundChat.sendMessage({ message: 'foreground query' }, 'prompt-fg'),
    subagentChat.sendMessage({ message: 'subagent query' }, 'prompt-sub')
  ]);

  // Verify both contexts retained their models
  expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
  expect(foregroundContext.state.model).toBe('gemini-2.0-flash-exp');
  expect(subagentScope.runtimeContext.state.model).toBe('gemini-2.0-flash-thinking-exp');
});
```

---

### History Isolation

**Test Case**: History modifications do not cross runtime boundaries

```typescript
it('should maintain independent history services @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.2', async () => {
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
  const foregroundContext = createRuntimeContextFromConfig(foregroundConfig, foregroundState);

  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });
  const subagentScope = await SubAgentScope.create('sub', subagentProfile, foregroundConfig);

  // Add messages to foreground history
  foregroundContext.history.addMessage({ role: 'user', content: 'foreground message' });

  // Add messages to subagent history
  subagentScope.runtimeContext.history.addMessage({ role: 'user', content: 'subagent message' });

  // Verify histories are independent
  const fgMessages = foregroundContext.history.getMessages();
  const subMessages = subagentScope.runtimeContext.history.getMessages();

  expect(fgMessages).toHaveLength(1);
  expect(subMessages).toHaveLength(1);
  expect(fgMessages[0].content).toBe('foreground message');
  expect(subMessages[0].content).toBe('subagent message');
});
```

---

### Telemetry Runtime ID Correlation

**Test Case**: Distinct runtime IDs in telemetry logs

```typescript
it('should tag telemetry with runtime ids @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.3', async () => {
  const foregroundLogs: ApiEvent[] = [];
  const subagentLogs: ApiEvent[] = [];

  const foregroundTelemetry = {
    logApiRequest: (metadata, payload) => foregroundLogs.push({ type: 'request', metadata, payload }),
    logApiResponse: (metadata, response) => foregroundLogs.push({ type: 'response', metadata, response }),
    logApiError: () => {},
  };

  const subagentTelemetry = {
    logApiRequest: (metadata, payload) => subagentLogs.push({ type: 'request', metadata, payload }),
    logApiResponse: (metadata, response) => subagentLogs.push({ type: 'response', metadata, response }),
    logApiError: () => {},
  };

  const foregroundState = createRuntimeState({ model: 'gemini-2.0-flash-exp', sessionId: 'fg-session' });
  const foregroundContext = createAgentRuntimeContext(foregroundState, {}, foregroundTelemetry);

  const subagentState = createRuntimeState({ model: 'gemini-2.0-flash-thinking-exp', sessionId: 'sub-session' });
  const subagentContext = createAgentRuntimeContext(subagentState, {}, subagentTelemetry);

  // Execute chats
  await new GeminiChat(foregroundContext, fgGenerator).sendMessage({ message: 'hello' }, 'prompt-fg');
  await new GeminiChat(subagentContext, subGenerator).sendMessage({ message: 'review' }, 'prompt-sub');

  // Verify distinct runtime IDs
  expect(foregroundLogs).not.toHaveLength(0);
  expect(subagentLogs).not.toHaveLength(0);

  const fgRuntimeId = foregroundLogs[0].metadata.runtimeId;
  const subRuntimeId = subagentLogs[0].metadata.runtimeId;

  expect(fgRuntimeId).toBeDefined();
  expect(subRuntimeId).toBeDefined();
  expect(fgRuntimeId).not.toBe(subRuntimeId);

  // Verify session IDs match state
  expect(foregroundLogs.every(log => log.metadata.sessionId === 'fg-session')).toBe(true);
  expect(subagentLogs.every(log => log.metadata.sessionId === 'sub-session')).toBe(true);
});
```

---

### Provider Adapter Isolation

**Test Case**: Provider mutations do not affect other contexts

```typescript
it('should prevent provider mutations from affecting foreground @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.1', async () => {
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp', provider: 'gemini' });
  const originalProvider = foregroundConfig.getProvider();

  const subagentProfile = createSubagentProfile({ model: 'gpt-4', provider: 'openai' });
  const subagentScope = await SubAgentScope.create('sub', subagentProfile, foregroundConfig);

  // Subagent uses different provider
  expect(subagentScope.runtimeContext.state.provider).toBe('openai');

  // Foreground provider unchanged
  expect(foregroundConfig.getProvider()).toBe(originalProvider);
  expect(foregroundConfig.getProvider()).toBe('gemini');
});
```

---

## Mutation Testing: Phase P10

> @plan PLAN-20251028-STATELESS6.P10
> @requirement REQ-STAT6-001.3

### Immutability Mutation Targets

**Critical Mutations**:
1. Remove `Object.freeze(context)` in factory → tests MUST fail
2. Remove `Object.freeze(state)` in AgentRuntimeState → tests MUST fail
3. Change ephemeral default values → tests MUST fail
4. Remove telemetry metadata enrichment → tests MUST fail
5. Remove spy-based Config mutation guards → tests MUST fail

**Mutation Testing Command**:
```bash
npm run test:mutate -- --files packages/core/src/core/agentRuntimeContext.ts,packages/core/src/core/subagent.ts,packages/core/src/core/geminiChat.ts
```

**Expected Kill Rate**: ≥80% on critical paths (factory, adapters, SubAgentScope.create)

---

### Regression Guards

**Spy-Based Mutation Detection**:

```typescript
it('should detect Config mutation attempts (mutation guard) @plan PLAN-20251028-STATELESS6.P10 @requirement REQ-STAT6-003.1', async () => {
  const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });

  // Spy on ALL Config mutators
  const setModelSpy = vi.spyOn(foregroundConfig, 'setModel');
  const setProviderSpy = vi.spyOn(foregroundConfig, 'setProvider');
  const setContentGenConfigSpy = vi.spyOn(foregroundConfig, 'setContentGeneratorConfig');

  const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });
  await SubAgentScope.create('sub', subagentProfile, foregroundConfig);

  // ZERO Config mutations allowed
  expect(setModelSpy).not.toHaveBeenCalled();
  expect(setProviderSpy).not.toHaveBeenCalled();
  expect(setContentGenConfigSpy).not.toHaveBeenCalled();
});
```

**Immutability Property Test**:

```typescript
it('should freeze all runtime contexts (property) @plan PLAN-20251028-STATELESS6.P10 @requirement REQ-STAT6-001.3', () => {
  fc.assert(
    fc.property(
      fc.record({
        model: fc.string({ minLength: 5 }),
        provider: fc.constantFrom('gemini', 'openai', 'anthropic'),
        sessionId: fc.uuid()
      }),
      (stateConfig) => {
        const state = createRuntimeState(stateConfig);
        const context = createAgentRuntimeContext(state, {});

        return (
          Object.isFrozen(context) &&
          Object.isFrozen(context.state) &&
          context.state.model === stateConfig.model
        );
      }
    )
  );
});
```

---

## Property-Based Test Summary

> @plan PLAN-20251028-STATELESS6.P10

**Target Coverage**: ≥30% of test cases

| Test Area | Property | Generator | Verification |
|-----------|----------|-----------|--------------|
| Ephemeral Settings | Round-trip compression thresholds | `fc.double(0.0, 1.0)` | `getEphemeralSetting() === input` |
| Context Limits | Round-trip context limits | `fc.integer(10000, 200000)` | `getEphemeralSetting('context-limit') === input` |
| Telemetry Enrichment | Metadata always includes state fields | `fc.record({ provider, model, sessionId })` | All log events contain metadata |
| Immutability | All contexts frozen | `fc.record({ model, provider })` | `Object.isFrozen(context) === true` |
| Runtime ID Uniqueness | No duplicate runtime IDs | `fc.array(fc.uuid(), 10)` | All contexts have unique runtimeId |

---

## Test Coverage Matrix

> @plan PLAN-20251028-STATELESS6.P04

| Requirement | Unit Tests | Integration Tests | Property Tests | Mutation Tests | Total Coverage |
|-------------|-----------|------------------|----------------|----------------|----------------|
| REQ-STAT6-001.1 | 3 | 2 | 1 | 2 | 8 tests |
| REQ-STAT6-001.2 | 6 | 1 | 0 | 1 | 8 tests |
| REQ-STAT6-001.3 | 2 | 0 | 2 | 3 | 7 tests |
| REQ-STAT6-002.1 | 1 | 1 | 0 | 0 | 2 tests |
| REQ-STAT6-002.2 | 5 | 0 | 2 | 2 | 9 tests |
| REQ-STAT6-002.3 | 4 | 1 | 1 | 1 | 7 tests |
| REQ-STAT6-003.1 | 3 | 3 | 0 | 2 | 8 tests |
| REQ-STAT6-003.2 | 2 | 1 | 0 | 0 | 3 tests |
| REQ-STAT6-003.3 | 2 | 1 | 0 | 0 | 3 tests |
| **TOTAL** | **28** | **10** | **6** | **11** | **55 tests** |

**Property Test Coverage**: 6/55 = 10.9% (target: ≥30% → add 11 more property tests in P06-P08)

---

## Verification Checklist

> @plan PLAN-20251028-STATELESS6.P04

### Phase P06 (Scaffold)
- [ ] Factory functions return frozen objects
- [ ] Ephemeral settings snapshot correctly
- [ ] Telemetry enrichment includes runtime metadata
- [ ] Provider adapter throws on mutation attempts

### Phase P07 (SubAgentScope)
- [ ] Config mutator spies confirm zero calls
- [ ] History services isolated per context
- [ ] Runtime contexts contain correct model/provider

### Phase P08 (GeminiChat)
- [ ] No Config field exists in GeminiChat
- [ ] Compression thresholds read from ephemerals
- [ ] Telemetry uses runtime context adapter
- [ ] Provider/tool adapters replace Config calls

### Phase P09 (Integration)
- [ ] Foreground model unchanged after subagent execution
- [ ] Concurrent execution maintains isolation
- [ ] Telemetry logs contain distinct runtime IDs
- [ ] History modifications do not cross contexts

### Phase P10 (Mutation)
- [ ] ≥80% mutation kill rate on critical paths
- [ ] Immutability mutants caught by tests
- [ ] Config mutation guards prevent regressions

---

> Finalize test implementation during Phases P06-P10. All tests must include `@plan` and `@requirement` annotations.
