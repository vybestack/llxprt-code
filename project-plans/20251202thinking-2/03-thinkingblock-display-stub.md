# Phase 03: ThinkingBlockDisplay Component Stub

## Phase ID

`PLAN-20251202-THINKING-UI.P03`

## Prerequisites

- Required: Phase 00a (Preflight Verification) completed
- Verification: `grep -r "@plan:PLAN-20251202-THINKING-UI.P00a" .` (or documented verification)
- ThinkingBlock interface exists in IContent.ts
- reasoning.includeInResponse setting exists

---

## Requirements Implemented (Expanded)

### REQ-THINK-UI-001: ThinkingBlock Type Recognition

**Full Text**: The UI MUST recognize `thinking` type in ContentBlock union and route it to appropriate display component.

**Behavior**:
- GIVEN: A ThinkingBlock exists in content
- WHEN: ThinkingBlockDisplay component is rendered
- THEN: The component accepts ThinkingBlock props and renders

**Why This Matters**: Without a component to render ThinkingBlocks, users cannot see model reasoning.

### REQ-THINK-UI-002: Visual Styling (Stub)

**Full Text**: ThinkingBlocks MUST be displayed with distinct visual styling.

**Behavior (Stub)**:
- GIVEN: ThinkingBlockDisplay component exists
- WHEN: Component is imported
- THEN: Component compiles and exports correctly

---

## Implementation Tasks

### Files to Create

#### `packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx`

**Purpose**: React component to render a ThinkingBlock with appropriate styling.

**Requirements**:
- MUST include: `@plan:PLAN-20251202-THINKING-UI.P03`
- MUST include: `@requirement:REQ-THINK-UI-001`
- MUST include: `@requirement:REQ-THINK-UI-002`

**Stub Implementation**:

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
 * @requirement:REQ-THINK-UI-001 - ThinkingBlock type recognition
 * @requirement:REQ-THINK-UI-002 - Visual styling (italic, shaded background)
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';

export interface ThinkingBlockDisplayProps {
  block: ThinkingBlock;
  visible?: boolean;
}

/**
 * Displays a ThinkingBlock with italic text and shaded background.
 * Visibility controlled by reasoning.includeInResponse setting.
 */
export const ThinkingBlockDisplay: React.FC<ThinkingBlockDisplayProps> = ({
  block,
  visible = true,
}) => {
  // Stub: Returns null for now, will be implemented in P05
  if (!visible) {
    return null;
  }

  return (
    <Box>
      <Text>{block.thought}</Text>
    </Box>
  );
};
```

---

## Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P03
 * @requirement:REQ-THINK-UI-001
 * @requirement:REQ-THINK-UI-002
 */
```

---

## Verification Commands

### Automated Checks (Structural)

```bash
# Check file exists
ls -la packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx

# Check plan markers exist
grep -r "@plan:PLAN-20251202-THINKING-UI.P03" packages/cli/src/ui/components/messages/

# Check requirements covered
grep -r "@requirement:REQ-THINK-UI-001" packages/cli/src/ui/components/messages/

# TypeScript compilation
npm run typecheck
```

### Structural Verification Checklist

- [ ] ThinkingBlockDisplay.tsx created
- [ ] Plan markers added
- [ ] Requirement markers added
- [ ] Component exports correctly
- [ ] TypeScript compiles without errors
- [ ] No "TODO" or "NotImplemented" in phase code (empty returns OK for stubs)

---

## Success Criteria

- ThinkingBlockDisplay.tsx exists and compiles
- Component accepts ThinkingBlock and visible props
- Component can be imported from other files
- No TypeScript errors

---

## Failure Recovery

If this phase fails:

1. Rollback: `git checkout -- packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx`
2. Delete if created: `rm packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx`
3. Cannot proceed to Phase 04 until fixed

---

## Phase Completion Marker

Create: `project-plans/20251202thinking-2/.completed/P03.md`

Contents:
```markdown
Phase: P03
Completed: [DATE TIME]
Files Created:
  - packages/cli/src/ui/components/messages/ThinkingBlockDisplay.tsx (~30 lines)
Tests Added: 0 (TDD phase)
Verification: npm run typecheck passed
```
