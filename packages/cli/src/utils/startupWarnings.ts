/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SSH_AGENT_EMPTY_WARNING } from './sandbox-ssh.js';

/**
 * Returns the empty-SSH-agent warning when the sandbox supervisor handed the
 * condition across the host→container boundary via
 * `LLXPRT_SANDBOX_SSH_AGENT_EMPTY=1`, undefined otherwise. The flag is only
 * ever set by the supervisor; a non-sandbox run never sees it.
 */
export function getSandboxHandoffWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY === '1') {
    return SSH_AGENT_EMPTY_WARNING;
  }
  return undefined;
}
