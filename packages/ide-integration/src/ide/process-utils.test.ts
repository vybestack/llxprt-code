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
  beforeAll,
  beforeEach,
} from 'bun:test';

const mockedExec = vi.fn();
vi.mock('node:util', () => ({
  promisify: vi.fn().mockReturnValue(mockedExec),
}));
vi.mock('util', () => ({
  promisify: vi.fn().mockReturnValue(mockedExec),
}));
const mockedOs = {
  platform: vi.fn(),
  homedir: vi.fn(),
};
vi.mock('node:os', () => ({ default: mockedOs, ...mockedOs }));
vi.mock('os', () => ({ default: mockedOs, ...mockedOs }));

// `process-utils.js` calls `promisify(exec)` at module scope, so it must be
// loaded only after the module mocks above are registered. A static import
// would evaluate it first and capture the real `promisify`.
let getIdeProcessInfo: typeof import('./process-utils.js').getIdeProcessInfo;
const os = mockedOs;

describe('getIdeProcessInfo', () => {
  beforeAll(async () => {
    ({ getIdeProcessInfo } = await import('./process-utils.js'));
  });

  beforeEach(() => {
    Object.defineProperty(process, 'pid', { value: 1000, configurable: true });
    mockedExec.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('on Unix', () => {
    it('should traverse up to find the shell and return grandparent process info', async () => {
      os.platform.mockReturnValue('linux');
      // process (1000) -> shell (800) -> IDE (700)
      mockedExec
        .mockResolvedValueOnce({ stdout: '800 /bin/bash' }) // ps -o ppid=,command= -p 1000 (find shell)
        .mockResolvedValueOnce({ stdout: '700 /usr/lib/vscode/code' }) // ps -o ppid=,command= -p 800 (get grandparent)
        .mockResolvedValueOnce({ stdout: '1 /usr/lib/vscode/code' }); // ps -o ppid=,command= -p 700 (final command lookup)

      const result = await getIdeProcessInfo();

      expect(result).toStrictEqual({
        pid: 700,
        command: '/usr/lib/vscode/code',
      });
    });

    it('should return parent process info if grandparent lookup fails', async () => {
      os.platform.mockReturnValue('linux');
      mockedExec
        .mockResolvedValueOnce({ stdout: '800 /bin/bash' }) // ps -o ppid=,command= -p 1000
        .mockRejectedValueOnce(new Error('ps failed')) // ps -o ppid=,command= -p 800 fails
        .mockResolvedValueOnce({ stdout: '700 /bin/bash' }); // ps -o ppid=,command= -p 800 (final call)

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 800, command: '/bin/bash' });
    });
  });

  describe('on Windows', () => {
    it('should return the IDE executable ancestor instead of a fixed great-grandchild offset', async () => {
      os.platform.mockReturnValue('win32');
      // process (1000) -> powershell (900) -> code (800) -> wininit (700) -> root (0)
      // Ancestors (nearest first): [1000, 900, 800, 700]
      // The IDE executable is code.exe at PID 800; it must win over the
      // previously-returned great-grandchild offset (which yielded 900/powershell).
      const processes = [
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
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 800, command: 'code.exe' });
      expect(mockedExec).toHaveBeenCalledWith(
        expect.stringContaining('Get-CimInstance Win32_Process'),
        expect.anything(),
      );
    });

    it('should return the real IDE process (Code.exe main) when wrapper and shell sit between CLI and Code main (issue #2656)', async () => {
      os.platform.mockReturnValue('win32');
      // Tree from the issue (CLI is process.pid):
      //   CLI(15604) -> start.ts(23676) -> pwsh(29180) -> Code util(26336)
      //     -> Code main(29396) -> wininit(1000) -> root(0)
      // 26336 is a VS Code utility child process (Code.exe --type=utility);
      // 29396 is the Code main process (plain Code.exe) that owns the
      // companion server / port file. The result must be 29396, NOT pwsh
      // (29180) and NOT the utility child (26336).
      const codeMainCmd =
        'C:\\Users\\someone\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
      const codeUtilityCmd = `${codeMainCmd} --type=utility`;
      const processes = [
        {
          ProcessId: 15604,
          ParentProcessId: 23676,
          Name: 'bun.exe',
          CommandLine: 'bun scripts/start.ts',
        },
        {
          ProcessId: 23676,
          ParentProcessId: 29180,
          Name: 'bun.exe',
          CommandLine: 'bun scripts/start.ts',
        },
        {
          ProcessId: 29180,
          ParentProcessId: 26336,
          Name: 'pwsh.exe',
          CommandLine:
            '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command',
        },
        {
          ProcessId: 26336,
          ParentProcessId: 29396,
          Name: 'Code.exe',
          CommandLine: codeUtilityCmd,
        },
        {
          ProcessId: 29396,
          ParentProcessId: 1000,
          Name: 'Code.exe',
          CommandLine: codeMainCmd,
        },
        {
          ProcessId: 1000,
          ParentProcessId: 0,
          Name: 'wininit.exe',
          CommandLine: 'wininit.exe',
        },
      ];
      const originalPid = process.pid;
      Object.defineProperty(process, 'pid', {
        value: 15604,
        configurable: true,
      });
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      try {
        const result = await getIdeProcessInfo();
        expect(result).toStrictEqual({ pid: 29396, command: codeMainCmd });
      } finally {
        Object.defineProperty(process, 'pid', {
          value: originalPid,
          configurable: true,
        });
      }
    });

    it('should pick the nearest main IDE ancestor when multiple Code.exe main windows exist in the tree', async () => {
      os.platform.mockReturnValue('win32');
      // process(1000) -> shell(900) -> Code main window A(800, plain Code.exe)
      //   -> Code main window B(700, plain Code.exe) -> root(0)
      // Neither Code.exe is a VS Code child process (no --type=), so both are
      // valid main candidates; the one closer to the CLI (800) must win for
      // determinism. VS Code child/utility processes (which carry --type=) are
      // excluded as non-main, see the issue #2656 test.
      const nearCmd =
        'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
      const farCmd =
        'C:\\Users\\y\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'pwsh.exe',
          CommandLine: 'pwsh.exe',
        },
        {
          ProcessId: 800,
          ParentProcessId: 700,
          Name: 'Code.exe',
          CommandLine: nearCmd,
        },
        {
          ProcessId: 700,
          ParentProcessId: 0,
          Name: 'Code.exe',
          CommandLine: farCmd,
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 800, command: nearCmd });
    });

    it('should match IDE executables case-insensitively', async () => {
      os.platform.mockReturnValue('win32');
      // process(1000) -> shell(900) -> code.exe (lowercase, 800) -> root(0)
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'pwsh.exe',
          CommandLine: 'pwsh.exe',
        },
        {
          ProcessId: 800,
          ParentProcessId: 0,
          Name: 'code.exe',
          CommandLine: 'code.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 800, command: 'code.exe' });
    });

    it('should match an IDE ancestor whose CommandLine is a quoted Windows path with spaces (Name does not match)', async () => {
      os.platform.mockReturnValue('win32');
      // process(1000) -> shell(900) -> Code main(800) -> wininit(700) -> root(0).
      // The Code process has an empty/non-IDE Name and a *quoted* CommandLine
      // containing spaces:
      //   "C:\Program Files\Microsoft VS Code\Code.exe" --reuse-window
      // The bare split(/\s+/)[0] would yield `"C:\Program` (basename `program`),
      // failing to match. Tokenization must respect the leading quote so the
      // real basename `Code.exe` is extracted and PID 800 is selected. Without
      // the fix, no ancestor matches and the fallback returns wininit (700).
      const quotedCmd = `"C:\\Program Files\\Microsoft VS Code\\Code.exe" --reuse-window`;
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'pwsh.exe',
          CommandLine: 'pwsh.exe',
        },
        {
          ProcessId: 800,
          ParentProcessId: 700,
          Name: '',
          CommandLine: quotedCmd,
        },
        {
          ProcessId: 700,
          ParentProcessId: 0,
          Name: 'wininit.exe',
          CommandLine: 'wininit.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 800, command: quotedCmd });
    });

    it('should not exclude a main IDE whose command path contains --type= as a substring but not as a switch', async () => {
      os.platform.mockReturnValue('win32');
      // process(1000) -> shell(900) -> Code main(800) -> wininit(700) -> root(0).
      // The Code CommandLine includes the substring `--type=` inside an
      // unrelated argument (`C:\work\project--type=demo-notes`), which is NOT
      // the Electron process-type switch. The main window must still be
      // selected. With the old loose `--type=` substring test, the Code
      // process is wrongly excluded and the fallback returns wininit (700).
      const substringCmd = `Code.exe C:\\work\\project--type=demo-notes`;
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'pwsh.exe',
          CommandLine: 'pwsh.exe',
        },
        {
          ProcessId: 800,
          ParentProcessId: 700,
          Name: 'Code.exe',
          CommandLine: substringCmd,
        },
        {
          ProcessId: 700,
          ParentProcessId: 0,
          Name: 'wininit.exe',
          CommandLine: 'wininit.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 800, command: substringCmd });
    });

    it('should still exclude a VS Code utility child whose command has --type= as a real switch', async () => {
      os.platform.mockReturnValue('win32');
      // process(1000) -> Code utility(900, Code.exe --type=utility)
      //   -> Code main(800, Code.exe) -> root(0)
      // The utility child carries the real `--type=utility` switch (a distinct
      // token preceded by whitespace); it must be excluded so the main window
      // (800) is selected.
      const utilityCmd = `C:\\app\\Code.exe --type=utility`;
      const mainCmd = `C:\\app\\Code.exe`;
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'Code.exe',
          CommandLine: utilityCmd,
        },
        {
          ProcessId: 800,
          ParentProcessId: 0,
          Name: 'Code.exe',
          CommandLine: mainCmd,
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 800, command: mainCmd });
    });

    it('should fall back to the top-level ancestor when no IDE executable matches', async () => {
      os.platform.mockReturnValue('win32');
      // process(1000) -> foo(900) -> bar(800) -> wininit(700, root)
      // No name matches a known IDE; fall back to the top-level reachable
      // ancestor (700), preserving current best-effort behavior.
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'foo.exe',
          CommandLine: 'foo.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'bar.exe',
          CommandLine: 'bar.exe',
        },
        {
          ProcessId: 800,
          ParentProcessId: 700,
          Name: 'baz.exe',
          CommandLine: 'baz.exe',
        },
        {
          ProcessId: 700,
          ParentProcessId: 0,
          Name: 'wininit.exe',
          CommandLine: 'wininit.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 700, command: 'wininit.exe' });
    });

    it('should handle short process chains', async () => {
      os.platform.mockReturnValue('win32');
      // process (1000) -> root (0)
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 0,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 1000, command: 'node.exe' });
    });

    it('should handle PowerShell failure gracefully', async () => {
      os.platform.mockReturnValue('win32');
      mockedExec.mockRejectedValueOnce(new Error('PowerShell failed'));
      // Fallback to getProcessInfo for current PID
      mockedExec.mockResolvedValueOnce({ stdout: '' }); // ps command fails on windows

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 1000, command: '' });
    });

    it('should handle malformed JSON output gracefully', async () => {
      os.platform.mockReturnValue('win32');
      mockedExec.mockResolvedValueOnce({ stdout: '{"invalid":json}' });
      // Fallback to getProcessInfo for current PID
      mockedExec.mockResolvedValueOnce({ stdout: '' });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 1000, command: '' });
    });

    it('should handle single process output from ConvertTo-Json', async () => {
      os.platform.mockReturnValue('win32');
      const process = {
        ProcessId: 1000,
        ParentProcessId: 0,
        Name: 'node.exe',
        CommandLine: 'node.exe',
      };
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(process) });

      const result = await getIdeProcessInfo();
      expect(result).toStrictEqual({ pid: 1000, command: 'node.exe' });
    });

    it('should handle missing process in map during traversal', async () => {
      os.platform.mockReturnValue('win32');
      // process (1000) -> parent (900) -> missing (800)
      const processes = [
        {
          ProcessId: 1000,
          ParentProcessId: 900,
          Name: 'node.exe',
          CommandLine: 'node.exe',
        },
        {
          ProcessId: 900,
          ParentProcessId: 800,
          Name: 'parent.exe',
          CommandLine: 'parent.exe',
        },
      ];
      mockedExec.mockResolvedValueOnce({ stdout: JSON.stringify(processes) });

      const result = await getIdeProcessInfo();
      // Ancestors: [1000, 900] (800 is missing). No IDE match, so the
      // top-level reachable ancestor (900) is returned as best-effort.
      expect(result).toStrictEqual({ pid: 900, command: 'parent.exe' });
    });
  });
});
