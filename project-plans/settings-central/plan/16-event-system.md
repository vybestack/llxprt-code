# Phase 16: Event System and Notifications

## Goal
Implement comprehensive change tracking and dependency management for settings.

## Context
Settings changes need to cascade properly and notify all dependent systems.

## Event Types

```typescript
enum SettingsEventType {
  // Provider events
  PROVIDER_CHANGED = 'provider:changed',
  MODEL_CHANGED = 'model:changed',
  API_KEY_CHANGED = 'apiKey:changed',
  
  // Profile events
  PROFILE_LOADED = 'profile:loaded',
  PROFILE_SAVED = 'profile:saved',
  PROFILE_MODIFIED = 'profile:modified',
  
  // Ephemeral settings
  EPHEMERAL_CHANGED = 'ephemeral:changed',
  
  // Model parameters
  MODEL_PARAMS_CHANGED = 'modelParams:changed',
  
  // Validation events
  VALIDATION_FAILED = 'validation:failed',
  VALIDATION_WARNING = 'validation:warning'
}
```

## Dependency Management

```typescript
class SettingsDependencyGraph {
  // When provider changes:
  // - Clear provider-specific ephemeral settings
  // - Update default model
  // - Reset model parameters
  // - Notify UI
  
  // When profile loads:
  // - Update provider
  // - Update model
  // - Apply ephemeral settings
  // - Apply model parameters
  
  // Define cascades
  dependencies = {
    'provider': ['model', 'modelParams', 'apiKey'],
    'profile': ['provider', 'model', 'ephemeralSettings'],
    'model': ['modelParams']
  };
}
```

## Implementation Steps

1. **Enhance Event System**
   - Add granular event types
   - Include before/after values
   - Support event cancellation

2. **Add Change History**
   ```typescript
   interface ChangeRecord {
     timestamp: Date;
     type: SettingsEventType;
     key: string;
     oldValue: any;
     newValue: any;
     source: string; // command, profile, etc
   }
   ```

3. **Implement Validation Pipeline**
   - Pre-change validation
   - Warning for risky changes
   - Rollback on failure

4. **Cascade Updates**
   - Define dependency rules
   - Auto-update dependent settings
   - Prevent circular updates

5. **Notification Batching**
   - Group related changes
   - Reduce event noise
   - Atomic multi-setting updates

## Key Components

```typescript
class SettingsEventManager {
  // Manage subscriptions
  on(event: SettingsEventType, handler: Handler): Unsubscribe;
  
  // Emit with context
  emit(event: SettingsEvent): void;
  
  // Batch operations
  batch(operations: () => void): void;
  
  // History tracking
  getHistory(filter?: HistoryFilter): ChangeRecord[];
}
```

## Testing Requirements

1. **Event Flow Tests**
   - Events fire correctly
   - Handlers receive data
   - Unsubscribe works

2. **Cascade Tests**
   - Dependencies update
   - No circular loops
   - Correct order

3. **Validation Tests**
   - Invalid changes blocked
   - Warnings issued
   - Rollback works

## Success Criteria

- Comprehensive event coverage
- Reliable change tracking
- Proper dependency management
- No event loops or races