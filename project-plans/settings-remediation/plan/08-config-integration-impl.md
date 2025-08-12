# Phase 8: Config Integration Implementation

## Worker Prompt

```bash
Implement Config class delegation to SettingsService to make ALL tests pass.

UPDATE packages/core/src/config/config.ts

MANDATORY: Follow pseudocode EXACTLY from analysis/pseudocode/settings-service-remediation.md:

- Lines 79-81: Setup
  → Get SettingsService instance
  → REMOVE ephemeralSettings property completely
  
- Lines 83-86: getEphemeralSetting
  → Direct delegation to settingsService.get(key)
  → Return value immediately (synchronous)
  
- Lines 88-94: setEphemeralSetting
  → Direct delegation to settingsService.set(key, value)
  → NO local storage update
  → NO async operations
  → NO queue processing
  
- Lines 96-98: clearEphemeralSettings
  → Direct delegation to settingsService.clear()

REMOVE completely (lines 100-102):
- setEphemeralInSettingsService method
- queueSettingsUpdate method  
- loadEphemeralSettingsFromService method
- Any async patterns around ephemeral settings

Requirements:
1. Simple delegation pattern
2. All operations synchronous
3. No local storage
4. All tests must pass
```

## Expected Implementation

```typescript
import { getSettingsService } from '../settings/settingsServiceInstance.js';

export class Config {
  // Line 80: Get service instance
  private settingsService = getSettingsService();
  
  // REMOVED: private ephemeralSettings = {}
  
  getEphemeralSetting(key: string): unknown {
    // Lines 84-85: Direct delegation
    return this.settingsService.get(key);
  }
  
  setEphemeralSetting(key: string, value: unknown): void {
    // Line 90: Direct delegation, no local storage
    this.settingsService.set(key, value);
    // NO async operations
    // NO queue processing
  }
  
  clearEphemeralSettings(): void {
    // Line 97: Direct delegation
    this.settingsService.clear();
  }
  
  // REMOVED: All async helper methods
}
```

## Verification

- All Config tests pass
- No ephemeralSettings property
- All operations synchronous
- Delegation pattern working