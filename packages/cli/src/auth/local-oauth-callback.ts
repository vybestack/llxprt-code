import http from 'node:http';

const CLAUDE_CAT_BASE64 =
  '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';

export interface LocalOAuthCallbackOptions {
  readonly state: string;
  readonly portRange: readonly [number, number];
  readonly timeoutMs: number;
}

export interface LocalOAuthCallbackServer {
  readonly redirectUri: string;
  waitForCallback(): Promise<{ code: string; state: string }>;
  shutdown(): Promise<void>;
}

const SUCCESS_HTML = buildResponseHtml({
  title: 'Authentication Complete',
  heading: 'Authorization finished. Return to llxprt.',
  includeCatImage: true,
});
const FAILURE_HTML = buildResponseHtml({
  title: 'Authentication Failed',
  heading: 'Authorization failed. Return to llxprt and try again.',
  includeCatImage: false,
});

function buildResponseHtml(options: {
  title: string;
  heading: string;
  includeCatImage: boolean;
}): string {
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
      ${options.includeCatImage ? `<img src="data:image/png;base64,${CLAUDE_CAT_BASE64}" alt="Claude Cat" />` : ''}
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

const createCallbackServer = async (
  port: number,
  options: LocalOAuthCallbackOptions,
): Promise<LocalOAuthCallbackServer> => {
  const redirectUri = `http://localhost:${port}/callback`;
  const server = http.createServer();

  await listen(server, port);

  let closed = false;
  let timeout: NodeJS.Timeout | null = null;
  let settled: { code: string; state: string } | Error | null = null;
  let resolveHandler:
    | ((value: { code: string; state: string }) => void)
    | null = null;
  let rejectHandler: ((error: Error) => void) | null = null;

  const settle = (result: { code: string; state: string } | Error) => {
    if (settled) {
      return;
    }
    settled = result;
    if (result instanceof Error) {
      if (rejectHandler) {
        rejectHandler(result);
      }
    } else if (resolveHandler) {
      resolveHandler(result);
    }
    resolveHandler = null;
    rejectHandler = null;
  };

  const shutdown = async () => {
    if (closed) {
      return;
    }
    closed = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  server.on('request', (request, response) => {
    const url = new URL(request.url ?? '/', redirectUri);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      respond(response, 400, FAILURE_HTML);
      settle(new Error('OAuth callback missing code or state'));
      void shutdown();
      return;
    }

    if (state !== options.state) {
      respond(response, 400, FAILURE_HTML);
      settle(new Error('OAuth state mismatch'));
      void shutdown();
      return;
    }

    respond(response, 200, SUCCESS_HTML);
    settle({ code, state });
    void shutdown();
  });

  server.on('error', async (error) => {
    settle(error instanceof Error ? error : new Error(String(error)));
    await shutdown();
  });

  timeout = setTimeout(() => {
    settle(new Error('OAuth callback timed out'));
    void shutdown();
  }, options.timeoutMs);

  return {
    redirectUri,
    waitForCallback: () => {
      if (settled instanceof Error) {
        return Promise.reject(settled);
      }
      if (settled && !(settled instanceof Error)) {
        return Promise.resolve(settled);
      }
      return new Promise<{ code: string; state: string }>((resolve, reject) => {
        resolveHandler = resolve;
        rejectHandler = reject;
      });
    },
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
