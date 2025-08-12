# Phase 10: Integration Tests

## Worker Prompt

```bash
Write integration tests that verify the complete remediation works end-to-end.

CREATE packages/core/src/integration-tests/settings-remediation.test.ts

Test the full flow from CLI commands through Config to SettingsService:

1. Test /set command updates SettingsService (not files)
2. Test /model command updates provider settings in memory
3. Test settings are NOT persisted across instances
4. Test events propagate to listeners
5. Test synchronous operations complete immediately

Each test must verify the INTEGRATION works:
/**
 * @requirement REQ-INT-001.1
 * @scenario CLI command updates in-memory settings
 * @given Fresh SettingsService instance
 * @when /set temperature 0.8 executed
 * @then SettingsService has temperature=0.8 in memory
 * @and No file is written
 * @and Operation completes synchronously
 */

Include tests that verify:
- Multiple components work together
- No file system operations occur
- Events flow correctly
- Settings clear on restart
- All operations synchronous
```

## Expected Integration Tests

```typescript
describe('Settings Remediation Integration', () => {
  it('should update settings through Config to SettingsService', () => {
    const config = new Config();
    const settingsService = getSettingsService();
    
    // User action through Config
    config.setEphemeralSetting('model', 'gpt-4');
    
    // Verify it reached SettingsService
    expect(settingsService.get('model')).toBe('gpt-4');
    
    // Verify no file was written
    expect(fs.existsSync('~/.llxprt/centralized-settings.json')).toBe(false);
  });
  
  it('should propagate events from SettingsService to listeners', () => {
    const settingsService = getSettingsService();
    const config = new Config();
    const listener = jest.fn();
    
    settingsService.on('change', listener);
    
    // Update through Config
    config.setEphemeralSetting('temperature', 0.7);
    
    // Verify event propagated
    expect(listener).toHaveBeenCalledWith({
      key: 'temperature',
      oldValue: undefined,
      newValue: 0.7
    });
  });
  
  it('should clear settings on new instance', () => {
    const config1 = new Config();
    config1.setEphemeralSetting('test', 'value');
    
    // Simulate restart
    resetSettingsService();
    
    const config2 = new Config();
    expect(config2.getEphemeralSetting('test')).toBeUndefined();
  });
  
  it('should complete all operations synchronously', () => {
    const config = new Config();
    const startTime = Date.now();
    
    // Many operations
    for (let i = 0; i < 1000; i++) {
      config.setEphemeralSetting(`key${i}`, i);
    }
    
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(10); // Should be instant
  });
});
```

## Verification

- Tests verify multiple components
- No file system mocks needed
- Event propagation tested
- Performance validated
- No async patterns