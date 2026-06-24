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

let counter = 0;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const id = ++counter;
    if (req.method === 'POST' && body.length > 0) {
      try {
        const parsed = JSON.parse(body.toString('utf8'));
        const summary = {
          id,
          ts: new Date().toISOString(),
          url: req.url,
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
          const sys = parsed.messages.find((m) => m.role === 'system');
          if (sys) {
            fs.appendFileSync(
              OUT,
              '---- REQUEST ' +
                id +
                ' SYSTEM MESSAGE ----\n' +
                (typeof sys.content === 'string'
                  ? sys.content
                  : JSON.stringify(sys.content)) +
                '\n---- END SYSTEM ----\n',
            );
          }
          const lastUser = [...parsed.messages]
            .reverse()
            .find((m) => m.role === 'user');
          if (lastUser) {
            fs.appendFileSync(
              OUT,
              '---- REQUEST ' +
                id +
                ' LAST USER ----\n' +
                (typeof lastUser.content === 'string'
                  ? lastUser.content
                  : JSON.stringify(lastUser.content)) +
                '\n',
            );
          }
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

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: OLLAMA_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end('proxy error: ' + err.message);
    });
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
