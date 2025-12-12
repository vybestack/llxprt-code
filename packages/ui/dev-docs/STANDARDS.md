# Development Standards for nui

## Core Principle: Test-Driven Development is Mandatory

**Every line of production code must be written in response to a failing test. No exceptions.**

## Quick Reference

### Must Do:

- Write test first (RED) → Minimal code to pass (GREEN) → Refactor if valuable
- Test behavior, not implementation
- Use TypeScript strict mode (no `any`, no type assertions)
- Use nui's Logger (`src/lib/logger.ts`) for all logging
- Explicit return types on all functions
- Run `npm run lint` and `npm run typecheck` before commits

### Never Do:

- Write production code without a failing test
- Use `console.log`, `console.warn`, `console.error` (use Logger)
- Use `any` type (use `unknown` with type guards)
- Write "mock theater" tests that verify mock calls instead of behavior
- Add comments (code must be self-documenting)
- Create speculative abstractions

## Technology Stack

- **Language**: TypeScript (strict mode required)
- **Testing**: Vitest
- **UI Framework**: opentui (terminal UI)
- **Backend Integration**: @vybestack/llxprt-code-core

## TDD Process

### Red-Green-Refactor (Follow Strictly)

1. **RED**: Write a failing test for the next small behavior
2. **GREEN**: Write ONLY enough code to make the test pass
3. **REFACTOR**: Assess if refactoring adds value. If yes, improve. If no, move on.
4. **COMMIT**: Feature + tests together, refactoring separately

### Example TDD Flow

```typescript
// 1. RED - Test first
describe('transformEvent', () => {
  it('should convert Content event to text_delta', () => {
    const input = { type: GeminiEventType.Content, value: 'hello' };
    const result = transformEvent(input);
    expect(result).toEqual({ type: 'text_delta', text: 'hello' });
  });
});

// 2. GREEN - Minimal implementation
function transformEvent(event: ServerGeminiStreamEvent): AdapterEvent {
  if (event.type === GeminiEventType.Content) {
    return { type: 'text_delta', text: event.value };
  }
  throw new Error(`Unknown event type: ${event.type}`);
}

// 3. REFACTOR - Only if it improves clarity
// 4. COMMIT - "feat: add event transformation for Content type"
```

## TypeScript Rules

### Required Practices

```typescript
// Explicit return types on all functions
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

// Use unknown with type guards, not any
function handleError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Use type predicates instead of assertions
function isTextEvent(event: AdapterEvent): event is TextDeltaEvent {
  return event.type === 'text_delta';
}
```

### Forbidden Patterns

```typescript
// BAD: Using any
function process(data: any) { ... }

// BAD: Type assertions
const user = data as User;

// BAD: Non-null assertions
const name = user!.name;

// BAD: Console logging
console.log("debug info");
```

## Testing Guidelines

### What to Test

- Public API behavior (input → output)
- Edge cases and error conditions
- Integration between units
- Event transformations

### What NOT to Test

- Implementation details
- Private methods
- That mocks were called (mock theater)
- Third-party library internals

### Mock Theater (FORBIDDEN)

```typescript
// BAD: Testing that a mock was called
it('should call database.find', () => {
  const mockDb = { find: vi.fn() };
  service.getUser('123');
  expect(mockDb.find).toHaveBeenCalledWith('123');
});

// GOOD: Testing actual behavior
it('should return user data for valid ID', () => {
  const user = service.getUser('123');
  expect(user).toEqual({ id: '123', name: 'Alice' });
});
```

### Reverse Tests (FORBIDDEN)

```typescript
// BAD: Test that passes when code is wrong
it('should not throw', () => {
  expect(() => brokenFunction()).not.toThrow();
});

// GOOD: Test that verifies correct behavior
it('should return calculated result', () => {
  expect(calculate(2, 3)).toBe(5);
});
```

### Stub Implementations (FORBIDDEN)

```typescript
// BAD: Stub that doesn't do anything
function processMessage(msg: Message): void {
  // TODO: implement
}

// GOOD: Real implementation or throw
function processMessage(msg: Message): ProcessedMessage {
  return { id: msg.id, processed: true, timestamp: Date.now() };
}
```

## Logging

Use nui's Logger for all logging:

```typescript
import { getLogger } from '../lib/logger';

const logger = getLogger('nui:my-module');

logger.debug('Processing started', { itemCount: items.length });
logger.warn('Unexpected state', { state });
logger.error('Operation failed', { error: err.message });
```

Logs go to `~/.llxprt/nuilog/nui.log`.

## Error Handling

### Use Explicit Error States

```typescript
// BAD: Throwing for control flow
try {
  const user = getUser(id);
} catch (e) {
  // Handle missing user
}

// GOOD: Explicit result types
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function getUser(id: string): Result<User> {
  const user = users.get(id);
  if (!user) {
    return { ok: false, error: `User ${id} not found` };
  }
  return { ok: true, value: user };
}
```

## Immutability

```typescript
// BAD: Mutation
function addItem(cart: Cart, item: Item): Cart {
  cart.items.push(item);
  return cart;
}

// GOOD: Immutable
function addItem(cart: Cart, item: Item): Cart {
  return { ...cart, items: [...cart.items, item] };
}
```

## Review Checklist

Before submitting code, verify:

- [ ] All tests pass (`npm test`)
- [ ] No TypeScript errors (`npm run typecheck`)
- [ ] No linting warnings (`npm run lint`)
- [ ] No console.log or debug code
- [ ] No stub implementations
- [ ] No mock theater tests
- [ ] Code is self-documenting
- [ ] Follows immutability patterns
- [ ] Error cases handled explicitly
