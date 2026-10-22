/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Variables a native Windows child needs from its parent even when the rest of
 * the environment is deliberately minimal. Node derives `os.tmpdir()` from
 * `SystemRoot` when TEMP and TMP are absent, and Windows system libraries
 * (crypto, sockets, process creation) read `SystemRoot` and `windir` directly.
 */
const WINDOWS_SYSTEM_VARIABLES = [
  'SystemRoot',
  'windir',
  'SystemDrive',
  'ComSpec',
  'PATHEXT',
] as const;

/**
 * The Windows-only part of an isolated child environment.
 *
 * `HOME` and `TMPDIR` are ignored by Windows: `os.homedir()` reads
 * `USERPROFILE` and `os.tmpdir()` reads `TEMP`/`TMP`. An isolated child that
 * sets only the POSIX names therefore resolves its home and temp directories to
 * the real user's, so those are pointed at the isolation roots here. On other
 * platforms there is nothing to add.
 */
export function windowsChildEnv(
  home: string,
  temp: string,
): Record<string, string> {
  if (process.platform !== 'win32') return {};
  const env: Record<string, string> = {
    USERPROFILE: home,
    TEMP: temp,
    TMP: temp,
  };
  for (const name of WINDOWS_SYSTEM_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
