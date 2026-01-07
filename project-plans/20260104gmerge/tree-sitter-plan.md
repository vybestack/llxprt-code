# Tree-sitter WASM Shell Parser Implementation Plan

## Overview

This plan implements upstream commit `dcf362bc` - "Inline tree-sitter wasm and add runtime fallback (#11157)" with LLxprt-specific adaptations.

**Goal**: Add tree-sitter-based shell command parsing to replace regex-based parsing, with automatic fallback to regex when tree-sitter fails to initialize.

## Why Tree-sitter?

Tree-sitter provides 100% syntactically-accurate shell command parsing vs regex (~95%). This matters for:
- Security: Accurate command substitution detection (`$()`, backticks, `<()`)
- Permission checks: Extracting command roots from complex pipelines
- Chained command splitting: Proper handling of `&&`, `||`, `;`, `|`

## Current State Assessment

### Already Have
- `packages/core/src/utils/__fixtures__/dummy.wasm` - Test fixture exists
- `packages/core/src/utils/fileUtils.ts` - Has `readWasmBinaryFromDisk()` function  
- `.wasm` in `BINARY_EXTENSIONS` ignore list
- Regex-based parsing in `shell-utils.ts` (will become fallback)

### Need to Add
1. **Dependencies** (packages/core/package.json):
   - `web-tree-sitter: ^0.25.10`
   - `tree-sitter-bash: ^0.25.0`

2. **Build Configuration** (esbuild.config.js):
   - `esbuild-plugin-wasm` dependency (root package.json)
   - WASM loader plugin configuration

3. **Shell Parser Module** (packages/core/src/utils/shell-parser.ts):
   - Tree-sitter initialization with WASM
   - Parser wrapper with fallback to regex

4. **Updated shell-utils.ts**:
   - Use tree-sitter parser when available
   - Graceful fallback to existing regex functions

## Implementation Steps

### Step 1: Add Dependencies

**File: `packages/core/package.json`**
Add to `dependencies`:
```json
"tree-sitter-bash": "^0.25.0",
"web-tree-sitter": "^0.25.10"
```

**File: `package.json` (root)**
Add to `devDependencies`:
```json
"esbuild-plugin-wasm": "^1.1.0"
```

Run `npm install` after changes.

### Step 2: Update esbuild.config.js

Add WASM plugin support. Insert after the imports at top of file:

```javascript
import { wasmLoader } from 'esbuild-plugin-wasm';

function createWasmPlugins() {
  const wasmBinaryPlugin = {
    name: 'wasm-binary',
    setup(build) {
      build.onResolve({ filter: /\.wasm\?binary$/ }, (args) => {
        const specifier = args.path.replace(/\?binary$/, '');
        const resolveDir = args.resolveDir || '';
        const isBareSpecifier =
          !path.isAbsolute(specifier) &&
          !specifier.startsWith('./') &&
          !specifier.startsWith('../');

        let resolvedPath;
        if (isBareSpecifier) {
          resolvedPath = require.resolve(specifier, {
            paths: resolveDir ? [resolveDir, __dirname] : [__dirname],
          });
        } else {
          resolvedPath = path.isAbsolute(specifier)
            ? specifier
            : path.join(resolveDir, specifier);
        }

        return { path: resolvedPath, namespace: 'wasm-embedded' };
      });
    },
  };

  return [wasmBinaryPlugin, wasmLoader({ mode: 'embedded' })];
}
```

Add `...createWasmPlugins()` to the `plugins` array in both `cliConfig` and `a2aServerConfig`.

### Step 3: Create Shell Parser Module

**File: `packages/core/src/utils/shell-parser.ts`**

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Parser from 'web-tree-sitter';

// Type definitions for tree-sitter query results
interface QueryMatch {
  captures: Array<{
    name: string;
    node: Parser.SyntaxNode;
  }>;
}

let parser: Parser | null = null;
let bashLanguage: Parser.Language | null = null;
let initializationAttempted = false;
let initializationError: Error | null = null;

/**
 * Initialize the tree-sitter parser with bash language support.
 * Returns true if initialization succeeded, false otherwise.
 * Safe to call multiple times - will return cached result.
 */
export async function initializeParser(): Promise<boolean> {
  if (parser && bashLanguage) {
    return true;
  }

  if (initializationAttempted) {
    return parser !== null;
  }

  initializationAttempted = true;

  try {
    await Parser.init();
    parser = new Parser();

    // Load the bash language WASM
    // The ?binary suffix triggers our esbuild plugin to embed the wasm
    const wasmPath = await import('tree-sitter-bash/tree-sitter-bash.wasm?binary');
    bashLanguage = await Parser.Language.load(wasmPath.default);
    parser.setLanguage(bashLanguage);

    return true;
  } catch (error) {
    initializationError = error instanceof Error ? error : new Error(String(error));
    console.warn('Tree-sitter initialization failed, falling back to regex parsing:', initializationError.message);
    parser = null;
    bashLanguage = null;
    return false;
  }
}

/**
 * Check if the tree-sitter parser is available.
 */
export function isParserAvailable(): boolean {
  return parser !== null && bashLanguage !== null;
}

/**
 * Get the initialization error if parser failed to initialize.
 */
export function getInitializationError(): Error | null {
  return initializationError;
}

/**
 * Parse a shell command string and return the syntax tree.
 * Returns null if parser is not available.
 */
export function parseShellCommand(command: string): Parser.Tree | null {
  if (!parser) {
    return null;
  }
  return parser.parse(command);
}

/**
 * Extract all command names from a parsed shell command tree.
 * This handles pipelines, command lists (&&, ||, ;), and subshells.
 */
export function extractCommandNames(tree: Parser.Tree): string[] {
  if (!bashLanguage) {
    return [];
  }

  const commands: string[] = [];
  
  // Query for command_name nodes which are the actual command being executed
  const query = bashLanguage.query('(command name: (command_name) @cmd)');
  const matches = query.matches(tree.rootNode) as QueryMatch[];

  for (const match of matches) {
    for (const capture of match.captures) {
      if (capture.name === 'cmd') {
        const cmdText = capture.node.text;
        // Extract just the command name (last path component if it's a path)
        const cmdName = cmdText.split(/[\\/]/).pop();
        if (cmdName) {
          commands.push(cmdName);
        }
      }
    }
  }

  return commands;
}

/**
 * Check if a command contains command substitution patterns.
 * Uses tree-sitter AST to accurately detect:
 * - $() command substitution
 * - `` backtick substitution
 * - <() process substitution
 */
export function hasCommandSubstitution(tree: Parser.Tree): boolean {
  if (!bashLanguage) {
    return false;
  }

  // Query for command_substitution and process_substitution nodes
  const query = bashLanguage.query(`
    [
      (command_substitution) @sub
      (process_substitution) @proc
    ]
  `);
  
  const matches = query.matches(tree.rootNode) as QueryMatch[];
  return matches.length > 0;
}

/**
 * Split a command string into individual commands respecting shell syntax.
 * Handles &&, ||, ;, |, and properly ignores these inside quotes.
 */
export function splitCommandsWithTree(tree: Parser.Tree): string[] {
  const commands: string[] = [];
  
  function extractCommands(node: Parser.SyntaxNode): void {
    switch (node.type) {
      case 'command':
      case 'subshell':
        commands.push(node.text);
        break;
      case 'pipeline':
      case 'list':
        // Recurse into children
        for (const child of node.children) {
          extractCommands(child);
        }
        break;
      case 'program':
        for (const child of node.children) {
          extractCommands(child);
        }
        break;
      default:
        // For other node types, check children
        for (const child of node.children) {
          extractCommands(child);
        }
    }
  }

  extractCommands(tree.rootNode);
  return commands.filter(cmd => cmd.trim().length > 0);
}

/**
 * Reset the parser state (primarily for testing).
 */
export function resetParser(): void {
  parser = null;
  bashLanguage = null;
  initializationAttempted = false;
  initializationError = null;
}
```

### Step 4: Update shell-utils.ts

Modify the existing functions to use tree-sitter when available, falling back to regex.

**Add imports at top:**
```typescript
import {
  initializeParser,
  isParserAvailable,
  parseShellCommand,
  extractCommandNames,
  hasCommandSubstitution as treeSitterHasCommandSubstitution,
  splitCommandsWithTree,
} from './shell-parser.js';
```

**Update `splitCommands` function:**
```typescript
export function splitCommands(command: string): string[] {
  // Try tree-sitter first
  if (isParserAvailable()) {
    const tree = parseShellCommand(command);
    if (tree) {
      const result = splitCommandsWithTree(tree);
      if (result.length > 0) {
        return result;
      }
    }
  }

  // Fall back to regex-based parsing
  // ... existing regex implementation ...
}
```

**Update `getCommandRoot` and `getCommandRoots`:**
```typescript
export function getCommandRoots(command: string): string[] {
  if (!command) {
    return [];
  }

  // Try tree-sitter first
  if (isParserAvailable()) {
    const tree = parseShellCommand(command);
    if (tree) {
      const result = extractCommandNames(tree);
      if (result.length > 0) {
        return result;
      }
    }
  }

  // Fall back to regex-based parsing
  return splitCommands(command)
    .map((c) => getCommandRoot(c))
    .filter((c): c is string => !!c);
}
```

**Update `detectCommandSubstitution`:**
```typescript
export function detectCommandSubstitution(command: string): boolean {
  // Try tree-sitter first
  if (isParserAvailable()) {
    const tree = parseShellCommand(command);
    if (tree) {
      return treeSitterHasCommandSubstitution(tree);
    }
  }

  // Fall back to regex-based detection
  // ... existing regex implementation ...
}
```

### Step 5: Add Initialization Hook

**File: `packages/core/src/tools/shell.ts`**

Add initialization at module load or lazy initialization on first use:

```typescript
import { initializeParser } from '../utils/shell-parser.js';

// Initialize tree-sitter parser (async, non-blocking)
// Failures are handled gracefully with fallback to regex
initializeParser().catch(() => {
  // Initialization errors are already logged in shell-parser.ts
});
```

### Step 6: Add/Update Tests

**File: `packages/core/src/utils/shell-parser.test.ts`** (new file)

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  initializeParser,
  isParserAvailable,
  parseShellCommand,
  extractCommandNames,
  hasCommandSubstitution,
  splitCommandsWithTree,
  resetParser,
} from './shell-parser.js';

describe('shell-parser', () => {
  beforeAll(async () => {
    await initializeParser();
  });

  afterEach(() => {
    // Don't reset between tests - initialization is expensive
  });

  describe('initializeParser', () => {
    it('should initialize successfully', async () => {
      const result = await initializeParser();
      expect(result).toBe(true);
      expect(isParserAvailable()).toBe(true);
    });
  });

  describe('extractCommandNames', () => {
    it('should extract simple command', () => {
      const tree = parseShellCommand('ls -la');
      expect(tree).not.toBeNull();
      const names = extractCommandNames(tree!);
      expect(names).toContain('ls');
    });

    it('should extract commands from pipeline', () => {
      const tree = parseShellCommand('cat file.txt | grep pattern | wc -l');
      expect(tree).not.toBeNull();
      const names = extractCommandNames(tree!);
      expect(names).toEqual(['cat', 'grep', 'wc']);
    });

    it('should extract commands from && chain', () => {
      const tree = parseShellCommand('npm install && npm test && npm build');
      expect(tree).not.toBeNull();
      const names = extractCommandNames(tree!);
      expect(names).toEqual(['npm', 'npm', 'npm']);
    });
  });

  describe('hasCommandSubstitution', () => {
    it('should detect $() substitution', () => {
      const tree = parseShellCommand('echo $(whoami)');
      expect(tree).not.toBeNull();
      expect(hasCommandSubstitution(tree!)).toBe(true);
    });

    it('should detect backtick substitution', () => {
      const tree = parseShellCommand('echo `date`');
      expect(tree).not.toBeNull();
      expect(hasCommandSubstitution(tree!)).toBe(true);
    });

    it('should detect process substitution', () => {
      const tree = parseShellCommand('diff <(ls dir1) <(ls dir2)');
      expect(tree).not.toBeNull();
      expect(hasCommandSubstitution(tree!)).toBe(true);
    });

    it('should not detect substitution in quotes when escaped', () => {
      const tree = parseShellCommand("echo 'hello $(world)'");
      expect(tree).not.toBeNull();
      // Single quotes prevent substitution in bash
      expect(hasCommandSubstitution(tree!)).toBe(false);
    });

    it('should return false for simple commands', () => {
      const tree = parseShellCommand('ls -la /tmp');
      expect(tree).not.toBeNull();
      expect(hasCommandSubstitution(tree!)).toBe(false);
    });
  });

  describe('splitCommandsWithTree', () => {
    it('should split && commands', () => {
      const tree = parseShellCommand('cd /tmp && ls');
      expect(tree).not.toBeNull();
      const commands = splitCommandsWithTree(tree!);
      expect(commands.length).toBe(2);
    });

    it('should split || commands', () => {
      const tree = parseShellCommand('test -f file || touch file');
      expect(tree).not.toBeNull();
      const commands = splitCommandsWithTree(tree!);
      expect(commands.length).toBe(2);
    });

    it('should handle semicolon separation', () => {
      const tree = parseShellCommand('echo a; echo b; echo c');
      expect(tree).not.toBeNull();
      const commands = splitCommandsWithTree(tree!);
      expect(commands.length).toBe(3);
    });
  });
});
```

**Update: `packages/core/src/utils/shell-utils.test.ts`**

Add tests that verify fallback behavior and tree-sitter integration.

### Step 7: Update TypeScript Configuration

**File: `packages/core/tsconfig.json`**

Ensure WASM imports are handled:
```json
{
  "compilerOptions": {
    // ... existing options ...
    "moduleResolution": "bundler",  // or "node16" with proper type definitions
  }
}
```

You may need to add a type declaration for the `.wasm?binary` imports:

**File: `packages/core/src/types/wasm.d.ts`** (new file)
```typescript
declare module '*.wasm?binary' {
  const content: Uint8Array;
  export default content;
}

declare module 'tree-sitter-bash/tree-sitter-bash.wasm?binary' {
  const content: Uint8Array;
  export default content;
}
```

## Verification Steps

After implementation, run:

```bash
# Quick verify
npm run lint
npm run typecheck

# Full verify
npm run test
npm run build
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

## Commit Message

```
feat(core): add tree-sitter WASM shell parser with regex fallback

Implements upstream dcf362bc with LLxprt adaptations.

- Add web-tree-sitter and tree-sitter-bash dependencies
- Add esbuild-plugin-wasm for WASM bundling
- Create shell-parser.ts with tree-sitter wrapper
- Update shell-utils.ts to use tree-sitter with regex fallback
- Add comprehensive tests for tree-sitter parsing

Tree-sitter provides 100% accurate shell syntax parsing for:
- Command substitution detection ($(), ``, <())
- Pipeline and command list splitting
- Command name extraction from complex commands

Falls back to regex parsing if tree-sitter fails to initialize.
```

## Files Modified/Created Summary

| File | Action |
|------|--------|
| `package.json` | Add `esbuild-plugin-wasm` devDependency |
| `packages/core/package.json` | Add `web-tree-sitter`, `tree-sitter-bash` |
| `esbuild.config.js` | Add WASM plugin configuration |
| `packages/core/src/utils/shell-parser.ts` | **NEW** - Tree-sitter wrapper |
| `packages/core/src/utils/shell-parser.test.ts` | **NEW** - Tests |
| `packages/core/src/utils/shell-utils.ts` | Update to use tree-sitter |
| `packages/core/src/utils/shell-utils.test.ts` | Add integration tests |
| `packages/core/src/tools/shell.ts` | Add parser initialization |
| `packages/core/src/types/wasm.d.ts` | **NEW** - TypeScript declarations |
| `packages/core/tsconfig.json` | Update if needed |

## Rollback Plan

If issues arise:
1. Remove tree-sitter imports from shell-utils.ts
2. Delete shell-parser.ts
3. Remove WASM plugin from esbuild.config.js
4. Remove dependencies from package.json files
5. Run `npm install` to clean up

The regex fallback ensures the system continues to work even if tree-sitter has issues.
