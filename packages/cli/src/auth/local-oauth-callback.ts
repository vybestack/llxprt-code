import http from 'node:http';

const CLAUDE_CAT_BASE64 =
  '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' +
  'AAAASUVORK5CYII=';

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
