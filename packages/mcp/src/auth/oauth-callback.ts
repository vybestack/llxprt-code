/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http';
import type * as net from 'node:net';
import { URL } from 'node:url';
import { resolveListenPort } from './oauth-provider-utils.js';
export const REDIRECT_PATH = '/oauth/callback';
const HTTP_OK = 200;

/**
 * OAuth authorization response.
 */
export interface OAuthAuthorizationResponse {
  code: string;
  state: string;
}

type OAuthCallbackResult =
  | { value: OAuthAuthorizationResponse }
  | { error: unknown };

export interface OAuthCallbackServer {
  port: Promise<number>;
  response: Promise<OAuthCallbackResult>;
  close: () => Promise<void>;
}

/**
 * Handle an incoming OAuth callback request.
 * Validates the state, extracts the auth code, and sends a response to the browser.
 */
async function handleOAuthCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  serverPort: number,
  expectedState: string,
  resolve: (value: OAuthAuthorizationResponse) => void,
  reject: (reason: unknown) => void,
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://localhost:${serverPort}`);

    if (url.pathname !== REDIRECT_PATH) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(HTTP_OK, { 'Content-Type': 'text/html' });
      res.end(`
              <html>
                <body>
                  <h1>Authentication Failed</h1>
                  <p>Error: ${error.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                  <p>${(url.searchParams.get('error_description') ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
      reject(new Error(`OAuth error: ${error}`));
      return;
    }

    if (!code || !state) {
      res.writeHead(400);
      res.end('Missing code or state parameter');
      return;
    }

    if (state !== expectedState) {
      res.writeHead(400);
      res.end('Invalid state parameter');
      reject(new Error('State mismatch - possible CSRF attack'));
      return;
    }

    res.writeHead(HTTP_OK, { 'Content-Type': 'text/html' });
    res.end(`
            <html>
              <body>
                <h1>Authentication Successful!</h1>
                <p>You can close this window and return to LLxprt Code.</p>
                <script>window.close();</script>
              </body>
            </html>
          `);

    resolve({ code, state });
  } catch (error) {
    reject(error);
  }
}

/**
 * Start a local HTTP server to handle OAuth callback.
 */
export function startOAuthCallbackServer(
  expectedState: string,
  port?: number,
  signal?: AbortSignal,
): OAuthCallbackServer {
  signal?.throwIfAborted();
  let settleResponse!: (result: OAuthCallbackResult) => void;
  const response = new Promise<OAuthCallbackResult>((resolve) => {
    settleResponse = resolve;
  });
  let serverPort: number;
  let listening = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let closure: Promise<Error | undefined> | undefined;
  const server = http.createServer((req, res) => {
    if (signal?.aborted === true) {
      res.destroy();
      return;
    }
    void handleOAuthCallback(
      req,
      res,
      serverPort,
      expectedState,
      (value) => settleResponse({ value }),
      (error) => settleResponse({ error }),
    );
  });
  const clearDeadline = (): void => {
    if (deadline !== undefined) {
      clearTimeout(deadline);
      deadline = undefined;
    }
  };
  const beginClose = (): Promise<Error | undefined> => {
    signal?.removeEventListener('abort', onAbort);
    clearDeadline();
    settleResponse({ error: new Error('OAuth callback server closed') });
    closure ??= listening
      ? new Promise<Error | undefined>((resolve) => server.close(resolve))
      : Promise.resolve(undefined);
    return closure;
  };
  const onAbort = (): void => {
    settleResponse({ error: signal?.reason });
    clearDeadline();
    if (listening) void beginClose();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const portPromise = new Promise<number>((resolve, reject) => {
    server.on('error', (error) => {
      reject(error);
      settleResponse({ error });
    });
    const listenPort = resolveListenPort(port, reject, (error) =>
      settleResponse({ error }),
    );
    deadline = setTimeout(
      () => {
        settleResponse({ error: new Error('OAuth callback timeout') });
      },
      5 * 60 * 1000,
    );
    server.listen(listenPort, () => {
      listening = true;
      const address = server.address() as net.AddressInfo;
      serverPort = address.port;
      resolve(serverPort);
      if (signal?.aborted === true) void beginClose();
    });
  });

  return {
    port: portPromise,
    response,
    async close(): Promise<void> {
      const error = await beginClose();
      if (error) throw error;
    },
  };
}
