# Phase 5: SettingsService Implementation

## Worker Prompt

```bash
Implement the remediated SettingsService to make ALL tests pass.

UPDATE packages/core/src/settings/SettingsService.ts

MANDATORY: Follow pseudocode EXACTLY from analysis/pseudocode/settings-service-remediation.md:

- Lines 01-14: Class setup with in-memory storage
  → Create settings object with providers/global/activeProvider
  → NO repository parameter
  
- Lines 16-23: get() method
  → Direct synchronous access to settings object
  → Handle nested keys with dot notation
  
- Lines 25-38: set() method  
  → Store old value
  → Update in-memory object
  → Emit change event
  → NO file writes
  
- Lines 40-54: Provider-specific methods
  → Direct manipulation of settings.providers
  → Event emission for provider changes
  
- Lines 56-64: clear() method
  → Reset to empty state
  → Emit cleared event

Requirements:
1. Remove ALL file system code
2. Remove ALL async/await
3. Simple in-memory JavaScript object
4. Synchronous operations only
5. Event emission working
6. All tests must pass

REMOVE completely:
- FileSystemSettingsRepository import
- Repository constructor parameter
- persistSettingsToRepository method
- loadSettings method
- Any file operations
```

## Expected Implementation Structure

```typescript
export class SettingsService {
  private settings: EphemeralSettings;
  private eventEmitter: EventEmitter;
  
  constructor() {
    // Line 05-14: Initialize in-memory only
    this.settings = {
      providers: {},
      global: {},
      activeProvider: null
    };
    this.eventEmitter = new EventEmitter();
  }
  
  get(key: string): any {
    // Lines 16-23: Direct access
    if (key.includes('.')) {
      return this.getNestedValue(this.settings, key);
    }
    return this.settings.global[key];
  }
  
  set(key: string, value: any): void {
    // Lines 25-38: Update and emit
    const oldValue = this.get(key);
    
    if (key.includes('.')) {
      this.setNestedValue(this.settings, key, value);
    } else {
      this.settings.global[key] = value;
    }
    
    this.eventEmitter.emit('change', {
      key,
      oldValue,
      newValue: value
    });
  }
}
```

## Verification

- All tests pass
- No file system imports
- No async operations
- Events emit correctly
- Memory-only storage works