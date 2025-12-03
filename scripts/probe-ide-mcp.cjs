#!/usr/bin/env node
/**
 * Quick probe script to call the IDE companion MCP server directly.
 * Reads a port file path from CLI arg or auto-detects llxprt-ide-server-*.json in the OS tmpdir.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const glob = require('glob');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function main() {
  const portFileArg = process.argv[2];
  let portFile = portFileArg;
  if (!portFile) {
    const tmpDir = os.tmpdir();
    const matches = glob.sync(`${tmpDir}/llxprt-ide-server-*.json`);
    if (matches.length === 0) {
      throw new Error(
        `No llxprt-ide-server-*.json files found in ${tmpDir}; is the companion running?`,
      );
    }
    // Prefer current ppid match if present
    const ppid = process.ppid;
    const preferred = matches.find((m) => m.includes(`-${ppid}.json`));
    portFile = preferred ?? matches[0];
  }

  const raw = fs.readFileSync(portFile, 'utf8');
  const { port, authToken } = JSON.parse(raw);
  if (!port) throw new Error(`Port missing in ${portFile}`);
  console.log(`Using port file: ${portFile}`);
  console.log(`Connecting to http://127.0.0.1:${port}/mcp`);

  const client = new Client({ name: 'ide-probe', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    {
      requestInit: {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      },
    },
  );
  await client.connect(transport);
  console.log('Connected. Calling tools/call openDiff...');
  const result = await client.callTool({
    name: 'openDiff',
    arguments: {
      filePath: path.join(process.cwd(), 'PROBE_TEST.txt'),
      newContent: 'probe-content',
    },
  });
  console.log('Tool call result:', JSON.stringify(result, null, 2));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
