#!/usr/bin/env node
/* Minimal logging proxy: forwards to Ollama and dumps each request body.
 * Usage: node scripts/ollama-logging-proxy.cjs [listenPort] [ollamaPort]
 * Point a profile's base-url at http://127.0.0.1:<listenPort>/v1/
 */
const http = require('http');
const fs = require('fs');

const LISTEN_PORT = Number(process.argv[2] || 11500);
const OLLAMA_PORT = Number(process.argv[3] || 11434);
const OUT = process.env.PROXY_LOG || '/tmp/ollama-proxy-requests.log';
const UPSTREAM_TIMEOUT_MS = Number(
  process.env.PROXY_UPSTREAM_TIMEOUT_MS || 120000,
);

// The log captures full system/user prompt content, so keep it readable only
// by the owner (0o600) to avoid exposing sensitive data to other local users.
fs.closeSync(fs.openSync(OUT, 'a', 0o600));
fs.chmodSync(OUT, 0o600);

/**
 * Format message content as string (if already string) or JSON.
 */
function formatMessageContent(content) {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

/**
 * Log the system message and last user message from parsed.messages.
 */
function logMessages(OUT, id, messages) {
  const sys = messages.find((m) => m.role === 'system');
  if (sys) {
    fs.appendFileSync(
      OUT,
      '---- REQUEST ' +
        id +
        ' SYSTEM MESSAGE ----\n' +
        formatMessageContent(sys.content) +
        '\n---- END SYSTEM ----\n',
    );
  }
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (lastUser) {
    fs.appendFileSync(
      OUT,
      '---- REQUEST ' +
        id +
        ' LAST USER ----\n' +
        formatMessageContent(lastUser.content) +
        '\n',
    );
  }
}

/**
 * Write a summary and detailed dump of the parsed request body to the log.
 */
function logRequestBody(OUT, id, parsed, url) {
  const summary = {
    id,
    ts: new Date().toISOString(),
    url,
    model: parsed.model,
    tool_choice: parsed.tool_choice,
    toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
    toolNames: Array.isArray(parsed.tools)
      ? parsed.tools.map((t) => t.function && t.function.name)
      : [],
    messageRoles: Array.isArray(parsed.messages)
      ? parsed.messages.map((m) => m.role)
      : [],
  };
  fs.appendFileSync(
    OUT,
    '==== REQUEST ' +
      id +
      ' SUMMARY ====\n' +
      JSON.stringify(summary, null, 2) +
      '\n',
  );
  // Dump the full system message + full tools array verbatim
  if (Array.isArray(parsed.messages)) {
    logMessages(OUT, id, parsed.messages);
  }
  if (Array.isArray(parsed.tools)) {
    fs.appendFileSync(
      OUT,
      '---- REQUEST ' +
        id +
        ' TOOLS ARRAY ----\n' +
        JSON.stringify(parsed.tools, null, 2) +
        '\n---- END TOOLS ----\n',
    );
  }
}

let counter = 0;

/**
 * Handle proxy request errors by returning an appropriate status to the client.
 */
function handleProxyError(res, err, settledRef) {
  if (settledRef.value) {
    res.destroy();
    return;
  }
  settledRef.value = true;
  const isTimeout = err && err.message === 'upstream timeout';
  res.writeHead(isTimeout ? 504 : 502);
  res.end((isTimeout ? 'upstream timeout: ' : 'proxy error: ') + err.message);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const id = ++counter;
    if (req.method === 'POST' && body.length > 0) {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        logRequestBody(OUT, id, parsed, req.url);
      } catch {
        fs.appendFileSync(
          OUT,
          '==== REQUEST ' +
            id +
            ' (non-JSON, ' +
            body.length +
            ' bytes) ====\n',
        );
      }
    }

    const settledRef = { value: false };
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: OLLAMA_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        settledRef.value = true;
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    // Avoid hanging forever if Ollama stops responding: time out and return 504.
    proxyReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      proxyReq.destroy(new Error('upstream timeout'));
    });
    proxyReq.on('error', (err) => handleProxyError(res, err, settledRef));
    proxyReq.end(body);
  });
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(
    'ollama-logging-proxy listening on http://127.0.0.1:' +
      LISTEN_PORT +
      ' -> 127.0.0.1:' +
      OLLAMA_PORT +
      ' (log: ' +
      OUT +
      ')',
  );
});
