/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/DebugLogger.js';
import { getErrorMessage } from '@vybestack/llxprt-code-tools/utils/errors.js';
import type { HostBrowserLauncher } from '../host/hostServices.js';
import type { OAuthCallbackServer } from './oauth-callback.js';
import { awaitOAuthOperation } from './oauth-request.js';

const logger = new DebugLogger('llxprt:mcp:oauth');
export type OAuthDisplaySink = (message: string) => void | Promise<void>;

export async function waitForAuthorizationCode(
  authUrl: string,
  callbackServer: OAuthCallbackServer,
  display: OAuthDisplaySink | undefined,
  signal: AbortSignal | undefined,
  openBrowser: HostBrowserLauncher,
): Promise<string> {
  const message = `→ Opening your browser for OAuth sign-in...

If the browser does not open, copy and paste this URL into your browser:
${authUrl}

TIP: Triple-click to select the entire URL, then copy and paste it into your browser.
WARNING: Make sure to copy the COMPLETE URL - it may wrap across multiple lines.`;
  signal?.throwIfAborted();
  if (display) await awaitOAuthOperation(signal, async () => display(message));
  else logger.log(message);
  signal?.throwIfAborted();
  try {
    await awaitOAuthOperation(signal, () => openBrowser(authUrl));
  } catch (error) {
    signal?.throwIfAborted();
    logger.warn(
      'Failed to open browser automatically:',
      getErrorMessage(error),
    );
  }
  const response = await callbackServer.response;
  signal?.throwIfAborted();
  if ('error' in response) throw response.error;
  logger.debug('[OK] Authorization code received, exchanging for tokens...');
  return response.value.code;
}
