/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Variant selection for the `@oven/bun-<platform>` fallback (issue #2978).
 *
 * npm v12 disables dependency install scripts by default (RFC 0054), so the
 * `bun` package's `postinstall` (`install.js`) — which MOVES the binary out of
 * the matching `@oven/bun-<platform>` optional dependency into
 * `bun/bin/bun.exe` — never runs. Every Bun resolver that only looks for
 * `bun/bin/bun.exe` then fails. The `@oven/bun-<platform>` tarballs contain
 * only `bin/bun`, `package.json`, and `README.md` (NO scripts), so they
 * materialize under default-deny. This module selects the correct variant for
 * a host from that set.
 *
 * The platform table is transcribed verbatim from `node_modules/bun/install.js`
 * (bun@1.3.14). One DELIBERATE deviation from upstream is documented below:
 * on a musl host, musl variants are ordered FIRST with glibc as a last resort.
 *
 * This module's selection logic is pure (no I/O) so it can be tested across
 * every host tuple without spawning anything. The side-effecting host detection
 * lives in {@link detectHostPlatform} and is invoked ONLY on the `@oven`
 * fallback path — i.e. only after `bun/bin/bun.exe` was confirmed absent.
 */

/**
 * A single row of the upstream platform table. `avx2` truthy means the package
 * requires AVX2 (it crashes with SIGILL on a baseline CPU). `abi` is set only
 * for musl and android variants.
 */
interface PlatformRow {
  readonly os: string;
  readonly arch: string;
  readonly avx2?: boolean;
  readonly abi?: HostAbi;
  readonly bin: string;
  readonly exe: string;
}

/**
 * The authoritative platform table, transcribed from
 * `node_modules/bun/install.js` (bun@1.3.14). Order within an (os, arch) group
 * matches upstream so stable sort preserves it for abi-neutral rows.
 */
const PLATFORM_TABLE: readonly PlatformRow[] = [
  { os: 'darwin', arch: 'arm64', bin: 'bun-darwin-aarch64', exe: 'bin/bun' },
  {
    os: 'darwin',
    arch: 'x64',
    avx2: true,
    bin: 'bun-darwin-x64',
    exe: 'bin/bun',
  },
  {
    os: 'darwin',
    arch: 'x64',
    bin: 'bun-darwin-x64-baseline',
    exe: 'bin/bun',
  },
  { os: 'linux', arch: 'arm64', bin: 'bun-linux-aarch64', exe: 'bin/bun' },
  {
    os: 'linux',
    arch: 'x64',
    avx2: true,
    bin: 'bun-linux-x64',
    exe: 'bin/bun',
  },
  {
    os: 'linux',
    arch: 'x64',
    bin: 'bun-linux-x64-baseline',
    exe: 'bin/bun',
  },
  {
    os: 'linux',
    arch: 'arm64',
    abi: 'musl',
    bin: 'bun-linux-aarch64-musl',
    exe: 'bin/bun',
  },
  {
    os: 'linux',
    arch: 'x64',
    abi: 'musl',
    avx2: true,
    bin: 'bun-linux-x64-musl',
    exe: 'bin/bun',
  },
  {
    os: 'linux',
    arch: 'x64',
    abi: 'musl',
    bin: 'bun-linux-x64-musl-baseline',
    exe: 'bin/bun',
  },
  {
    os: 'android',
    arch: 'arm64',
    abi: 'android',
    bin: 'bun-linux-aarch64-android',
    exe: 'bin/bun',
  },
  {
    os: 'android',
    arch: 'x64',
    abi: 'android',
    bin: 'bun-linux-x64-android',
    exe: 'bin/bun',
  },
  {
    os: 'freebsd',
    arch: 'arm64',
    bin: 'bun-freebsd-aarch64',
    exe: 'bin/bun',
  },
  { os: 'freebsd', arch: 'x64', bin: 'bun-freebsd-x64', exe: 'bin/bun' },
  {
    os: 'win32',
    arch: 'x64',
    avx2: true,
    bin: 'bun-windows-x64',
    exe: 'bin/bun.exe',
  },
  {
    os: 'win32',
    arch: 'x64',
    bin: 'bun-windows-x64-baseline',
    exe: 'bin/bun.exe',
  },
  {
    os: 'win32',
    arch: 'arm64',
    bin: 'bun-windows-aarch64',
    exe: 'bin/bun.exe',
  },
];

/**
 * The full list of `@oven/bun-*` package names, in table order. Used by the
 * manifest-completeness test to assert the package manifest never drifts from
 * the upstream table.
 */
export const OVEN_PACKAGE_NAMES: readonly string[] = PLATFORM_TABLE.map(
  (row) => `@oven/${row.bin}`,
);

/** The version every `@oven/bun-*` package is pinned to. */
export const OVEN_PACKAGE_VERSION = '1.3.14';

/**
 * Normalized host architecture. `process.arch` and `uname -m` aliases are
 * collapsed to these two values.
 */
export type NormalizedArch = 'x64' | 'arm64';

/**
 * The host ABI, mirroring upstream's detection. `undefined` means glibc (or a
 * platform where the distinction is irrelevant: darwin, win32, freebsd).
 */
export type HostAbi = 'musl' | 'android' | undefined;

/**
 * Resolved host characteristics consumed by {@link selectOvenVariants}. These
 * are the OUTPUT of detection, not raw signals: arch aliases have been
 * normalized, Rosetta 2 has been folded into arm64, and avx2 is a boolean.
 */
export interface HostPlatformInput {
  readonly os: string;
  readonly arch: NormalizedArch;
  readonly abi: HostAbi;
  readonly avx2: boolean;
}

/**
 * A candidate `@oven` variant with the exe names to probe, ordered
 * platform-correct-first. Callers probe each exe name in order and use the
 * first that exists and is executable.
 */
export interface OvenBunVariant {
  readonly packageName: string;
  readonly exeNames: readonly string[];
}

/**
 * Returns the ordered exe names for a platform row: the row's native exe first,
 * then the other name for robustness (e.g. a win32 layout that also has a bare
 * `bin/bun`, or a POSIX layout that retains `bin/bun.exe`).
 */
function exeNamesFor(row: PlatformRow): readonly string[] {
  if (row.exe === 'bin/bun.exe') {
    return ['bin/bun.exe', 'bin/bun'];
  }
  return ['bin/bun', 'bin/bun.exe'];
}

/**
 * Computes the abi-match sort key for a row against a host abi. Lower is
 * preferred.
 *
 * The deliberate deviation from upstream: on a musl host, musl variants
 * (`platform.abi === 'musl'`) sort AHEAD of glibc variants (no abi field).
 * Upstream's filter `!platform.abi || abi === platform.abi` lets glibc entries
 * pass on a musl host and, being earlier in the table, sort ahead of musl —
 * safe for upstream because its postinstall already picked a binary, but
 * unsafe here because several variants coexist untouched in the install.
 */
function abiSortKey(row: PlatformRow, hostAbi: HostAbi): number {
  if (hostAbi === 'musl') {
    return row.abi === 'musl' ? 0 : 1;
  }
  return 0;
}

/**
 * Computes the avx2 sort key for a row. Lower is preferred: an AVX2 build is
 * tried before its baseline sibling when the host supports AVX2.
 */
function avx2SortKey(row: PlatformRow): number {
  return row.avx2 === true ? 0 : 1;
}

/**
 * Upstream abi filter: `!platform.abi || abi === platform.abi`. A row with no
 * abi field always passes (glibc/standard). A row declaring an abi passes only
 * when the host abi matches it.
 */
function abiFilter(row: PlatformRow, hostAbi: HostAbi): boolean {
  if (row.abi === undefined) {
    return true;
  }
  return row.abi === hostAbi;
}

/**
 * True when `row` can actually execute on `host`. Splitting this out of the
 * filter callback keeps each predicate independently readable and testable.
 */
function isRunnableOnHost(row: PlatformRow, host: HostPlatformInput): boolean {
  if (row.os !== host.os || row.arch !== host.arch) {
    return false;
  }
  if (row.avx2 === true && !host.avx2) {
    return false;
  }
  return abiFilter(row, host.abi);
}

/**
 * Selects the ordered list of `@oven/bun-<platform>` candidates for a host.
 *
 * Filtering mirrors upstream's `install.js`:
 *   - `platform.os === host.os && platform.arch === host.arch`
 *   - `(!platform.avx2 || host.avx2)`: an AVX2-requiring package is excluded on
 *     a baseline host (it crashes with SIGILL). A non-avx2 host therefore NEVER
 *     receives an avx2 package.
 *   - abi matching keeps musl/android rows out of glibc hosts and vice versa,
 *     EXCEPT a musl host retains glibc rows as a last-resort fallback.
 *
 * Sorting applies the musl-first deviation (abi match before avx2), then
 * prefers AVX2 builds within the same abi class. The result is the safe probe
 * order for the host.
 */
export function selectOvenVariants(
  host: HostPlatformInput,
): readonly OvenBunVariant[] {
  const matched = PLATFORM_TABLE.filter((row) => isRunnableOnHost(row, host));
  const sorted = [...matched].sort((a, b) => {
    const abiDiff = abiSortKey(a, host.abi) - abiSortKey(b, host.abi);
    if (abiDiff !== 0) {
      return abiDiff;
    }
    return avx2SortKey(a) - avx2SortKey(b);
  });
  return sorted.map((row) => ({
    packageName: `@oven/${row.bin}`,
    exeNames: exeNamesFor(row),
  }));
}

/**
 * Injectable side effects for {@link detectHostPlatform}. Each defaults to the
 * real Node primitive so production callers need only pass `{}` (or omit the
 * argument). Tests pass fakes to exercise every host tuple without spawning.
 */
export interface HostDetectionDeps {
  readonly platform?: string;
  readonly rawArch?: string;
  readonly spawnSync?: (
    cmd: string,
    args: readonly string[],
  ) => { readonly stdout: string; readonly status: number | null };
  readonly readFileSync?: (path: string) => string;
  readonly existsSync?: (path: string) => boolean;
}

/** Spawn result shape used by the injectable detection callbacks. */
interface SpawnIo {
  readonly stdout: string;
  readonly status: number | null;
}

function defaultSpawn(cmd: string, args: readonly string[]): SpawnIo {
  // spawnSync's types promise `stdout: string` for utf8, but it is actually
  // null when the process could not be spawned at all (e.g. ENOENT because
  // sysctl/powershell is absent), so model the real contract here.
  const result: { stdout: string | null; status: number | null } = spawnSync(
    cmd,
    [...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
  return { stdout: result.stdout ?? '', status: result.status };
}

function defaultReadFile(path: string): string {
  return readFileSync(path, 'utf8');
}

function defaultExists(path: string): boolean {
  return existsSync(path);
}

/**
 * Normalizes a raw architecture string (`process.arch` or `uname -m`) to a
 * {@link NormalizedArch}. Recognizes the common aliases x86_64/amd64 → x64 and
 * arm64/aarch64 → arm64. Returns `null` for unrecognized values so callers can
 * skip `@oven` resolution rather than guessing.
 */
export function normalizeArch(rawArch: string): NormalizedArch | null {
  switch (rawArch) {
    case 'x64':
    case 'x86_64':
    case 'amd64':
      return 'x64';
    case 'arm64':
    case 'aarch64':
      return 'arm64';
    default:
      return null;
  }
}

/**
 * Detects whether darwin/x64 is running under Rosetta 2, matching upstream's
 * `sysctl -n sysctl.proc_translated` check. When true, the host is treated as
 * arm64.
 */
function isRosetta2(
  spawn: (cmd: string, args: readonly string[]) => SpawnIo,
): boolean {
  try {
    const { status, stdout } = spawn('sysctl', [
      '-n',
      'sysctl.proc_translated',
    ]);
    return status === 0 && stdout.includes('1');
  } catch {
    return false;
  }
}

function existsAlpine(exists: (path: string) => boolean): boolean {
  try {
    return exists('/etc/alpine-release');
  } catch {
    return false;
  }
}

function linuxHasAvx2(readFile: (path: string) => string): boolean {
  try {
    return readFile('/proc/cpuinfo').includes('avx2');
  } catch {
    return false;
  }
}

function darwinHasAvx2(
  spawn: (cmd: string, args: readonly string[]) => SpawnIo,
): boolean {
  try {
    const { status, stdout } = spawn('sysctl', ['-n', 'machdep.cpu']);
    return status === 0 && stdout.includes('AVX2');
  } catch {
    return false;
  }
}

function windowsHasAvx2(
  spawn: (cmd: string, args: readonly string[]) => SpawnIo,
): boolean {
  try {
    const { status, stdout } = spawn('powershell', [
      '-NoProfile',
      '-Command',
      "(Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);' -Name 'Kernel32' -Namespace 'Win32' -PassThru)::IsProcessorFeaturePresent(40)",
    ]);
    return status === 0 && stdout.trim() === 'True';
  } catch {
    return false;
  }
}

/**
 * Resolves the host's runtime characteristics by probing the OS. This is the
 * ONLY side-effecting entry point and must be called exclusively on the
 * `@oven` fallback path — never when `bun/bin/bun.exe` was found.
 *
 * Detection mirrors upstream `install.js` exactly:
 *   - arch: `process.arch`, except darwin+x64 under Rosetta 2 → arm64.
 *   - avx2 (x64 only): linux → `/proc/cpuinfo` contains `avx2`;
 *     darwin → `sysctl -n machdep.cpu` contains `AVX2`;
 *     win32 → `IsProcessorFeaturePresent(40)` via PowerShell.
 *   - abi: `android` on android; `musl` when `/etc/alpine-release` exists.
 */
export function detectHostPlatform(
  deps: HostDetectionDeps = {},
): HostPlatformInput | null {
  const os = deps.platform ?? process.platform;
  const rawArch = deps.rawArch ?? process.arch;
  const spawn = deps.spawnSync ?? defaultSpawn;
  const readFile = deps.readFileSync ?? defaultReadFile;
  const exists = deps.existsSync ?? defaultExists;

  let arch: NormalizedArch | null = normalizeArch(rawArch);
  if (os === 'darwin' && arch === 'x64' && isRosetta2(spawn)) {
    arch = 'arm64';
  }
  if (arch === null) {
    return null;
  }

  const abi = detectAbi(os, exists);
  const avx2 = arch === 'x64' && hasAvx2(os, readFile, spawn);

  return { os, arch, abi, avx2 };
}

/**
 * Mirrors upstream's abi selection: android hosts use the android rows, and a
 * linux host with `/etc/alpine-release` is treated as musl. Everything else is
 * the unqualified (glibc/standard) abi.
 */
function detectAbi(os: string, exists: (path: string) => boolean): HostAbi {
  if (os === 'android') {
    return 'android';
  }
  if (os === 'linux' && existsAlpine(exists)) {
    return 'musl';
  }
  return undefined;
}

/**
 * Dispatches AVX2 detection to the per-OS probe. Unknown platforms report no
 * AVX2 so they never receive an AVX2-requiring build.
 */
function hasAvx2(
  os: string,
  readFile: (path: string) => string,
  spawn: (cmd: string, args: readonly string[]) => SpawnIo,
): boolean {
  switch (os) {
    case 'linux':
      return linuxHasAvx2(readFile);
    case 'darwin':
      return darwinHasAvx2(spawn);
    case 'win32':
      return windowsHasAvx2(spawn);
    default:
      return false;
  }
}
