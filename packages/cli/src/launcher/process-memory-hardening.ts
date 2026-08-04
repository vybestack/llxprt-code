/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * prctl(2) option that sets the process "dumpable" flag. Setting it to 0 makes
 * `/proc/<pid>/{maps,mem,...}` root-owned, so `ptrace_may_access` denies a
 * same-UID reader. The kernel resets this flag to 1 on every `execve`, so it
 * must be applied in-process by the final token-holding process. See issue
 * #3028.
 */
const PR_SET_DUMPABLE = 4;

/** Exit code for a fatal sandbox-hardening failure (matches FatalSandboxError). */
export const HARDENING_FAILURE_EXIT_CODE = 44;

/**
 * Outcome of {@link applyProcessMemoryHardening}. When `abortReason` is set the
 * caller MUST abort startup: the process is credential-bearing and could not be
 * protected. The reason is returned rather than thrown as a `FatalError` so this
 * module — which runs at the earliest bootstrap point, before the CLI is
 * imported — stays free of package imports. `packages/cli/index.ts` owns the
 * fatal-error policy.
 */
export interface ProcessMemoryHardeningResult {
  readonly abortReason?: string;
}

/**
 * Raw prctl callable signature. The real symbol is resolved lazily from libc
 * via `bun:ffi`; tests inject a plain function instead.
 */
type PrctlCallable = (
  option: number,
  arg2: number,
  arg3: number,
  arg4: number,
  arg5: number,
) => number;

/**
 * Optional seams for {@link applyProcessMemoryHardening}. Every field defaults
 * to the real production behavior; tests inject values to drive the gate and
 * failure policy without Bun FFI.
 */
export interface ProcessMemoryHardeningOptions {
  /**
   * Injectable prctl callable. When omitted, the real libc symbol is resolved
   * lazily via `bun:ffi` (Linux only).
   */
  readonly prctl?: PrctlCallable | null;
  /** Injectable platform read; defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Injectable warning sink; defaults to the project's stderr writer. */
  readonly writeWarning?: (message: string) => void;
}

/**
 * True when the process is about to hold a credential. The sandbox entrypoint
 * sets `LLXPRT_CAPABILITY_FD=3` before exec'ing the CLI (it remains set until
 * the credential-store factory consumes/scrubs it inside the CLI module), and
 * `sandbox-containers.ts` injects `LLXPRT_CREDENTIAL_SOCKET` via `--env` for
 * the entire session. Both are present at the bootstrap point where this module
 * runs (before `import('./src/cli.js')`).
 */
function isCredentialBearing(env: NodeJS.ProcessEnv): boolean {
  const fd = env['LLXPRT_CAPABILITY_FD'];
  const socket = env['LLXPRT_CREDENTIAL_SOCKET'];
  return (
    (fd !== undefined && fd !== '') || (socket !== undefined && socket !== '')
  );
}

/**
 * True when `SANDBOX` indicates a container sandbox (Docker/Podman), mirroring
 * the detection idiom in `ui/commands/bugCommand.ts`: a non-empty value other
 * than `sandbox-exec` (which is macOS Seatbelt, not a container).
 */
function isContainerSandbox(sandboxEnv: string | undefined): boolean {
  return (
    sandboxEnv !== undefined &&
    sandboxEnv !== '' &&
    sandboxEnv !== 'sandbox-exec'
  );
}

/**
 * The hardening gate: Linux AND (container sandbox OR credential-bearing).
 *
 * The credential-bearing arm closes a gap where a custom or direct Linux
 * launch is credential-bearing but `SANDBOX` is unset — e.g. a user who
 * manually exports `LLXPRT_CAPABILITY_FD` and runs the CLI under bun. If a
 * credential is about to enter this process's address space, we must harden
 * regardless of how the process was launched.
 */
function shouldHarden(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): boolean {
  if (platform !== 'linux') return false;
  return isContainerSandbox(env['SANDBOX']) || isCredentialBearing(env);
}

/**
 * Resolves the real `prctl` symbol from glibc via `bun:ffi`. Returns null if
 * `bun:ffi` or libc is unavailable (e.g. a non-glibc sandbox image) so the
 * caller can apply the appropriate failure policy.
 *
 * `bun:ffi` is imported dynamically so this module remains loadable in Node
 * contexts (vitest, tooling) that have no Bun FFI built-in.
 */
async function resolveLibcPrctl(): Promise<PrctlCallable | null> {
  try {
    const ffi = await import('bun:ffi');
    const lib = ffi.dlopen('libc.so.6', {
      prctl: {
        args: [
          ffi.FFIType.i32,
          ffi.FFIType.u64,
          ffi.FFIType.u64,
          ffi.FFIType.u64,
          ffi.FFIType.u64,
        ],
        returns: ffi.FFIType.i32,
      },
    });
    const prctl = lib.symbols.prctl;
    // The dlopen handle is deliberately left open. Calling lib.close() would
    // dlclose libc while we still hold and invoke the captured native function
    // pointer. libc.so.6 stays mapped for the process lifetime regardless, and
    // this resolves once per process, so there is nothing to reclaim.
    return (option, arg2, arg3, arg4, arg5) =>
      prctl(option, arg2, arg3, arg4, arg5);
  } catch {
    return null;
  }
}

/**
 * Applies the failure policy for a hardening failure. When the process is
 * credential-bearing this **fails closed** by returning an abort reason: the
 * CLI must not start if it cannot protect the credential in memory. When the
 * process is NOT credential-bearing it warns on stderr and returns no abort
 * reason, preserving the compatibility path for tokenless custom images.
 */
function reportHardeningFailure(
  reason: string,
  credentialBearing: boolean,
  writeWarning: (message: string) => void,
): ProcessMemoryHardeningResult {
  if (credentialBearing) {
    return {
      abortReason:
        'Process memory hardening failed and this process is credential-bearing ' +
        '(LLXPRT_CAPABILITY_FD or LLXPRT_CREDENTIAL_SOCKET is set), so the CLI ' +
        'refuses to start rather than expose the credential to an in-container ' +
        `memory read. ${reason} Likely cause: a non-glibc sandbox image where ` +
        'prctl cannot be resolved from libc. Use the official Debian bookworm ' +
        '/ glibc sandbox image.',
    };
  }
  writeWarning(
    'Process memory hardening skipped: ' +
      reason +
      ' The CLI will continue, but an in-container process may be able to ' +
      'read its memory.\n',
  );
  return {};
}

/**
 * Marks the current process non-dumpable via `prctl(PR_SET_DUMPABLE, 0)` so an
 * in-container process running as the same UID cannot read this process's
 * memory through `/proc/<pid>/{maps,mem}`. This composes with the
 * `CAP_SYS_PTRACE` drop shipped in #3022: `PR_SET_DUMPABLE(0)` alone denies an
 * ordinary same-UID reader, and the capability drop prevents the
 * `CAP_SYS_PTRACE` privileged override.
 *
 * No-op off Linux or when neither sandboxed nor credential-bearing. On any
 * failure (`bun:ffi` unavailable, libc missing, `prctl` returns non-zero, or
 * the callable throws):
 * - **Credential-bearing** => returns an `abortReason` (fail closed). The
 *   caller must refuse to start because the credential cannot be protected.
 * - **Not credential-bearing** => writes a visible warning to stderr and
 *   returns normally (warn and continue), preserving tokenless custom images.
 *
 * See issue #3028.
 */
export async function applyProcessMemoryHardening(
  options: ProcessMemoryHardeningOptions = {},
): Promise<ProcessMemoryHardeningResult> {
  const platform = options.platform ?? process.platform;
  if (!shouldHarden(platform, process.env)) {
    return {};
  }

  const credentialBearing = isCredentialBearing(process.env);
  const writeWarning =
    options.writeWarning ??
    ((message: string): void => {
      process.stderr.write(message);
    });
  // Explicit `undefined` check rather than `??` so an injected `null` really
  // short-circuits to the "could not resolve prctl" path. With `??`, injecting
  // null would fall through to resolveLibcPrctl(), making the failure path
  // environment-dependent (it would resolve a real prctl under Bun on Linux).
  const prctl =
    options.prctl !== undefined ? options.prctl : await resolveLibcPrctl();

  if (prctl === null) {
    return reportHardeningFailure(
      'Could not resolve prctl from libc.',
      credentialBearing,
      writeWarning,
    );
  }

  let result: number;
  try {
    result = prctl(PR_SET_DUMPABLE, 0, 0, 0, 0);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return reportHardeningFailure(
      `prctl(PR_SET_DUMPABLE) threw ${detail}.`,
      credentialBearing,
      writeWarning,
    );
  }

  if (result !== 0) {
    return reportHardeningFailure(
      `prctl(PR_SET_DUMPABLE) returned ${result}.`,
      credentialBearing,
      writeWarning,
    );
  }
  return {};
}
