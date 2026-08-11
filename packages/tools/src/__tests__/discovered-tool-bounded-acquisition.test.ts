/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiscoveredTool } from '../tools/tool-registry.js';
import {
  BoundedCombinedCollector,
  createDefaultByteBudget,
} from '../acquisition/index.js';
import type { IToolRegistryHost, IToolMessageBus } from '../index.js';

function createTempDir(prefix = 'llxprt-dt-test-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

function createScript(dir: string, name: string, content: string): string {
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, content, 'utf-8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function createHost(callCommand: string): IToolRegistryHost {
  return {
    getToolCallCommand: () => callCommand,
  };
}

const noopMessageBus: IToolMessageBus = {
  requestConfirmation: () => Promise.resolve(true),
};

function createDiscoveredTool(
  callCommand: string,
  name = 'test',
): DiscoveredTool {
  return new DiscoveredTool(
    createHost(callCommand),
    `discovered_tool_${name}`,
    'Test discovered tool',
    { type: 'object', properties: {} },
    noopMessageBus,
  );
}

async function executeTool(
  tool: DiscoveredTool,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
) {
  return tool.execute(params, signal ?? new AbortController().signal);
}

describe('DiscoveredTool bounded acquisition', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it.skipIf(process.platform === 'win32')(
    'bounds output exceeding the acquisition budget and reports truncation',
    async () => {
      // Produce 10 MiB of output — far beyond the 4 MiB default budget.
      const script = createScript(
        tempDir,
        'huge-output.sh',
        '#!/bin/sh\nhead -c 10485760 /dev/zero | tr "\\0" "A"',
      );
      const tool = createDiscoveredTool(script);
      const result = await executeTool(tool);

      expect(result.error).toBeUndefined();
      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      // Retained content must be bounded, not 10 MiB.
      expect(content.length).toBeLessThan(10 * 1024 * 1024);
      // Truncation must be reported so the result is not presented as exhaustive.
      expect(content).toContain('truncated');
    },
    { timeout: 30000 },
  );

  it.skipIf(process.platform === 'win32')(
    'truncation notice is identical in llmContent, returnDisplay, and error.message',
    async () => {
      // Produce 10 MiB on stdout AND write to stderr to trigger error path.
      const script = createScript(
        tempDir,
        'trunc-fail.sh',
        '#!/bin/sh\nhead -c 10485760 /dev/zero | tr "\\0" "A"\necho "err" >&2\nexit 1',
      );
      const tool = createDiscoveredTool(script);
      const result = await executeTool(tool);

      expect(result.error).toBeDefined();
      const llm =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      const display =
        typeof result.returnDisplay === 'string' ? result.returnDisplay : '';
      const errMsg = result.error?.message ?? '';

      // All three must contain the truncation notice.
      expect(llm).toContain('truncated');
      expect(display).toContain('truncated');
      expect(errMsg).toContain('truncated');

      // llmContent, returnDisplay, and error.message must be identical.
      expect(llm).toBe(display);
      expect(llm).toBe(errMsg);
    },
    { timeout: 30000 },
  );

  it.skipIf(process.platform === 'win32')(
    'handles a multi-megabyte producer within bounded memory',
    async () => {
      // Portable POSIX producer: dd writes a single large block without
      // command substitution or huge argv (unlike printf $(seq ...)).
      const script = createScript(
        tempDir,
        'huge-chunk.sh',
        '#!/bin/sh\ndd if=/dev/zero bs=5242880 count=1 2>/dev/null | tr "\\0" "A"',
      );
      const tool = createDiscoveredTool(script);
      const result = await executeTool(tool);

      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      // Must be bounded (default budget is 4 MiB), not 5 MiB.
      expect(content.length).toBeLessThan(5 * 1024 * 1024);
      // Must contain actual data, not near-empty error output.
      expect(content).toContain('AAAA');
      // Truncation must be reported (5 MiB exceeds the 4 MiB budget).
      expect(content).toContain('truncated');
    },
    { timeout: 30000 },
  );

  it.skipIf(process.platform === 'win32')(
    'handles many small interleaved stdout/stderr chunks',
    async () => {
      const script = createScript(
        tempDir,
        'interleaved.sh',
        '#!/bin/sh\nfor i in $(seq 1 1000); do\n  echo "out-$i"\n  echo "err-$i" >&2\ndone',
      );
      const tool = createDiscoveredTool(script);
      const result = await executeTool(tool);

      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      // Error path includes stderr content. Verify some lines survived.
      expect(content).toContain('out-1');
      expect(content).toContain('err-1');
    },
    { timeout: 15000 },
  );

  it.skipIf(process.platform === 'win32')(
    'handles multibyte UTF-8 content without replacement characters',
    async () => {
      const script = createScript(
        tempDir,
        'multibyte.sh',
        '#!/bin/sh\nprintf "café 世界 \\xe4\\xb8\\x96\\xe7\\x95\\x8c"',
      );
      const tool = createDiscoveredTool(script);
      const result = await executeTool(tool);

      expect(result.error).toBeUndefined();
      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(content).not.toContain('\uFFFD');
    },
    { timeout: 10000 },
  );

  it.skipIf(process.platform === 'win32')(
    'writes params JSON to stdin (observable by the subprocess)',
    async () => {
      const script = createScript(tempDir, 'echo-stdin.sh', '#!/bin/sh\ncat');
      const tool = createDiscoveredTool(script);
      const result = await executeTool(tool, { key: 'value', num: 42 });

      expect(result.error).toBeUndefined();
      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(content).toContain('"key":"value"');
      expect(content).toContain('"num":42');
    },
    { timeout: 10000 },
  );
});

describe('DiscoveredTool already-aborted signal', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it.skipIf(process.platform === 'win32')(
    'does not execute the command when the signal is already aborted',
    async () => {
      // Create a marker script that writes a file when executed.
      const markerPath = join(tempDir, 'executed.marker');
      const script = createScript(
        tempDir,
        'marker.sh',
        `#!/bin/sh\ntouch "${markerPath}"\necho done`,
      );
      const tool = createDiscoveredTool(script);
      const controller = new AbortController();
      controller.abort();

      const result = await executeTool(tool, {}, controller.signal);

      // Must return cancellation result.
      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(content).toMatch(/cancel/i);
      // The marker file must NOT exist — the command was never executed.
      expect(existsSync(markerPath)).toBe(false);
    },
    { timeout: 10000 },
  );
});

describe('DiscoveredTool bounded cancellation', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it.skipIf(process.platform === 'win32')(
    'terminates the subprocess when the abort signal fires',
    async () => {
      const script = createScript(
        tempDir,
        'long-running.sh',
        '#!/bin/sh\nsleep 60\necho done',
      );
      const tool = createDiscoveredTool(script);
      const controller = new AbortController();

      const executePromise = executeTool(tool, {}, controller.signal);
      setTimeout(() => controller.abort(), 200);

      const result = await executePromise;

      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error).toBeDefined();
      // Process was terminated by signal (not "Exit Code: N").
      const signalLine = content
        .split('\n')
        .find((l) => l.startsWith('Signal:'));
      expect(signalLine).toBeDefined();
      expect(signalLine).not.toContain('(none)');
    },
    { timeout: 15000 },
  );

  it.skipIf(process.platform === 'win32')(
    'escalates to SIGKILL for a process that ignores SIGTERM',
    async () => {
      const script = createScript(
        tempDir,
        'ignore-sigterm.sh',
        '#!/bin/sh\ntrap "" TERM\nsleep 60\necho done',
      );
      const tool = createDiscoveredTool(script);
      const controller = new AbortController();

      const executePromise = executeTool(tool, {}, controller.signal);
      setTimeout(() => controller.abort(), 300);

      const startTime = Date.now();
      const result = await executePromise;
      const elapsed = Date.now() - startTime;

      // Must terminate within a bounded time (not wait forever).
      // 300ms initial + 5000ms grace + overhead.
      expect(elapsed).toBeLessThan(10000);

      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(result.error).toBeDefined();
      expect(content).toContain('Signal:');
    },
    { timeout: 15000 },
  );
});

describe('DiscoveredTool unexpected signal is treated as failure', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it.skipIf(process.platform === 'win32')(
    'a process killed by an unexpected signal is reported as failure, not success',
    async () => {
      // Script outputs some content, then sends itself SIGKILL.
      // This is NOT an intentional termination by the tool — the process
      // died unexpectedly. The result must be an error.
      const script = createScript(
        tempDir,
        'self-kill.sh',
        '#!/bin/sh\necho "partial output"\nkill -KILL $$\n',
      );
      const tool = createDiscoveredTool(script);
      const result = await executeTool(tool);

      expect(result.error).toBeDefined();
      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(content).toContain('partial output');
      expect(content).toContain('Signal: SIGKILL');
    },
    { timeout: 10000 },
  );
});

describe('DiscoveredTool spawn error settles promptly (no orphan drain timer)', () => {
  it(
    'a spawn error settles without waiting for the drain timeout',
    async () => {
      const tool = createDiscoveredTool(
        '/nonexistent/path/that/does/not/exist',
      );
      const startTime = Date.now();
      const result = await executeTool(tool);
      const elapsed = Date.now() - startTime;

      expect(result.error).toBeDefined();
      // STREAM_DRAIN_TIMEOUT_MS is 2000. An unguarded post-settlement
      // onExit would install an orphan 2-second drain timer.
      expect(elapsed).toBeLessThan(1500);
    },
    { timeout: 10000 },
  );
});

describe('DiscoveredTool stdin EPIPE during early child exit', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  it.skipIf(process.platform === 'win32')(
    'child exiting immediately during large stdin write does not crash parent',
    async () => {
      const script = createScript(
        tempDir,
        'instant-exit.sh',
        '#!/bin/sh\nexit 1',
      );
      const tool = createDiscoveredTool(script);
      const largeParams = { data: 'A'.repeat(2 * 1024 * 1024) };

      const result = await executeTool(tool, largeParams);

      expect(result.error).toBeDefined();
      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      // stdin EPIPE is the truthful primary failure (first-failure
      // semantics). The key assertion is no uncaught crash.
      expect(content).toContain('Error:');
    },
    { timeout: 15000 },
  );

  it.skipIf(process.platform === 'win32')(
    'child closing stdin immediately with large payload reports truthful result',
    async () => {
      const script = createScript(
        tempDir,
        'close-stdin.sh',
        '#!/bin/sh\nexec cat < /dev/null\nexit 0',
      );
      const tool = createDiscoveredTool(script);
      const largeParams = { data: 'B'.repeat(4 * 1024 * 1024) };

      const result = await executeTool(tool, largeParams);

      const content =
        typeof result.llmContent === 'string' ? result.llmContent : '';
      expect(typeof result.llmContent).toBe('string');
      expect(result.returnDisplay).toBe(content);
      if (result.error !== undefined) {
        expect(result.error.message).toBe(content);
        expect(content).toContain('Exit Code:');
      } else {
        expect(content).toBe('');
      }
    },
    { timeout: 15000 },
  );
});

describe('BoundedCombinedCollector deterministic single huge chunk', () => {
  it('retains bounded head and tail from one huge chunk', () => {
    const collector = new BoundedCombinedCollector({
      budget: createDefaultByteBudget(),
    });
    const budgetBytes = createDefaultByteBudget().bytes;
    const hugeChunk = Buffer.alloc(budgetBytes + 2 * 1024 * 1024, 0x41);
    collector.append(hugeChunk, 'stdout');
    const result = collector.getResult();

    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.observedBytes).toBe(hugeChunk.length);
    expect(result.metadata.retainedBytes).toBeLessThanOrEqual(budgetBytes);
    expect(result.stdoutText.length).toBeLessThanOrEqual(budgetBytes);
    expect(result.stdoutText).toContain('AAAA');
  });

  it('retains all bytes when chunk fits within budget', () => {
    const collector = new BoundedCombinedCollector({
      budget: createDefaultByteBudget(),
    });
    const chunk = Buffer.alloc(1024, 0x42);
    collector.append(chunk, 'stdout');
    const result = collector.getResult();

    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.retainedBytes).toBe(1024);
    expect(result.stdoutText).toHaveLength(1024);
  });
});

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function killDescendantFromMarker(markerPath: string): void {
  let descendantPid: number;
  try {
    descendantPid = Number.parseInt(
      readFileSync(markerPath, 'utf8').trim(),
      10,
    );
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) return;
    throw error;
  }
  if (!Number.isSafeInteger(descendantPid) || descendantPid <= 0) return;
  try {
    process.kill(descendantPid, 'SIGKILL');
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ESRCH')) throw error;
  }
}

describe('DiscoveredTool drain timeout terminates descendant group', () => {
  let tempDir: string;
  let markerPath: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    markerPath = join(tempDir, 'descendant.pid');
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    try {
      killDescendantFromMarker(markerPath);
    } finally {
      cleanup();
    }
  });

  it.skipIf(process.platform === 'win32')(
    'kills a descendant holding inherited pipes after the leader exits',
    async () => {
      const script = createScript(
        tempDir,
        'leak.sh',
        `#!/bin/sh\n(sleep 30) &\necho $! > "${markerPath}"\nexit 0`,
      );
      const tool = createDiscoveredTool(script);

      await executeTool(tool);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const descendantPid = Number.parseInt(
        readFileSync(markerPath, 'utf8').trim(),
        10,
      );
      expect(descendantPid).toBeGreaterThan(0);

      expect(() => process.kill(descendantPid, 0)).toThrow('ESRCH');
    },
    { timeout: 15000 },
  );
});
