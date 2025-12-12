/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
  type Mock,
} from 'vitest';
import { getIdeProcessInfo } from './process-utils.js';
import os from 'node:os';

const mockedExec = vi.hoisted(() => vi.fn());
vi.mock('node:util', () => ({
  promisify: vi.fn().mockReturnValue(mockedExec),
}));
vi.mock('node:os', () => ({
  default: {
    platform: vi.fn(),
  },
}));

describe('getIdeProcessInfo', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'pid', { value: 1000, configurable: true });
    mockedExec.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('on Unix', () => {
    it('should traverse up to find the shell and return grandparent process info', async () => {
      (os.platform as Mock).mockReturnValue('linux');
      // process (1000) -> shell (800) -> IDE (700)
      mockedExec
        .mockResolvedValueOnce({ stdout: '800 /bin/bash' }) // ps -o ppid=,command= -p 1000 (find shell)
        .mockResolvedValueOnce({ stdout: '/bin/bash' }) // ps -o command= -p 1000 (find shell)
        .mockResolvedValueOnce({ stdout: '700 /usr/lib/vscode/code' }) // ps -o ppid=,command= -p 800 (get grandparent)
        .mockResolvedValueOnce({ stdout: '/usr/lib/vscode/code' }) // ps -o command= -p 800 (get grandparent)
        .mockResolvedValueOnce({ stdout: '700 /usr/lib/vscode/code' }) // ps -o ppid=,command= -p 700 (final command lookup)
        .mockResolvedValueOnce({ stdout: '/usr/lib/vscode/code' }); // ps -o command= -p 700 (final command lookup)

      const result = await getIdeProcessInfo();

      expect(result).toEqual({ pid: 700, command: '/usr/lib/vscode/code' });
    });

    it('should return parent process info if grandparent lookup fails', async () => {
      (os.platform as Mock).mockReturnValue('linux');
      mockedExec
        .mockResolvedValueOnce({ stdout: '800 /bin/bash' }) // ps -o ppid=,command= -p 1000
        .mockResolvedValueOnce({ stdout: '/bin/bash' }) // ps -o command= -p 1000
        .mockRejectedValueOnce(new Error('ps failed')) // ps -o ppid=,command= -p 800 fails
        .mockResolvedValueOnce({ stdout: '800 /bin/bash' }) // ps -o ppid=,command= -p 800 (final call)
        .mockResolvedValueOnce({ stdout: '/bin/bash' }); // ps -o command= -p 800 (final call)

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 800, command: '/bin/bash' });
    });
  });

  describe('on Windows', () => {
    it('should traverse up and find the great-grandchild of the root process', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      // Mock the single PowerShell call that returns all processes
      const allProcesses = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'powershell.exe',
          CommandLine: 'powershell.exe',
        },
        {
          ProcessId: 800,
          ParentProcessId: 700,
          Name: 'code.exe',
          CommandLine: 'code.exe',
        },
        {
          ProcessId: 700,
          ParentProcessId: 0,
          Name: 'wininit.exe',
          CommandLine: 'wininit.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({
        stdout: JSON.stringify(allProcesses),
      });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 900, command: 'powershell.exe' });
    });

    it('should handle non-existent process gracefully', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      // Mock all processes but the current process PID is missing from the list
      const allProcesses = [
        {
          ProcessId: 900,
          ParentProcessId: 0,
          Name: 'fallback.exe',
          CommandLine: 'fallback.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({
        stdout: JSON.stringify(allProcesses),
      });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 1000, command: '' });
    });

    it('should handle malformed JSON output gracefully', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      // Mock malformed JSON response from PowerShell
      mockedExec.mockResolvedValueOnce({ stdout: '{"invalid":json}' });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 1000, command: '' });
    });

    it('should handle PowerShell errors without crashing the process chain', async () => {
      (os.platform as Mock).mockReturnValue('win32');

      // Mock the process.pid to test traversal with missing processes
      Object.defineProperty(process, 'pid', {
        value: 1001,
        configurable: true,
      });

      // Mock all processes where current process exists but some parents may be missing
      const allProcesses = [
        {
          ProcessId: 1001,
          ParentProcessId: 800,
          Name: 'parent.exe',
          CommandLine: 'parent.exe',
        },
        {
          ProcessId: 800,
          ParentProcessId: 0,
          Name: 'ide.exe',
          CommandLine: 'ide.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({
        stdout: JSON.stringify(allProcesses),
      });

      const result = await getIdeProcessInfo();
      // Should return the current process command since traversal continues despite missing processes
      expect(result).toEqual({ pid: 1001, command: 'parent.exe' });

      // Reset process.pid
      Object.defineProperty(process, 'pid', {
        value: 1000,
        configurable: true,
      });
    });

    it('should handle partial JSON data with defaults', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      // Mock processes with some fields missing - should use defaults
      const allProcesses = [
        {
          ProcessId: 1000,
          Name: 'partial.exe',
          // Missing ParentProcessId, should default to 0
          // Missing CommandLine
        },
        {
          ProcessId: 900,
          ParentProcessId: 0,
          Name: 'root.exe',
          CommandLine: 'root.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({
        stdout: JSON.stringify(allProcesses),
      });

      const result = await getIdeProcessInfo();
      // Current process has parent 0 (default), so it's already at root
      expect(result).toEqual({ pid: 1000, command: '' });
    });
  });
});
