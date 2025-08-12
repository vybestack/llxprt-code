# Phase 3: SettingsService Stub Implementation

## Worker Prompt

```bash
Create a stub implementation of the remediated SettingsService based on:
- specification.md requirements [REQ-001]
- analysis/pseudocode/settings-service-remediation.md lines 01-78

UPDATE packages/core/src/settings/SettingsService.ts

Requirements:
1. Remove ALL file system imports and operations
2. Remove repository parameter from constructor
3. Create empty in-memory settings object
4. All methods return empty values (not errors):
   - get() returns undefined
   - set() returns void (does nothing)
   - getProviderSettings() returns {}
5. Keep EventEmitter for future use
6. Remove ALL async/await keywords
7. Maximum 100 lines total

FORBIDDEN:
- throw new Error('NotYetImplemented')
- Any file system operations
- Any async operations
- Repository patterns
- TODO comments

The stub must compile but do nothing.
```

## Expected Stub Structure

```typescript
export class SettingsService {
  private settings: any = {};
  private eventEmitter = new EventEmitter();
  
  constructor() {
    // NO repository parameter
  }
  
  get(key: string): any {
    return undefined;
  }
  
  set(key: string, value: any): void {
    // Does nothing
  }
  
  // etc...
}
```

## Verification

- Must compile with TypeScript
- No file imports
- No async keywords
- No error throwing