# Development Guidelines for LLMs

## CORE PRINCIPLE: TEST-DRIVEN DEVELOPMENT IS MANDATORY

**Every line of production code must be written in response to a failing test. No exceptions.**

## Quick Reference (MEMORIZE THIS)

### Must Do:

- Write test first (RED) → Minimal code to pass (GREEN) → Refactor if valuable
- Test behavior, not implementation
- Use TypeScript strict mode (no `any`, no type assertions)
- Work with immutable data only
- Achieve 100% behavior coverage
- Update your memory with learnings after each session

### Never Do:

- Write production code without a failing test
- Test implementation details
- Add comments (code must be self-documenting)
- Mutate data structures
- Create speculative abstractions

## Technology Stack

- **Language**: TypeScript (strict mode required)
- **Testing**: Vitest + React Testing Library
- **Validation**: Zod for schema-first development
- **State**: Immutable patterns only

## TDD Process

### Red-Green-Refactor (FOLLOW STRICTLY)

1. **RED**: Write a failing test for the next small behavior
2. **GREEN**: Write ONLY enough code to make the test pass
3. **REFACTOR**: Assess if refactoring adds value. If yes, improve. If no, move on.
4. **COMMIT**: Feature + tests together, refactoring separately

### Example TDD Flow

```typescript
// 1. RED - Test first
describe('calculateTotal', () => {
  it('should sum item prices', () => {
    expect(calculateTotal([{ price: 10 }, { price: 20 }])).toBe(30);
  });
});

// 2. GREEN - Minimal implementation
const calculateTotal = (items: Item[]): number => {
  return items.reduce((sum, item) => sum + item.price, 0);
};

// 3. REFACTOR - Only if it improves clarity (this is already clean, so skip)
// 4. COMMIT - "feat: add calculateTotal function"
```

## TypeScript Rules

### Required Compiler Options

```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "noImplicitThis": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true
}
```

### Type Guidelines

- Schema-first with Zod, derive types from schemas
- No `any` - use `unknown` with type guards
- No type assertions - use type predicates
- Explicit return types on all functions

## Testing Guidelines

### Test Structure

- **Describe**: Feature/component name
- **It**: Specific behavior in plain English
- **Arrange-Act-Assert**: Clear test sections
- **Single Assertion**: One behavior per test

### What to Test

✅ Public API behavior
✅ Input → Output transformations
✅ Edge cases and error conditions
✅ Integration between units
✅ Schema validation

### What NOT to Test

❌ Implementation details
❌ Private methods
❌ Third-party libraries
❌ Mock interactions

## Code Patterns

### Immutability

```typescript
// ❌ BAD: Mutation
function addItem(cart: Cart, item: Item) {
  cart.items.push(item); // Mutates!
  return cart;
}

// ✅ GOOD: Immutable
function addItem(cart: Cart, item: Item): Cart {
  return { ...cart, items: [...cart.items, item] };
}
```

### Error Handling

```typescript
// ❌ BAD: Throwing exceptions for control flow
try {
  const user = getUser(id);
} catch (e) {
  // Handle missing user
}

// ✅ GOOD: Explicit error states
const result = getUser(id);
if (result.error) {
  // Handle error case
} else {
  // Use result.data
}
```

### Function Design

- Pure functions preferred
- Single responsibility
- Explicit dependencies
- No side effects in business logic

## Project Organization

### File Structure

```
src/
  features/
    auth/
      auth.schema.ts      # Zod schemas
      auth.service.ts     # Business logic
      auth.service.spec.ts # Tests
      auth.types.ts       # Derived types
```

### Naming Conventions

- **Files**: kebab-case.ts
- **Classes/Types**: PascalCase
- **Functions/Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Test files**: \*.spec.ts

## Anti-Patterns to Avoid

### 1. Premature Abstraction

```typescript
// ❌ BAD: Creating abstractions before they're needed
interface Repository<T> {
  find(id: string): T;
  save(item: T): void;
  // ... 20 more methods
}

// ✅ GOOD: Start concrete, extract when pattern emerges
class UserService {
  getUser(id: string): User {
    /* ... */
  }
}
```

### 2. Test-After Development

```typescript
// ❌ BAD: Writing tests after implementation
function complexBusinessLogic() {
  // 200 lines of untested code
}
// "I'll add tests later" (never happens)

// ✅ GOOD: TDD ensures testable design
it('should calculate discount for premium users', () => {
  expect(calculateDiscount(premiumUser, 100)).toBe(90);
});
// Then implement calculateDiscount
```

### 3. Over-Engineering

```typescript
// ❌ BAD: Complex patterns for simple problems
class UserFactoryBuilderStrategy {
  /* ... */
}

// ✅ GOOD: Simple solutions first
function createUser(data: UserData): User {
  return { ...data, id: generateId() };
}
```

## Performance Considerations

### Only Optimize When:

1. Performance issue is measured and proven
2. It's a critical path
3. The optimization doesn't harm readability

### Performance Rules:

- Profile before optimizing
- Optimize algorithms, not micro-optimizations
- Document why optimization was necessary

## Security Guidelines

### Input Validation

- Validate ALL external inputs with Zod
- Sanitize user-generated content
- Use parameterized queries
- Never trust client data

### Authentication/Authorization

- Use established libraries (don't roll your own)
- Implement proper session management
- Follow OWASP guidelines

## Review Checklist

Before submitting code, verify:

- [ ] All tests pass
- [ ] 100% behavior coverage
- [ ] No TypeScript errors
- [ ] No linting warnings
- [ ] No console.logs or debug code
- [ ] All TODOs addressed
- [ ] Code is self-documenting
- [ ] Follows immutability patterns
- [ ] Error cases handled explicitly

## Common Mistakes and How to Fix Them

### Mistake 1: Testing Implementation

```typescript
// ❌ BAD
it('should call database.find', () => {
  const mockDb = { find: jest.fn() };
  service.getUser('123');
  expect(mockDb.find).toHaveBeenCalledWith('123');
});

// ✅ GOOD
it('should return user data for valid ID', () => {
  const user = service.getUser('123');
  expect(user).toEqual({ id: '123', name: 'Alice' });
});
```

### Mistake 2: Implicit Dependencies

```typescript
// ❌ BAD
function processOrder() {
  const config = globalConfig; // Hidden dependency
  const db = DatabaseConnection.getInstance(); // Hidden dependency
}

// ✅ GOOD
function processOrder(config: Config, db: Database) {
  // Explicit dependencies
}
```

### Mistake 3: Mixed Concerns

```typescript
// ❌ BAD
function saveUser(userData: UserData) {
  // Validation mixed with persistence
  if (!userData.email.includes('@')) throw new Error();
  database.save(userData);
  emailService.sendWelcome(userData.email); // Side effect
}

// ✅ GOOD
const validateUser = (data: unknown): User => UserSchema.parse(data);
const saveUser = (user: User): void => database.save(user);
const notifyUser = (email: Email): void => emailService.sendWelcome(email);
```

## Session Protocol

### Start of Session:

1. Read your project memory for project-specific context
2. Understand the current task
3. Plan the TDD approach

### During Development:

1. Write test for next small behavior
2. Run test - ensure it fails
3. Write minimal code to pass
4. Run all tests
5. Refactor if valuable
6. Commit working code

### End of Session:

1. Run full test suite
2. Ensure no linting errors
3. Update CLAUDE.md with important discoveries
4. Commit all changes

## Mock Hygiene

### The Fundamental Rule

**You cannot test a component by mocking that component.**

This seems obvious but is constantly violated. If you mock `EmojiFilter` to test `EmojiFilter`, you're not testing `EmojiFilter` at all.

### Mock Decision Tree

When deciding whether to mock something:

```
Is it the component you're testing?
├─ Yes → [ERROR] NEVER MOCK IT
└─ No → Is it doing the core work being tested?
    ├─ Yes → [ERROR] DON'T MOCK IT
    └─ No → Is it infrastructure (FS, network, DB)?
        ├─ Yes → [OK] OK to mock
        └─ No → Is it completely unrelated to the test?
            ├─ Yes → [OK] OK to mock
            └─ No → WARNING: Probably shouldn't mock
```

### Prohibited Mock Patterns

#### 1. [ERROR] FORBIDDEN: Self-Mocking Pattern

**Never mock the component under test**

```typescript
// [ERROR] FORBIDDEN - Mocking the thing being tested
vi.mock('./EmojiFilter', () => ({
  EmojiFilter: MockEmojiFilter, // Testing MockEmojiFilter, not EmojiFilter!
}));

test('EmojiFilter filters emojis', () => {
  const filter = new EmojiFilter(); // This is MockEmojiFilter!
  expect(filter.filter('[OK]')).toBe('[OK]'); // Testing the mock!
});
```

#### 2. [ERROR] FORBIDDEN: Direct Value Mock Pattern

**Never mock with the expected output directly**

```typescript
// [ERROR] FORBIDDEN - Mock returns exactly what test expects
const mockFilter = {
  filterText: vi.fn().mockReturnValue('[OK] Done'),
};

test('filters text', () => {
  expect(mockFilter.filterText('[OK] Done')).toBe('[OK] Done'); // Worthless!
});
```

#### 3. [ERROR] FORBIDDEN: Mock Verification Pattern

**Never test that mocks were called**

```typescript
// [ERROR] FORBIDDEN - Testing mock invocations
test('calls filter method', () => {
  mockService.process('data');
  expect(mockFilter.filter).toHaveBeenCalledWith('data'); // Mock theater!
});
```

### Allowed Mock Patterns

#### 1. [OK] ALLOWED: Infrastructure Mocking

**Mock filesystem, network, databases - NOT business logic**

```typescript
// [OK] ALLOWED - Mock infrastructure, test real component
const mockFs = createMockFilesystem({
  '/test.txt': 'Initial content',
});

const tool = new WriteFileTool({ fs: mockFs }); // REAL tool
const result = await tool.execute({
  file_path: '/test.txt',
  content: 'New [OK] content',
});

// Test REAL transformation by REAL component
expect(mockFs.readFile('/test.txt')).toBe('New [OK] content');
```

#### 2. [OK] ALLOWED: Irrelevant Service Mocking

**Mock services unrelated to what's being tested**

```typescript
// [OK] ALLOWED - Mock unrelated services
const mockAuthService = { isAuthenticated: () => true };
const mockLogger = { log: vi.fn() };

// Testing EmojiFilter, not auth or logging
const processor = new ContentProcessor({
  auth: mockAuthService, // Irrelevant to emoji filtering
  logger: mockLogger, // Irrelevant to emoji filtering
  filter: new EmojiFilter(), // REAL component under test!
});

const result = processor.process('Hello [OK]');
expect(result).toBe('Hello [OK]'); // Testing REAL filtering
```

#### 3. [OK] ALLOWED: Test Data Builders

**Create test data, don't mock behavior**

```typescript
// [OK] ALLOWED - Build test data, not mock behavior
class TestDataBuilder {
  static createFileWithEmojis(): string {
    return 'function test() {
  console.log("[OK] Done!");
}';
  }
}

const tool = new EditTool(); // REAL tool
const result = await tool.edit({
  content: TestDataBuilder.createFileWithEmojis(),
});

expect(result).not.toContain('[OK]'); // Test REAL filtering
```

### Anti-Patterns to Detect

1. **The Circular Mock**: Mocking A to test A
2. **The Expected Value Mock**: Mock returns exactly what test expects
3. **The Mock Verification**: Testing that mocks were called
4. **The Mock Chain**: A calls MockB calls MockC (no real code tested)
5. **The Mock Implementation**: Mock has complex logic (should be testing real code)

### Red Flags in Tests

If you see these, the test is probably worthless:

```typescript
//  Mocking the component under test
vi.mock('./ComponentUnderTest');

//  Mock returns expected value
mockThing.method.mockReturnValue('expected value');
expect(thing.method()).toBe('expected value');

//  Verifying mock was called
expect(mockService.method).toHaveBeenCalledWith(args);

//  No real component in test
const mock1 = vi.fn();
const mock2 = vi.fn();
mock1.mockReturnValue(mock2);

//  Mock with implementation (why not test real code?)
vi.mock('./Filter', () => ({
  filter: (text) => text.replace(/[OK]/g, '[OK]'), // Just use real Filter!
}));
```

### The Litmus Test

After writing a test, ask:

1. **If I delete the real implementation, will this test fail?**
   - If NO: Your test is worthless

2. **If I break the real implementation, will this test catch it?**
   - If NO: Your test is worthless

3. **Am I testing my mock or my code?**
   - If MOCK: Your test is worthless

4. **Could I replace the component with `return 'expected'` and pass?**
   - If YES: Your test is worthless

## Remember:

- **TDD is not optional** - it's the foundation of quality
- **Simplicity beats cleverness** every time
- **Working software** > perfect architecture
- **Fast feedback** > comprehensive planning
- **Refactoring** is an investment decision, not a requirement
