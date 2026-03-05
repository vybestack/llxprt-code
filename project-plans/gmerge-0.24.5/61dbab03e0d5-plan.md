# Playbook: Add visual indicators for hook execution

**Upstream SHA:** `61dbab03e0d5`
**Upstream Subject:** feat(ui): add visual indicators for hook execution (#15408)
**Upstream Stats:** 27 files, 1117 insertions(+), 118 deletions(-)

## What Upstream Does

Adds real-time visual feedback for executing hooks in the interactive UI. Introduces `hooks.notifications` setting (default: true), `useHookDisplayState` hook to track active hooks, `HookStatusDisplay` component to show "Executing Hook: {name}" status, and `StatusDisplay` component to coordinate hook status, warnings, and context summary. The UI prioritizes messages: system md indicator → Ctrl+C → warnings → Ctrl+D → Escape → queue errors → hook status → context summary. **SKIP:** All hooks list command changes (LLxprt doesn't have this UI).

## LLxprt File Existence Map

| Upstream Path | LLxprt Equivalent | Status | Action |
|--------------|-------------------|--------|--------|
| `packages/cli/src/config/settingsSchema.ts` | `packages/cli/src/config/settingsSchema.ts` | EXISTS | PORT — Add hooks.notifications |
| `packages/cli/src/ui/hooks/useHookDisplayState.ts` | N/A | CREATE | PORT — Track active hooks |
| `packages/cli/src/ui/components/HookStatusDisplay.tsx` | N/A | CREATE | PORT — Visual indicator |
| `packages/cli/src/ui/components/StatusDisplay.tsx` | N/A | CREATE | PORT — Status coordinator |
| `packages/cli/src/ui/components/Composer.tsx` | `packages/cli/src/ui/components/Composer.tsx` | EXISTS | PORT — Use StatusDisplay |
| `packages/cli/src/ui/AppContainer.tsx` | `packages/cli/src/ui/AppContainer.tsx` | EXISTS | PORT — Add activeHooks to state |
| `packages/cli/src/ui/types.ts` | `packages/cli/src/ui/types.ts` | EXISTS | PORT — Add ActiveHook interface |
| `packages/cli/src/ui/constants.ts` | N/A | CREATE | PORT — Timing constants |
| Hooks list command | N/A | SKIP | LLxprt doesn't have this |

## Preflight Checks

```bash
# Verify settings schema exists
test -f packages/cli/src/config/settingsSchema.ts || echo "MISSING"

# Verify UI structure exists
test -d packages/cli/src/ui/hooks || echo "MISSING: hooks directory"
test -d packages/cli/src/ui/components || echo "MISSING: components directory"
test -f packages/cli/src/ui/AppContainer.tsx || echo "MISSING"
test -f packages/cli/src/ui/types.ts || echo "MISSING"

# Verify Composer exists
test -f packages/cli/src/ui/components/Composer.tsx || echo "MISSING"

# Check if ContextSummaryDisplay exists
grep -n "ContextSummaryDisplay" packages/cli/src/ui/components/Composer.tsx || echo "NOT FOUND"
```

## Inter-Playbook Dependencies

- **Consumes:** 6d1e27633a32 (SessionStart context injection), all prior hook infrastructure
- **Provides:** 61dbab03e0d5 → 56092bd78205 (Visual indicators work before canonical hooks.enabled)
- **Contracts:** `ActiveHook` interface with name/eventName/index/total, `hooks.notifications` setting controls display

## Implementation Steps (Compressed)

### Step 1: Add hooks.notifications Setting

**File:** `packages/cli/src/config/settingsSchema.ts`

Add to `hooks` properties:
```typescript
notifications: {
  type: 'boolean',
  label: 'Hook Notifications',
  default: true,
  category: 'Advanced',
  description: 'Show visual indicators when hooks are executing.',
  showInDialog: false,
}
```

### Step 2: Create ActiveHook Interface

**File:** `packages/cli/src/ui/types.ts`

```typescript
export interface ActiveHook {
  name: string;
  eventName: string;
  index?: number;
  total?: number;
}
```

### Step 3: Create useHookDisplayState Hook

**File:** `packages/cli/src/ui/hooks/useHookDisplayState.ts`

```typescript
import { useState, useEffect } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import type { ActiveHook } from '../types.js';

export function useHookDisplayState(config: Config): ActiveHook[] {
  const [activeHooks, setActiveHooks] = useState<ActiveHook[]>([]);

  useEffect(() => {
    // Subscribe to MessageBus for HOOK_EXECUTION_REQUEST/RESPONSE events
    // Track start/end of hook execution
    // Return cleanup function
    
    const messageBus = config.getMessageBus();
    if (!messageBus) return;

    const handleHookStart = (event: any) => {
      setActiveHooks(prev => [...prev, {
        name: event.name || 'Unknown Hook',
        eventName: event.eventName,
        index: event.index,
        total: event.total,
      }]);
    };

    const handleHookEnd = (event: any) => {
      setActiveHooks(prev => prev.filter(h => h.name !== event.name || h.eventName !== event.eventName));
    };

    messageBus.subscribe('HOOK_EXECUTION_REQUEST', handleHookStart);
    messageBus.subscribe('HOOK_EXECUTION_RESPONSE', handleHookEnd);

    return () => {
      messageBus.unsubscribe('HOOK_EXECUTION_REQUEST', handleHookStart);
      messageBus.unsubscribe('HOOK_EXECUTION_RESPONSE', handleHookEnd);
    };
  }, [config]);

  return activeHooks;
}
```

### Step 4: Create HookStatusDisplay Component

**File:** `packages/cli/src/ui/components/HookStatusDisplay.tsx`

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import type { ActiveHook } from '../types.js';

interface HookStatusDisplayProps {
  activeHooks: ActiveHook[];
}

export const HookStatusDisplay: React.FC<HookStatusDisplayProps> = ({ activeHooks }) => {
  if (activeHooks.length === 0) {
    return null;
  }

  const hookNames = activeHooks.map(h => {
    let name = h.name;
    if (h.index !== undefined && h.total !== undefined) {
      name += ` (${h.index}/${h.total})`;
    }
    return name;
  }).join(', ');

  const label = activeHooks.length === 1 ? 'Executing Hook' : 'Executing Hooks';

  return (
    <Box>
      <Text color={theme.status.warning}>
        {label}: {hookNames}
      </Text>
    </Box>
  );
};
```

### Step 5: Create StatusDisplay Component

**File:** `packages/cli/src/ui/components/StatusDisplay.tsx`

```typescript
import React from 'react';
import { Box } from 'ink';
import { HookStatusDisplay } from './HookStatusDisplay.js';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';
import type { ActiveHook } from '../types.js';

interface StatusDisplayProps {
  activeHooks: ActiveHook[];
  contextSummary?: { filesCount: number; tokensCount: number };
  warnings?: string[];
  // ... other status props
}

export const StatusDisplay: React.FC<StatusDisplayProps> = ({
  activeHooks,
  contextSummary,
  warnings,
}) => {
  // Priority order: hook status > warnings > context summary
  
  if (activeHooks.length > 0) {
    return <HookStatusDisplay activeHooks={activeHooks} />;
  }

  if (warnings && warnings.length > 0) {
    // Display warnings
    return <Box>{/* warning display */}</Box>;
  }

  if (contextSummary) {
    return <ContextSummaryDisplay {...contextSummary} />;
  }

  return null;
};
```

### Step 6: Update Composer

**File:** `packages/cli/src/ui/components/Composer.tsx`

**Replace inline ContextSummaryDisplay with StatusDisplay:**
```typescript
import { StatusDisplay } from './StatusDisplay.js';

// Inside render:
<StatusDisplay
  activeHooks={uiState.activeHooks}
  contextSummary={contextSummary}
  warnings={uiState.warnings}
/>
```

### Step 7: Update AppContainer

**File:** `packages/cli/src/ui/AppContainer.tsx`

```typescript
import { useHookDisplayState } from './hooks/useHookDisplayState.js';

// Inside AppContainer function:
const activeHooks = useHookDisplayState(config);

// Add to UIState:
const uiState = {
  // ... existing fields ...
  activeHooks,
};
```

### Step 8: Create constants.ts

**File:** `packages/cli/src/ui/constants.ts`

```typescript
export const WARNING_PROMPT_DURATION_MS = 3000;
export const QUEUE_ERROR_DISPLAY_DURATION_MS = 5000;
```

### Step 9: Add Tests

**Create:** `packages/cli/src/ui/components/HookStatusDisplay.test.tsx`
**Create:** `packages/cli/src/ui/components/StatusDisplay.test.tsx`
**Modify:** `packages/cli/src/ui/components/Composer.test.tsx`
**Modify:** `packages/cli/src/ui/AppContainer.test.tsx`

Add snapshot tests for HookStatusDisplay and StatusDisplay components.

### Step 10: SKIP Hooks List Command

**DO NOT PORT:** All changes to hooks list command (HooksList.tsx, hooks list subcommand)

**Reason:** LLxprt doesn't have a hooks list UI — verified by user requirements.

## Deterministic Verification Commands

```bash
npm run typecheck
npm run test -- packages/cli/src/ui/hooks/useHookDisplayState.ts
npm run test -- packages/cli/src/ui/components/HookStatusDisplay.test.tsx
npm run test -- packages/cli/src/ui/components/StatusDisplay.test.tsx
npm run test -- packages/cli/src/ui/components/Composer.test.tsx
npm run test -- packages/cli/src/ui/AppContainer.test.tsx

# Verify hooks.notifications setting added
grep "notifications" packages/cli/src/config/settingsSchema.ts

# Verify ActiveHook interface exists
grep "interface ActiveHook" packages/cli/src/ui/types.ts

# Verify useHookDisplayState exists
test -f packages/cli/src/ui/hooks/useHookDisplayState.ts || echo "MISSING"

# Verify HookStatusDisplay exists
test -f packages/cli/src/ui/components/HookStatusDisplay.tsx || echo "MISSING"

# Verify StatusDisplay exists
test -f packages/cli/src/ui/components/StatusDisplay.tsx || echo "MISSING"

# Verify Composer uses StatusDisplay
grep "StatusDisplay" packages/cli/src/ui/components/Composer.tsx

# Verify AppContainer uses useHookDisplayState
grep "useHookDisplayState" packages/cli/src/ui/AppContainer.tsx

# Verify constants file exists
test -f packages/cli/src/ui/constants.ts || echo "MISSING"
```

## Execution Notes

- **Batch group:** Hooks Phase 4 - UX & Configuration
- **Dependencies:** 6d1e27633a32 (SessionStart context injection), all hook infrastructure
- **Enables:** 56092bd78205 (hooks.enabled setting — visual indicators work before canonical toggle)
- **SKIP:** All hooks list command changes (not in LLxprt)
- **Scope:** Adds visual feedback for executing hooks, controlled by `hooks.notifications` setting

## Post-Implementation Checklist

- [ ] hooks.notifications setting added (default: true)
- [ ] ActiveHook interface added to types.ts
- [ ] useHookDisplayState hook tracks active hooks via MessageBus
- [ ] HookStatusDisplay component renders "Executing Hook: {name}"
- [ ] StatusDisplay component coordinates status priority
- [ ] Composer uses StatusDisplay instead of inline ContextSummaryDisplay
- [ ] AppContainer passes activeHooks to UIState
- [ ] constants.ts exports timing constants
- [ ] Snapshot tests added for new components
- [ ] Hooks list command changes SKIPPED (documented in commit)
- [ ] npm run typecheck passes
- [ ] All UI tests pass
