# Phase 4: SettingsService TDD

## Worker Prompt

```bash
Write comprehensive BEHAVIORAL tests for the remediated SettingsService based on:
- specification.md requirements [REQ-001]
- analysis/pseudocode/settings-service-remediation.md
- The in-memory only behavior

UPDATE packages/core/test/settings/SettingsService.spec.ts

MANDATORY RULES:
1. Test ACTUAL BEHAVIOR with real data flows
2. Test synchronous operations complete immediately
3. Test settings are stored in memory
4. Test events are emitted on changes
5. Test no persistence occurs
6. Each test must have clear given/when/then:
   /**
    * @requirement REQ-001.1
    * @scenario Setting a value in memory
    * @given Empty settings service
    * @when set('model', 'gpt-4') is called
    * @then get('model') returns 'gpt-4'
    * @and No file operations occur
    */

FORBIDDEN:
- Testing for NotYetImplemented
- Mocking file systems (there should be none)
- Async test patterns (all sync)
- Testing for persistence

Create 15-20 tests covering:
- Setting and getting values
- Provider-specific settings
- Event emission on changes
- Clearing settings
- No persistence behavior
```

## Expected Test Examples

```typescript
describe('SettingsService (In-Memory)', () => {
  it('should store settings in memory only', () => {
    const service = new SettingsService();
    service.set('model', 'gpt-4');
    expect(service.get('model')).toBe('gpt-4');
  });

  it('should emit events on changes', () => {
    const service = new SettingsService();
    const listener = jest.fn();
    service.on('change', listener);
    
    service.set('temperature', 0.7);
    
    expect(listener).toHaveBeenCalledWith({
      key: 'temperature',
      oldValue: undefined,
      newValue: 0.7
    });
  });

  it('should clear settings on clear()', () => {
    const service = new SettingsService();
    service.set('model', 'gpt-4');
    service.clear();
    expect(service.get('model')).toBeUndefined();
  });
});
```

## Verification

- Tests expect real memory storage behavior
- No async patterns
- No file system mocks
- Events are tested
- Tests fail naturally with stub