# PLAN-20251028-STATELESS6 Test Strategy (P04)

> @plan PLAN-20251028-STATELESS6.P04

## Unit Level

- **P06 Scaffold Coverage**
  - `createGeminiRuntimeView` returns immutable structure.
  - Ephemeral getters return values from supplied settings snapshot.
  - Telemetry adapter forwards events without Config reference.
- **P07 SubAgentScope Behaviour**
  - Throw if legacy `setModel` is invoked (regression guard).
  - Verify SubAgentScope constructs runtime view using subagent settings snapshot (no Config mutation).
  - Concrete behavioural test:
    ```typescript
    it('should not mutate foreground config when creating subagent @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.1', async () => {
      const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
      const spy = vi.spyOn(foregroundConfig, 'setModel');
      await SubAgentScope.create('sub', subagentProfile, foregroundConfig);
      expect(spy).not.toHaveBeenCalled();
      expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
    });
    ```
  - Additional regression test guarding history isolation:
    ```typescript
    it('should allocate isolated history services @plan PLAN-20251028-STATELESS6.P07 @requirement REQ-STAT6-003.2', async () => {
      const scopeA = await SubAgentScope.create('a', profileA, config);
      const scopeB = await SubAgentScope.create('b', profileB, config);
      expect(scopeA['runtimeView'].history).not.toBe(scopeB['runtimeView'].history);
    });
    ```
- **P08 GeminiChat Runtime Checks**
  - Compression thresholds resolved via `view.ephemerals`.
  - Provider switching uses `view.provider` adapter only.
  - Telemetry logging hits `view.telemetry` (capture spy).
  - Tool diagnostics read from `view.tools`.
  - Content generator bridge uses runtime view metadata (no Config references in GeminiChat).

## Integration Level

- **P09 Dual Runtime Scenario**
  - Foreground view constructed via Config adapter; subagent view via manual snapshot.
  - Execute sequences ensuring histories remain independent.
  - Validate telemetry logs tagged with respective runtime IDs.
  - Confirm provider/model selections differ without cross-contamination.
  - Assert ProviderManager mutations on subagent view throw and do not affect foreground.
  - Behavioural contract example:
    ```typescript
    it('should keep foreground model unchanged @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.1', async () => {
      const foregroundConfig = createMockConfig({ model: 'gemini-2.0-flash-exp' });
      const subagentProfile = createSubagentProfile({ model: 'gemini-2.0-flash-thinking-exp' });
      const foregroundView = createRuntimeViewFromConfig(foregroundConfig);
      const subagentView = createGeminiRuntimeView({ state: subagentState, settings: subagentSettings });
      await new GeminiChat(foregroundView, fgGenerator).sendMessage({ message: 'hello' }, 'prompt-fg');
      await new GeminiChat(subagentView, subGenerator).sendMessage({ message: 'review' }, 'prompt-sub');
      expect(foregroundConfig.getModel()).toBe('gemini-2.0-flash-exp');
      expect(subagentView.state.model).toBe('gemini-2.0-flash-thinking-exp');
    });
    ```
  - Integration telemetry sample:
    ```typescript
    it('should tag telemetry with runtime ids @plan PLAN-20251028-STATELESS6.P09 @requirement REQ-STAT6-003.3', async () => {
      const logs: ApiEvent[] = [];
      const telemetryTarget = { logApiRequest: (e) => logs.push(e), logApiResponse: (e) => logs.push(e), logApiError: () => undefined };
      const subagentView = createGeminiRuntimeView({ state: subagentState, settings: subagentSettings, telemetryTarget });
      await new GeminiChat(subagentView, contentGenerator).sendMessage({ message: 'hello' }, 'prompt');
      expect(logs).not.toHaveLength(0);
      expect(logs.every((event) => event.metadata?.sessionId === subagentState.sessionId)).toBe(true);
    });
    ```

## Concrete Test Cases

- `GeminiRuntimeView` should freeze returned object (Object.isFrozen === true).
- `GeminiRuntimeView` provider adapter should throw when `setActiveProvider` is called on read-only views.
- `GeminiRuntimeView` telemetry adapter should enrich events with provider/model/session metadata (spy assertion).
- Property: generated compression thresholds respected by `view.ephemerals` (fast-check).
- Property: generated sessionId values appear in telemetry logs (fast-check).
- `SubAgentScope.create` should NOT call `config.setModel` or any `set*` mutator (spy-based assertion).
- `SubAgentScope.create` should return scope whose runtime view history is independent per invocation (different references).
- `GeminiChat` should log telemetry via injected adapter (spy collects events containing runtime state metadata).
- `GeminiChat` should compute compression thresholds via `view.ephemerals`, respecting defaults when values undefined.
- Integration: run foreground + subagent chats sequentially, assert final `config.getModel()` equals original foreground model.
- Integration: telemetry log arrays should contain separate runtimeId values for foreground vs subagent sessions.
- Integration: provider adapter throws when subagent attempts to change foreground provider.

## Mutation / Regression Detection

- Spy on Config mutator methods (`setModel`, `setContentGeneratorConfig`, etc.) to ensure zero calls in new pathways.
- Freeze `contentConfig` objects used in tests to guarantee runtime view does not mutate shared config.
- Use `Object.isFrozen` and `Object.getOwnPropertyDescriptor` checks to ensure runtime view is immutable.

## Verification Practices

- All tests tag requirements and plan markers (`@plan`, `@requirement`).
- Mutation/property targets evaluated during final verification (P10a) per PLAN rules.

> Finalize details during Phase P04 execution.
- **Behavioural Contract Template**
  ```typescript
  it('should build immutable runtime view @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-001.3', async () => {
    // GIVEN runtime state + settings snapshot
    // WHEN createGeminiRuntimeView is invoked
    // THEN Object.isFrozen(result) === true AND result.state === state (same reference)
  });
  ```

- **Property-Based Tests (≥30%)**
  - Use `@fast-check` to generate random compression thresholds / context limits and ensure runtime view honours overrides.
- Property: `state.provider` + generated provider name ensures provider adapter resolves correctly.
- Property: telemetry enrichment always injects provider/model/session metadata.
  ```typescript
  it('should round-trip compression thresholds (property) @plan PLAN-20251028-STATELESS6.P06 @requirement REQ-STAT6-002.2', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.0, max: 1.0 }), (threshold) => {
        const view = createGeminiRuntimeView({ state, settings: { compressionThreshold: threshold } });
        return view.ephemerals.compressionThreshold() === threshold;
      })
    );
  });
  ```

- **Mutation Targets (≥80%)**
  - Kill mutations where `setActiveProvider` becomes noop (should throw in read-only view).
  - Kill mutations altering default ephemerals; tests must fail if defaults change silently.
  - Kill mutations removing telemetry enrichment metadata.

## Mutation Targets & Anti-Fraud Checks

- Execute `npm run test:mutate -- --files packages/core/src/core/geminiChat.ts --mutate ProviderManagerAdapter` targeting provider/telemetry code paths.
- Kill mutants that remove call to telemetry enrichment helper or change default thresholds.
- Add runtime view immutability guard (Object.freeze) to kill mutants removing freeze.
- CLI to capture mutation results recorded in P10a verification.
