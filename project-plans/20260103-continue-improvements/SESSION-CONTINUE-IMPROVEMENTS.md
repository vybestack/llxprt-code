# Session Continue (`--continue`) Feature Improvements

**Date:** 2026-01-03
**Feature:** `--continue` flag for session resumption
**Commit:** e19cfa22c
**Status:** Review and improvement recommendations

---

## Table of Contents

1. [Issue #2: Memory Leak from SessionPersistenceService Recreation](#issue-2-memory-leak-from-sessionpersistenceservice-recreation)
2. [Issue #4: Weak Type Safety for uiHistory](#issue-4-weak-type-safety-for-uihistory)
3. [Issue #6: Silent Failure on Corrupted History Restore](#issue-6-silent-failure-on-corrupted-history-restore)
4. [Issue #7: No Validation of HistoryItem Schema](#issue-7-no-validation-of-historyitem-schema)
5. [Issue #8: Synchronous fs.existsSync in Async Context](#issue-8-synchronous-fsexistssync-in-async-context)
6. [Issue #10: --continue + --prompt Interaction Undefined](#issue-10---continue----prompt-interaction-undefined)
7. [Issue #11: No Test Coverage](#issue-11-no-test-coverage)

---

## Issue #2: Memory Leak from SessionPersistenceService Recreation

### Location
`packages/cli/src/ui/AppContainer.tsx:1651-1654`

### Current Implementation

```typescript
const sessionPersistence = useMemo(
  () => new SessionPersistenceService(config.storage, config.getSessionId()),
  [config],
);
```

### Problem Analysis

The `SessionPersistenceService` constructor generates a **timestamp-based filename** on instantiation:

```typescript
// From SessionPersistenceService.ts:62-67
constructor(storage: Storage, sessionId: string) {
  // ...
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  this.sessionFilePath = path.join(
    this.chatsDir,
    `${PERSISTED_SESSION_PREFIX}${timestamp}.json`,
  );
}
```

**The dependency array `[config]` is problematic because:**

1. **`config` is an object reference** - React's shallow comparison means ANY property change on `config` triggers recreation
2. The `Config` class has many mutable properties (model, provider, settings, etc.) that change during runtime
3. Each recreation generates a **new timestamp** → **new file path**
4. Previous session files are orphaned (never deleted, never updated)

### Consequences

1. **Disk bloat**: Multiple session files created per session (one per config change)
2. **Data loss**: If config changes mid-session, saves go to new file; `--continue` loads the wrong (older) file
3. **Memory churn**: New `SessionPersistenceService` instances created unnecessarily

### Root Cause

The `useMemo` dependency should be the **stable identifiers** needed for the service, not the entire config object:

- `config.storage` (the Storage instance)
- `config.getSessionId()` (the session ID string)

These rarely change during a session, unlike the `config` object reference.

### Proposed Fix

**Option A: Stable Dependencies (Recommended)**

```typescript
// Extract stable values once
const storage = config.storage;
const sessionId = config.getSessionId();

const sessionPersistence = useMemo(
  () => new SessionPersistenceService(storage, sessionId),
  [storage, sessionId],
);
```

**Option B: Use Refs for Stability**

```typescript
const storageRef = useRef(config.storage);
const sessionIdRef = useRef(config.getSessionId());

const sessionPersistence = useMemo(
  () => new SessionPersistenceService(storageRef.current, sessionIdRef.current),
  [], // Empty deps - created once
);
```

**Option C: Singleton Pattern in Service**

Modify `SessionPersistenceService` to maintain a single file path per session:

```typescript
export class SessionPersistenceService {
  private static instances = new Map<string, SessionPersistenceService>();

  static getInstance(storage: Storage, sessionId: string): SessionPersistenceService {
    const key = `${storage.getProjectTempDir()}:${sessionId}`;
    if (!this.instances.has(key)) {
      this.instances.set(key, new SessionPersistenceService(storage, sessionId));
    }
    return this.instances.get(key)!;
  }

  // Make constructor private
  private constructor(storage: Storage, sessionId: string) {
    // ...
  }
}
```

### Testing Verification

To verify the fix works:

```typescript
// Test that service maintains same file path across config changes
it('should maintain same session file when config properties change', () => {
  const storage = new Storage('/test');
  const sessionId = 'test-session';

  const service1 = new SessionPersistenceService(storage, sessionId);
  const path1 = service1.getSessionFilePath();

  // Simulate time passing (would create different timestamp)
  jest.advanceTimersByTime(1000);

  // With current bug: this creates new timestamp
  // With fix: should reuse existing service
  const service2 = SessionPersistenceService.getInstance(storage, sessionId);
  const path2 = service2.getSessionFilePath();

  expect(path1).toBe(path2);
});
```

---

## Issue #4: Weak Type Safety for uiHistory

### Location
`packages/core/src/storage/SessionPersistenceService.ts:33`

### Current Implementation

```typescript
export interface PersistedSession {
  version: 1;
  sessionId: string;
  projectHash: string;
  createdAt: string;
  updatedAt: string;
  history: IContent[];
  uiHistory?: unknown[];  // <-- Problem: unknown[] loses all type safety
  metadata?: {
    provider?: string;
    model?: string;
    tokenCount?: number;
  };
}
```

### Problem Analysis

Using `unknown[]` for `uiHistory` creates several issues:

1. **No compile-time checking**: TypeScript can't catch shape mismatches
2. **Requires casting everywhere**: `restoredSession.uiHistory as HistoryItem[]`
3. **Runtime errors possible**: If the shape doesn't match, crashes occur at runtime
4. **Poor developer experience**: No autocomplete, no refactoring support

### The Architectural Challenge

The `PersistedSession` interface lives in `@vybestack/llxprt-code-core`, but `HistoryItem` is defined in `@vybestack/llxprt-code-cli`. Core cannot import from CLI (would create circular dependency).

### Proposed Solutions

**Option A: Define Minimal Interface in Core (Recommended)**

Create a minimal, stable interface in core that CLI's `HistoryItem` must satisfy:

```typescript
// packages/core/src/storage/SessionPersistenceService.ts

/**
 * Minimal interface for persisted UI history items.
 * CLI's HistoryItem must satisfy this interface.
 */
export interface PersistedUIHistoryItem {
  /** Unique identifier for the history item */
  id: number;
  /** Type discriminator for the history item */
  type: string;
  /** Optional text content */
  text?: string;
  /** Optional model identifier */
  model?: string;
  /** Optional tool information for tool_group type */
  tools?: Array<{
    callId: string;
    name: string;
    status: string;
    description?: string;
    resultDisplay?: string;
  }>;
}

export interface PersistedSession {
  version: 1;
  sessionId: string;
  projectHash: string;
  createdAt: string;
  updatedAt: string;
  history: IContent[];
  uiHistory?: PersistedUIHistoryItem[];  // <-- Now typed!
  metadata?: {
    provider?: string;
    model?: string;
    tokenCount?: number;
  };
}
```

Then in CLI, ensure `HistoryItem` extends or satisfies this interface:

```typescript
// packages/cli/src/ui/types.ts

import type { PersistedUIHistoryItem } from '@vybestack/llxprt-code-core';

// HistoryItem should be a superset of PersistedUIHistoryItem
export interface HistoryItem extends PersistedUIHistoryItem {
  // CLI-specific fields that aren't persisted
  isStreaming?: boolean;
  // ... other runtime-only fields
}
```

**Option B: Separate Serialization Types**

Create explicit serialization/deserialization types:

```typescript
// packages/core/src/storage/sessionTypes.ts

export interface SerializedHistoryItem {
  id: number;
  type: 'user' | 'gemini' | 'info' | 'warning' | 'error' | 'tool_group';
  text?: string;
  model?: string;
  agentId?: string;
  tools?: SerializedToolCall[];
}

export interface SerializedToolCall {
  callId: string;
  name: string;
  status: 'pending' | 'executing' | 'success' | 'error' | 'cancelled';
  description: string;
  resultDisplay?: string;
}
```

**Option C: Use Zod Schema (Runtime Validation)**

If you want runtime validation as well:

```typescript
import { z } from 'zod';

const PersistedToolCallSchema = z.object({
  callId: z.string(),
  name: z.string(),
  status: z.string(),
  description: z.string().optional(),
  resultDisplay: z.string().optional(),
});

const PersistedUIHistoryItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  text: z.string().optional(),
  model: z.string().optional(),
  tools: z.array(PersistedToolCallSchema).optional(),
});

export type PersistedUIHistoryItem = z.infer<typeof PersistedUIHistoryItemSchema>;
```

### Implementation Steps

1. Define `PersistedUIHistoryItem` in core
2. Update `PersistedSession.uiHistory` to use typed array
3. Update CLI's `HistoryItem` to extend/satisfy the interface
4. Update `convertToUIHistory` to return typed array
5. Remove all `as HistoryItem[]` casts (they become unnecessary)

---

## Issue #6: Silent Failure on Corrupted History Restore

### Location
`packages/cli/src/ui/AppContainer.tsx:515-543`

### Current Implementation

```typescript
// Part 2: Restore core history when historyService becomes available
useEffect(() => {
  if (!restoredSession || coreHistoryRestoredRef.current) {
    return;
  }

  const checkInterval = setInterval(() => {
    const geminiClient = config.getGeminiClient();
    const historyService = geminiClient?.getHistoryService?.();

    if (!historyService) {
      return;
    }

    clearInterval(checkInterval);
    coreHistoryRestoredRef.current = true;

    try {
      historyService.validateAndFix();
      historyService.addAll(restoredSession.history);
      debug.log('Restored core history for AI context');
    } catch (err) {
      debug.error('Failed to restore core history:', err);
      // <-- PROBLEM: User sees "Session restored" but AI has no context!
    }
  }, 100);

  return () => {
    clearInterval(checkInterval);
  };
}, [restoredSession, config]);
```

### Problem Analysis

When core history restoration fails:

1. User already saw "Session restored (X messages from ...)" message (from Part 1)
2. UI shows previous conversation correctly
3. **But AI has no memory of the conversation**
4. User types follow-up question
5. AI responds with confusion: "I don't see any previous context..."
6. User is confused why AI "forgot" the conversation

This creates a **deceptive UX** where the system appears to work but is fundamentally broken.

### Failure Scenarios

1. **Schema mismatch**: `IContent` format changed between versions
2. **Corrupted data**: Partial write, disk error, JSON parse succeeds but data is invalid
3. **Token limit**: History too large for `historyService.addAll()`
4. **Validation failure**: `validateAndFix()` throws on invalid data

### Proposed Fix

**Comprehensive error handling with user notification:**

```typescript
useEffect(() => {
  if (!restoredSession || coreHistoryRestoredRef.current) {
    return;
  }

  const checkInterval = setInterval(() => {
    const geminiClient = config.getGeminiClient();
    const historyService = geminiClient?.getHistoryService?.();

    if (!historyService) {
      return;
    }

    clearInterval(checkInterval);
    coreHistoryRestoredRef.current = true;

    try {
      // Validate first
      historyService.validateAndFix();

      // Attempt to add history
      const addedCount = historyService.addAll(restoredSession.history);

      if (addedCount === 0 && restoredSession.history.length > 0) {
        throw new Error('No history items were added');
      }

      if (addedCount < restoredSession.history.length) {
        debug.warn(`Only ${addedCount}/${restoredSession.history.length} history items restored`);
        addItem({
          type: 'warning',
          text: `Partial session restore: ${addedCount} of ${restoredSession.history.length} messages loaded into AI context.`,
        }, Date.now());
      } else {
        debug.log('Restored core history for AI context');
      }
    } catch (err) {
      debug.error('Failed to restore core history:', err);

      // Notify user that AI context is missing
      addItem({
        type: 'warning',
        text: 'Previous session display restored, but AI context could not be loaded. The AI will not remember the previous conversation.',
      }, Date.now());

      // Optionally offer to clear the corrupted display too
      // This prevents the deceptive state
    }
  }, 100);

  return () => {
    clearInterval(checkInterval);
  };
}, [restoredSession, config, addItem]);
```

### Additional Improvements

**Add retry logic for transient failures:**

```typescript
const MAX_RETRIES = 3;
let retryCount = 0;

const attemptRestore = () => {
  try {
    historyService.validateAndFix();
    historyService.addAll(restoredSession.history);
    debug.log('Restored core history for AI context');
  } catch (err) {
    retryCount++;
    if (retryCount < MAX_RETRIES) {
      debug.warn(`Retry ${retryCount}/${MAX_RETRIES} for history restore`);
      setTimeout(attemptRestore, 500 * retryCount); // Exponential backoff
    } else {
      debug.error('Failed to restore core history after retries:', err);
      addItem({
        type: 'warning',
        text: 'AI context restoration failed. Previous messages are shown but AI has no memory of them.',
      }, Date.now());
    }
  }
};
```

---

## Issue #7: No Validation of HistoryItem Schema

### Location
`packages/cli/src/ui/AppContainer.tsx:476-488`

### Current Implementation

```typescript
// Use saved UI history if available, otherwise convert from core history
let uiHistoryItems: HistoryItem[];
if (
  restoredSession.uiHistory &&
  Array.isArray(restoredSession.uiHistory)
) {
  uiHistoryItems = restoredSession.uiHistory as HistoryItem[];  // <-- Dangerous cast!
  debug.log(`Using saved UI history (${uiHistoryItems.length} items)`);
} else {
  uiHistoryItems = convertToUIHistory(restoredSession.history);
  debug.log(`Converted core history to UI (${uiHistoryItems.length} items)`);
}
loadHistory(uiHistoryItems);
```

### Problem Analysis

The `as HistoryItem[]` cast is a **type assertion**, not a runtime check. If the persisted data doesn't match the expected shape:

1. **Schema evolution**: `HistoryItem` interface changes, old sessions have different shape
2. **Corruption**: Partial writes, encoding issues
3. **Version mismatch**: User downgrades app, loads newer session format

**Failure modes:**

```typescript
// If persisted item looks like this (old format):
{ id: 1, messageType: 'user', content: 'hello' }

// But code expects:
{ id: 1, type: 'user', text: 'hello' }

// Then accessing item.type returns undefined
// And item.text returns undefined
// UI renders empty/broken items or crashes
```

### Proposed Fix

**Runtime validation with fallback:**

```typescript
/**
 * Validates that an item matches the HistoryItem schema.
 * Uses duck typing for flexibility with minor schema changes.
 */
const isValidHistoryItem = (item: unknown): item is HistoryItem => {
  if (typeof item !== 'object' || item === null) {
    return false;
  }

  const obj = item as Record<string, unknown>;

  // Required fields
  if (typeof obj.id !== 'number') return false;
  if (typeof obj.type !== 'string') return false;

  // Type-specific validation
  switch (obj.type) {
    case 'user':
    case 'gemini':
    case 'info':
    case 'warning':
    case 'error':
      // Text types should have text (but might be empty)
      return typeof obj.text === 'string' || obj.text === undefined;

    case 'tool_group':
      // Tool groups must have tools array
      if (!Array.isArray(obj.tools)) return false;
      return obj.tools.every(tool =>
        typeof tool === 'object' &&
        tool !== null &&
        typeof (tool as Record<string, unknown>).callId === 'string' &&
        typeof (tool as Record<string, unknown>).name === 'string'
      );

    default:
      // Unknown type - might be from newer version
      debug.warn(`Unknown history item type: ${obj.type}`);
      return true; // Allow unknown types to pass through
  }
};

/**
 * Validates all items in a history array.
 * Returns valid items, filters invalid ones.
 */
const validateUIHistory = (
  items: unknown[],
  debug: DebugLogger
): { valid: HistoryItem[]; invalidCount: number } => {
  const valid: HistoryItem[] = [];
  let invalidCount = 0;

  for (let i = 0; i < items.length; i++) {
    if (isValidHistoryItem(items[i])) {
      valid.push(items[i]);
    } else {
      debug.warn(`Invalid history item at index ${i}:`, items[i]);
      invalidCount++;
    }
  }

  return { valid, invalidCount };
};
```

**Updated restoration logic:**

```typescript
useEffect(() => {
  if (!restoredSession || sessionRestoredRef.current) {
    return;
  }
  sessionRestoredRef.current = true;

  try {
    let uiHistoryItems: HistoryItem[];
    let usedFallback = false;

    if (restoredSession.uiHistory && Array.isArray(restoredSession.uiHistory)) {
      const { valid, invalidCount } = validateUIHistory(
        restoredSession.uiHistory,
        debug
      );

      if (invalidCount > 0) {
        debug.warn(`${invalidCount} invalid UI history items found`);

        if (valid.length === 0) {
          // All items invalid - fall back to conversion
          debug.warn('All UI history invalid, falling back to conversion');
          uiHistoryItems = convertToUIHistory(restoredSession.history);
          usedFallback = true;
        } else {
          // Some items valid - use them but warn
          uiHistoryItems = valid;
          addItem({
            type: 'warning',
            text: `${invalidCount} corrupted message(s) could not be displayed.`,
          }, Date.now());
        }
      } else {
        uiHistoryItems = valid;
      }
    } else {
      uiHistoryItems = convertToUIHistory(restoredSession.history);
      usedFallback = true;
    }

    loadHistory(uiHistoryItems);

    const source = usedFallback ? 'converted from core' : 'restored from UI cache';
    addItem({
      type: 'info',
      text: `Session restored (${uiHistoryItems.length} messages ${source})`,
    }, Date.now());

  } catch (err) {
    debug.error('Failed to restore UI history:', err);
    addItem({
      type: 'warning',
      text: 'Failed to restore previous session display.',
    }, Date.now());
  }
}, [restoredSession, convertToUIHistory, loadHistory, addItem]);
```

### Schema Migration Support

For handling schema evolution across versions:

```typescript
interface HistoryItemV1 {
  id: number;
  messageType: string;  // Old field name
  content: string;      // Old field name
}

interface HistoryItemV2 {
  id: number;
  type: string;        // New field name
  text: string;        // New field name
}

const migrateHistoryItem = (item: unknown): HistoryItem | null => {
  if (typeof item !== 'object' || item === null) return null;

  const obj = item as Record<string, unknown>;

  // Already current format
  if ('type' in obj && 'text' in obj) {
    return isValidHistoryItem(item) ? item as HistoryItem : null;
  }

  // Migrate from V1 format
  if ('messageType' in obj && 'content' in obj) {
    return {
      id: obj.id as number,
      type: obj.messageType as string,
      text: obj.content as string,
    } as HistoryItem;
  }

  return null;
};
```

---

## Issue #8: Synchronous fs.existsSync in Async Context

### Location
`packages/core/src/storage/SessionPersistenceService.ts:130-136`

### Current Implementation

```typescript
async loadMostRecent(): Promise<PersistedSession | null> {
  try {
    // Check if chats directory exists
    if (!fs.existsSync(this.chatsDir)) {  // <-- Synchronous call in async function
      logger.debug('No chats directory found');
      return null;
    }
    // ... rest of async operations
```

### Problem Analysis

**Why this matters:**

1. `fs.existsSync()` is a **synchronous, blocking** call
2. It blocks the Node.js event loop until the filesystem responds
3. In an async function, this defeats the purpose of async/await
4. On slow filesystems (network drives, encrypted volumes), this can cause noticeable UI freezes

**The irony:** The function is correctly async for `readdir` and `readFile`, but uses sync for the existence check.

### Impact Assessment

- **Low impact** for local SSDs (< 1ms)
- **Medium impact** for HDDs or encrypted volumes (10-50ms)
- **High impact** for network filesystems (100ms+)

Given that `loadMostRecent()` is called during startup with `--continue`, this could delay app launch.

### Proposed Fix

**Replace with async equivalent:**

```typescript
async loadMostRecent(): Promise<PersistedSession | null> {
  try {
    // Check if chats directory exists (async)
    try {
      await fs.promises.access(this.chatsDir, fs.constants.R_OK);
    } catch {
      logger.debug('No chats directory found');
      return null;
    }

    // Find all persisted session files
    const files = await fs.promises.readdir(this.chatsDir);
    // ... rest unchanged
```

**Alternative using stat:**

```typescript
async loadMostRecent(): Promise<PersistedSession | null> {
  try {
    // Check if chats directory exists and is a directory
    try {
      const stat = await fs.promises.stat(this.chatsDir);
      if (!stat.isDirectory()) {
        logger.debug('Chats path exists but is not a directory');
        return null;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('No chats directory found');
        return null;
      }
      throw err; // Re-throw other errors
    }

    const files = await fs.promises.readdir(this.chatsDir);
    // ... rest unchanged
```

### Full Method Refactor

```typescript
async loadMostRecent(): Promise<PersistedSession | null> {
  try {
    // Async directory existence check
    let files: string[];
    try {
      files = await fs.promises.readdir(this.chatsDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug('No chats directory found');
        return null;
      }
      throw err;
    }

    // Filter and sort session files
    const sessionFiles = files
      .filter(
        (f) => f.startsWith(PERSISTED_SESSION_PREFIX) && f.endsWith('.json'),
      )
      .sort()
      .reverse();

    if (sessionFiles.length === 0) {
      logger.debug('No persisted sessions found');
      return null;
    }

    // Load most recent
    const mostRecentFile = sessionFiles[0];
    const filePath = path.join(this.chatsDir, mostRecentFile);

    logger.debug('Loading most recent session:', filePath);

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const session = JSON.parse(content) as PersistedSession;

    // Validate project hash
    const currentProjectHash = this.getProjectHash();
    if (session.projectHash !== currentProjectHash) {
      logger.warn('Session project hash mismatch, skipping:', {
        expected: currentProjectHash,
        found: session.projectHash,
      });
      return null;
    }

    // Validate version
    if (session.version !== 1) {
      logger.warn('Unknown session version:', session.version);
      return null;
    }

    logger.debug('Session loaded:', {
      sessionId: session.sessionId,
      historyLength: session.history.length,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });

    return session;
  } catch (error) {
    logger.error('Failed to load session:', error);

    if (error instanceof SyntaxError) {
      await this.backupCorruptedSession();
    }

    return null;
  }
}
```

---

## Issue #10: --continue + --prompt Interaction Undefined

### Location
- `packages/cli/src/config/config.ts:358-363` (argument parsing)
- `packages/cli/src/gemini.tsx:225-240` (session loading)

### Current Behavior

The code allows both flags simultaneously but behavior is undefined:

```bash
llxprt --continue --prompt "fix the auth bug"
```

What happens:
1. Previous session is loaded (UI history + AI context restored)
2. User sees previous conversation
3. The prompt "fix the auth bug" is... what?
   - Submitted immediately after restore? (current behavior, probably)
   - Appended to restored context?
   - Ignored?

### Problem Analysis

There are legitimate use cases for combining these:

1. **Resume and continue**: "Continue where I left off and now fix the bug"
2. **Resume context only**: "Load context but start with this new task"

But there are also problematic cases:

1. **Conflicting context**: Previous session was about feature A, new prompt about feature B
2. **Token limits**: Restored history + new prompt exceeds context window
3. **User confusion**: User expects clean slate but gets old context

### Proposed Solutions

**Option A: Mutual Exclusivity (Simplest)**

Treat them as mutually exclusive:

```typescript
// In parseArguments() or loadCliConfig()
if (argv.continue && (argv.prompt || argv.promptInteractive)) {
  console.error(chalk.red(
    'Error: Cannot use --continue with --prompt or --prompt-interactive.\n' +
    'Use --continue to resume a session, or --prompt to start fresh.'
  ));
  process.exit(1);
}
```

**Option B: Clear Semantics with Warning (Recommended)**

Allow it but define clear behavior:

```typescript
// In gemini.tsx startInteractiveUI()
if (config.isContinueSession()) {
  const persistence = new SessionPersistenceService(
    config.storage,
    config.getSessionId(),
  );
  restoredSession = await persistence.loadMostRecent();

  if (restoredSession) {
    const formattedTime = SessionPersistenceService.formatSessionTime(restoredSession);

    if (config.getQuestion()) {
      // User provided both --continue and --prompt
      console.log(chalk.cyan(
        `Resuming session from ${formattedTime}\n` +
        `Your prompt will be submitted after context is restored.`
      ));
    } else {
      console.log(chalk.green(`Resumed session from ${formattedTime}`));
    }
  } else {
    console.log(chalk.yellow('No previous session found. Starting fresh.'));
  }
}
```

**Option C: Explicit Flag for Behavior**

Add a flag to control the interaction:

```typescript
.option('continue-with-prompt', {
  type: 'boolean',
  description: 'When using --continue with --prompt, submit prompt after restoring session',
  default: true,
})
.option('continue-context-only', {
  type: 'boolean',
  description: 'Load previous session context but start a new conversation',
  implies: 'continue',
})
```

### Recommended Implementation

```typescript
// packages/cli/src/gemini.tsx

export async function startInteractiveUI(
  config: Config,
  settings: LoadedSettings,
  startupWarnings: string[],
  workspaceRoot: string,
) {
  const version = await getCliVersion();
  const initialPrompt = config.getQuestion();

  let restoredSession: PersistedSession | null = null;

  if (config.isContinueSession()) {
    const persistence = new SessionPersistenceService(
      config.storage,
      config.getSessionId(),
    );
    restoredSession = await persistence.loadMostRecent();

    if (restoredSession) {
      const formattedTime = SessionPersistenceService.formatSessionTime(restoredSession);

      if (initialPrompt) {
        // Both --continue and --prompt provided
        console.log(chalk.cyan(
          `Resuming session from ${formattedTime}`
        ));
        console.log(chalk.dim(
          `Your prompt "${initialPrompt.slice(0, 50)}${initialPrompt.length > 50 ? '...' : ''}" ` +
          `will be submitted after session loads.`
        ));
      } else {
        console.log(chalk.green(`Resumed session from ${formattedTime}`));
      }
    } else {
      if (initialPrompt) {
        console.log(chalk.yellow(
          'No previous session found. Starting fresh with your prompt.'
        ));
      } else {
        console.log(chalk.yellow('No previous session found. Starting fresh.'));
      }
    }
  }

  // ... rest of startup
}
```

### Documentation Update

Add to help text:

```typescript
.option('continue', {
  alias: 'C',
  type: 'boolean',
  description:
    'Resume the most recent session for this project. ' +
    'Can be combined with --prompt to continue with a new message.',
  default: false,
})
```

---

## Issue #11: No Test Coverage

### Location
The feature spans multiple files but no test files were added:
- `packages/core/src/storage/SessionPersistenceService.ts` - No tests
- `packages/cli/src/ui/AppContainer.tsx` - Session restoration logic untested

### Problem Analysis

The `--continue` feature is a critical persistence feature that:

1. Writes to disk (can fail, corrupt, race)
2. Reads from disk (can fail, corrupt, migrate)
3. Restores complex state (can mismatch, crash)
4. Interacts with multiple subsystems (GeminiClient, HistoryService, UI)

Without tests:
- Regressions go unnoticed
- Edge cases are discovered in production
- Refactoring is risky
- Cross-version compatibility is untested

### Proposed Test Suite

**File: `packages/core/src/storage/SessionPersistenceService.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionPersistenceService, PersistedSession } from './SessionPersistenceService';
import { Storage } from '../config/storage';

// Mock the filesystem
vi.mock('node:fs');

describe('SessionPersistenceService', () => {
  let storage: Storage;
  let service: SessionPersistenceService;
  const mockProjectRoot = '/test/project';
  const mockSessionId = 'test-session-123';

  beforeEach(() => {
    storage = new Storage(mockProjectRoot);
    service = new SessionPersistenceService(storage, mockSessionId);
    vi.clearAllMocks();
  });

  describe('save()', () => {
    it('should create chats directory if not exists', async () => {
      const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      vi.spyOn(fs.promises, 'rename').mockResolvedValue();

      await service.save([], undefined, []);

      expect(mkdirSpy).toHaveBeenCalledWith(
        expect.stringContaining('chats'),
        { recursive: true }
      );
    });

    it('should write to temp file then rename (atomic write)', async () => {
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue();
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue();

      await service.save([], undefined, []);

      // Should write to .tmp file first
      expect(writeFileSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expect.any(String),
        'utf-8'
      );

      // Then rename to final path
      expect(renameSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\.tmp$/),
        expect.stringMatching(/\.json$/)
      );
    });

    it('should include all required fields in saved session', async () => {
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      let savedContent = '';
      vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (_path, content) => {
        savedContent = content as string;
      });
      vi.spyOn(fs.promises, 'rename').mockResolvedValue();

      const history = [{ speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] }];
      const metadata = { provider: 'test', model: 'test-model' };
      const uiHistory = [{ id: 1, type: 'user', text: 'hello' }];

      await service.save(history as any, metadata, uiHistory);

      const parsed = JSON.parse(savedContent) as PersistedSession;
      expect(parsed.version).toBe(1);
      expect(parsed.sessionId).toBe(mockSessionId);
      expect(parsed.projectHash).toBeDefined();
      expect(parsed.createdAt).toBeDefined();
      expect(parsed.updatedAt).toBeDefined();
      expect(parsed.history).toEqual(history);
      expect(parsed.uiHistory).toEqual(uiHistory);
      expect(parsed.metadata).toEqual(metadata);
    });

    it('should throw on write failure', async () => {
      vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(new Error('Disk full'));

      await expect(service.save([], undefined, [])).rejects.toThrow('Disk full');
    });
  });

  describe('loadMostRecent()', () => {
    it('should return null if chats directory does not exist', async () => {
      vi.spyOn(fs.promises, 'access').mockRejectedValue({ code: 'ENOENT' });

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should return null if no session files exist', async () => {
      vi.spyOn(fs.promises, 'access').mockResolvedValue();
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([]);

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should load the most recent session file', async () => {
      vi.spyOn(fs.promises, 'access').mockResolvedValue();
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        'persisted-session-2026-01-01.json',
        'persisted-session-2026-01-03.json',  // Most recent
        'persisted-session-2026-01-02.json',
      ] as any);

      const mockSession: PersistedSession = {
        version: 1,
        sessionId: mockSessionId,
        projectHash: service['getProjectHash'](),  // Access private method
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        history: [],
      };

      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.loadMostRecent();

      expect(result).toEqual(mockSession);
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        expect.stringContaining('2026-01-03'),
        'utf-8'
      );
    });

    it('should reject session with wrong project hash', async () => {
      vi.spyOn(fs.promises, 'access').mockResolvedValue();
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        'persisted-session-2026-01-03.json',
      ] as any);

      const mockSession: PersistedSession = {
        version: 1,
        sessionId: mockSessionId,
        projectHash: 'wrong-hash',  // Different project
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        history: [],
      };

      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should reject session with unknown version', async () => {
      vi.spyOn(fs.promises, 'access').mockResolvedValue();
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        'persisted-session-2026-01-03.json',
      ] as any);

      const mockSession = {
        version: 99,  // Future version
        sessionId: mockSessionId,
        projectHash: service['getProjectHash'](),
        createdAt: '2026-01-03T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        history: [],
      };

      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify(mockSession));

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
    });

    it('should handle corrupted JSON gracefully', async () => {
      vi.spyOn(fs.promises, 'access').mockResolvedValue();
      vi.spyOn(fs.promises, 'readdir').mockResolvedValue([
        'persisted-session-2026-01-03.json',
      ] as any);
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue('{ invalid json }}}');
      const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue();

      const result = await service.loadMostRecent();

      expect(result).toBeNull();
      // Should backup the corrupted file
      expect(renameSpy).toHaveBeenCalledWith(
        expect.stringContaining('persisted-session'),
        expect.stringContaining('.corrupted-')
      );
    });
  });

  describe('formatSessionTime()', () => {
    it('should format session time from updatedAt', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T12:30:00.000Z',
        history: [],
      };

      const formatted = SessionPersistenceService.formatSessionTime(session);

      expect(formatted).toContain('2026');
      expect(formatted).toContain('1'); // Month
      expect(formatted).toContain('3'); // Day
    });

    it('should fall back to createdAt if updatedAt missing', () => {
      const session: PersistedSession = {
        version: 1,
        sessionId: 'test',
        projectHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '',  // Empty
        history: [],
      };

      const formatted = SessionPersistenceService.formatSessionTime(session);

      expect(formatted).toContain('2026');
    });
  });

  describe('getProjectHash()', () => {
    it('should generate consistent hash for same project', () => {
      const service1 = new SessionPersistenceService(storage, 'session1');
      const service2 = new SessionPersistenceService(storage, 'session2');

      // Same storage = same project = same hash
      expect(service1['getProjectHash']()).toBe(service2['getProjectHash']());
    });

    it('should generate different hash for different projects', () => {
      const storage1 = new Storage('/project1');
      const storage2 = new Storage('/project2');

      const service1 = new SessionPersistenceService(storage1, 'session');
      const service2 = new SessionPersistenceService(storage2, 'session');

      expect(service1['getProjectHash']()).not.toBe(service2['getProjectHash']());
    });
  });
});
```

**File: `packages/cli/src/ui/__tests__/sessionRestore.test.tsx`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react-hooks';

describe('Session Restoration', () => {
  const mockAddItem = vi.fn();
  const mockLoadHistory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('UI History Restoration', () => {
    it('should use saved UI history when available', () => {
      const restoredSession = {
        history: [/* core history */],
        uiHistory: [
          { id: 1, type: 'user', text: 'hello' },
          { id: 2, type: 'gemini', text: 'hi there' },
        ],
      };

      // Test that uiHistory is preferred over conversion
      // ... implementation
    });

    it('should convert core history when UI history missing', () => {
      const restoredSession = {
        history: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
        ],
        uiHistory: undefined,
      };

      // Test that conversion is used as fallback
      // ... implementation
    });

    it('should validate UI history items before loading', () => {
      const restoredSession = {
        history: [],
        uiHistory: [
          { id: 1, type: 'user', text: 'valid' },
          { invalid: 'item' },  // Missing required fields
          { id: 3, type: 'gemini', text: 'also valid' },
        ],
      };

      // Should filter out invalid item and load only valid ones
      // ... implementation
    });
  });

  describe('Core History Restoration', () => {
    it('should wait for historyService before restoring', async () => {
      // Test polling behavior until historyService available
      // ... implementation
    });

    it('should warn user if core history restoration fails', async () => {
      // Test error notification to user
      // ... implementation
    });
  });
});
```

### Test Categories

| Category | Purpose | Priority |
|----------|---------|----------|
| Unit: SessionPersistenceService | Core persistence logic | High |
| Unit: History validation | Schema validation | High |
| Unit: Error handling | Graceful degradation | Medium |
| Integration: Full flow | End-to-end --continue | High |
| Edge cases: Corruption | Recovery from bad data | Medium |
| Edge cases: Race conditions | Concurrent saves | Low |

---

## Summary

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| #2: Memory leak | Medium | Low | P1 |
| #4: Type safety | Low | Medium | P3 |
| #6: Silent failure | High | Low | P1 |
| #7: No validation | High | Medium | P1 |
| #8: Sync fs call | Low | Low | P3 |
| #10: Flag interaction | Medium | Low | P2 |
| #11: No tests | High | High | P1 |

**Recommended implementation order:**
1. #11 (Tests) - Enables safe refactoring
2. #6 + #7 (Error handling + validation) - Prevents data loss/crashes
3. #2 (Memory leak) - Quick fix, prevents resource issues
4. #10 (Flag interaction) - UX clarity
5. #4 + #8 (Type safety + async) - Code quality
