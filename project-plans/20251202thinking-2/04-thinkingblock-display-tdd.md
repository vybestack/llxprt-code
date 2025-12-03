# Phase 04: ThinkingBlockDisplay TDD

## Phase ID

`PLAN-20251202-THINKING-UI.P04`

## Prerequisites

- Required: Phase 03a (Stub Verification) completed
- Verification: `grep -r "@plan:PLAN-20251202-THINKING-UI.P03" packages/cli/src/ui/components/messages/`
- ThinkingBlockDisplay.tsx exists and compiles

---

## Requirements Implemented (Expanded)

### REQ-THINK-UI-002: Visual Styling

**Full Text**: ThinkingBlocks MUST be displayed with distinct visual styling to differentiate from regular response content.

**Behavior**:
- GIVEN: ThinkingBlock with thought content
- WHEN: ThinkingBlockDisplay renders
- THEN: Text is rendered in italics with shaded background

**Test Cases**:
1. Renders thought content correctly
2. Applies italic styling to text
3. Has shaded background (theme-aware)
4. Background adapts to dark/light mode

### REQ-THINK-UI-003: Toggle via Ephemeral Setting

**Full Text**: ThinkingBlock display MUST be controlled by `reasoning.includeInResponse` ephemeral setting.

**Behavior (visible=false)**:
- GIVEN: visible prop is false
- WHEN: Component renders
- THEN: Returns null (nothing displayed)

**Behavior (visible=true)**:
- GIVEN: visible prop is true
- WHEN: Component renders
- THEN: ThinkingBlock is displayed with styling

---

## Implementation Tasks

### Files to Create

#### `packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx`

**Purpose**: TDD tests for ThinkingBlockDisplay component.

**Requirements**:
- MUST include: `@plan:PLAN-20251202-THINKING-UI.P04`
- MUST include: `@requirement:REQ-THINK-UI-002`
- MUST include: `@requirement:REQ-THINK-UI-003`

**Test Implementation**:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ThinkingBlockDisplay TDD Tests
 *
 * @plan:PLAN-20251202-THINKING-UI.P04
 * @requirement:REQ-THINK-UI-002 - Visual styling
 * @requirement:REQ-THINK-UI-003 - Toggle via setting
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ThinkingBlockDisplay } from './ThinkingBlockDisplay.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';

describe('ThinkingBlockDisplay', () => {
  const sampleThinkingBlock: ThinkingBlock = {
    type: 'thinking',
    thought: 'Let me analyze this step by step...',
    sourceField: 'reasoning_content',
  };

  describe('REQ-THINK-UI-002: Visual Styling', () => {
    /**
     * @requirement REQ-THINK-UI-002
     * @scenario Renders thought content
     * @given ThinkingBlock with thought text
     * @when Component renders
     * @then Thought text is visible
     */
    it('should render the thought content', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} />
      );

      expect(lastFrame()).toContain('Let me analyze this step by step...');
    });

    /**
     * @requirement REQ-THINK-UI-002
     * @scenario Empty thought handling
     * @given ThinkingBlock with empty thought
     * @when Component renders
     * @then Component renders without error
     */
    it('should handle empty thought gracefully', () => {
      const emptyBlock: ThinkingBlock = {
        type: 'thinking',
        thought: '',
      };

      const { lastFrame } = render(
        <ThinkingBlockDisplay block={emptyBlock} />
      );

      // Should render without throwing
      expect(lastFrame()).toBeDefined();
    });

    /**
     * @requirement REQ-THINK-UI-002
     * @scenario Multi-line thought
     * @given ThinkingBlock with multi-line thought
     * @when Component renders
     * @then All lines are rendered
     */
    it('should render multi-line thoughts', () => {
      const multiLineBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'First step: understand the problem.\nSecond step: break it down.\nThird step: solve each part.',
      };

      const { lastFrame } = render(
        <ThinkingBlockDisplay block={multiLineBlock} />
      );

      expect(lastFrame()).toContain('First step');
      expect(lastFrame()).toContain('Second step');
      expect(lastFrame()).toContain('Third step');
    });
  });

  describe('REQ-THINK-UI-003: Visibility Toggle', () => {
    /**
     * @requirement REQ-THINK-UI-003
     * @scenario visible=true (default)
     * @given visible prop is true
     * @when Component renders
     * @then Thought content is displayed
     */
    it('should display content when visible=true', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} visible={true} />
      );

      expect(lastFrame()).toContain('Let me analyze this step by step...');
    });

    /**
     * @requirement REQ-THINK-UI-003
     * @scenario visible=false
     * @given visible prop is false
     * @when Component renders
     * @then Nothing is displayed
     */
    it('should not display content when visible=false', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} visible={false} />
      );

      expect(lastFrame()).not.toContain('Let me analyze this step by step...');
    });

    /**
     * @requirement REQ-THINK-UI-003
     * @scenario Default visibility
     * @given visible prop not provided
     * @when Component renders
     * @then Defaults to visible (true)
     */
    it('should default to visible when prop not provided', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} />
      );

      expect(lastFrame()).toContain('Let me analyze this step by step...');
    });
  });

  describe('Edge Cases', () => {
    /**
     * @scenario Long thought content
     * @given Very long thought text
     * @when Component renders
     * @then Content is rendered (no truncation in component)
     */
    it('should handle long thought content', () => {
      const longBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'A'.repeat(1000),
      };

      const { lastFrame } = render(
        <ThinkingBlockDisplay block={longBlock} />
      );

      expect(lastFrame()).toContain('A'.repeat(100)); // At least part of it
    });

    /**
     * @scenario Special characters in thought
     * @given Thought with markdown/special chars
     * @when Component renders
     * @then Characters are preserved
     */
    it('should preserve special characters', () => {
      const specialBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'Analysis: **bold** _italic_ `code` <tag>',
      };

      const { lastFrame } = render(
        <ThinkingBlockDisplay block={specialBlock} />
      );

      expect(lastFrame()).toContain('**bold**');
      expect(lastFrame()).toContain('`code`');
    });
  });
});
```

---

## Required Code Markers

Every test MUST include:

```typescript
/**
 * @plan:PLAN-20251202-THINKING-UI.P04
 * @requirement:REQ-THINK-UI-002 or @requirement:REQ-THINK-UI-003
 */
```

---

## Verification Commands

### Automated Checks

```bash
# Check file exists
ls -la packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx

# Check plan markers exist
grep -r "@plan:PLAN-20251202-THINKING-UI.P04" packages/cli/src/ui/components/messages/

# Check requirements covered
grep -r "@requirement:REQ-THINK-UI-002" packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx
grep -r "@requirement:REQ-THINK-UI-003" packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx

# Run tests - should FAIL until P05 implementation
npm test -- packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers added
- [ ] Requirement markers added
- [ ] At least 8 tests written
- [ ] Tests for visibility toggle (visible=true, visible=false, default)
- [ ] Tests for content rendering
- [ ] Edge case tests (empty, long, special chars)
- [ ] NO reverse testing (expect NotYetImplemented)
- [ ] NO mock theater (expect mock.toHaveBeenCalled)

---

## Success Criteria

- 8+ tests created for ThinkingBlockDisplay
- All tests tagged with plan and requirement IDs
- Tests fail naturally with stub implementation
- Tests expect REAL BEHAVIOR, not stubs

---

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx`
2. Re-run Phase 04 with corrected tests
3. Cannot proceed to Phase 05 until tests are properly written

---

## Phase Completion Marker

Create: `project-plans/20251202thinking-2/.completed/P04.md`

Contents:
```markdown
Phase: P04
Completed: [DATE TIME]
Files Created:
  - packages/cli/src/ui/components/messages/ThinkingBlockDisplay.test.tsx (~100 lines)
Tests Added: 8+
Test Status: Failing (expected - TDD)
Verification: Tests exist and fail naturally
```
