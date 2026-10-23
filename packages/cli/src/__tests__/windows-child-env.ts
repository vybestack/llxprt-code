/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';

/**
 * Variables a native Windows child needs from its parent even when the rest of
 * the environment is deliberately minimal. Node derives `os.tmpdir()` from
 * `SystemRoot` when TEMP and TMP are absent, and Windows system libraries
 * (crypto, sockets, process creation) read `SystemRoot` and `windir` directly.
 *
 * The machine-level variables after `PATHEXT` are set on every real Windows
 * session. Tools the CLI spawns (git, PowerShell, cmd) and the Windows
 * libraries they load consult them, so a child that lacks them runs in an
 * environment no user has. None of them carries a credential or a path into
 * the real user profile.
 */
const WINDOWS_SYSTEM_VARIABLES = [
  'SystemRoot',
  'windir',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
  'OS',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'NUMBER_OF_PROCESSORS',
  'COMPUTERNAME',
  'USERNAME',
  'USERDOMAIN',
  'PSModulePath',
] as const;

/**
 * The Windows-only part of an isolated child environment.
 *
 * `HOME` and `TMPDIR` are ignored by Windows: `os.homedir()` reads
 * `USERPROFILE` and `os.tmpdir()` reads `TEMP`/`TMP`. An isolated child that
 * sets only the POSIX names therefore resolves its home and temp directories to
 * the real user's, so those are pointed at the isolation roots here.
 * `APPDATA` and `LOCALAPPDATA` are always defined for a real user and are
 * placed under the isolated home, where Windows itself puts them. On other
 * platforms there is nothing to add.
 */
export function windowsChildEnv(
  home: string,
  temp: string,
): Record<string, string> {
  if (process.platform !== 'win32') return {};
  const env: Record<string, string> = {
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TEMP: temp,
    TMP: temp,
  };
  for (const name of WINDOWS_SYSTEM_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
