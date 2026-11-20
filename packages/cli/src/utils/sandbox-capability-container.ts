/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The container half of the capability transport (issue #3573).
 *
 * The host writes the capability token to a file in a host-only directory and
 * bind-mounts that directory into the container at a fixed private path. The
 * trusted entrypoint opens the file, unlinks it, keeps the token in an
 * unexported shell variable, and hands it to the CLI on fd 3 from a pipe at
 * the final exec. The token is never part of the container's create
 * configuration (argv, `--env`, `--env-file`, `docker inspect`), PID 1's
 * environment or any process environment, and no copy stays on disk.
 *
 * This module only builds shell text. The host half is in
 * sandbox-capability.ts; both import the path constants from here so the
 * mount destination and the entrypoint can never disagree.
 */

/** Where the host-only capability directory is mounted in the container. */
export const CAPABILITY_CONTAINER_DIR = '/run/llxprt-capability';

/** The token file's name inside the host-only directory and the mount. */
export const CAPABILITY_TOKEN_FILE_NAME = 'token';

const NL = '\n';

/** Single-quotes a value for a shell: every embedded quote becomes '\''. */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * How the stanza treats a capability file it cannot use.
 * - `required`: the process that runs the CLI chain. A mounted capability
 *   directory means the host expects delivery, so a file this process cannot
 *   open or unlink stops the container instead of starting without it or
 *   leaving a readable copy behind.
 * - `opportunistic`: the outer root stanza of the current-user path. Root
 *   without CAP_DAC_OVERRIDE cannot read a file owned by the host uid, while
 *   the user `su` drops to can. When root cannot use the file this stanza
 *   leaves it untouched for the inner `required` stanza.
 */
export type CapabilityFileCaptureMode = 'required' | 'opportunistic';

function captureFailure(mode: CapabilityFileCaptureMode, message: string) {
  return mode === 'required'
    ? [`    echo ${shellSingleQuote(message)} >&2`, '    exit 1']
    : ['    :'];
}

/**
 * Starts every capture site with a variable that is empty and NOT exported.
 * Bash keeps the export attribute of a variable that arrives in the
 * environment, and an empty assignment does not clear it, so the token would
 * be exported to every process started before the final exec (prefixes,
 * relays, the root setup tools). `unset` removes the attribute with the
 * value, and `set +a` stops an `allexport` option imported through SHELLOPTS
 * from exporting the later assignment. The caller captures into the variable
 * afterwards.
 */
export const CAPABILITY_VARIABLE_RESET: readonly string[] = [
  'set +a',
  'unset __llxprt_cap',
  "__llxprt_cap=''",
];

/**
 * Opens the capability file on fd 4, unlinks it, reads the token into the
 * unexported shell variable `__llxprt_cap`, and closes fd 4. The file is
 * unlinked before anything is read from it, so the on-disk entry is gone
 * before any other process can start. Reading uses the `read` builtin, so no
 * temporary file, here-string, or argv ever carries the token.
 *
 * The caller must run CAPABILITY_VARIABLE_RESET first so an inherited variable
 * can neither stand in for the file nor export the token.
 */
export function buildCapabilityFileCapture(
  mountDir: string,
  mode: CapabilityFileCaptureMode,
): string {
  const dir = shellSingleQuote(mountDir);
  const file = shellSingleQuote(`${mountDir}/${CAPABILITY_TOKEN_FILE_NAME}`);
  const where = `capability directory ${mountDir}`;
  return [
    `if [ -z "\${__llxprt_cap-}" ] && [ -d ${dir} ]; then`,
    `  if { exec 4<${file}; } 2>/dev/null; then`,
    `    if rm -f -- ${file} 2>/dev/null && [ ! -e ${file} ]; then`,
    '      IFS= read -r __llxprt_cap <&4',
    '      exec 4<&-',
    '      if [ -z "${__llxprt_cap}" ]; then',
    '        echo "Capability token file was empty" >&2',
    '        exit 1',
    '      fi',
    '    else',
    '      exec 4<&-',
    ...captureFailure(
      mode,
      `The capability token file in ${where} could not be removed after it was opened`,
    ),
    '    fi',
    '  else',
    ...captureFailure(
      mode,
      `The capability token file in ${where} is not readable by the sandbox user`,
    ),
    '  fi',
    'fi',
  ].join(NL);
}

/**
 * Re-opens fd 3 from a pipe that carries the token. The pipe writer is a
 * forked shell that holds the token only in memory, so no file is involved
 * (a here-string would be backed by a temporary file on bash before 5.1).
 * Run this after every prefix, bridge and relay, immediately before the exec
 * of the CLI: no later process than the CLI inherits fd 3.
 */
export const CAPABILITY_FD_REOPEN =
  'exec 3< <(builtin printf \'%s\\n\' "${__llxprt_cap}")';
