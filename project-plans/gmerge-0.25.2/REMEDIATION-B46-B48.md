# Remediation Plan: B46/B48 - Subagent Manager Encapsulation

## Problem Statement

Audit found critical architectural concern:
```typescript
(subagentManager as unknown as { _diskSubagentExists(...) })._diskSubagentExists(name)
```

This violates encapsulation by calling a private method through type casting. Plan explicitly said "use manager API, not private probing".

## Files Affected

- `packages/cli/src/ui/commands/subagentCommand.ts`

## Required Remediation

### Option 1: Add Public Method to SubagentManager (Recommended)

Add a public method to `SubagentManager` that subagentCommand can use:

```typescript
// packages/core/src/config/subagentManager.ts
export class SubagentManager {
  // ... existing code ...
  
  /**
   * Check if a subagent exists on disk (for extensions/commands)
   */
  async subagentExistsOnDisk(name: string): Promise<boolean> {
    return this._diskSubagentExists(name);
  }
  
  /**
   * Check if a subagent is from settings vs disk
   */
  isSettingsSubagent(name: string): boolean {
    // Return true if loaded from settings.json
    return this.settingsSubagents.has(name);
  }
}
```

### Option 2: Expose Through Config

```typescript
// packages/core/src/config/config.ts
export interface Config {
  // ... existing ...
  
  /**
   * Check if a subagent exists (disk or settings)
   */
  subagentExists(name: string): Promise<boolean>;
}
```

### Update subagentCommand.ts

Remove the type cast and use the public API:

```typescript
// BEFORE (bad)
const exists = await (subagentManager as unknown as { 
  _diskSubagentExists(name: string): Promise<boolean> 
})._diskSubagentExists(name);

// AFTER (good)
const exists = await subagentManager.subagentExistsOnDisk(name);
```

## Additional Issues in B46/B48

### Mixed Source Logic

The command checks `config.source === 'settings'` in multiple places even for extension subagents. This should be cleaner:

```typescript
// Use the manager's method instead of direct property access
if (subagentManager.isSettingsSubagent(name)) {
  // Handle settings subagent
}
```

## Testing

1. Verify subagentCommand works with public API
2. Test both disk and settings subagents
3. Ensure no type casts remain

## Files to Modify

1. `packages/core/src/config/subagentManager.ts` - Add public methods
2. `packages/core/src/config/types.ts` - Update interface if needed
3. `packages/cli/src/ui/commands/subagentCommand.ts` - Remove type casts

## Copyright

Vybestack LLC, 2026 for new methods
