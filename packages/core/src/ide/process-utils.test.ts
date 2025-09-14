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
      // Simulate ps command failure
      mockedExec.mockRejectedValue(new Error('ps command failed'));

      const result = await getIdeProcessInfo();

      // Should return fallback values with current process
      expect(result).toEqual({ pid: 1000, command: '' });
    });
  });

  describe('on Windows', () => {
    it('should traverse up and find the great-grandchild of the root process', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      const processInfoMap = new Map([
        [1000, { stdout: 'ParentProcessId=900\r\nCommandLine=node.exe\r\n' }],
        [
          900,
          { stdout: 'ParentProcessId=800\r\nCommandLine=powershell.exe\r\n' },
        ],
        [800, { stdout: 'ParentProcessId=700\r\nCommandLine=code.exe\r\n' }],
        [700, { stdout: 'ParentProcessId=0\r\nCommandLine=wininit.exe\r\n' }],
      ]);
      mockedExec.mockImplementation((command: string) => {
        const pidMatch = command.match(/ProcessId=(\d+)/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          return Promise.resolve(processInfoMap.get(pid));
        }
        return Promise.reject(new Error('Invalid command for mock'));
      });

      const result = await getIdeProcessInfo();
      expect(result).toEqual({ pid: 900, command: 'powershell.exe' });
    });

    it('should handle process command failure gracefully on Windows', async () => {
      (os.platform as Mock).mockReturnValue('win32');
      // Simulate wmic command failure
      mockedExec.mockRejectedValue(new Error('wmic command failed'));

      const result = await getIdeProcessInfo();

      // Should return fallback values with current process
      expect(result).toEqual({ pid: 1000, command: '' });
    });
  });
});
