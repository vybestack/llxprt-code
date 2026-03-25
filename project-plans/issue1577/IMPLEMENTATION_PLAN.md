# Issue #1577 Implementation Plan
## Break up text-buffer.ts (2,734 lines) - Test-First Refactoring with Strict SoC

### Project Context
- **Parent Issue**: #1568 (0.10.0 Code Improvement Plan - break up god objects)
- **Core Objective**: Architectural soundness, SoC, DRY - not just file size reduction
- **File**: `packages/cli/src/ui/components/shared/text-buffer.ts` (2,734 lines)
- **Related**: `packages/cli/src/ui/components/shared/vim-buffer-actions.ts` (814 lines)

### Key Constraints
1. No single file exceeds 800 lines
2. No single function exceeds 80 lines (cyclomatic complexity <= 15)
3. All existing tests pass
4. Test coverage does not decrease
5. Strict SoC - no facade crutches
6. Direct imports only - vim-buffer-actions must not import from text-buffer.ts
7. All mutations through shared primitives

---

## Architectural Invariants & Enforcement

### Module Layer Contract

| Module | Allowed | Forbidden | Rationale |
|--------|---------|-----------|-----------|
| `buffer-types` | Types, interfaces, constants | Logic, React, side effects | Pure model definition |
| `word-navigation` | Pure functions | React, logging, I/O | Domain logic only |
| `buffer-operations` | Pure functions, buffer-types | React, logging, I/O | Domain logic only |
| `transformations` | Pure functions, buffer-types | React, logging, I/O | Domain logic only |
| `visual-layout` | Pure functions, buffer-types, transformations | React, logging, I/O | Domain logic only |
| `buffer-reducer` | State transitions, vim actions | React, logging, I/O | Orchestration only |
| `vim-buffer-actions` | State transitions, buffer-operations, word-navigation | React, buffer-reducer | Vim semantics only |
| `text-buffer` | React hook, useReducer, useMemo | Logic, utilities, reducer | Composition root only |

### Import Direction Rules
```
buffer-types (layer 0 - foundation)
    ↑
word-navigation ──────────────────────┐
buffer-operations ────────────────────┤
transformations ──────────────────────┤
    ↑                                 │
visual-layout ────────────────────────┤
    ↑                                 │
buffer-reducer ← vim-buffer-actions ──┘
    ↑
text-buffer (layer 4 - React only)
```

**Critical Invariants**:
1. No upward imports (lower layer cannot import higher layer)
2. DAG import graph: buffer-types <- (word-navigation, buffer-operations, transformations) <- visual-layout <- buffer-reducer
3. vim-buffer-actions.ts must NOT import from buffer-reducer.ts
4. text-buffer.ts must NOT export utilities (useTextBuffer + types only)
5. Domain modules must be side-effect free

### Precise Import DAG

| Module | Allowed Dependencies |
|--------|---------------------|
| buffer-types | None (foundation layer) |
| word-navigation | buffer-types, textUtils.js |
| buffer-operations | buffer-types, textUtils.js |
| transformations | buffer-types, node:path, core (unescapePath only), textUtils.js |
| visual-layout | buffer-types, transformations, textUtils.js |
| buffer-reducer | buffer-types, word-navigation, buffer-operations, transformations, visual-layout, vim-buffer-actions, textUtils.js, core (debugLogger allowed for diagnostics only) |
| vim-buffer-actions | buffer-types, word-navigation, buffer-operations |
| text-buffer | buffer-types, buffer-reducer, React |

### ESLint Flat Config Enforcement (Production-Ready)

Add to `eslint.config.js` (the repo uses flat config format). Insert these configs into the main `tseslint.config()` array:

```javascript
// ============================================================================
// Issue #1577: text-buffer.ts decomposition - Architecture Enforcement
// ============================================================================

// Domain modules must be pure (no React, no side effects)
{
  files: [
    'packages/cli/src/ui/components/shared/buffer-types.ts',
    'packages/cli/src/ui/components/shared/word-navigation.ts',
    'packages/cli/src/ui/components/shared/buffer-operations.ts',
    'packages/cli/src/ui/components/shared/transformations.ts',
    'packages/cli/src/ui/components/shared/visual-layout.ts',
  ],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'react',
          message: 'Domain modules must be pure. React only allowed in text-buffer.ts'
        },
        {
          name: '@vybestack/llxprt-code-core',
          importNames: ['debugLogger'],
          message: 'Domain modules must be side-effect free. No logging.'
        }
      ],
      patterns: [
        {
          group: ['node:fs', 'node:child_process', 'node:os'],
          message: 'Domain modules must be pure. No Node.js I/O modules.'
        }
      ]
    }],
    'complexity': ['error', 15],
    'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }]
  }
},

// vim-buffer-actions.ts specific restrictions
{
  files: ['packages/cli/src/ui/components/shared/vim-buffer-actions.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: './text-buffer.js',
          message: 'Import from buffer-types, buffer-operations, or word-navigation directly'
        },
        {
          name: './buffer-reducer.js',
          message: 'vim-buffer-actions must not import buffer-reducer (creates cycle)'
        },
        {
          name: 'react',
          message: 'vim-buffer-actions must be pure logic. No React.'
        }
      ],
      patterns: [
        {
          group: ['**/shared/text-buffer.js'],
          message: 'Import from specific module, not text-buffer.js'
        }
      ]
    }],
    'complexity': ['error', 15],
    'max-lines-per-function': ['error', 80]
  }
},

// buffer-reducer.ts specific restrictions
{
  files: ['packages/cli/src/ui/components/shared/buffer-reducer.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'react',
          message: 'buffer-reducer must be pure logic. No React.'
        }
      ]
    }],
    'complexity': ['error', 15],
    'max-lines-per-function': ['error', 80]
  }
},

// text-buffer.ts size limits (React allowed here only)
{
  files: ['packages/cli/src/ui/components/shared/text-buffer.ts'],
  rules: {
    'max-lines': ['error', { max: 800, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', 80]
  }
},

// Migration: Warn on utility imports from text-buffer.js in CLI src
{
  files: ['packages/cli/src/**/*.ts', 'packages/cli/src/**/*.tsx'],
  ignores: [
    'packages/cli/src/ui/components/shared/text-buffer.ts',
    'packages/cli/src/ui/components/shared/text-buffer.test.ts'
  ],
  rules: {
    'no-restricted-imports': ['warn', {
      paths: [],
      patterns: [
        {
          group: ['**/shared/text-buffer.js'],
          importNames: [
            'offsetToLogicalPos',
            'logicalPosToOffset',
            'textBufferReducer',
            'pushUndo',
            'replaceRangeInternal',
            'findNextWordStartInLine',
            'findPrevWordStartInLine',
            'findWordEndInLine',
            'getPositionFromOffsets',
            'getLineRangeOffsets'
          ],
          message: 'Import from buffer-operations.js, word-navigation.js, or buffer-types.js directly. See Issue #1577.'
        }
      ]
    }]
  }
},
// ============================================================================
// End Issue #1577
// ============================================================================
```

### Import Boundary Verification Commands

Add to `package.json` scripts or run manually:

```bash
# Verify no cycles (ESLint is authoritative)
npx eslint --rule 'import/no-cycle: error' packages/cli/src/ui/components/shared/

# Verify complexity limits
npx eslint --rule 'complexity: [error, 15]' packages/cli/src/ui/components/shared/buffer-*.ts packages/cli/src/ui/components/shared/word-navigation.ts packages/cli/src/ui/components/shared/transformations.ts packages/cli/src/ui/components/shared/visual-layout.ts

# Verify layer boundaries via ESLint (domain modules don't import React)
npx eslint packages/cli/src/ui/components/shared/buffer-*.ts packages/cli/src/ui/components/shared/word-navigation.ts packages/cli/src/ui/components/shared/transformations.ts packages/cli/src/ui/components/shared/visual-layout.ts

# Verify vim-buffer-actions doesn't import buffer-reducer (diagnostic only, ESLint is authoritative)
if grep -q "from './buffer-reducer'" packages/cli/src/ui/components/shared/vim-buffer-actions.ts; then
  echo "WARNING: buffer-reducer import found in vim-buffer-actions.ts"
fi

# Verify domain modules don't import text-buffer (diagnostic only, ESLint is authoritative)
if grep -l "from './text-buffer'" packages/cli/src/ui/components/shared/buffer-*.ts packages/cli/src/ui/components/shared/word-navigation.ts packages/cli/src/ui/components/shared/transformations.ts packages/cli/src/ui/components/shared/visual-layout.ts 2>/dev/null; then
  echo "WARNING: text-buffer import found in domain modules"
fi
```

---

## Phase 0: Baseline & Test Infrastructure

### 0.1 Baseline Snapshots (MANDATORY)

Before any code changes:

```bash
# Coverage baseline
npm run test:coverage -- --reporter=json --outputFile=project-plans/issue1577/baseline-coverage.json

# Test count baseline
npm run test -- --reporter=json --outputFile=project-plans/issue1577/baseline-test-results.json

# File size baseline
wc -l packages/cli/src/ui/components/shared/text-buffer.ts packages/cli/src/ui/components/shared/text-buffer.test.ts packages/cli/src/ui/components/shared/vim-buffer-actions.ts packages/cli/src/ui/components/shared/vim-buffer-actions.test.ts > project-plans/issue1577/baseline-file-sizes.txt
```

### 0.2 Test Coverage Gap Analysis

**Files to Analyze**:
- `text-buffer.test.ts` (2,341 lines)
- `vim-buffer-actions.test.ts`
- `InputPrompt.test.tsx`
- `vim.test.ts`
- Completion hook tests

**Deliverables**:
1. Map existing test coverage to proposed modules
2. Identify test gaps per module responsibility
3. Document dependency injection points needed for testability

### 0.3 HARD GATE: Test-First Checkpoint

**NO CODE MAY BE MOVED UNTIL**:

- [ ] All Phase 1 and Phase 2 test files are created
- [ ] All new test files pass (testing current implementation)
- [ ] Baseline coverage captured
- [ ] ESLint config updated and passing
- [ ] Import boundary checks passing
- [ ] **Golden snapshot baseline captured** (see below)

**Verification Command**:
```bash
npm run test -- buffer-types.test.ts word-navigation.test.ts buffer-operations.test.ts transformations.test.ts visual-layout.test.ts buffer-reducer.test.ts position-roundtrip.test.ts reducer-invariants.test.ts vim-consistency.test.ts
```

### 0.4 Golden Snapshot Baseline Artifact

**Purpose**: Ensure behavioral parity between old and new implementations.

**Corpus Definition** (committed to repo):
```json
// project-plans/issue1577/action-corpus.json
{
  "version": 1,
  "sequences": [
    ["insert:hello", "move:end", "insert:
world"],
    ["insert:test", "backspace", "backspace"],
    ["move:wordRight", "delete_word_left"],
    ["vim_insert_at_cursor", "insert:abc", "vim_escape_insert_mode"],
    // ... 100+ sequences covering all action types
  ]
}
```

**Create Baseline**:
```bash
# Run action corpus against current implementation
npm run test -- --testNamePattern="action corpus baseline"
# Generates: project-plans/issue1577/golden-snapshot-baseline.json
# This file is committed to repo and becomes the oracle
```

**Baseline Contents**:
- State snapshots after each action in corpus
- Lines, cursor position, undo/redo stack depth, visual layout
- Deterministic (seeded RNG if any randomness)

**Parity Verification**:
After each module extraction, run:
```bash
npm run test -- --testNamePattern="golden parity"
# Must match golden-snapshot-baseline.json exactly
```

**CI Requirement**: Golden parity tests must pass before PR merge.

**If any test fails, extraction is blocked.**

---

## Phase 1: Behavioral Parity / Golden Tests

### 1.1 Round-Trip Property Tests

**File**: `packages/cli/src/ui/components/shared/__tests__/position-roundtrip.test.ts`

```typescript
// Test: logicalPosToOffset(offsetToLogicalPos(text, offset)) === offset
// For all valid offsets in test corpus
describe('position conversion round-trip', () => {
  const testCases = [
    '',                                    // empty
    'hello',                               // single line
    'hello\nworld',                        // multi-line
    'emoji\n测试',                       // unicode
    'a'.repeat(10000),                     // long line
    '\n\n\n',                              // empty lines
  ];
  
  testCases.forEach(text => {
    it(`round-trips for "${text.slice(0, 20)}..."`, () => {
      for (let offset = 0; offset <= text.length; offset++) {
        const [row, col] = offsetToLogicalPos(text, offset);
        const reconstructed = logicalPosToOffset(text.split('\n'), row, col);
        expect(reconstructed).toBe(offset);
      }
    });
  });
});
```

### 1.2 Reducer Invariant Harness

**File**: `packages/cli/src/ui/components/shared/__tests__/reducer-invariants.test.ts`

```typescript
// Run after EVERY action type to verify state validity
function assertStateInvariants(state: TextBufferState): void {
  // Cursor in bounds
  expect(state.cursorRow).toBeGreaterThanOrEqual(0);
  expect(state.cursorRow).toBeLessThan(state.lines.length);
  expect(state.cursorCol).toBeGreaterThanOrEqual(0);
  expect(state.cursorCol).toBeLessThanOrEqual(cpLen(state.lines[state.cursorRow] ?? ''));
  
  // Lines never empty-invalid (always at least [''])
  expect(state.lines.length).toBeGreaterThan(0);
  
  // Undo stack constraints
  expect(state.undoStack.length).toBeLessThanOrEqual(historyLimit);
  
  // Layout alignment
  expect(state.visualLayout.visualLines.length).toBeGreaterThan(0);
  expect(state.transformationsByLine.length).toBe(state.lines.length);
}

// Apply to all action types in test suite
```

### 1.3 State Snapshot Tests

**File**: `packages/cli/src/ui/components/shared/__tests__/action-corpus.test.ts`

```typescript
// Corpus of action sequences for behavioral parity
const actionSequences = [
  ['insert:a', 'insert:b', 'insert:\n', 'insert:c'],
  ['move:right', 'move:right', 'delete_word_left'],
  ['insert:hello', 'set_cursor:0,5', 'kill_line_right'],
  // Vim sequences
  ['vim_insert_at_cursor', 'insert:test', 'vim_escape_insert_mode'],
  ['vim_delete_word_forward:1'],
  ['vim_move_word_forward:3'],
];

// Generate state snapshots after each sequence
// Compare before/after refactor for parity
```

### 1.4 Vim/Non-Vim Semantic Consistency Tests

**File**: `packages/cli/src/ui/components/shared/__tests__/vim-consistency.test.ts`

```typescript
// Equivalent operations must produce equivalent states
describe('vim/non-vim semantic consistency', () => {
  it('vim_delete_word_forward matches delete_word_right at word boundary', () => {
    const state1 = applyActions(initialState, ['move:wordRight', 'delete_word_left']);
    const state2 = applyActions(initialState, ['vim_delete_word_forward:1']);
    expect(state1.lines).toEqual(state2.lines);
    expect(state1.cursorRow).toBe(state2.cursorRow);
    expect(state1.cursorCol).toBe(state2.cursorCol);
  });
  
  // Additional pairs...
});
```

---

## Phase 2: Module Test Specifications

### 2.1 buffer-types.ts Tests

**File**: `buffer-types.test.ts`

Minimal runtime tests (mostly compile-time):
- `historyLimit` constant value
- `Direction` type exhaustiveness (via switch test)
- `TextBufferAction` discriminated union narrowing

### 2.2 word-navigation.ts Tests

**File**: `word-navigation.test.ts`

**Edge-Case Matrix**:

| Category | Test Cases |
|----------|------------|
| ASCII | `hello world`, `foo_bar`, `test123` |
| Combining marks | `cafe\u0301` (e + combining acute), `na\u00EFve` (i with diaeresis) |
| Script boundaries | `hello\u4E16\u754C` (Latin+Han), `\u0645\u0631\u062D\u0628\u0627world` (Arabic+Latin) |
| ZWJ emoji | `\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}` (family), `\u{1F3F3}\uFE0F\u200D\u{1F308}` (rainbow flag) |
| Astral plane | `\u{1F600}` (emoji), `\u{10348}` (Gothic letter) at boundaries |
| Empty/whitespace | empty string, spaces, `\t\n` |
| Mixed | `test123-456.789_abc` |

**Function Coverage**:
- `isWordCharStrict` - all Unicode categories
- `isWhitespace` - all whitespace code points
- `isCombiningMark` - diacritics, variation selectors
- `getCharScript` - all supported scripts
- `isDifferentScript` - boundary detection
- `findNextWordStartInLine` / `findPrevWordStartInLine` - all edge cases
- `findWordEndInLine` - end detection
- `findNextWordAcrossLines` / `findPrevWordAcrossLines` - cross-line navigation

### 2.3 buffer-operations.ts Tests

**File**: `buffer-operations.test.ts`

**Edge-Case Matrix**:

| Operation | Edge Cases |
|-----------|------------|
| `replaceRangeInternal` | Empty replacement, multi-line replacement, pasting with newlines, replacing entire buffer, zero-width replacement |
| `pushUndo` | History limit enforcement, multiple rapid pushes |
| `getPositionFromOffsets` | Offset 0, offset at newlines, offset past end, empty buffer |
| `offsetToLogicalPos` / `logicalPosToOffset` | Round-trip for all test corpus |
| `calculateInitialCursorPosition` | Offset 0, offset at end, empty lines |

### 2.4 transformations.ts Tests

**File**: `transformations.test.ts`

**Edge-Case Matrix**:

| Scenario | Test Cases |
|----------|------------|
| Image path detection | `@path/image.png`, `@escaped\ space.jpg`, `@@double` |
| Path truncation | Long names > 10 chars, short names, no extension |
| Transformation state | Expanded (cursor inside), collapsed (cursor outside) |
| Multi-transform | Multiple images on one line |
| Cursor boundaries | Cursor at logStart, logEnd, inside, outside |
| Empty | Line with no images, empty line |

### 2.5 visual-layout.ts Tests

**File**: `visual-layout.test.ts`

**Edge-Case Matrix**:

| Scenario | Test Cases |
|----------|------------|
| Viewport width | 0, 1, 2, 10, 80, 200 |
| Word wrapping | Exact fit, break at space, break mid-word (no space), CJK characters |
| Empty lines | Single empty, multiple empties |
| Long lines | 10K chars, all spaces, no spaces |
| Transformations | Expanded path longer than viewport, cursor movement across transform boundary |
| Wide chars | East Asian width 2 chars, emoji |
| Round-trip | Logical->visual->logical coordinate mapping |

### 2.6 buffer-reducer.ts Tests

**File**: `buffer-reducer.test.ts`

**Action Coverage**:

| Action | Test Cases |
|--------|------------|
| `set_text` | Empty, single line, multi-line, with/without pushToUndo |
| `insert` | Single char, multi-char, newline, filtered, singleLine mode |
| `backspace` | At start, mid-line, joining lines, at [0,0] |
| `delete` | At end, mid-line, joining lines, at last position |
| `move` | All 8 directions, at boundaries, preferredCol preservation |
| `delete_word_left/right` | At word boundary, mid-word, across lines |
| `kill_line_right/left` | Mid-line, at boundary, empty line |
| `undo/redo` | Empty stack, single, multiple, interleaved with edits |
| `replace_range` | Same line, multi-line, empty replacement |
| `set_viewport` | Resize, no change |

**CRLF Handling Tests**:
- Input with `\r\n` normalized to `\n`
- Input with `\r` normalized to `\n`
- Mixed line endings

**Reducer Invariant Tests**:
- After EVERY action: run `assertStateInvariants(state)`
- Coverage for all 30+ action types

### 2.7 Unicode Normalization Policy

**Policy**: Preserve input as-is. Do NOT normalize to NFC or NFD.

**Rationale**: User input should be preserved exactly. Normalization can change byte sequences that users may depend on.

**Test Fixtures**: Use explicit escaped literals or codepoint notation to avoid ambiguity:

```typescript
// Explicit codepoint notation for ZWJ emoji
const familyEmoji = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';

// Explicit codepoint for combining marks
const cafeWithCombining = 'cafe\u0301'; // e + combining acute

// Explicit codepoint for precomposed
const cafePrecomposed = 'caf\u00E9'; // é precomposed

// Surrogate pairs (astral plane characters)
const gothicLetter = '\u{10348}'; // Valid Unicode scalar: Gothic letter Hwair
const emojiAstral = '\u{1F600}'; // Valid Unicode scalar: grinning face
```

**CRLF Normalization Tests** (buffer-operations level):
- `offsetToLogicalPos` with `
` input
- `replaceRangeInternal` with mixed line endings
- All operations must handle CRLF consistently with reducer

---

## Phase 3: Implementation (AFTER All Tests Pass)

### Reducer Pipeline Contract

Every action handler MUST follow this pipeline:

```
1. Normalize Action Input
   - Apply inputFilter if present
   - Normalize CRLF to LF for insertions
   - Validate input (throw if invalid)

2. Push Undo Snapshot (if required)
   - Call pushUndo BEFORE mutation
   - Exceptions: set_text with pushToUndo:false, internal movements

3. Apply Pure State Transition
   - Immutable update only
   - NO side effects (no logging, no I/O)
   - Return new state object

4. Clamp Cursor Position
   - Ensure cursorRow in [0, lines.length-1]
   - Ensure cursorCol in [0, lineLength]

5. Recompute Transformations and Layout (if needed)
   - If lines changed: recalculate transformations
   - If viewport or lines changed: recalculate layout
   - Do this EXACTLY ONCE per action

6. Return Final State
```

### Undo Policy by Action Type

| Action | Pushes Undo | Notes |
|--------|-------------|-------|
| `set_text` | Yes (configurable) | pushToUndo:false for external editor sync |
| `insert` | Yes | Always undoable |
| `backspace` | Yes | Always undoable |
| `delete` | Yes | Always undoable |
| `move` | No | Cursor movement only |
| `set_cursor` | No | Direct positioning |
| `delete_word_left/right` | Yes | Word deletion |
| `kill_line_right/left` | Yes | Line deletion |
| `undo` | No | Moves state between stacks |
| `redo` | No | Moves state between stacks |
| `replace_range` | Yes | Range replacement |
| `move_to_offset` | No | Cursor movement |
| `create_undo_snapshot` | Yes | Explicit snapshot |
| `set_viewport` | No | Viewport resize |
| Vim actions | Most yes | See vim-buffer-actions for specifics |

### Error Handling Policy (Deterministic)

| Failure Class | Policy | Behavior |
|---------------|--------|----------|
| Invalid action shape (programmer error) | Throw always | `if (!action.type) throw new Error('Invalid action')` |
| Out-of-range cursor inputs | Clamp always | `cursorRow = clamp(cursorRow, 0, lines.length - 1)` |
| Invariant violation (data corruption) | Throw always | `if (lines.length === 0) throw new Error('Invariant: lines empty')` |
| Unsafe text input | Sanitize always | `text = stripUnsafeCharacters(text)` |
| Negative viewport | Clamp to 0 | `viewportWidth = Math.max(0, width)` |

**No Environment-Dependent Behavior**: Reducer behaves identically in test, dev, and production. No `NODE_ENV` checks.

**Logging**: `debugLogger` calls allowed in reducer for diagnostic purposes but must not affect state or behavior.

### Immutable Update Discipline

**Required Pattern**:
```typescript
// CORRECT: Immutable update
const newLines = [...state.lines];
newLines[row] = modifiedLine;
return { ...state, lines: newLines };

// WRONG: Mutates existing state
state.lines[row] = modifiedLine;
return state;
```

**Structural Sharing**: Allow structural sharing for performance (e.g., unchanged lines reference same array).

### 3.1 Create buffer-types.ts

**Location**: `packages/cli/src/ui/components/shared/buffer-types.ts`

**Exports**:
```typescript
// Types
export type Direction = 'left' | 'right' | 'up' | 'down' | 'wordLeft' | 'wordRight' | 'home' | 'end';
export interface Viewport { height: number; width: number; }
export interface Transformation { logStart: number; logEnd: number; logicalText: string; collapsedText: string; }
export interface VisualLayout { visualLines: string[]; logicalToVisualMap: Array<Array<[number, number]>>; visualToLogicalMap: Array<[number, number]>; transformedToLogicalMaps: number[][]; visualToTransformedMap: number[]; }
export interface UndoHistoryEntry { lines: string[]; cursorRow: number; cursorCol: number; }
export interface TextBufferState { lines: string[]; cursorRow: number; cursorCol: number; transformationsByLine: Transformation[][]; preferredCol: number | null; undoStack: UndoHistoryEntry[]; redoStack: UndoHistoryEntry[]; clipboard: string | null; selectionAnchor: [number, number] | null; viewportWidth: number; viewportHeight: number; visualLayout: VisualLayout; }
export type TextBufferAction = /* discriminated union */
export interface TextBufferOptions { inputFilter?: (text: string) => string; singleLine?: boolean; }
export interface TextBuffer { /* interface only */ }

// Constants
export const historyLimit = 100;
```

**Size Target**: < 200 lines

### 3.2 Create word-navigation.ts

**Location**: `packages/cli/src/ui/components/shared/word-navigation.ts`

**Imports**: `cpLen` from textUtils.js only

**Exports**: All word navigation functions

**Refactoring for 80-line limit**:
```typescript
// Extract helper for findWordEndInLine
function scanToWordEnd(chars: string[], startIdx: number, currentScript: string): number
function isScriptBoundary(chars: string[], i: number, currentScript: string): boolean
```

**Size Target**: < 600 lines

### 3.3 Create buffer-operations.ts

**Location**: `packages/cli/src/ui/components/shared/buffer-operations.ts`

**Imports**:
- Types from `buffer-types.ts`
- `cpLen`, `cpSlice`, `stripUnsafeCharacters` from textUtils.js

**Exports**: All buffer operation functions

**Size Target**: < 400 lines

### 3.4 Create transformations.ts

**Location**: `packages/cli/src/ui/components/shared/transformations.ts`

**Imports**:
- Types from `buffer-types.ts`
- `unescapePath` from core
- `path` from node:path
- `cpLen`, `cpSlice` from textUtils.js

**Exports**: All transformation functions

**Size Target**: < 300 lines

### 3.5 Create visual-layout.ts

**Location**: `packages/cli/src/ui/components/shared/visual-layout.ts`

**Imports**:
- Types from `buffer-types.ts`
- Transformation functions from `transformations.ts`
- `toCodePoints`, `getCachedStringWidth` from textUtils.js

**Refactoring for 80-line limit**:
```typescript
// Break calculateLayout into:
function processLogicalLine(line: string, logIndex: number, ...): ProcessedLineResult
function buildVisualChunks(codePoints: string[], viewportWidth: number, ...): Chunk[]
function finalizeLayout(processedLines: ProcessedLineResult[]): VisualLayout

// Break calculateVisualCursorFromLayout into:
function findTargetSegment(segments: Array<[number, number]>, logicalCol: number): number
function mapToVisualCoordinates(...): [number, number]
```

**Size Target**: < 600 lines

### 3.6 Create buffer-reducer.ts

**Location**: `packages/cli/src/ui/components/shared/buffer-reducer.ts`

**Imports**:
- Types from `buffer-types.ts`
- Operations from `buffer-operations.ts`
- Word navigation from `word-navigation.ts`
- Layout functions from `visual-layout.ts`
- Transformation functions from `transformations.ts`
- `handleVimAction` from `vim-buffer-actions.ts`
- `stripUnsafeCharacters`, `cpLen`, `cpSlice` from textUtils.js
- `debugLogger` from core

**Refactoring for 80-line limit**:
```typescript
// Extract action handlers (private, not exported):
function handleSetText(state: TextBufferState, action: SetTextAction, options: TextBufferOptions): TextBufferState
function handleInsert(state: TextBufferState, action: InsertAction, options: TextBufferOptions): TextBufferState
function handleBackspace(state: TextBufferState): TextBufferState
function handleMove(state: TextBufferState, action: MoveAction): TextBufferState
function handleDelete(state: TextBufferState): TextBufferState
function handleDeleteWordLeft(state: TextBufferState): TextBufferState
function handleDeleteWordRight(state: TextBufferState): TextBufferState
function handleKillLineRight(state: TextBufferState): TextBufferState
function handleKillLineLeft(state: TextBufferState): TextBufferState
function handleUndo(state: TextBufferState): TextBufferState
function handleRedo(state: TextBufferState): TextBufferState
function handleReplaceRange(state: TextBufferState, action: ReplaceRangeAction): TextBufferState

// Shared helpers:
function withUndo(state: TextBufferState): TextBufferState
function clampCursor(state: TextBufferState): TextBufferState
function recomputeLayout(state: TextBufferState): TextBufferState
```

**Size Target**: < 700 lines

### 3.7 Update vim-buffer-actions.ts

**Location**: `packages/cli/src/ui/components/shared/vim-buffer-actions.ts`

**BEFORE (current)**:
```typescript
import {
  TextBufferState, TextBufferAction, getLineRangeOffsets, getPositionFromOffsets,
  replaceRangeInternal, pushUndo, isWordCharStrict, isWordCharWithCombining,
  isCombiningMark, findNextWordAcrossLines, findPrevWordAcrossLines, findWordEndInLine,
} from './text-buffer.js';
```

**AFTER (remediated)**:
```typescript
import type { TextBufferState, TextBufferAction } from './buffer-types.js';
import { getLineRangeOffsets, getPositionFromOffsets, replaceRangeInternal, pushUndo } from './buffer-operations.js';
import { isWordCharStrict, isWordCharWithCombining, isCombiningMark, findNextWordAcrossLines, findPrevWordAcrossLines, findWordEndInLine } from './word-navigation.js';
```

**Invariant**: vim-buffer-actions.ts has NO imports from text-buffer.ts or buffer-reducer.ts

### 3.8 Refactor text-buffer.ts to Minimal Composition Root

**Location**: `packages/cli/src/ui/components/shared/text-buffer.ts`

**Allowed Contents**:
```typescript
// React imports
import { useState, useCallback, useEffect, useMemo, useReducer } from 'react';

// Core module imports (for useTextBuffer only)
import { textBufferReducer } from './buffer-reducer.js';
import type { TextBufferState, TextBufferOptions } from './buffer-types.js';
// ... other imports for hook implementation

// Hook export (the ONLY runtime export)
export function useTextBuffer(props: UseTextBufferProps): TextBuffer {
  // Implementation
}

// Type-only re-exports (minimal public API)
export type { Direction, Viewport, Transformation, VisualLayout } from './buffer-types.js';
export type { TextBufferState, TextBufferAction, TextBufferOptions, TextBuffer } from './buffer-types.js';

// NO utility function exports
// NO re-export of word-navigation, buffer-operations, etc.
```

**Size Target**: < 700 lines (useTextBuffer is large due to React)

---

## Phase 4: Per-Extraction Verification (MANDATORY)

After EACH module extraction, run:

```bash
# 1. Module tests
npm run test -- buffer-types.test.ts
npm run test -- word-navigation.test.ts
npm run test -- buffer-operations.test.ts
npm run test -- transformations.test.ts
npm run test -- visual-layout.test.ts
npm run test -- buffer-reducer.test.ts

# 2. Integration tests
npm run test -- text-buffer.test.ts
npm run test -- vim-buffer-actions.test.ts

# 3. File size check
wc -l packages/cli/src/ui/components/shared/buffer-*.ts packages/cli/src/ui/components/shared/word-navigation.ts packages/cli/src/ui/components/shared/transformations.ts packages/cli/src/ui/components/shared/visual-layout.ts packages/cli/src/ui/components/shared/text-buffer.ts

# 4. Import boundary check
npx eslint --rule 'import/no-cycle: error' packages/cli/src/ui/components/shared/

# 5. Complexity check
npx eslint --rule 'complexity: [error, 15]' --rule 'max-lines-per-function: [error, 80]' packages/cli/src/ui/components/shared/buffer-*.ts packages/cli/src/ui/components/shared/word-navigation.ts packages/cli/src/ui/components/shared/transformations.ts packages/cli/src/ui/components/shared/visual-layout.ts

# 6. Type check
npm run typecheck
```

**If any check fails, extraction is incomplete. Fix before proceeding.**

---

## Phase 5: Staged Migration

### Migration Phases

#### Phase 5.1: Module Introduction (Within this Issue)
- Create all new modules
- Keep minimal type-only re-exports from text-buffer.ts for backward compatibility
- Update vim-buffer-actions.ts to use direct imports
- All internal tests pass

#### Phase 5.2: Internal Consumer Migration (Within this Issue)
Update all CLI internal imports:

**Files to Update**:
- `packages/cli/src/ui/components/InputPrompt.tsx` - type imports
- `packages/cli/src/ui/components/SettingsDialog.tsx` - type imports
- `packages/cli/src/ui/components/SubagentManagement/*.tsx` - type imports
- `packages/cli/src/ui/hooks/*.ts` - type imports and utilities
- `packages/cli/src/test-utils/customMatchers.ts` - type imports

**Migration Pattern**:
```typescript
// BEFORE
import { TextBuffer, offsetToLogicalPos } from './shared/text-buffer.js';

// AFTER (types only)
import type { TextBuffer } from './shared/buffer-types.js';
import { offsetToLogicalPos } from './shared/buffer-operations.js';
```

#### Phase 5.3: Lint Enforcement (Within this Issue)
Add ESLint warnings for remaining legacy imports:
```javascript
{
  files: ['packages/cli/src/**/*.ts', 'packages/cli/src/**/*.tsx'],
  rules: {
    'no-restricted-imports': ['warn', {
      paths: [
        {
          name: './shared/text-buffer.js',
          importNames: ['offsetToLogicalPos', 'logicalPosToOffset', 'textBufferReducer', 'pushUndo', 'replaceRangeInternal'],
          message: 'Import from buffer-operations.js or buffer-types.js directly'
        }
      ]
    }]
  }
}
```

#### Phase 5.4: Cleanup (Follow-up Issue)
After migration stabilizes:
- Remove unnecessary re-exports from text-buffer.ts
- Upgrade lint warnings to errors
- Document public API surface

### Phase Exit Criteria

| Phase | Exit Criteria | Verification |
|-------|---------------|--------------|
| 5.1 Complete | All modules created, tests pass, vim imports updated | `npm run test` passes |
| 5.2 Complete | Zero ESLint warnings for utility imports from text-buffer.js | `npm run lint` shows no text-buffer utility import warnings |
| 5.3 Complete | ESLint warnings active, no new legacy imports introduced | CI lint passes (warnings allowed, no errors) |
| 5.4 Complete | ESLint errors on legacy imports, only useTextBuffer + types exported | `npm run lint` errors on utility imports, manual review of re-exports |

**Completion Condition for Phase 5.2**: All utility imports migrated (Issue #1577 scope)
**Completion Condition for Phase 5.4**: Follow-up issue (#1580)

### Migration Verification

**Grep-based Completion Check**:
```bash
# Find remaining utility imports from text-buffer.js
# (should only show useTextBuffer imports after migration)
grep -r "from.*text-buffer" packages/cli/src --include="*.ts" --include="*.tsx" | grep -v "useTextBuffer"

# Should return empty after Phase 5.2 complete
```

### Per-Module Coverage Thresholds

| Module | Minimum Coverage | Enforcement |
|--------|------------------|-------------|
| buffer-types | N/A (types only) | Compile-time |
| word-navigation | 95% lines, 90% branches | Jest threshold |
| buffer-operations | 95% lines, 90% branches | Jest threshold |
| transformations | 90% lines, 85% branches | Jest threshold |
| visual-layout | 90% lines, 85% branches | Jest threshold |
| buffer-reducer | 90% lines, 85% branches | Jest threshold |
| vim-buffer-actions | 90% lines, 85% branches | Jest threshold |

**Jest Configuration** (add to the active Jest config, typically `packages/cli/jest.config.js`):
```javascript
coverageThreshold: {
  // Paths are relative to Jest rootDir (packages/cli)
  'src/ui/components/shared/word-navigation.ts': {
    branches: 90,
    functions: 95,
    lines: 95,
    statements: 95
  },
  'src/ui/components/shared/buffer-operations.ts': {
    branches: 90,
    functions: 95,
    lines: 95,
    statements: 95
  },
  'src/ui/components/shared/transformations.ts': {
    branches: 85,
    functions: 90,
    lines: 90,
    statements: 90
  },
  'src/ui/components/shared/visual-layout.ts': {
    branches: 85,
    functions: 90,
    lines: 90,
    statements: 90
  },
  'src/ui/components/shared/buffer-reducer.ts': {
    branches: 85,
    functions: 90,
    lines: 90,
    statements: 90
  },
  'src/ui/components/shared/vim-buffer-actions.ts': {
    branches: 85,
    functions: 90,
    lines: 90,
    statements: 90
  }
}
```

**Verification Steps**:
```bash
# 1. Confirm active Jest config
cat packages/cli/package.json | grep -A 5 '"jest"'
# or
cat packages/cli/jest.config.js | head -20

# 2. Run coverage with thresholds
npm run test:coverage
# If thresholds are wrong, Jest will report: "Coverage threshold for ... not met"

# 3. Verify thresholds are enforced (intentionally fail to test)
# Temporarily set a threshold to 100% and run - should fail
```

---

## Phase 6: Final Verification

### 6.1 Full Test Suite
```bash
npm run test
```

### 6.2 Coverage Comparison
```bash
npm run test:coverage
# Compare against baseline-coverage.json
# Coverage must not decrease
```

### 6.3 File Size Verification
```bash
wc -l packages/cli/src/ui/components/shared/*.ts
# All files must be < 800 lines
```

### 6.4 Function Size Verification
```bash
npx eslint --rule 'max-lines-per-function: [error, 80]' packages/cli/src/ui/components/shared/*.ts
```

### 6.5 Architecture Invariant Verification

**ESLint is the authoritative source of truth.** Grep checks below are diagnostic only.

```bash
# Primary: ESLint enforces all architectural rules
npm run lint

# Diagnostic: Check for React imports in domain modules (informational)
grep -r "from 'react'" packages/cli/src/ui/components/shared/buffer-*.ts packages/cli/src/ui/components/shared/word-navigation.ts packages/cli/src/ui/components/shared/transformations.ts packages/cli/src/ui/components/shared/visual-layout.ts || echo "No React imports found (good)"

# Diagnostic: Check for buffer-reducer imports in vim-buffer-actions (informational)
grep "from './buffer-reducer'" packages/cli/src/ui/components/shared/vim-buffer-actions.ts || echo "No buffer-reducer import found (good)"

# Diagnostic: Check for text-buffer imports in domain modules (informational)
grep -l "from './text-buffer'" packages/cli/src/ui/components/shared/buffer-*.ts packages/cli/src/ui/components/shared/word-navigation.ts packages/cli/src/ui/components/shared/transformations.ts packages/cli/src/ui/components/shared/visual-layout.ts 2>/dev/null || echo "No text-buffer imports found (good)"
```

### 6.6 Smoke Test
```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### 6.7 Full Verification Suite
```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
```

---

## Success Criteria

| Criterion | Target | Verification |
|-----------|--------|--------------|
| File size | < 800 lines | `wc -l` |
| Function size | < 80 lines | ESLint max-lines-per-function |
| Complexity | <= 15 | ESLint complexity |
| Test pass | 100% | `npm run test` |
| Coverage | No decrease | Compare to baseline |
| No cycles | 0 | ESLint import/no-cycle |
| Layering | Enforced | Custom grep checks |
| Smoke test | Pass | Manual verification |

---

## Module Dependency Graph (Final)

```
buffer-types.ts (layer 0: pure types)
    ↑
word-navigation.ts ────────────────────────┐
    ↑                                      │
buffer-operations.ts ──────────────────────┤
    ↑                                      │
transformations.ts ────────┐               │
    ↑                      │               │
visual-layout.ts ──────────┤               │
    ↑                      │               │
buffer-reducer.ts ←────────┴───────────────┴── vim-buffer-actions.ts
    ↑                                          (uses: buffer-operations,
    │                                           word-navigation,
text-buffer.ts                               buffer-types)
(layer 4: React hook)
(uses: buffer-reducer, buffer-types)
```

**No upward imports. No cross-domain imports. vim-buffer-actions does not import buffer-reducer.**

---

## Appendix: Code Section Mapping

| Current Lines | Content | Destination |
|---------------|---------|-------------|
| 32-41 | Direction type | buffer-types.ts |
| 43-409 | Word navigation | word-navigation.ts |
| 410-545 | Position/offset/operations | buffer-operations.ts |
| 547-550 | Viewport interface | buffer-types.ts |
| 686-845 | Transformations | transformations.ts |
| 847-1103 | VisualLayout, calculateLayout | visual-layout.ts |
| 1106-1214 | TextBufferState, history, actions | buffer-types.ts |
| 1216-1756 | textBufferReducerLogic | buffer-reducer.ts (extract handlers) |
| 1757-1806 | textBufferReducer | buffer-reducer.ts |
| 1809-2482 | useTextBuffer hook | text-buffer.ts (keep) |
| 2484-2735 | TextBuffer interface | buffer-types.ts |
