# Code Organization for nui

## Directory Structure

```
nui/
├── dev-docs/                    # Documentation for LLMs and developers
│   ├── ARCHITECTURE.md          # System design and principles
│   ├── CODE_ORGANIZATION.md     # This file
│   └── STANDARDS.md             # Coding standards and TDD rules
│
├── src/
│   ├── features/                # Feature modules (domain-organized)
│   │   ├── chat/                # Chat UI components
│   │   │   ├── ChatLayout.ts
│   │   │   ├── ChatLayout.test.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── config/              # Configuration and adapter
│   │   │   ├── llxprtAdapter.ts
│   │   │   ├── llxprtAdapter.test.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── markdown/            # Markdown rendering
│   │   │   ├── StreamingMarkdown.ts
│   │   │   ├── StreamingMarkdown.test.ts
│   │   │   └── index.ts
│   │   │
│   │   └── tools/               # Tool display and approval
│   │       ├── ToolDisplay.ts
│   │       ├── ToolApproval.ts
│   │       └── index.ts
│   │
│   ├── lib/                     # Shared utilities
│   │   ├── logger.ts            # Logging (use this, not console)
│   │   ├── logger.test.ts
│   │   └── index.ts
│   │
│   ├── types/                   # Shared type definitions
│   │   ├── events.ts            # AdapterEvent types
│   │   └── index.ts
│   │
│   ├── renderer.ts              # opentui setup
│   └── index.ts                 # Main entry point
│
├── themes/                      # UI themes
│   └── default.json
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── eslint.config.cjs
```

## Feature Module Pattern

Each feature is a self-contained module:

```
features/
  feature-name/
    ├── index.ts              # Public exports only
    ├── FeatureName.ts        # Main implementation
    ├── FeatureName.test.ts   # Tests (colocated)
    ├── types.ts              # Feature-specific types (if needed)
    └── helpers.ts            # Internal helpers (if needed)
```

### Export Rules

- `index.ts` exports ONLY the public API
- Internal helpers are NOT exported
- Tests import from the implementation file, not index

```typescript
// index.ts - public API only
export { ChatLayout } from './ChatLayout';
export type { ChatLayoutProps } from './ChatLayout';

// ChatLayout.test.ts - imports implementation directly
import { ChatLayout, internalHelper } from './ChatLayout';
```

## Naming Conventions

### Files

| Type              | Convention               | Example              |
| ----------------- | ------------------------ | -------------------- |
| Feature component | PascalCase               | `ChatLayout.ts`      |
| Utility           | camelCase                | `logger.ts`          |
| Types             | camelCase                | `events.ts`          |
| Tests             | Same as source + `.test` | `ChatLayout.test.ts` |
| Config            | camelCase                | `vitest.config.ts`   |

### Code

| Type       | Convention               | Example                     |
| ---------- | ------------------------ | --------------------------- |
| Classes    | PascalCase               | `class StreamingMarkdown`   |
| Interfaces | PascalCase (no I prefix) | `interface AdapterEvent`    |
| Types      | PascalCase               | `type EventHandler`         |
| Functions  | camelCase                | `function transformEvent()` |
| Variables  | camelCase                | `const eventBuffer`         |
| Constants  | UPPER_SNAKE_CASE         | `const MAX_BUFFER_SIZE`     |

## Import Order

Imports must be ordered:

1. Node.js built-ins
2. External packages
3. Internal absolute imports (if using aliases)
4. Relative imports

```typescript
// 1. Node built-ins
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// 2. External packages
import { GeminiClient } from '@vybestack/llxprt-code-core';

// 3. Internal (relative)
import { getLogger } from '../../lib/logger';
import { transformEvent } from './helpers';
```

## Test Organization

### Colocation

Tests live next to the code they test:

```
ChatLayout.ts
ChatLayout.test.ts   # Right next to it
```

### Test File Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { functionUnderTest } from './module';

describe('functionUnderTest', () => {
  describe('when given valid input', () => {
    it('should return expected result', () => {
      // Arrange
      const input = createTestInput();

      // Act
      const result = functionUnderTest(input);

      // Assert
      expect(result).toEqual(expectedOutput);
    });
  });

  describe('when given invalid input', () => {
    it('should return error result', () => {
      // ...
    });
  });
});
```

### Test Naming

- Describe blocks: function/class name
- Nested describes: conditions ("when...", "with...")
- It blocks: behavior in plain English ("should...")

## Types Location

### Shared Types

Types used across multiple features go in `src/types/`:

```typescript
// src/types/events.ts
export type AdapterEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_pending'; id: string; name: string }
  | { type: 'complete' };
```

### Feature-Specific Types

Types used only within a feature stay in that feature:

```typescript
// src/features/chat/types.ts
export interface ChatLayoutProps {
  onSubmit: (text: string) => void;
  events: AdapterEvent[];
}
```

## Adding a New Feature

1. Create directory: `src/features/feature-name/`
2. Write failing test: `FeatureName.test.ts`
3. Create implementation: `FeatureName.ts`
4. Create index: `index.ts` with public exports
5. Add to parent index if needed

## Dependencies

### External Dependencies

- `@vybestack/llxprt-code-core` - Backend integration
- `opentui` - Terminal UI framework
- `vitest` - Testing

### Internal Dependencies

Features should minimize cross-dependencies:

```
lib/           # No dependencies on features
types/         # No dependencies on features or lib
features/      # Can depend on lib and types
              # Features should NOT depend on each other
```

If features need to communicate, use:

- Events/callbacks passed through props
- Shared types in `src/types/`
- Coordination at the app level (`src/index.ts`)
