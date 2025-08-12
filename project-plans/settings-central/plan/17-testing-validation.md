# Phase 17: Testing and Validation

## Goal
Comprehensive testing of the integrated settings system.

## Context
Need to ensure the centralized system works correctly and doesn't break existing functionality.

## Test Categories

### 1. Integration Tests

```typescript
describe('Settings Integration', () => {
  it('should reflect profile load in diagnostics', async () => {
    // Load profile
    await profileManager.load('testprofile');
    
    // Get diagnostics
    const diag = await diagnosticsCommand.execute();
    
    // Verify all settings match profile
    expect(diag).toContain('Active Provider: openai');
    expect(diag).toContain('Current Model: gpt-4');
    expect(diag).toContain('Current Profile: testprofile');
  });
  
  it('should handle provider switch correctly', async () => {
    // Switch provider
    await providerCommand.execute('anthropic');
    
    // Verify cascade
    const settings = settingsService.getAll();
    expect(settings.provider).toBe('anthropic');
    expect(settings.model).toBe('claude-3-opus'); // default
    expect(settings.ephemeral['auth-key']).toBeUndefined(); // cleared
  });
});
```

### 2. Scenario Tests

**Profile → Provider → Model Flow**
1. Load profile with OpenAI/GPT-4
2. Switch to Anthropic
3. Change model to Claude-Opus
4. Save as new profile
5. Reload original profile
6. Verify state restored

**Multi-Command Sequence**
1. Set ephemeral settings
2. Change model parameters
3. Switch provider
4. Load profile
5. Verify final state

### 3. Backward Compatibility Tests

```typescript
describe('Backward Compatibility', () => {
  it('should support old Config API', () => {
    // Old way should still work
    config.setEphemeralSetting('max-tokens', 1000);
    expect(config.getEphemeralSetting('max-tokens')).toBe(1000);
    
    // Should be reflected in SettingsService
    expect(settingsService.getEphemeralSetting('max-tokens')).toBe(1000);
  });
  
  it('should read old profile format', () => {
    // Old profile without version field
    const oldProfile = { provider: 'openai', model: 'gpt-4' };
    settingsService.importFromProfile(oldProfile);
    expect(settingsService.getProvider()).toBe('openai');
  });
});
```

### 4. Performance Tests

```typescript
describe('Performance', () => {
  it('should handle rapid changes', async () => {
    const start = Date.now();
    
    for (let i = 0; i < 1000; i++) {
      settingsService.setEphemeralSetting(`key${i}`, i);
    }
    
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100); // Under 100ms
  });
  
  it('should not leak memory', () => {
    // Monitor memory during operations
    const before = process.memoryUsage().heapUsed;
    
    // Many operations
    for (let i = 0; i < 10000; i++) {
      settingsService.setModel('gpt-4');
      settingsService.setModel('claude');
    }
    
    global.gc(); // Force garbage collection
    const after = process.memoryUsage().heapUsed;
    
    expect(after - before).toBeLessThan(1024 * 1024); // Less than 1MB growth
  });
});
```

### 5. Edge Case Tests

- Concurrent access
- Invalid settings
- Missing profiles
- Corrupted data
- Network failures
- File system errors

## Test Matrix

| Component | Unit | Integration | E2E | Performance |
|-----------|------|-------------|-----|-------------|
| SettingsService | ✓ | ✓ | ✓ | ✓ |
| Config Integration | ✓ | ✓ | ✓ | - |
| Provider Integration | ✓ | ✓ | ✓ | - |
| Profile System | ✓ | ✓ | ✓ | ✓ |
| Commands | ✓ | ✓ | ✓ | - |
| Event System | ✓ | ✓ | - | ✓ |

## Success Criteria

- All tests pass
- No regressions
- Performance acceptable
- Memory usage stable
- Edge cases handled