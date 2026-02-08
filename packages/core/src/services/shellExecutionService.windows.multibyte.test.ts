/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import { spawn } from 'child_process';
import EventEmitter from 'events';
import { Readable } from 'stream';
import { ShellExecutionService } from './shellExecutionService.js';
import type { ChildProcess } from 'child_process';

vi.mock('os');
vi.mock('child_process');
vi.mock('../utils/textUtils.js', () => ({ isBinary: () => false }));
vi.mock('strip-ansi', () => ({ default: (s: string) => s }));
vi.mock('../utils/systemEncoding.js', () => ({
  getSystemEncoding: vi.fn().mockReturnValue('utf-8'),
  getCachedEncodingForBuffer: vi.fn().mockReturnValue('utf-8'),
}));

describe('ShellExecutionService Windows multibyte regression tests', () => {
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  const defaultShellConfig = {
    showColor: false,
    scrollback: 600000,
    terminalWidth: 80,
    terminalHeight: 24,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.platform).mockReturnValue('win32');

    mockChildProcess = new EventEmitter() as EventEmitter &
      Partial<ChildProcess>;
    mockChildProcess.stdout = new EventEmitter() as Readable;
    mockChildProcess.stderr = new EventEmitter() as Readable;
    mockChildProcess.kill = vi.fn();

    Object.defineProperty(mockChildProcess, 'pid', {
      value: 12345,
      configurable: true,
    });

    vi.mocked(spawn).mockReturnValue(mockChildProcess as ChildProcess);
  });

  it('should handle Japanese text in shell commands without hanging', async () => {
    const command = 'echo "こんにちは世界"';
    const expectedOutput = 'こんにちは世界\r\n';

    const promise = await ShellExecutionService.execute(
      command,
      '.',
      () => {},
      new AbortController().signal,
      false, // shouldUseNodePty - false for child_process path
      defaultShellConfig,
    );

    // Simulate Windows cmd.exe outputting Japanese text
    setImmediate(() => {
      mockChildProcess.stdout?.emit(
        'data',
        Buffer.from(expectedOutput, 'utf-8'),
      );
      mockChildProcess.emit('exit', 0, null);
    });

    const result = await promise.result;

    // Should use powershell.exe on Windows (new shell-utils architecture)
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', command],
      expect.objectContaining({
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: expect.objectContaining({ LLXPRT_CODE: '1' }),
      }),
    );

    expect(result.output).toContain('こんにちは世界');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
  });

  it('should handle commands with Japanese filenames', async () => {
    const command = 'dir "テストファイル.txt"';

    const promise = await ShellExecutionService.execute(
      command,
      '.',
      () => {},
      new AbortController().signal,
      false,
      defaultShellConfig,
    );

    setImmediate(() => {
      mockChildProcess.stdout?.emit(
        'data',
        Buffer.from('テストファイル.txt', 'utf-8'),
      );
      mockChildProcess.emit('exit', 0, null);
    });

    const result = await promise.result;

    expect(result.output).toContain('テストファイル.txt');
    expect(result.exitCode).toBe(0);
  });

  it.skipIf(process.platform !== 'win32')(
    'should handle mixed English and Japanese output',
    async () => {
      const command = 'echo "Hello 世界"';
      const mixedOutput = 'Hello 世界\r\n';

      const promise = await ShellExecutionService.execute(
        command,
        '.',
        () => {},
        new AbortController().signal,
        false,
        defaultShellConfig,
      );

      setImmediate(() => {
        // Split the output to test chunked decoding
        const buffer = Buffer.from(mixedOutput, 'utf-8');
        mockChildProcess.stdout?.emit('data', buffer.slice(0, 7)); // "Hello "
        mockChildProcess.stdout?.emit('data', buffer.slice(7)); // "世界\r\n"
        mockChildProcess.emit('exit', 0, null);
      });

      const result = await promise.result;

      expect(result.output).toContain('Hello 世界');
      expect(result.exitCode).toBe(0);
    },
  );

  it('should not escape quotes excessively in commands', async () => {
    const command = 'git commit -m "日本語のコミットメッセージ"';

    await ShellExecutionService.execute(
      command,
      '.',
      () => {},
      new AbortController().signal,
      false,
      defaultShellConfig,
    );

    // Should use powershell.exe with command as argument (no extra quote escaping)
    expect(spawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', command],
      expect.objectContaining({ shell: false }),
    );

    // Should NOT be called with excessive quoting like:
    // cmd.exe """/c""" """git" "commit" "-m" "日本語のコミットメッセージ"""
    expect(spawn).not.toHaveBeenCalledWith(
      expect.stringContaining('"""/c"""'),
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('should handle error output with Japanese text', async () => {
    const command = 'badcommand';
    const errorMessage =
      "'badcommand' は、内部コマンドまたは外部コマンド、\r\n操作可能なプログラムまたはバッチ ファイルとして認識されていません。\r\n";

    const promise = await ShellExecutionService.execute(
      command,
      '.',
      () => {},
      new AbortController().signal,
      false,
      defaultShellConfig,
    );

    setImmediate(() => {
      mockChildProcess.stderr?.emit('data', Buffer.from(errorMessage, 'utf-8'));
      mockChildProcess.emit('exit', 1, null);
    });

    const result = await promise.result;

    // ShellExecutionResult uses `output` which combines stdout+stderr
    expect(result.output).toContain('badcommand');
    expect(result.output).toContain('認識されていません');
    expect(result.exitCode).toBe(1);
  });
});
