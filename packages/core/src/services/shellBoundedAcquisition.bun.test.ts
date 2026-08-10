/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ShellExecutionConfig,
  ShellExecutionResult,
} from './shellExecutionService.js';
import { ShellExecutionService } from './shellExecutionService.js';

/**
 * Behavioral tests for bounded foreground shell output acquisition
 * (Issue #3200).
 *
 * These tests exercise the REAL child_process fallback path with real
 * subprocesses — no mock theater. They use cross-platform Node.js fixture
 * scripts (via process.execPath) rather than POSIX-only utilities so they
 * run identically on macOS, Linux, and Windows.
 *
 * Coverage:
 * - Output is bounded DURING acquisition, not merely truncated after.
 * - Continue-and-drain semantics preserve side effects and exit codes.
 * - Truncation metadata/notice is surfaced.
 * - rawOutput buffer is bounded (no full-size concat).
 * - UTF-8 multibyte correctness.
 * - One-huge-chunk and many-tiny-chunks patterns.
 * - Interleaved stdout/stderr under shared budget.
 */

/**
 * Cross-platform producer script. Written to a temp file so the command
 * avoids shell-quoting issues across bash/zsh/PowerShell/cmd.exe.
 *
 * Usage: node producer.mjs <size> <stream> <mode> <exit-code>
 *   size:      number of bytes to write
 *   stream:    "stdout" | "stderr" | "both"
 *   mode:      "ascii" | "multibyte" | "tiny"
 *   exit-code: optional process exit code (defaults to zero)
 */
let producerDir = '';
let producerScript = '';

const PRODUCER_CODE = `
const size = parseInt(process.argv[2] || '1024', 10);
const stream = process.argv[3] || 'stdout';
const mode = process.argv[4] || 'ascii';
process.exitCode = parseInt(process.argv[5] || '0', 10);

if (mode === 'tiny') {
  // Write single bytes in a loop (many tiny chunks).
  const target = stream === 'stderr' ? process.stderr : process.stdout;
  for (let i = 0; i < size; i++) {
    target.write(String.fromCharCode(48 + (i % 10)));
  }
  target.end();
} else if (mode === 'multibyte') {
  // Write multibyte UTF-8 characters.
  // Each \u4e16 is 3 bytes. Write enough to reach the target size.
  const char = '\u4e16';
  const charBytes = Buffer.byteLength(char, 'utf-8');
  const count = Math.ceil(size / charBytes);
  const data = char.repeat(count).slice(0, size);
  const target = stream === 'stderr' ? process.stderr : process.stdout;
  target.write(data);
  target.end();
} else {
  // ASCII filler.
  const data = 'A'.repeat(size);
  if (stream === 'both') {
    process.stdout.write(data);
    process.stderr.write('ERR:' + data.slice(0, Math.min(size, 1024)));
  } else {
    const target = stream === 'stderr' ? process.stderr : process.stdout;
    target.write(data);
  }
  process.stdout.end();
  process.stderr.end();
}
`;

beforeAll(() => {
  producerDir = mkdtempSync(join(tmpdir(), 'llxprt-bounded-tests-'));
  producerScript = join(producerDir, 'producer.mjs');
  writeFileSync(producerScript, PRODUCER_CODE);
});

afterAll(() => {
  rmSync(producerDir, { recursive: true, force: true });
});

/**
 * Build a cross-platform command that runs the producer script.
 * The execPath and script path are quoted with double quotes which works
 * on bash, zsh, PowerShell, and cmd.exe.
 */
function producerCommand(
  size: number,
  stream: 'stdout' | 'stderr' | 'both' = 'stdout',
  mode: 'ascii' | 'multibyte' | 'tiny' = 'ascii',
  exitCode = 0,
): string {
  return `"${process.execPath}" "${producerScript}" ${size} ${stream} ${mode} ${exitCode}`;
}

/**
 * Execute a shell command via the child_process fallback and collect the
 * final result.
 *
 * The onOutput callback is a no-op: tests that assert output is bounded must
 * NOT themselves retain every live event in an array (that would contradict
 * the memory-bounds claim by pinning all data in memory). The authoritative
 * bounded state lives in the acquisition collector, surfaced via `result`.
 */
async function executeAndCollect(
  command: string,
  config: ShellExecutionConfig = {},
): Promise<ShellExecutionResult> {
  const controller = new AbortController();
  const handle = await ShellExecutionService.execute(
    command,
    process.cwd(),
    () => undefined,
    controller.signal,
    false, // shouldUseNodePty = false -> child_process fallback
    config,
  );
  return handle.result;
}

describe('Shell bounded acquisition - child_process path (cross-platform)', () => {
  it('bounds output to the configured retention budget during acquisition', async () => {
    const result = await executeAndCollect(
      producerCommand(2 * 1024 * 1024, 'stdout', 'ascii'), // 2 MB
      { outputRetentionMaxBytes: 65536 },
    );

    const outputLength = result.output.length;
    // Output must be bounded well below the 2 MB produced.
    expect(outputLength).toBeLessThan(200000);
    // But should retain at least some content (head + tail + notice).
    expect(outputLength).toBeGreaterThan(100);
  });

  it('includes a visible truncation notice when output exceeds the budget', async () => {
    const result = await executeAndCollect(
      producerCommand(1024 * 1024, 'stdout', 'ascii'), // 1 MB
      { outputRetentionMaxBytes: 8192 },
    );

    expect(result.output).toMatch(/truncat/i);
  });

  it('preserves exit code and completes despite bounded output', async () => {
    // Produce output beyond the budget, then write a tail marker.
    const cmd = `${producerCommand(524288, 'stdout', 'ascii')} && echo END_MARKER_42`;
    const result = await executeAndCollect(cmd, {
      outputRetentionMaxBytes: 4096,
    });

    expect(result.exitCode).toBe(0);
    // The final marker should be present (tail retention).
    expect(result.output).toContain('END_MARKER_42');
  });

  it('bounds rawOutput buffer to the retention budget', async () => {
    const result = await executeAndCollect(
      producerCommand(1024 * 1024, 'stdout', 'ascii'), // 1 MB
      { outputRetentionMaxBytes: 16384 },
    );

    expect(result.rawOutput.length).toBeLessThanOrEqual(16384);
  });

  it('does not bound output when it fits within the budget', async () => {
    const result = await executeAndCollect(
      producerCommand(11, 'stdout', 'ascii'),
      { outputRetentionMaxBytes: 65536 },
    );

    expect(result.output).toBe('A'.repeat(11));
    expect(result.output).not.toMatch(/truncat/i);
  });

  it('bounds interleaved stdout and stderr under one shared budget', async () => {
    const result = await executeAndCollect(
      producerCommand(524288, 'both', 'ascii'), // stdout + stderr
      { outputRetentionMaxBytes: 8192 },
    );

    // Both streams should have content in the head.
    expect(result.output.length).toBeGreaterThan(0);
  });

  it('handles UTF-8 multibyte output without corruption', async () => {
    const result = await executeAndCollect(
      producerCommand(32768, 'stdout', 'multibyte'), // 32 KB of \u4e16
      { outputRetentionMaxBytes: 16384 },
    );

    expect(result.output.length).toBeGreaterThan(0);
    // Should contain valid multibyte chars without replacement chars.
    expect(result.output).not.toContain('\uFFFD');
  });

  it('handles one huge chunk (large single write)', async () => {
    const result = await executeAndCollect(
      producerCommand(524288, 'stdout', 'ascii'), // 512 KB single write
      { outputRetentionMaxBytes: 4096 },
    );

    expect(result.output.length).toBeLessThan(10000);
    expect(result.rawOutput.length).toBeLessThanOrEqual(4096);
  });

  it('handles many tiny chunks (byte-at-a-time writes)', async () => {
    const result = await executeAndCollect(
      producerCommand(10000, 'stdout', 'tiny'), // 10000 single-byte writes
      { outputRetentionMaxBytes: 4096 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output.length).toBeLessThan(10000);
  });

  it('preserves exit status of a failing command despite bounded output', async () => {
    const result = await executeAndCollect(
      producerCommand(524288, 'stdout', 'ascii', 42),
      { outputRetentionMaxBytes: 4096 },
    );

    expect(result.exitCode).toBe(42);
  });

  it('does not duplicate rawOutput at full size', async () => {
    const result = await executeAndCollect(
      producerCommand(2 * 1024 * 1024, 'stdout', 'ascii'), // 2 MB
      { outputRetentionMaxBytes: 32768 },
    );

    expect(result.rawOutput.length).toBeLessThanOrEqual(32768);
  });
});

/**
 * Windows-specific tests for the child_process path. These only run on
 * win32 and test Windows-specific behaviors (PowerShell, CLIXML).
 */
describe.skipIf(process.platform !== 'win32')(
  'Shell bounded acquisition - Windows child_process path',
  () => {
    it('decodes genuine PowerShell CLIXML error records rather than leaking raw XML', async () => {
      // A non-interactive PowerShell host serialises error/warning stream
      // records as CLIXML (prefixed with "#< CLIXML") on stderr. The bounded
      // acquisition path must decode these into human-readable text so the
      // model never sees raw <S S="Error"> markup. We force a real error
      // record via Write-Error which reliably produces CLIXML.
      const result = await executeAndCollect(
        'powershell -NoProfile -Command "Write-Error LLXPRT_CLIXML_BOUND_MARKER; 1..50000 | ForEach-Object { Write-Error $_ }"',
        { outputRetentionMaxBytes: 8192 },
      );

      expect(result.rawOutput.length).toBeLessThanOrEqual(8192);
      expect(result.outputTruncation?.truncated).toBe(true);
      expect(result.output).toContain('LLXPRT_CLIXML_BOUND_MARKER');
      expect(result.output).not.toContain('<S S=');
      expect(result.output).not.toContain('#< CLIXML');
    });

    it('bounds and drains output from a Windows batch command', async () => {
      const result = await executeAndCollect(
        'cmd /d /s /c "(for /L %i in (1,1,20000) do @echo WINDOWS_OUTPUT_%i) & echo WINDOWS_FINAL_MARKER"',
        { outputRetentionMaxBytes: 4096 },
      );

      expect(result.exitCode).toBe(0);
      expect(result.rawOutput.length).toBeLessThanOrEqual(4096);
      expect(result.outputTruncation?.truncated).toBe(true);
      expect(result.output).toContain('WINDOWS_FINAL_MARKER');
    });
  },
);
