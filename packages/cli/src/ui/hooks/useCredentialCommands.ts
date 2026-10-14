/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { ToolKeyStorage } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import type { BuiltinCommandOwners } from '../../services/BuiltinCommandLoader.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { createAuthCommand } from '../commands/authCommand.js';
import { createBaseurlCommand } from '../commands/baseurlCommand.js';
import {
  bindBaseurlCommandOperations,
  bindKeyCommandOperations,
  bindKeyfileCommandOperations,
  bindLogoutCommandOperations,
  bindQuotaCommandOperations,
} from '../commands/credentialCommandHost.js';
import { createKeyCommand } from '../commands/keyCommand.js';
import { createKeyfileCommand } from '../commands/keyfileCommand.js';
import { createLogoutCommand } from '../commands/logoutCommand.js';
import { createQuotaCommand } from '../commands/quotaCommand.js';
import { createToolkeyCommand } from '../commands/toolkeyCommand.js';
import { createToolkeyfileCommand } from '../commands/toolkeyfileCommand.js';
import { useOAuthControl } from '../contexts/OAuthControlContext.js';
import { useRuntimeApi } from '../contexts/RuntimeContext.js';

type CredentialCommands = Pick<
  BuiltinCommandOwners,
  | 'baseurlCommand'
  | 'logoutCommand'
  | 'keyfileCommand'
  | 'keyCommand'
  | 'toolkeyCommand'
  | 'toolkeyfileCommand'
  | 'authCommand'
  | 'quotaCommand'
>;

/**
 * Registers the credential commands for one session, each bound to the
 * operations it uses. Memoised so the registered command identities stay stable
 * while their owners do.
 */
export function useCredentialCommands(
  agent: Agent | null,
  settings: LoadedSettings,
  config: CliUiRuntime | null,
): CredentialCommands {
  const api = useRuntimeApi();
  const oauthControl = useOAuthControl();
  const baseurlCommand = useMemo(
    () => createBaseurlCommand(bindBaseurlCommandOperations(api, agent)),
    [api, agent],
  );
  const logoutCommand = useMemo(
    () => createLogoutCommand(bindLogoutCommandOperations(agent, oauthControl)),
    [agent, oauthControl],
  );
  const keyfileCommand = useMemo(
    () => createKeyfileCommand(bindKeyfileCommandOperations(api, settings)),
    [api, settings],
  );
  const keyCommand = useMemo(
    () => createKeyCommand(bindKeyCommandOperations(api, config)),
    [api, config],
  );
  const authCommand = useMemo(
    () => createAuthCommand(oauthControl),
    [oauthControl],
  );
  const quotaCommand = useMemo(
    () => createQuotaCommand(bindQuotaCommandOperations(api, oauthControl)),
    [api, oauthControl],
  );
  const toolkeyCommands = useMemo(() => {
    const storage = new ToolKeyStorage();
    return {
      toolkeyCommand: createToolkeyCommand(storage),
      toolkeyfileCommand: createToolkeyfileCommand(storage),
    };
  }, []);
  return useMemo(
    () => ({
      baseurlCommand,
      logoutCommand,
      keyfileCommand,
      keyCommand,
      authCommand,
      quotaCommand,
      ...toolkeyCommands,
    }),
    [
      baseurlCommand,
      logoutCommand,
      keyfileCommand,
      keyCommand,
      authCommand,
      quotaCommand,
      toolkeyCommands,
    ],
  );
}
