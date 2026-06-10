/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ConversationFileWriter.
 *
 * CRITICAL: No test writes to the real ~/.llxprt directory.
 * All tests use temp directories via fs.promises.mkdtemp().
 *
 * @plan PLAN-20260609-ISSUE1590.P04b
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ConversationFileWriter,
  getConversationFileWriter,
} from './ConversationFileWriter.js';
// NOTE: Ideally imported from '@vybestack/llxprt-code-storage/testing' (Tier 3 deep export),
// but package self-import does not resolve at vitest runtime without a built dist/ or vite alias.
// Using source-relative import instead. The testing.ts barrel is verified separately.
import { resetConversationFileWriterForTesting } from '../testing.js';
import type { StorageLogger } from '../types/logger.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a temp directory for test isolation.
 */
async function createTempDir(prefix = 'cfw-test-'): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Creates a real StorageLogger that records calls to observable arrays.
 * NOT vi.fn() mock theater.
 */
function createTestLogger(): {
  logger: StorageLogger;
  debugEntries: Array<{ message: string; context: unknown[] }>;
  warnEntries: Array<{ message: string; context: unknown[] }>;
  errorEntries: Array<{ message: string; context: unknown[] }>;
} {
  const debugEntries: Array<{ message: string; context: unknown[] }> = [];
  const warnEntries: Array<{ message: string; context: unknown[] }> = [];
  const errorEntries: Array<{ message: string; context: unknown[] }> = [];

  const logger: StorageLogger = {
    debug: (message: string | (() => string), ...context: unknown[]) => {
      debugEntries.push({
        message: typeof message === 'function' ? message() : message,
        context,
      });
    },
    warn: (message: string | (() => string), ...context: unknown[]) => {
      warnEntries.push({
        message: typeof message === 'function' ? message() : message,
        context,
      });
    },
    error: (message: string | (() => string), ...context: unknown[]) => {
      errorEntries.push({
        message: typeof message === 'function' ? message() : message,
        context,
      });
    },
  };

  return { logger, debugEntries, warnEntries, errorEntries };
}

/**
 * Reads the JSONL file at logPath and returns parsed lines.
 */
async function readJsonlLines(
  logPath: string,
): Promise<Array<Record<string, unknown>>> {
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(logPath, `conversation-${today}.jsonl`);
  const content = await fsp.readFile(logFile, 'utf-8');
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Creates a path where the parent directory component is a regular file,
 * causing mkdir to fail deterministically.
 */
async function createInvalidParentPath(): Promise<{
  parentIsFilePath: string;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await createTempDir('cfw-invalid-');
  const regularFile = path.join(tmpDir, 'regularfile');
  await fsp.writeFile(regularFile, 'not a directory');
  const invalidLogPath = path.join(regularFile, 'conversations');
  return {
    parentIsFilePath: invalidLogPath,
    cleanup: async () => {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

// ─── Request Write (Scenario 1) ─────────────────────────────────────────────

describe('ConversationFileWriter — Request Write', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a request entry with type, provider, messages, context, and timestamp', async () => {
    const writer = new ConversationFileWriter(tmpDir);
    writer.writeRequest('openai', [{ role: 'user', content: 'hi' }], {
      sessionId: 's1',
    });

    const lines = await readJsonlLines(tmpDir);
    expect(lines).toHaveLength(1);

    const entry = lines[0];
    expect(entry.type).toBe('request');
    expect(entry.provider).toBe('openai');
    expect(entry.messages).toStrictEqual([{ role: 'user', content: 'hi' }]);
    expect(entry.context).toStrictEqual({ sessionId: 's1' });

    // Timestamp must be a valid ISO string
    const ts = new Date(entry.timestamp as string);
    expect(ts.getTime()).not.toBeNaN();
    expect(ts.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

// ─── Response Write (Scenario 2) ────────────────────────────────────────────

describe('ConversationFileWriter — Response Write', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a response entry with type, provider, response payload, metadata, and timestamp', async () => {
    const writer = new ConversationFileWriter(tmpDir);
    writer.writeResponse('openai', { text: 'ok' }, { tokens: 2 });

    const lines = await readJsonlLines(tmpDir);
    expect(lines).toHaveLength(1);

    const entry = lines[0];
    expect(entry.type).toBe('response');
    expect(entry.provider).toBe('openai');
    expect(entry.response).toStrictEqual({ text: 'ok' });
    expect(entry.metadata).toStrictEqual({ tokens: 2 });

    const ts = new Date(entry.timestamp as string);
    expect(ts.getTime()).not.toBeNaN();
  });
});

// ─── Tool Call Write (Scenario 3) ────────────────────────────────────────────

describe('ConversationFileWriter — Tool Call Write', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes a tool_call entry with context spread at top level, not nested under context', async () => {
    const writer = new ConversationFileWriter(tmpDir);
    writer.writeToolCall('openai', 'read_file', { path: 'README.md' });

    const lines = await readJsonlLines(tmpDir);
    expect(lines).toHaveLength(1);

    const entry = lines[0];
    expect(entry.type).toBe('tool_call');
    expect(entry.provider).toBe('openai');
    expect(entry.tool).toBe('read_file');
    // Context fields are spread at top level, NOT nested under 'context'
    expect(entry.path).toBe('README.md');
    expect(entry).not.toHaveProperty('context');

    const ts = new Date(entry.timestamp as string);
    expect(ts.getTime()).not.toBeNaN();
  });
});

// ─── Singleton Reuse (Scenario 4) ───────────────────────────────────────────

describe('ConversationFileWriter — Singleton Reuse', () => {
  afterEach(() => {
    resetConversationFileWriterForTesting();
  });

  it('getConversationFileWriter returns the same instance on repeated calls', () => {
    const tmpDir = path.join(os.tmpdir(), 'cfw-singleton-test');
    const first = getConversationFileWriter(tmpDir);
    const second = getConversationFileWriter(tmpDir);
    expect(first).toBe(second);
  });

  it('resetConversationFileWriterForTesting clears the singleton', () => {
    const tmpDir = path.join(os.tmpdir(), 'cfw-reset-test');
    const first = getConversationFileWriter(tmpDir);
    resetConversationFileWriterForTesting();
    const second = getConversationFileWriter(tmpDir);
    expect(first).not.toBe(second);
  });
});

// ─── Zero-Arg Backward Compat (Scenario 5) ──────────────────────────────────

describe('ConversationFileWriter — Zero-Arg Backward Compat', () => {
  it('constructs without error and resolves logPath including .llxprt and conversations', () => {
    // Approach B: Test zero-arg construction verifies the instance is created
    // and the path includes .llxprt/conversations, without actually writing.
    const writer = new ConversationFileWriter();
    // Access the private logPath via reflection to verify the resolved path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolvedPath = (writer as any).logPath as string;
    expect(resolvedPath).toContain('.llxprt');
    expect(resolvedPath).toContain('conversations');
  });
});

// ─── One-Arg Backward Compat (Scenario 6) ───────────────────────────────────

describe('ConversationFileWriter — One-Arg Backward Compat', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('constructs with a custom path and writes a valid JSONL entry', async () => {
    const writer = new ConversationFileWriter(tmpDir);
    writer.writeResponse('anthropic', { text: 'hello' });

    const lines = await readJsonlLines(tmpDir);
    expect(lines).toHaveLength(1);

    const entry = lines[0];
    expect(entry.type).toBe('response');
    expect(entry.provider).toBe('anthropic');
    expect(entry.response).toStrictEqual({ text: 'hello' });

    const ts = new Date(entry.timestamp as string);
    expect(ts.getTime()).not.toBeNaN();
  });
});

// ─── writeEntry Error Path (Scenario 7) ──────────────────────────────────────

describe('ConversationFileWriter — writeEntry Error Path', () => {
  it('logs an error when directory creation fails deterministically', async () => {
    const { parentIsFilePath, cleanup } = await createInvalidParentPath();
    const { logger, errorEntries } = createTestLogger();

    try {
      // Construct with invalid path + injected logger
      const writer = new ConversationFileWriter(parentIsFilePath, logger);
      writer.writeEntry({ type: 'test', data: 'hello' });

      // The error should have been logged via the injected logger
      expect(errorEntries.length).toBeGreaterThan(0);
      expect(errorEntries[0].message).toContain('Failed to write log entry');
    } finally {
      await cleanup();
    }
  });
});

// ─── Logger Injection (Scenario 8) ──────────────────────────────────────────

describe('ConversationFileWriter — Logger Injection', () => {
  it('injected logger.error is called when write fails', async () => {
    const { parentIsFilePath, cleanup } = await createInvalidParentPath();
    const { logger, errorEntries } = createTestLogger();

    try {
      const writer = new ConversationFileWriter(parentIsFilePath, logger);
      writer.writeEntry({ type: 'test', data: 'hello' });

      // Verify error was recorded in the observable array
      expect(errorEntries.length).toBeGreaterThan(0);
      // Verify the error context includes the actual error object
      expect(errorEntries[0].context.length).toBeGreaterThan(0);
    } finally {
      await cleanup();
    }
  });
});

// ─── Multiple Writes ─────────────────────────────────────────────────────────

describe('ConversationFileWriter — Multiple Writes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTempDir();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('appends multiple entries as separate JSONL lines', async () => {
    const writer = new ConversationFileWriter(tmpDir);
    writer.writeRequest('openai', [{ role: 'user', content: 'first' }]);
    writer.writeResponse('openai', { text: 'first-response' });
    writer.writeToolCall('openai', 'read_file', { path: 'test.txt' });

    const lines = await readJsonlLines(tmpDir);
    expect(lines).toHaveLength(3);

    expect(lines[0].type).toBe('request');
    expect(lines[1].type).toBe('response');
    expect(lines[2].type).toBe('tool_call');
  });
});
