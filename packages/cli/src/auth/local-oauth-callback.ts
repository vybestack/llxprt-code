import http from 'node:http';

import { CLAUDE_CAT_BASE64, CODEX_HAND_BASE64 } from './codex-success-image.js';

export interface LocalOAuthCallbackOptions {
  readonly state: string;
  readonly portRange: readonly [number, number];
  readonly timeoutMs: number;
  /** Provider name for customized success page (e.g., 'codex' for OpenAI/Codex) */
  readonly provider?: 'codex' | 'claude';
}

export interface LocalOAuthCallbackServer {
  readonly redirectUri: string;
  waitForCallback(): Promise<{ code: string; state: string }>;
  shutdown(): Promise<void>;
}

const SUCCESS_HTML = buildResponseHtml({
  title: 'Authentication Complete',
  heading: 'Authorization finished. Return to llxprt.',
  imageType: 'claude',
});

const CODEX_SUCCESS_HTML = buildResponseHtml({
  title: 'Authentication Complete',
  heading:
    "You have successfully authenticated to 'Open'AI, what could possibly go wrong?",
  imageType: 'codex',
});

const FAILURE_HTML = buildResponseHtml({
  title: 'Authentication Failed',
  heading: 'Authorization failed. Return to llxprt and try again.',
  imageType: 'none',
});

function buildResponseHtml(options: {
  title: string;
  heading: string;
  imageType: 'claude' | 'codex' | 'none';
}): string {
  const getImageHtml = (): string => {
    switch (options.imageType) {
      case 'claude':
        return `<img src="data:image/png;base64,${CLAUDE_CAT_BASE64}" alt="Claude Cat" />`;
      case 'codex':
        return `<img src="data:image/png;base64,${CODEX_HAND_BASE64}" alt="Open Hand" />`;
      case 'none':
      default:
        return '';
    }
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${options.title}</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        color: #6a9955;
        font-family: "SFMono-Regular", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        text-align: center;
        padding: 2rem;
      }
      main {
        max-width: 32rem;
      }
      h1 {
        font-size: 1.5rem;
        margin-bottom: 0.75rem;
      }
      p {
        margin: 0;
        line-height: 1.6;
      }
      img {
        display: block;
        margin: 1.5rem auto 0 auto;
        max-width: 240px;
        width: 100%;
        height: auto;
      }
      a {
        color: #6a9955;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${options.title}</h1>
      <p>${options.heading}</p>
      ${getImageHtml()}
    </main>
  </body>
</html>`;
}

export const startLocalOAuthCallback = async (
  options: LocalOAuthCallbackOptions,
): Promise<LocalOAuthCallbackServer> => {
  const [startPort, endPort] = options.portRange;
  for (let port = startPort; port <= endPort; port += 1) {
    try {
      return await createCallbackServer(port, options);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE' || code === 'EACCES') {
        continue;
      }
      throw error;
    }
  }
  throw new Error('No available port for OAuth callback');
};

type OAuthCallbackResult = { code: string; state: string };
type CallbackSettlement = OAuthCallbackResult | Error;
type CallbackState = {
  closed: boolean;
  timeout: NodeJS.Timeout | null;
  settled: CallbackSettlement | null;
  resolveHandler: ((value: OAuthCallbackResult) => void) | null;
  rejectHandler: ((error: Error) => void) | null;
};

const createCallbackState = (): CallbackState => ({
  closed: false,
  timeout: null,
  settled: null,
  resolveHandler: null,
  rejectHandler: null,
});

const settleCallback = (
  state: CallbackState,
  result: CallbackSettlement,
): void => {
  if (state.settled) {
    return;
  }
  state.settled = result;
  if (result instanceof Error) {
    state.rejectHandler?.(result);
  } else {
    state.resolveHandler?.(result);
  }
  state.resolveHandler = null;
  state.rejectHandler = null;
};

const shutdownCallbackServer = async (
  server: http.Server,
  state: CallbackState,
): Promise<void> => {
  if (state.closed) {
    return;
  }
  state.closed = true;
  if (state.timeout) {
    clearTimeout(state.timeout);
    state.timeout = null;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};

const createCallbackRequestHandler =
  (
    redirectUri: string,
    options: LocalOAuthCallbackOptions,
    state: CallbackState,
    shutdown: () => Promise<void>,
  ) =>
  (request: http.IncomingMessage, response: http.ServerResponse) => {
    const url = new URL(request.url ?? '/', redirectUri);
    const code = url.searchParams.get('code');
    const callbackState = url.searchParams.get('state');

    if (!code || !callbackState) {
      respond(response, 400, FAILURE_HTML);
      settleCallback(state, new Error('OAuth callback missing code or state'));
      void shutdown();
      return;
    }

    if (callbackState !== options.state) {
      respond(response, 400, FAILURE_HTML);
      settleCallback(state, new Error('OAuth state mismatch'));
      void shutdown();
      return;
    }

    const successHtml =
      options.provider === 'codex' ? CODEX_SUCCESS_HTML : SUCCESS_HTML;
    respond(response, 200, successHtml);
    settleCallback(state, { code, state: callbackState });
    void shutdown();
  };

const waitForCallback = (
  state: CallbackState,
): Promise<OAuthCallbackResult> => {
  if (state.settled instanceof Error) {
    return Promise.reject(state.settled);
  }
  if (state.settled && !(state.settled instanceof Error)) {
    return Promise.resolve(state.settled);
  }
  return new Promise<OAuthCallbackResult>((resolve, reject) => {
    state.resolveHandler = resolve;
    state.rejectHandler = reject;
  });
};

const createCallbackServer = async (
  port: number,
  options: LocalOAuthCallbackOptions,
): Promise<LocalOAuthCallbackServer> => {
  const callbackPath =
    options.provider === 'codex' ? '/auth/callback' : '/callback';
  const redirectUri = `http://localhost:${port}${callbackPath}`;
  const server = http.createServer();

  await listen(server, port);

  const state = createCallbackState();
  const shutdown = () => shutdownCallbackServer(server, state);

  server.on(
    'request',
    createCallbackRequestHandler(redirectUri, options, state, shutdown),
  );

  server.on('error', (error) => {
    settleCallback(
      state,
      error instanceof Error ? error : new Error(String(error)),
    );
    void shutdown();
  });

  state.timeout = setTimeout(() => {
    settleCallback(state, new Error('OAuth callback timed out'));
    void shutdown();
  }, options.timeoutMs);

  return {
    redirectUri,
    waitForCallback: () => waitForCallback(state),
    shutdown,
  };
};

const listen = (server: http.Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.removeListener('listening', handleListening);
      reject(error);
    };

    const handleListening = () => {
      server.removeListener('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, '127.0.0.1');
  });

const respond = (
  response: http.ServerResponse,
  status: number,
  body: string,
): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(body);
};
