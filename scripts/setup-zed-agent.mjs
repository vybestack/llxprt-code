#!/usr/bin/env node
/**
 * Cross-platform Zed agent configuration script.
 *
 * Configures the Zed editor's agent_servers setting to point to a specific
 * llxprt-code build (e.g., a local development branch). This is useful for
 * testing fixes in Zed without needing to reinstall the global npm package.
 *
 * Usage:
 *   node scripts/setup-zed-agent.mjs [--profile <name>] [--entry <path>] [--binary <path>]
 *
 * Without arguments, it auto-detects:
 *   - Binary: local node_modules bun (or global bun on PATH)
 *   - Entry:  packages/cli/index.ts relative to project root
 *   - Profile: gpt56high (override with --profile)
 *
 * Works on Windows, macOS, and Linux.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Zed settings path resolution (cross-platform)
// ---------------------------------------------------------------------------

function getZedSettingsPath() {
  const home = homedir();
  const isWin = platform() === 'win32';
  const isMac = platform() === 'darwin';

  if (isMac) {
    return join(home, 'Library', 'Application Support', 'Zed', 'settings.json');
  }

  if (isWin) {
    return join(home, 'AppData', 'Roaming', 'Zed', 'settings.json');
  }

  // Linux and others — follow XDG
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(home, '.config');
  return join(xdgConfig, 'zed', 'settings.json');
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function findBunBinary() {
  const isWin = platform() === 'win32';
  const exe = isWin ? 'bun.exe' : 'bun';

  // Local node_modules bun
  const localBun = join(projectRoot, 'node_modules', 'bun', 'bin', exe);
  if (existsSync(localBun)) {
    return localBun;
  }

  // Fallback
  return 'bun';
}

function findEntryPoint() {
  return join(projectRoot, 'packages', 'cli', 'index.ts');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    profile: 'gpt56high',
    entry: null,
    binary: null,
    agentName: 'llxprt',
    yolo: true,
    debug: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--profile':
        opts.profile = args[++i];
        break;
      case '--entry':
        opts.entry = args[++i];
        break;
      case '--binary':
        opts.binary = args[++i];
        break;
      case '--agent-name':
        opts.agentName = args[++i];
        break;
      case '--no-yolo':
        opts.yolo = false;
        break;
      case '--no-debug':
        opts.debug = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  opts.binary = opts.binary || findBunBinary();
  opts.entry = opts.entry || findEntryPoint();

  return opts;
}

function printHelp() {
  console.log(`
Usage: node scripts/setup-zed-agent.mjs [options]

Configures Zed's agent_servers to use a local llxprt-code build.

Options:
  --profile <name>     Profile to load (default: gpt56high)
  --entry <path>       Override the index.ts entry point
  --binary <path>      Override the bun binary path
  --agent-name <name>  Agent server name in Zed (default: llxprt)
  --no-yolo            Disable auto-approve (--yolo flag)
  --no-debug           Disable debug logging
  -h, --help           Show this help

The script reads the existing Zed settings.json, adds or updates the
agent_servers entry, and writes it back. It preserves all other settings.
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();
  const settingsPath = getZedSettingsPath();

  console.log(`Zed settings path: ${settingsPath}`);
  console.log(`Binary:            ${opts.binary}`);
  console.log(`Entry:             ${opts.entry}`);
  console.log(`Profile:           ${opts.profile}`);
  console.log(`Agent name:        ${opts.agentName}`);

  // Read existing settings or start fresh
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      // Zed settings.json may have comments (JSONC) — strip them naively.
      const cleaned = raw
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      settings = JSON.parse(cleaned);
    } catch (e) {
      console.warn(
        `Warning: could not parse existing settings.json: ${e.message}`,
      );
      console.warn('Creating a backup and starting fresh.');
      try {
        writeFileSync(
          `${settingsPath}.bak`,
          readFileSync(settingsPath, 'utf-8'),
        );
      } catch {}
    }
  } else {
    // Ensure directory exists
    const dir = dirname(settingsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Build the agent server config
  const args = [
    opts.entry,
    '--experimental-acp',
    '--profile-load',
    opts.profile,
  ];
  if (opts.yolo) {
    args.push('--yolo');
  }

  const env = {};
  if (opts.debug) {
    env.LLXPRT_DEBUG = 'llxprt:*';
  }

  if (!settings.agent_servers) {
    settings.agent_servers = {};
  }

  settings.agent_servers[opts.agentName] = {
    type: 'custom',
    command: opts.binary,
    args,
  };

  if (Object.keys(env).length > 0) {
    settings.agent_servers[opts.agentName].env = env;
  }

  // Write back
  writeFileSync(
    settingsPath,
    JSON.stringify(settings, null, 2) + '\n',
    'utf-8',
  );

  console.log(`\n✅ Updated Zed settings: ${settingsPath}`);
  console.log(`   Agent "${opts.agentName}" now points to your local build.`);
  console.log(
    `\n📌 Restart Zed (or reconnect the agent) for changes to take effect.`,
  );
}

main();
