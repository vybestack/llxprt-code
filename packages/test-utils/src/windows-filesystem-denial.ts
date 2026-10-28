/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Windows primitives for tests that need the operating system to really
 * refuse a filesystem operation.
 *
 * An ACL deny entry is not enough on its own: a process whose token holds
 * SeBackupPrivilege/SeRestorePrivilege (every elevated administrator, such as
 * the GitHub-hosted runner account) can open files and directories with
 * backup semantics, which skips the DACL check. `denyWindowsAccess` therefore
 * switches both privileges off in the current process token for as long as the
 * denial is in place, then switches back whichever of them were on.
 *
 * Callers prove the denial by attempting the refused operation and report a
 * failed probe through `WindowsDenial.abort`, which appends the token
 * privileges, group list and ACLs so a CI log shows why the denial did not hold.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const nativeRequire = createRequire(import.meta.url);

/**
 * Absolute path of a Windows system tool. A bare name resolves through PATH,
 * where Git-for-Windows' GNU coreutils `whoami` precedes System32 and rejects
 * the Windows switches. The environment is read through the live
 * `process.env`, whose lookups are case-insensitive on Windows.
 */
export function system32Tool(name: string): string {
  const windowsDirectory = process.env.SystemRoot ?? process.env.windir;
  if (windowsDirectory === undefined) {
    throw new Error(
      `Windows filesystem denial requires SystemRoot or windir to locate System32\\${name}.`,
    );
  }
  return path.join(windowsDirectory, 'System32', name);
}

let cachedSid: string | undefined;

/** SID of the account running the tests, as `whoami /user` reports it. */
function currentUserSid(): string {
  if (cachedSid !== undefined) return cachedSid;
  const output = execFileSync(
    system32Tool('whoami.exe'),
    ['/user', '/fo', 'csv', '/nh'],
    { encoding: 'utf8' },
  );
  const match = /S-1-\d+(?:-\d+)+/.exec(output);
  if (match === null) {
    throw new Error(`whoami /user returned no SID: ${output}`);
  }
  cachedSid = match[0];
  return cachedSid;
}

function icaclsDeny(target: string, rights: string): void {
  execFileSync(
    system32Tool('icacls.exe'),
    [target, '/deny', `*${currentUserSid()}:(${rights})`],
    { stdio: 'pipe' },
  );
}

function icaclsRemoveDeny(target: string): void {
  execFileSync(
    system32Tool('icacls.exe'),
    [target, '/remove:d', `*${currentUserSid()}`],
    { stdio: 'pipe' },
  );
}

/**
 * The shape of the `bun:ffi` library handle this module uses. `bun:ffi` has
 * no ESM export and `packages/test-utils` does not load Bun's ambient FFI
 * types, so the module is loaded with `require` and described here. The
 * single cast in {@link loadTokenApi} is the only place this description is
 * asserted rather than checked.
 */
type FfiSymbol = (...args: unknown[]) => number | bigint;

interface FfiLibrary {
  readonly symbols: Readonly<Record<string, FfiSymbol>>;
}

interface BunFfi {
  readonly dlopen: (
    name: string,
    definitions: Readonly<
      Record<
        string,
        { readonly args: readonly string[]; readonly returns: string }
      >
    >,
  ) => FfiLibrary;
}

interface TokenApi {
  readonly advapi32: FfiLibrary;
  readonly kernel32: FfiLibrary;
}

let tokenApi: TokenApi | undefined;

function loadTokenApi(): TokenApi {
  if (process.platform !== 'win32') {
    throw new Error(
      `Token privileges can only be adjusted on win32 (platform=${process.platform}).`,
    );
  }
  if (tokenApi !== undefined) return tokenApi;
  const ffi = nativeRequire('bun:ffi') as BunFfi;
  tokenApi = {
    advapi32: ffi.dlopen('advapi32.dll', {
      OpenProcessToken: { args: ['u64', 'u32', 'ptr'], returns: 'i32' },
      LookupPrivilegeValueW: { args: ['ptr', 'ptr', 'ptr'], returns: 'i32' },
      AdjustTokenPrivileges: {
        args: ['u64', 'i32', 'ptr', 'u32', 'ptr', 'ptr'],
        returns: 'i32',
      },
      GetTokenInformation: {
        args: ['u64', 'u32', 'ptr', 'u32', 'ptr'],
        returns: 'i32',
      },
    }),
    kernel32: ffi.dlopen('kernel32.dll', {
      GetCurrentProcess: { args: [], returns: 'u64' },
      CloseHandle: { args: ['u64'], returns: 'i32' },
    }),
  };
  return tokenApi;
}

const TOKEN_QUERY = 0x8;
const TOKEN_ADJUST_PRIVILEGES = 0x20;
const TOKEN_PRIVILEGES_CLASS = 3;
const SE_PRIVILEGE_ENABLED = 0x2;

/** The two privileges that let an open skip the DACL check. */
const BYPASS_PRIVILEGES = ['SeBackupPrivilege', 'SeRestorePrivilege'] as const;

/** A LUID is a DWORD followed by a LONG; both are kept as raw bytes. */
const LUID_BYTES = 8;
const LUID_AND_ATTRIBUTES_BYTES = LUID_BYTES + 4;
const TOKEN_PRIVILEGES_BUFFER_BYTES = 4096;

interface PrivilegeLuid {
  readonly name: string;
  readonly bytes: Buffer;
}

function expectNonZero(result: number | bigint, call: string): void {
  if (Number(result) === 0) {
    throw new Error(`${call} failed`);
  }
}

function lookupLuid(name: string): PrivilegeLuid {
  const { advapi32 } = loadTokenApi();
  const bytes = Buffer.alloc(LUID_BYTES);
  const wideName = Buffer.from(`${name}\0`, 'utf16le');
  expectNonZero(
    advapi32.symbols.LookupPrivilegeValueW(null, wideName, bytes),
    `LookupPrivilegeValueW(${name})`,
  );
  return { name, bytes };
}

function withProcessToken<T>(operation: (token: bigint) => T): T {
  const { advapi32, kernel32 } = loadTokenApi();
  const tokenSlot = Buffer.alloc(8);
  expectNonZero(
    advapi32.symbols.OpenProcessToken(
      BigInt(kernel32.symbols.GetCurrentProcess()),
      TOKEN_QUERY | TOKEN_ADJUST_PRIVILEGES,
      tokenSlot,
    ),
    'OpenProcessToken',
  );
  const token = tokenSlot.readBigUInt64LE(0);
  try {
    return operation(token);
  } finally {
    expectNonZero(kernel32.symbols.CloseHandle(token), 'CloseHandle');
  }
}

/** Names of the privileges in `luids` that are currently enabled in `token`. */
function enabledPrivileges(
  token: bigint,
  luids: readonly PrivilegeLuid[],
): PrivilegeLuid[] {
  const { advapi32 } = loadTokenApi();
  const buffer = Buffer.alloc(TOKEN_PRIVILEGES_BUFFER_BYTES);
  const returnLength = Buffer.alloc(4);
  expectNonZero(
    advapi32.symbols.GetTokenInformation(
      token,
      TOKEN_PRIVILEGES_CLASS,
      buffer,
      buffer.length,
      returnLength,
    ),
    'GetTokenInformation(TokenPrivileges)',
  );
  const count = buffer.readUInt32LE(0);
  const enabled: PrivilegeLuid[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 4 + index * LUID_AND_ATTRIBUTES_BYTES;
    const luidBytes = buffer.subarray(offset, offset + LUID_BYTES);
    const attributes = buffer.readUInt32LE(offset + LUID_BYTES);
    const match = luids.find((luid) => luid.bytes.equals(luidBytes));
    if (match !== undefined && (attributes & SE_PRIVILEGE_ENABLED) !== 0) {
      enabled.push(match);
    }
  }
  return enabled;
}

function setPrivilegesEnabled(
  token: bigint,
  luids: readonly PrivilegeLuid[],
  enabled: boolean,
): void {
  if (luids.length === 0) return;
  const { advapi32 } = loadTokenApi();
  const state = Buffer.alloc(4 + luids.length * LUID_AND_ATTRIBUTES_BYTES);
  state.writeUInt32LE(luids.length, 0);
  luids.forEach((luid, index) => {
    const offset = 4 + index * LUID_AND_ATTRIBUTES_BYTES;
    luid.bytes.copy(state, offset);
    state.writeUInt32LE(
      enabled ? SE_PRIVILEGE_ENABLED : 0,
      offset + LUID_BYTES,
    );
  });
  // Success with ERROR_NOT_ALL_ASSIGNED (a privilege the token does not hold)
  // is indistinguishable here from full success because GetLastError is not
  // reliable across FFI calls. The caller re-reads the token instead.
  expectNonZero(
    advapi32.symbols.AdjustTokenPrivileges(
      token,
      0,
      state,
      state.length,
      null,
      null,
    ),
    'AdjustTokenPrivileges',
  );
}

export interface PrivilegeSuppression {
  /** Backup/restore privileges that were enabled before suppression. */
  readonly previouslyEnabled: readonly string[];
  /** Re-enables exactly the privileges that were enabled before. */
  readonly restore: () => void;
}

/**
 * Disables SeBackupPrivilege and SeRestorePrivilege in the current process
 * token and confirms by re-reading the token that neither is enabled. Windows
 * only: it throws on any other platform.
 */
export function suppressBackupRestorePrivileges(): PrivilegeSuppression {
  const luids = BYPASS_PRIVILEGES.map(lookupLuid);
  const wasEnabled = withProcessToken((token) => {
    const before = enabledPrivileges(token, luids);
    setPrivilegesEnabled(token, luids, false);
    const after = enabledPrivileges(token, luids);
    if (after.length > 0) {
      setPrivilegesEnabled(token, before, true);
      throw new Error(
        `Token still has ${after.map((luid) => luid.name).join(', ')} enabled after disabling it`,
      );
    }
    return before;
  });
  let restored = false;
  return {
    previouslyEnabled: wasEnabled.map((luid) => luid.name),
    restore: () => {
      if (restored) return;
      restored = true;
      withProcessToken((token) =>
        setPrivilegesEnabled(token, wasEnabled, true),
      );
    },
  };
}

function runDiagnosticTool(tool: string, args: readonly string[]): string {
  try {
    return execFileSync(system32Tool(tool), [...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return `${tool} ${args.join(' ')} failed: ${reason}`;
  }
}

/** Token privileges, token groups and ACLs of `targets`, for failure output. */
function describeWindowsAccess(
  targets: readonly string[],
  suppression: PrivilegeSuppression,
): string {
  const sections = [
    `privileges enabled before suppression: ${suppression.previouslyEnabled.join(', ') || '(none)'}`,
    `whoami /priv:\n${runDiagnosticTool('whoami.exe', ['/priv'])}`,
    `whoami /groups:\n${runDiagnosticTool('whoami.exe', ['/groups'])}`,
    ...targets.map(
      (target) =>
        `icacls ${target}:\n${runDiagnosticTool('icacls.exe', [target])}`,
    ),
  ];
  return sections.join('\n');
}

export interface WindowsDenial {
  /** Lifts the denial and re-enables the suppressed privileges. */
  readonly restore: () => void;
  /**
   * Reports a failed probe: lifts the denial, then throws `failure` with the
   * token and ACL diagnostics appended. If lifting the denial also fails, the
   * thrown error carries both, so the original failure is never hidden.
   */
  readonly abort: (failure: unknown) => never;
}

export interface WindowsDenyGrant {
  readonly target: string;
  /** icacls right codes, e.g. `WD,AD` or `DE`. */
  readonly rights: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Installs deny entries for the current user and suppresses the token
 * privileges that would bypass them. Call `restore` (or `abort`) in a
 * `finally`/`catch` before any teardown that needs the denied access.
 */
export function denyWindowsAccess(
  grants: readonly WindowsDenyGrant[],
): WindowsDenial {
  const suppression = suppressBackupRestorePrivileges();
  const targets = grants.map((grant) => grant.target);
  const installed: string[] = [];
  let lifted = false;

  const restore = (): void => {
    if (lifted) return;
    lifted = true;
    try {
      for (const target of [...installed].reverse()) {
        icaclsRemoveDeny(target);
      }
    } finally {
      suppression.restore();
    }
  };

  const abort = (failure: unknown): never => {
    const report = `${messageOf(failure)}\n${describeWindowsAccess(targets, suppression)}`;
    try {
      restore();
    } catch (restoreFailure: unknown) {
      throw new Error(
        `${report}\nRestoring access also failed: ${messageOf(restoreFailure)}`,
      );
    }
    throw new Error(report);
  };

  try {
    for (const grant of grants) {
      icaclsDeny(grant.target, grant.rights);
      installed.push(grant.target);
      const acl = runDiagnosticTool('icacls.exe', [grant.target]);
      if (!acl.includes('(DENY)')) {
        throw new Error(`icacls shows no deny entry on ${grant.target}`);
      }
    }
  } catch (error: unknown) {
    return abort(error);
  }
  return { restore, abort };
}
