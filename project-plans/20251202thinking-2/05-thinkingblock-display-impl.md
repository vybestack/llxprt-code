# Phase 05: ThinkingBlockDisplay Implementation

## Phase ID

`PLAN-20251202-THINKING-UI.P05`

## Prerequisites

- Required: Phase 04a (TDD Verification) completed
- Verification: Tests exist and fail naturally
- ThinkingBlockDisplay.test.tsx has 8+ tests

---

## Requirements Implemented (Expanded)

### REQ-THINK-UI-001: Type Recognition

**Full Text**: The UI MUST recognize `thinking` type and route to display component.

**Implementation**: Component accepts ThinkingBlock type and renders appropriately.

### REQ-THINK-UI-002: Visual Styling

**Full Text**: ThinkingBlocks MUST be displayed with distinct visual styling.

**Implementation**:
- Italic text via `fontStyle="italic"` on Text component
- Shaded background using theme-aware colors
- Background: `Colors.Gray` for subtle shading
- Margin to separate from other content

### REQ-THINK-UI-003: Visibility Toggle

**Full Text**: Display controlled by `visible` prop (mapped from `reasoning.includeInResponse`).

**Implementation**: Return null when `visible=false`.

---

## Implementation Tasks

### Files to Modify

#### `packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx`

**Replace stub with full implementation**.

**Requirements**:
- MUST pass all P04 tests
- MUST NOT modify any tests
- MUST include: `@plan:PLAN-20251202-THINKING-UI.P05`

**Full Implementation**:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ThinkingBlockDisplay - Renders a ThinkingBlock with distinct styling
 *
 * @plan:PLAN-20251202-THINKING-UI.P03
 * @plan:PLAN-20251202-THINKING-UI.P05
 * @requirement:REQ-THINK-UI-001 - ThinkingBlock type recognition
 * @requirement:REQ-THINK-UI-002 - Visual styling (italic, shaded background)
 * @requirement:REQ-THINK-UI-003 - Toggle via visible prop
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { Colors } from '../../colors.js';

export interface ThinkingBlockDisplayProps {
  /** The ThinkingBlock to display */
  block: ThinkingBlock;
  /** Whether to display the block (controlled by reasoning.includeInResponse) */
  visible?: boolean;
}

/**
 * Displays a ThinkingBlock with italic text and shaded background.
 * Visibility controlled by reasoning.includeInResponse setting.
 *
 * Visual style:
 * - Italic text
 * - Slightly shaded background (theme-aware gray)
 * - Small margin for separation from other content
 *
 * @plan:PLAN-20251202-THINKING-UI.P05
 * @requirement:REQ-THINK-UI-002 - Visual styling
 * @requirement:REQ-THINK-UI-003 - Visibility toggle
 */
export const ThinkingBlockDisplay: React.FC<ThinkingBlockDisplayProps> = ({
  block,
  visible = true,
}) => {
  // @requirement REQ-THINK-UI-003 - Toggle via visible prop
  if (!visible) {
    return null;
  }

  // @requirement REQ-THINK-UI-002 - Visual styling
  // Empty thought handling - render nothing if thought is empty
  if (!block.thought || block.thought.trim() === '') {
    return <Box />;
  }

  return (
    <Box
      flexDirection="column"
      marginY={0}
      paddingX={1}
      borderStyle="single"
      borderColor={Colors.Gray}
    >
      <Text italic color={Colors.Gray}>
        {block.thought}
      </Text>
    </Box>
  );
};
```

---

## Required Code Markers

Implementation MUST include:

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P05
 * @requirement:REQ-THINK-UI-001
 * @requirement:REQ-THINK-UI-002
 * @requirement:REQ-THINK-UI-003
 */
```

---

## Verification Commands

### All Tests Pass

```bash
# Run tests - all MUST pass
npm test -- packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx --run
# Expected: All tests pass
```

### No Test Modifications

```bash
# Verify tests were NOT modified
git diff packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx
# Expected: No changes
```

### Plan Markers

```bash
grep "@plan:PLAN-20251202-THINKING-UI.P05" packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx && echo "PASS" || echo "FAIL"
```

### TypeScript Compilation

```bash
npm run typecheck
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK
grep -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx
# Expected: No matches
```

---

## Success Criteria

- All P04 tests pass
- No tests modified
- TypeScript compiles
- Plan markers present
- No TODO/FIXME comments
- Component renders italic text with border/shading

---

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx`
2. Review failing tests
3. Re-implement to pass all tests
4. Cannot proceed to Phase 06 until all tests pass

---

## Phase Completion Marker

Create: `project-plans/20251202thinking-2/.completed/P05.md`

Contents:
```markdown
Phase: P05
Completed: [DATE TIME]
Files Modified:
  - packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx (~60 lines)
Tests Modified: 0
Test Status: All passing
Verification: npm test passed, npm run typecheck passed
```
