# Phase 6: Config Integration Stub

## Worker Prompt

```bash
Create stub for Config class integration with remediated SettingsService based on:
- specification.md requirements [REQ-002]
- analysis/pseudocode/settings-service-remediation.md lines 79-103

UPDATE packages/core/src/config/config.ts

Requirements:
1. Remove private ephemeralSettings property
2. Keep getEphemeralSetting() returning undefined
3. Keep setEphemeralSetting() doing nothing
4. Remove ALL async methods related to settings:
   - setEphemeralInSettingsService
   - queueSettingsUpdate
   - loadEphemeralSettingsFromService
5. Import getSettingsService but don't use yet
6. All methods stay synchronous

FORBIDDEN:
- Keeping local ephemeralSettings storage
- Any async operations
- throw new Error('NotYetImplemented')

The stub must compile but delegate nothing yet.
```

## Expected Changes

```typescript
export class Config {
  // REMOVE: private ephemeralSettings: Record<string, unknown> = {};
  
  getEphemeralSetting(key: string): unknown {
    return undefined; // Stub
  }
  
  setEphemeralSetting(key: string, value: unknown): void {
    // Does nothing in stub
  }
  
  // REMOVE these methods entirely:
  // - private async setEphemeralInSettingsService()
  // - private async queueSettingsUpdate()
  // - private async loadEphemeralSettingsFromService()
}
```

## Verification

- Config compiles without ephemeralSettings
- No async methods remain
- Synchronous stubs in place