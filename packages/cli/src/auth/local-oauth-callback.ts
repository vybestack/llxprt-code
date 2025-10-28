import http from 'node:http';
import { readFileSync } from 'node:fs';

const CAT_IMAGE_BASE64 = readFileSync(
  new URL('../assets/cat.png', import.meta.url),
).toString('base64');

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
      ${options.includeCatImage ? `<img src="data:image/png;base64,${CAT_IMAGE_BASE64}" alt="Claude Cat" />` : ''}
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
