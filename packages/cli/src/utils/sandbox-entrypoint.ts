/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import { quote } from 'shell-quote';
import {
  getContainerPath,
  sandboxPorts,
  isSandboxDebugModeEnabled,
  isSourceDevelopmentWorkdir,
  resolveDebugPort,
} from './sandbox-env.js';

/** Newline separator for multi-statement shell stanzas. */
const NL = '\n';

function buildPathSuffix(
  envValue: string | undefined,
  containerWorkdir: string,
  pathSeparator: string,
): string {
  if (!envValue) {
    return '';
  }
  let suffix = '';
  for (const p of envValue.split(pathSeparator)) {
    const containerPath = getContainerPath(p);
    if (
      containerPath.toLowerCase().startsWith(containerWorkdir.toLowerCase())
    ) {
      suffix += `:${containerPath}`;
    }
  }
  return suffix;
}

function resolveCliCommand(workdir: string): string {
  const isDebugMode = isSandboxDebugModeEnabled(process.env.DEBUG);
  const debugPort = resolveDebugPort();
  // #3455: only a positively identified llxprt-code source checkout in
  // development mode runs the checked-out source entry; ambient
  // NODE_ENV=development in an arbitrary repository must fall through to
  // the sandbox image's installed command.
  if (isSourceDevelopmentWorkdir(workdir)) {
    // The local-development sandbox command bypasses npm so npm cannot drop
    // the inherited capability descriptor. Bun is launched directly on the
    // source entry, preserving fd 3.
    return isDebugMode
      ? `node --inspect-brk=0.0.0.0:${debugPort} $(which bun) ./packages/cli/index.ts`
      : 'bun ./packages/cli/index.ts';
  }
  if (isDebugMode) {
    return `node --inspect-brk=0.0.0.0:${debugPort} $(which llxprt)`;
  }
  return 'llxprt';
}

/**
 * The trusted capability-capture stanza. It runs BEFORE any prefix/bridge
 * process, project-controlled code, or final CLI. It captures the token into
 * an unexported shell variable from fd 3 (current-user path) or from
 * `LLXPRT_CAPABILITY_TOKEN` (env-file path), ALWAYS unsets the env value so
 * no later process can observe it, and records whether a token was present so
 * the final exec only re-opens fd 3 when a token exists. Prefixes and socat
 * relays are composed INTO this script AFTER the capture stanza.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC2, AC3, F1, F7)
 */
const CAPABILITY_CAPTURE_STANZA = [
  'if [ "${LLXPRT_CAPABILITY_FD-}" = "3" ]; then',
  // O21: fail fast if fd 3 is marked but cannot be read.
  '  if ! { IFS= read -r __llxprt_cap <&3; } 2>/dev/null; then',
  '    echo "Capability descriptor fd 3 is marked but cannot be read" >&2',
  '    unset LLXPRT_CAPABILITY_TOKEN LLXPRT_CAPABILITY_FD',
  '    exit 1',
  '  fi',
  '  exec 3<&-',
  'elif [ -n "${LLXPRT_CAPABILITY_FD-}" ]; then',
  '  echo "Invalid LLXPRT_CAPABILITY_FD marker" >&2',
  '  exit 1',
  'else',
  '  __llxprt_cap="${LLXPRT_CAPABILITY_TOKEN-}"',
  'fi',
  // F7: ALWAYS scrub the transport markers before any prefix/bridge.
  'unset LLXPRT_CAPABILITY_TOKEN LLXPRT_CAPABILITY_FD',
].join(NL);

/**
 * Pins the container-local data/cache/log roots to the REAL container HOME.
 *
 * These cannot be omitted: `resolveGlobalDataDir`/`CacheDir`/`LogDir` fall
 * back to `LLXPRT_CONFIG_HOME` (the mounted host config dir), so leaving them
 * unset would redirect container-local data, cache and logs into the mounted
 * host config directory. They are exported INSIDE the entrypoint rather than
 * passed as `--env` from the host so they follow the image's default user
 * home — a host-side hard-coded home would break custom sandbox images whose
 * default user home is elsewhere (#3081). The export is unconditional (not
 * `${VAR:-...}`) so no image-inherited or host override can redirect these
 * roots back into the mounted config directory; SANDBOX_ENV is additionally
 * filtered for these keys in sandbox-containers.ts.
 */
const XDG_HOME_PIN_STANZA = [
  'export LLXPRT_DATA_HOME="$HOME/.local/share/llxprt-code"',
  'export LLXPRT_CACHE_HOME="$HOME/.cache/llxprt-code"',
  'export LLXPRT_LOG_HOME="$HOME/.local/state/llxprt-code"',
].join(NL);

/**
 * Builds the final CLI exec stanza. Opens fd 3 and sets `LLXPRT_CAPABILITY_FD=3`
 * only when a capability token was captured; otherwise execs the CLI without
 * capability transport (tokenless path). The captured shell variable is unset
 * before exec so it does not persist into the CLI's shell environment.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC2, F7)
 */
function buildFinalExec(cliCmd: string, quotedCliArgs: string[]): string {
  const fullCmd =
    quotedCliArgs.length > 0 ? `${cliCmd} ${quotedCliArgs.join(' ')}` : cliCmd;
  return [
    'if [ -n "${__llxprt_cap}" ]; then',
    '  exec 3<<<"${__llxprt_cap}"',
    '  unset __llxprt_cap',
    `  LLXPRT_CAPABILITY_FD=3 exec ${fullCmd}`,
    'else',
    '  unset __llxprt_cap',
    `  exec ${fullCmd}`,
    'fi',
  ].join(NL);
}

/**
 * Builds the trusted entrypoint command array for the container.
 *
 * @param workdir Host workdir (translated to the container path).
 * @param cliArgs Full argv slice beginning with the CLI invocation
 *   (`[cli, subcommand, ...userArgs]`); elements after index 1 are forwarded.
 * @param skipPortRelays Sandbox ports to skip generating socat relays for.
 * @param entrypointPrefixes Prefix shell stanzas (ssh-agent bridge, credential
 *   proxy bridge) that must run AFTER the capability capture and BEFORE the
 *   socat relays/final CLI. They are composed INTO the trusted script body so
 *   they never receive the env token or an open capability descriptor.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC2, AC3, F1)
 */
export function entrypoint(
  workdir: string,
  cliArgs: string[],
  skipPortRelays?: Set<string>,
  entrypointPrefixes?: string[],
): string[] {
  const isWindows = os.platform() === 'win32';
  const containerWorkdir = getContainerPath(workdir);
  const shellCmds: string[] = [];
  const pathSeparator = isWindows ? ';' : ':';

  // STEP 1 (security): capture and scrub the capability BEFORE anything else.
  shellCmds.push(CAPABILITY_CAPTURE_STANZA);

  // STEP 1.5: pin the container-local data/cache/log roots to the real
  // container HOME before the CLI is exec'd on every path this entrypoint
  // takes (default and current-user `su -p` modes, docker and podman). Runs
  // before prefixes/relays/exec; the exports propagate to the exec'd CLI.
  shellCmds.push(XDG_HOME_PIN_STANZA);

  // STEP 2: trusted prefixes (ssh-agent / cred-proxy bridges) run AFTER capture
  // and env scrub, so they have neither the token nor (it was never on fd 3
  // here) an open capability descriptor.
  if (entrypointPrefixes !== undefined) {
    for (const prefix of entrypointPrefixes) {
      shellCmds.push(prefix);
    }
  }

  const pathSuffix = buildPathSuffix(
    process.env.PATH,
    containerWorkdir,
    pathSeparator,
  );
  if (pathSuffix) {
    shellCmds.push(`export PATH="$PATH${pathSuffix}";`);
  }

  const pythonPathSuffix = buildPathSuffix(
    process.env.PYTHONPATH,
    containerWorkdir,
    pathSeparator,
  );
  if (pythonPathSuffix) {
    shellCmds.push(`export PYTHONPATH="$PYTHONPATH${pythonPathSuffix}";`);
  }

  // NOTE: project .llxprt/sandbox.bashrc is NO LONGER sourced at entrypoint
  // time. It is evaluated by the CLI AFTER the capability is consumed. See
  // sandbox-bashrc.ts (issue #1954 AC5).

  for (const p of sandboxPorts()) {
    if (skipPortRelays?.has(p) === true) {
      continue;
    }
    shellCmds.push(
      `socat TCP4-LISTEN:${p},bind=$(hostname -i),fork,reuseaddr TCP4:127.0.0.1:${p} 2> /dev/null &`,
    );
  }

  const quotedCliArgs = cliArgs.slice(2).map((arg) => quote([arg]));
  const cliCmd = resolveCliCommand(workdir);

  // STEP 3: re-open fd 3 with the scrubbed capability (only when present) and
  // exec the final CLI.
  shellCmds.push(buildFinalExec(cliCmd, quotedCliArgs));

  // The outer invocation disables implicit Bash startup files (--noprofile
  // --norc) and strips BASH_ENV (env -u) so adversarial startup scripts cannot
  // source before the capture stanza runs.
  return [
    'env',
    '-u',
    'BASH_ENV',
    'bash',
    '--noprofile',
    '--norc',
    '-c',
    shellCmds.join(NL),
  ];
}
