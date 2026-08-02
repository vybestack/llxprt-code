#!/usr/bin/env node
/**
 * Cross-platform Zed agent configuration script.
 *
 * Configures the Zed editor's agent_servers setting to point to a specific
 * llxprt-code build (e.g., a local development branch). This is useful for
 * testing fixes in Zed without needing to reinstall the global npm package.
 *
 * Usage:
 *   node scripts/setup-zed-agent.ts [--profile <name>] [--entry <path>] [--binary <path>]
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
// ---------------------------------------------------------------------------
// JSONC comment stripping (string-aware state machine)
//
// A naive regex like /\/\/.*$/gm corrupts Windows paths (e.g., "C:\\Users"
// becomes "C:"). This state machine tracks whether we're inside a string
// literal and only strips comments outside strings.
// ---------------------------------------------------------------------------

/**
 * Strip // line comments and block comments from JSONC, respecting
 * string literals. Handles escaped quotes inside strings.
 */
function stripJsoncComments(text: string): string {
  let result = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      const { advanced, stillInString } = consumeStringChar(ch, next);
      result += advanced.char;
      if (advanced.char !== '') result += advanced.extra || '';
      inString = stillInString;
      i += advanced.step;
    } else if (ch === '"') {
      inString = true;
      result += ch;
      i++;
    } else if (ch === '/' && next === '/') {
      i = skipLineComment(text, i);
    } else if (ch === '/' && next === '*') {
      i = skipBlockComment(text, i);
    } else {
      result += ch;
      i++;
    }
  }

  return result;
}

function skipLineComment(text: string, i: number): number {
  i += 2;
  while (i < text.length && text[i] !== '\n') {
    i++;
  }
  return i;
}

function skipBlockComment(text: string, i: number): number {
  i += 2;
  while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
    i++;
  }
  return i + 2;
}

function consumeStringChar(
  ch: string,
  next: string | undefined,
): {
  advanced: { char: string; extra: string; step: number };
  stillInString: boolean;
} {
  if (ch === '\\' && next !== undefined) {
    return {
      advanced: { char: ch, extra: next, step: 2 },
      stillInString: true,
    };
  }
  return {
    advanced: { char: ch, extra: '', step: 1 },
    stillInString: ch !== '"',
  };
}

const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Zed settings path resolution (cross-platform)
// ---------------------------------------------------------------------------

function getZedSettingsPath(): string {
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

function findBunBinary(): string {
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

function findEntryPoint(): string {
  return join(projectRoot, 'packages', 'cli', 'index.ts');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ZedSetupOptions {
  profile: string;
  entry: string;
  binary: string;
  agentName: string;
  yolo: boolean;
  debug: boolean;
}

function parseArgs(): ZedSetupOptions {
  const args = process.argv.slice(2);
  const opts: ZedSetupOptions = {
    profile: 'gpt56high',
    entry: '',
    binary: '',
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

function printHelp(): void {
  console.log(`
Usage: node scripts/setup-zed-agent.ts [options]

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

interface AgentServerConfig {
  type: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

function isAgentServers(
  value: unknown,
): value is Record<string, AgentServerConfig> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSettings(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) {
    const dir = dirname(settingsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return {};
  }
  try {
    return JSON.parse(stripJsoncComments(readFileSync(settingsPath, 'utf-8')));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: could not parse existing settings.json: ${message}`);
    try {
      writeFileSync(`${settingsPath}.bak`, readFileSync(settingsPath, 'utf-8'));
      console.error(`A backup was saved to ${settingsPath}.bak`);
    } catch {
      // If backup also fails, nothing more we can do
    }
    console.error('Please fix the file manually and re-run this script.');
    process.exit(1);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const opts = parseArgs();
  const settingsPath = getZedSettingsPath();

  console.log(`Zed settings path: ${settingsPath}`);
  console.log(`Binary:            ${opts.binary}`);
  console.log(`Entry:             ${opts.entry}`);
  console.log(`Profile:           ${opts.profile}`);
  console.log(`Agent name:        ${opts.agentName}`);

  const settings = readSettings(settingsPath);

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

  const env: Record<string, string> = {};
  if (opts.debug) {
    env.LLXPRT_DEBUG = 'llxprt:*';
  }

  const agentServers: Record<string, AgentServerConfig> = isAgentServers(
    settings.agent_servers,
  )
    ? settings.agent_servers
    : {};
  settings.agent_servers = agentServers;
  agentServers[opts.agentName] = {
    type: 'custom',
    command: opts.binary,
    args,
  };

  if (Object.keys(env).length > 0) {
    const agentConfig = agentServers[opts.agentName];
    agentConfig.env = env;
  }

  // Backup before write (in case of disk error mid-write)
  if (existsSync(settingsPath)) {
    try {
      writeFileSync(`${settingsPath}.bak`, readFileSync(settingsPath, 'utf-8'));
    } catch {
      // Non-fatal: best-effort backup
    }
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
