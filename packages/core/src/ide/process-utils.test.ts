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

const originalPidDescriptor = Object.getOwnPropertyDescriptor(process, 'pid');

describe('getIdeProcessInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'pid', { value: 1000, configurable: true });
    mockedExec.mockReset();
  });

  afterEach(() => {
    if (originalPidDescriptor) {
      Object.defineProperty(process, 'pid', originalPidDescriptor);
    }
  });

  describe('on Unix', () => {
    it('should traverse up to find the shell and return grandparent process info', async () => {
      (os.platform as Mock).mockReturnValue('linux');
      // process (1000) -> shell (800) -> IDE (700)
      mockedExec
        .mockResolvedValueOnce({ stdout: '800 /bin/bash' }) // pid 1000 -> ppid 800, comm (shell)
        .mockResolvedValueOnce({ stdout: '/usr/bin/bash --login' }) // pid 1000 full command
        .mockResolvedValueOnce({ stdout: '700 /usr/bin/code' }) // pid 800 -> ppid 700 (IDE)
        .mockResolvedValueOnce({ stdout: '/usr/lib/vscode/code' }) // pid 800 full command
        .mockResolvedValueOnce({ stdout: '1 systemd' }) // pid 700 -> ppid 1
        .mockResolvedValueOnce({ stdout: '/usr/lib/vscode/code --no-sandbox' }); // pid 700 full command

      const result = await getIdeProcessInfo();

      expect(result).toEqual({
        pid: 700,
        command: '/usr/lib/vscode/code --no-sandbox',
      });
    });

    it('should return parent process info if grandparent lookup fails', async () => {
      (os.platform as Mock).mockReturnValue('linux');
      mockedExec
        .mockResolvedValueOnce({ stdout: '800 /bin/bash' }) // pid 1000 -> ppid 800 (shell)
        .mockResolvedValueOnce({ stdout: '/usr/bin/bash --login' }) // pid 1000 full command
        .mockRejectedValueOnce(new Error('ps failed')) // lookup for ppid of 800 fails (grandparent)
        .mockResolvedValueOnce({ stdout: '700 /usr/bin/code' }) // get ppid/comm for pid 800 (final lookup)
        .mockResolvedValueOnce({ stdout: '/usr/lib/vscode/code --no-sandbox' }); // get command for pid 800 (final lookup)

      const result = await getIdeProcessInfo();
      expect(result).toEqual({
        pid: 800,
        command: '/usr/lib/vscode/code --no-sandbox',
      });
    });

    it('should handle process command failure gracefully', async () => {
      (os.platform as Mock).mockReturnValue('linux');
      mockedExec.mockRejectedValue(new Error('ps command failed'));

      const result = await getIdeProcessInfo();

      expect(result).toEqual({ pid: 1000, command: '' });
    });
  });

  describe('on Windows', () => {
    it('should traverse up and find the great-grandchild of the root process', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      const processInfoMap = new Map([
        [
          1000,
          {
            stdout:
              '{"Name":"node.exe","ParentProcessId":900,"CommandLine":"node.exe"}',
          },
        ],
        [
          900,
          {
            stdout:
              '{"Name":"powershell.exe","ParentProcessId":800,"CommandLine":"powershell.exe"}',
          },
        ],
        [
          800,
          {
            stdout:
              '{"Name":"code.exe","ParentProcessId":700,"CommandLine":"code.exe"}',
          },
        ],
        [
          700,
          {
            stdout:
              '{"Name":"wininit.exe","ParentProcessId":0,"CommandLine":"wininit.exe"}',
          },
        ],
      ]);
      mockedExec.mockImplementation((command: string) => {
        const pidMatch = command.match(/ProcessId=(\d+)/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          return Promise.resolve(processInfoMap.get(pid) || { stdout: '' });
        }
        return Promise.reject(new Error('Invalid command for mock'));
      });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 900, command: 'powershell.exe' });
    });

    it('should handle non-existent process gracefully', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      mockedExec
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({
          stdout:
            '{"Name":"fallback.exe","ParentProcessId":0,"CommandLine":"fallback.exe"}',
        });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 1000, command: 'fallback.exe' });
    });

    it('should handle malformed JSON output gracefully', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      mockedExec
        .mockResolvedValueOnce({ stdout: '{"invalid":json}' })
        .mockResolvedValueOnce({
          stdout:
            '{"Name":"fallback.exe","ParentProcessId":0,"CommandLine":"fallback.exe"}',
        });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 1000, command: 'fallback.exe' });
    });

    it('should handle PowerShell command errors gracefully', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      mockedExec.mockRejectedValue(new Error('powershell command failed'));

      const result = await getIdeProcessInfo();

      expect(result).toEqual({ pid: 1000, command: '' });
    });

    it('should handle PowerShell errors without breaking traversal', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      const processInfoMap = new Map([
        [1000, { stdout: '' }],
        [
          1001,
          {
            stdout:
              '{"Name":"parent.exe","ParentProcessId":800,"CommandLine":"parent.exe"}',
          },
        ],
        [
          800,
          {
            stdout:
              '{"Name":"ide.exe","ParentProcessId":0,"CommandLine":"ide.exe"}',
          },
        ],
      ]);

      Object.defineProperty(process, 'pid', {
        value: 1001,
        configurable: true,
      });

      mockedExec.mockImplementation((command: string) => {
        const pidMatch = command.match(/ProcessId=(\d+)/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          return Promise.resolve(processInfoMap.get(pid) || { stdout: '' });
        }
        return Promise.reject(new Error('Invalid command for mock'));
      });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 1001, command: 'parent.exe' });
    });

    it('should handle partial JSON data with defaults', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      mockedExec
        .mockResolvedValueOnce({ stdout: '{"Name":"partial.exe"}' })
        .mockResolvedValueOnce({
          stdout:
            '{"Name":"root.exe","ParentProcessId":0,"CommandLine":"root.exe"}',
        });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 1000, command: 'root.exe' });
    });
  });
});
