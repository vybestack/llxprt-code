# Phase 7: Config Integration TDD

## Worker Prompt

```bash
Write behavioral tests for Config class using the remediated SettingsService based on:
- specification.md requirements [REQ-002]
- analysis/pseudocode/settings-service-remediation.md lines 79-103

UPDATE packages/core/src/config/config.test.ts

MANDATORY RULES:
1. Test Config delegates to SettingsService
2. Test no local storage occurs
3. Test synchronous operations
4. Test integration with SettingsService events
5. Each test must verify delegation:
   /**
    * @requirement REQ-002.1
    * @scenario Config delegates ephemeral get
    * @given SettingsService has 'model' = 'gpt-4'
    * @when config.getEphemeralSetting('model') called
    * @then Returns 'gpt-4' from SettingsService
    * @and No local storage accessed
    */

Create tests covering:
- getEphemeralSetting delegates to SettingsService.get
- setEphemeralSetting delegates to SettingsService.set
- No local ephemeralSettings storage
- Synchronous operations complete immediately
- Clear delegates to SettingsService.clear

FORBIDDEN:
- Testing async operations
- Testing local storage
- Testing file persistence
```

## Expected Test Examples

```typescript
describe('Config with SettingsService', () => {
  it('should delegate getEphemeralSetting to SettingsService', () => {
    const config = new Config();
    const settingsService = getSettingsService();
    
    settingsService.set('model', 'gpt-4');
    
    expect(config.getEphemeralSetting('model')).toBe('gpt-4');
  });
  
  it('should delegate setEphemeralSetting to SettingsService', () => {
    const config = new Config();
    const settingsService = getSettingsService();
    
    config.setEphemeralSetting('temperature', 0.8);
    
    expect(settingsService.get('temperature')).toBe(0.8);
  });
  
  it('should not maintain local ephemeral storage', () => {
    const config = new Config();
    
    config.setEphemeralSetting('test', 'value');
    
    // Verify no local storage property exists
    expect((config as any).ephemeralSettings).toBeUndefined();
  });
  
  it('should complete operations synchronously', () => {
    const config = new Config();
    
    // No await needed
    config.setEphemeralSetting('instant', true);
    const result = config.getEphemeralSetting('instant');
    
    expect(result).toBe(true);
  });
});
```

## Verification

- Tests verify delegation pattern
- No async test patterns
- No local storage testing
- Synchronous operations verified