/**
 * Minimal tmux-based interactive UI harness for the legacy Ink UI.
 *
 * Why tmux:
 * - Keeps stdin as a TTY (so LLxprt stays in interactive mode).
 * - Lets us inject keystrokes and capture the rendered screen + scrollback.
 *
 * Usage:
 *   node scripts/oldui-tmux-harness.js
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    scenario: 'haiku', // haiku | scrollback
    cols: 120,
    rows: 40,
    yolo: false,
    keepSession: false,
  };

  const takeValue = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const value = args[idx + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(`Missing value for ${flag}`);
    }
    args.splice(idx, 2);
    return value;
  };

  const hasFlag = (flag) => {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    args.splice(idx, 1);
    return true;
  };

  const scenario = takeValue('--scenario');
  if (scenario) opts.scenario = scenario;

  const cols = takeValue('--cols');
  if (cols) opts.cols = Number(cols);
  const rows = takeValue('--rows');
  if (rows) opts.rows = Number(rows);

  opts.yolo = hasFlag('--yolo');
  opts.keepSession = hasFlag('--keep-session');

  if (args.length > 0) {
    throw new Error(`Unknown args: ${args.join(' ')}`);
  }

  if (!Number.isFinite(opts.cols) || opts.cols <= 0) {
    throw new Error(`Invalid --cols: ${opts.cols}`);
  }
  if (!Number.isFinite(opts.rows) || opts.rows <= 0) {
    throw new Error(`Invalid --rows: ${opts.rows}`);
  }
  if (!['haiku', 'scrollback'].includes(opts.scenario)) {
    throw new Error(`Invalid --scenario: ${opts.scenario}`);
  }

  return opts;
}

function runTmux(args, options = {}) {
  const result = spawnSync('tmux', args, {
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? '').toString().trim();
    const message = stderr.length > 0 ? stderr : 'tmux command failed';
    const err = new Error(`${message}: tmux ${args.join(' ')}`);
    err.code = result.status;
    throw err;
  }

  return (result.stdout ?? '').toString();
}

function tryTmux(args) {
  try {
    return runTmux(args);
  } catch {
    return null;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isPrimaryPaneDead(sessionName) {
  try {
    const out = runTmux([
      'list-panes',
      '-t',
      `${sessionName}:0`,
      '-F',
      '#{pane_dead}',
    ]).trim();
    const first = out.split('\n')[0]?.trim();
    return first === '1';
  } catch {
    return false;
  }
}

async function waitForPaneDead(sessionName, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isPrimaryPaneDead(sessionName)) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

function getHistorySize(sessionName) {
  const out = runTmux([
    'display-message',
    '-p',
    '-t',
    `${sessionName}:0.0`,
    '#{history_size}',
  ]).trim();
  const n = Number(out);
  return Number.isFinite(n) ? n : 0;
}

async function runScenarioHaiku({ typeLineAndSubmit }) {
  await typeLineAndSubmit('/profile load synthetic');
  await sleep(2000);

  await typeLineAndSubmit('write me a haiku');
  await sleep(8000);

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  return { kind: 'haiku' };
}

async function runScenarioScrollback({
  sessionName,
  typeLineAndSubmit,
  outDir,
}) {
  await typeLineAndSubmit('/profile load synthetic');
  await sleep(2000);

  const sentinel = 'SCROLLTEST LINE 0001';

  // Produce incremental output for ~15s so the UI updates repeatedly while the
  // output grows beyond a small terminal height.
  const cmd =
    '!node -e \'let i=0; const total=60; const ms=250; const t=setInterval(() => { i++; console.log("SCROLLTEST LINE " + String(i).padStart(4, "0")); if (i>=total) { clearInterval(t); } }, ms);\'';
  await typeLineAndSubmit(cmd, { enterRepeats: 1, escapeBeforeEnter: false });

  // If the shell command triggers a confirmation dialog (non-YOLO mode), accept
  // the default selection ("Yes, allow once") so the scenario can proceed.
  await sleep(600);
  const maybeDialog = runTmux(['capture-pane', '-p', '-t', sessionName]);
  if (maybeDialog.includes('Shell Command Execution')) {
    runTmux(['send-keys', '-t', sessionName, 'Enter']);
  }

  // Disable output height constraints while the command is running (this is the
  // user-visible "show more lines" mode that can trigger redraw/scrollback
  // problems when output exceeds terminal height).
  await sleep(800);
  runTmux(['send-keys', '-t', sessionName, 'C-s']);

  // Wait until output is flowing, then enter tmux copy-mode (simulates user
  // scrolling up in their terminal) and sit there while the program continues.
  await sleep(2500);
  runTmux(['copy-mode', '-t', `${sessionName}:0.0`]);
  for (let i = 0; i < 3; i += 1) {
    runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'page-up']);
  }

  const sampleStart = Date.now();
  const historySamples = [];
  const sampleForMs = 20000;
  while (Date.now() - sampleStart <= sampleForMs) {
    historySamples.push({
      tMs: Date.now() - sampleStart,
      historySize: getHistorySize(sessionName),
    });
    await sleep(1000);
  }

  runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'cancel']);

  // Let the command finish and settle.
  await sleep(2000);

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  await fs.writeFile(
    path.join(outDir, 'history-samples.json'),
    JSON.stringify(historySamples, null, 2),
    'utf8',
  );

  return { kind: 'scrollback', sentinel, historySamples };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionName = `llxprt_oldui_${Date.now().toString(16)}`;
  const outDir = path.join(
    os.tmpdir(),
    `llxprt-oldui-tmux-harness-${Date.now()}`,
  );
  await fs.mkdir(outDir, { recursive: true });

  // Ensure no stale session with the same name (unlikely, but safe).
  tryTmux(['kill-session', '-t', sessionName]);

  // Start LLxprt in interactive mode (no piped stdin).
  const startArgs = ['node', 'scripts/start.js'];
  if (options.yolo) {
    startArgs.push('--yolo');
  }
  runTmux([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-x',
    String(options.cols),
    '-y',
    String(options.rows),
    ...startArgs,
  ]);
  // Keep the session around after the command exits so we can capture the final
  // screen and scrollback even if /quit exits quickly.
  runTmux(['set-option', '-t', `${sessionName}:0`, 'remain-on-exit', 'on']);
  runTmux(['set-option', '-t', `${sessionName}:0`, 'history-limit', '50000']);

  // Let Ink render the initial UI.
  await sleep(6000);

  const typeLineAndSubmit = async (
    line,
    { postTypeMs = 600, enterRepeats = 1, escapeBeforeEnter = true } = {},
  ) => {
    runTmux(['send-keys', '-t', sessionName, '-l', line]);
    await sleep(postTypeMs);
    if (escapeBeforeEnter) {
      runTmux(['send-keys', '-t', sessionName, 'Escape']);
      await sleep(150);
    }
    for (let i = 0; i < enterRepeats; i += 1) {
      runTmux(['send-keys', '-t', sessionName, 'Enter']);
      await sleep(150);
    }
  };

  let scenarioResult;
  if (options.scenario === 'haiku') {
    scenarioResult = await runScenarioHaiku({ sessionName, typeLineAndSubmit });
  } else if (options.scenario === 'scrollback') {
    scenarioResult = await runScenarioScrollback({
      sessionName,
      typeLineAndSubmit,
      outDir,
    });
  } else {
    throw new Error(`Unhandled scenario: ${options.scenario}`);
  }

  // Give the process time to exit cleanly (pane should become "dead").
  const exited = await waitForPaneDead(sessionName, 15000);

  // Capture both visible screen and some scrollback for inspection.
  const screen = runTmux(['capture-pane', '-p', '-t', sessionName]);
  const scrollbackLines = options.scenario === 'scrollback' ? 20000 : 2000;
  const scrollback = runTmux([
    'capture-pane',
    '-p',
    '-t',
    sessionName,
    '-S',
    `-${scrollbackLines}`,
  ]);
  await fs.writeFile(path.join(outDir, 'screen.txt'), screen, 'utf8');
  await fs.writeFile(path.join(outDir, 'scrollback.txt'), scrollback, 'utf8');

  if (scenarioResult?.kind === 'scrollback') {
    const sentinelCount =
      scrollback.match(new RegExp(scenarioResult.sentinel, 'g'))?.length ?? 0;
    const tipsCount =
      scrollback.match(/Tips for getting started:/g)?.length ?? 0;

    const historyDelta =
      scenarioResult.historySamples.length >= 2
        ? scenarioResult.historySamples.at(-1).historySize -
          scenarioResult.historySamples[0].historySize
        : 0;

    await fs.writeFile(
      path.join(outDir, 'metrics.json'),
      JSON.stringify(
        {
          scenario: 'scrollback',
          tmux: {
            cols: options.cols,
            rows: options.rows,
          },
          counts: {
            sentinel: scenarioResult.sentinel,
            sentinelCount,
            tipsCount,
          },
          history: {
            deltaDuringCopyMode: historyDelta,
            samplesFile: 'history-samples.json',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  // Tear down so we don't leak sessions.
  if (!options.keepSession) {
    tryTmux(['kill-session', '-t', sessionName]);
  }

  const summary = [
    `tmux session: ${sessionName}`,
    `exited: ${exited ? 'yes' : 'no (killed session)'}`,
    `artifacts: ${outDir}`,
    `scenario: ${options.scenario}`,
  ].join('\n');
  console.log(summary);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
