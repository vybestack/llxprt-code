# REIMPLEMENT Playbook: 9722ec9 — fix(core): warnings for invalid hook event names

## Upstream Change Summary

Upstream added better warning handling for invalid hook event names in configuration:

1. **Added `HOOKS_CONFIG_FIELDS` constant**: Array of config field names that are NOT hook event names: `['enabled', 'disabled', 'notifications']`
2. **Updated `hookRegistry.ts`**: Skip known config fields without warning, then warn on invalid event names
3. **Changed warning mechanism**: Uses `coreEvents.emitFeedback('warning', ...)` instead of `debugLogger.warn()`

## LLxprt Current State

**File**: `packages/core/src/hooks/types.ts`

LLxprt does NOT have `HOOKS_CONFIG_FIELDS` constant.

**File**: `packages/core/src/hooks/hookRegistry.ts`

LLxprt's `processHooksConfiguration`:
```typescript
private processHooksConfiguration(
  hooksConfig: { [K in HookEventName]?: HookDefinition[] },
  source: ConfigSource,
): void {
  for (const [eventName, definitions] of Object.entries(hooksConfig)) {
    if (!this.isValidEventName(eventName)) {
      debugLogger.warn(`Invalid hook event name: ${eventName}`);
      continue;
    }
    // ...
  }
}
```

LLxprt uses `DebugLogger.getLogger()` pattern, not `debugLogger` from a central import:
```typescript
const debugLogger = DebugLogger.getLogger('llxprt:core:hooks:registry');
```

LLxprt's events system uses `CoreEvent.Output` for emitting feedback (not `emitFeedback` method).

## Adaptation Plan

### File-by-File Changes

#### 1. `packages/core/src/hooks/hookRegistry.ts` — HOOKS_CONFIG_FIELDS constant

`ConfigSource` is defined locally in `hookRegistry.ts` — do NOT import it from `types.ts`. Add `HOOKS_CONFIG_FIELDS` as a local constant at the top of `hookRegistry.ts`:

```typescript
/**
 * Fields in the hooks configuration that are not hook event names.
 * Only include keys that are verified in LLxprt's actual hook config schema.
 */
const HOOKS_CONFIG_FIELDS = ['disabled'];
```

> **Note on values**: Only include `'disabled'` here — that is the only non-event key verified in LLxprt's hook config schema. Do NOT add `'enabled'` or `'notifications'` without first confirming they exist in LLxprt's config schema.

#### 2. `packages/core/src/hooks/hookRegistry.ts` — imports and processHooksConfiguration

1. Add event system import (alongside existing imports):
   ```typescript
   import { coreEvents, CoreEvent } from '../utils/events.js';
   ```
   (`ConfigSource` stays local — no change needed to the existing import for it.)

2. Update `processHooksConfiguration` to skip config fields and warn on invalid event names:
   ```typescript
   private processHooksConfiguration(
     hooksConfig: { [K in HookEventName]?: HookDefinition[] },
     source: ConfigSource,
   ): void {
     for (const [eventName, definitions] of Object.entries(hooksConfig)) {
       // Skip known config fields without warning
       if (HOOKS_CONFIG_FIELDS.includes(eventName)) {
         continue;
       }

       if (!this.isValidEventName(eventName)) {
         // Emit warning via coreEvents (LLxprt-idiomatic pattern)
         coreEvents.emit(CoreEvent.Output, {
           chunk: `Warning: Invalid hook event name: "${eventName}". Skipping.\n`,
           isStderr: true,
         });
         continue;
       }
       // ... rest of existing code
     }
   }
   ```

#### 3. `packages/core/src/hooks/hookRegistry.test.ts`

Add test case for the new behavior, with concrete assertions:
```typescript
it('should skip known config fields and warn on invalid event names', async () => {
  const emitSpy = vi.spyOn(coreEvents, 'emit');

  const configWithExtras = {
    disabled: [],        // known config field — must be skipped silently
    InvalidEvent: [],    // unknown event name — must trigger warning
    BeforeTool: [
      {
        hooks: [{ type: 'command', command: './test.sh' }],
      },
    ],
  };

  vi.mocked(mockConfig.getHooks).mockReturnValue(
    configWithExtras as unknown as { [K in HookEventName]?: HookDefinition[] },
  );

  await hookRegistry.initialize();

  // Should only load the valid hook (BeforeTool), not InvalidEvent
  expect(hookRegistry.getAllHooks()).toHaveLength(1);

  // Should have emitted exactly one Output warning for InvalidEvent
  expect(emitSpy).toHaveBeenCalledWith(CoreEvent.Output, {
    chunk: expect.stringContaining('Invalid hook event name: "InvalidEvent"'),
    isStderr: true,
  });

  // Should NOT have emitted a warning for 'disabled' (known config field)
  const allCalls = emitSpy.mock.calls;
  const warningCallsForDisabled = allCalls.filter(
    ([, payload]) =>
      typeof payload === 'object' &&
      payload !== null &&
      'chunk' in payload &&
      typeof (payload as { chunk: string }).chunk === 'string' &&
      (payload as { chunk: string }).chunk.includes('"disabled"'),
  );
  expect(warningCallsForDisabled).toHaveLength(0);
});
```

**Note**: Import `coreEvents` and `CoreEvent` in the test file to support `emitSpy`.

#### 4. `packages/core/src/hooks/hookSystem.ts`

**No changes required** for this commit. `hookSystem.ts` delegates to `hookRegistry` and is unaffected by this warning improvement.

## Files to Read

- `packages/core/src/hooks/hookRegistry.ts` (read first — `ConfigSource` is defined locally here)
- `packages/core/src/hooks/hookRegistry.test.ts`
- `packages/core/src/utils/events.ts` (verify `coreEvents` export and `CoreEvent.Output`)

## Files to Modify

- `packages/core/src/hooks/hookRegistry.ts` (add `HOOKS_CONFIG_FIELDS` local constant, add `coreEvents`/`CoreEvent` import, update `processHooksConfiguration`)
- `packages/core/src/hooks/hookRegistry.test.ts` (add test with concrete `emitSpy` assertions)

## Files NOT to Modify

- `packages/core/src/hooks/types.ts` — no changes needed; `ConfigSource` stays in `hookRegistry.ts`
- `packages/core/src/hooks/hookSystem.ts` — no changes needed for this commit

## Specific Verification

1. Run tests: `npm run test -- packages/core/src/hooks/hookRegistry.test.ts`
2. Confirm `coreEvents.emit` is called with `CoreEvent.Output` and `isStderr: true` for invalid event names
3. Confirm `'disabled'` config field is silently skipped (no warning emitted)

## LLxprt-Specific Notes

- `ConfigSource` is a local type in `hookRegistry.ts` — do NOT move it to `types.ts`
- `HOOKS_CONFIG_FIELDS` is a local constant in `hookRegistry.ts` — only contains `'disabled'` (the only verified non-event key in LLxprt's hook config schema)
- LLxprt uses `coreEvents.emit(CoreEvent.Output, { chunk: '...', isStderr: true })` for warning output — not `emitFeedback`
- Import path: `import { coreEvents, CoreEvent } from '../utils/events.js'`
