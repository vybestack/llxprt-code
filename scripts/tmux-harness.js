/**
 * Minimal tmux-based interactive UI harness for the Ink UI.
 *
 * Why tmux:
 * - Keeps stdin as a TTY (so LLxprt stays in interactive mode).
 * - Lets us inject keystrokes and capture the rendered screen + scrollback.
 *
 * Usage:
 *   node scripts/tmux-harness.js
 *
 * Scripted mode:
 *   node scripts/tmux-harness.js --script scripts/tmux-script.example.json
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const args = [...argv];
  const opts = {
    scenario: undefined, // haiku | scrollback
    scriptPath: undefined,
    outDir: undefined,
    cols: undefined,
    rows: undefined,
    initialWaitMs: undefined,
    historyLimit: undefined,
    scrollbackLines: undefined,
    yolo: false,
    keepSession: false,
    assert: false,
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

  const scriptPath = takeValue('--script');
  if (scriptPath) opts.scriptPath = scriptPath;

  const outDir = takeValue('--out-dir');
  if (outDir) opts.outDir = outDir;

  const cols = takeValue('--cols');
  if (cols) opts.cols = Number(cols);
  const rows = takeValue('--rows');
  if (rows) opts.rows = Number(rows);

  const initialWaitMs = takeValue('--initial-wait-ms');
  if (initialWaitMs) opts.initialWaitMs = Number(initialWaitMs);

  const historyLimit = takeValue('--history-limit');
  if (historyLimit) opts.historyLimit = Number(historyLimit);

  const scrollbackLines = takeValue('--scrollback-lines');
  if (scrollbackLines) opts.scrollbackLines = Number(scrollbackLines);

  opts.yolo = hasFlag('--yolo');
  opts.keepSession = hasFlag('--keep-session');
  opts.assert = hasFlag('--assert');

  if (args.length > 0) {
    throw new Error(`Unknown args: ${args.join(' ')}`);
  }

  validatePositiveFinite(opts.cols, '--cols');
  validatePositiveFinite(opts.rows, '--rows');
  validateNonNegativeFinite(opts.initialWaitMs, '--initial-wait-ms');
  validatePositiveFinite(opts.historyLimit, '--history-limit');
  validatePositiveFinite(opts.scrollbackLines, '--scrollback-lines');
  if (
    opts.scenario !== undefined &&
    !['haiku', 'scrollback'].includes(opts.scenario)
  ) {
    throw new Error(`Invalid --scenario: ${opts.scenario}`);
  }

  return opts;
}

function validatePositiveFinite(value, flag) {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
}

function validateNonNegativeFinite(value, flag) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`Invalid ${flag}: ${value}`);
  }
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

function captureScreen(sessionName) {
  return runTmux(['capture-pane', '-p', '-t', sessionName]);
}

function captureScrollback(sessionName, scrollbackLines) {
  return runTmux([
    'capture-pane',
    '-p',
    '-t',
    sessionName,
    '-S',
    `-${scrollbackLines}`,
  ]);
}

export function compileMatcher(step) {
  if (typeof step.contains === 'string') {
    return { kind: 'contains', value: step.contains };
  }
  if (typeof step.regex === 'string') {
    const flags = typeof step.regexFlags === 'string' ? step.regexFlags : '';
    return { kind: 'regex', value: new RegExp(step.regex, flags) };
  }
  throw new Error(
    `Matcher requires "contains" or "regex": ${JSON.stringify(step)}`,
  );
}

export function matchText(text, matcher) {
  if (matcher.kind === 'contains') {
    return text.includes(matcher.value);
  }
  matcher.value.lastIndex = 0;

  return matcher.value.test(text);
}

export function formatMatcher(matcher) {
  if (matcher.kind === 'contains') {
    return `contains "${matcher.value}"`;
  }
  return `regex /${matcher.value.source}/${matcher.value.flags}`;
}

export function countMatches(text, matcher) {
  if (matcher.kind === 'contains') {
    if (matcher.value.length === 0) {
      return 0;
    }
    let count = 0;
    let idx = 0;
    while (true) {
      idx = text.indexOf(matcher.value, idx);
      if (idx === -1) break;
      count += 1;
      idx += matcher.value.length;
    }
    return count;
  }

  const flags = matcher.value.flags.includes('g')
    ? matcher.value.flags
    : `${matcher.value.flags}g`;
  const re = new RegExp(matcher.value.source, flags);
  return Array.from(text.matchAll(re)).length;
}

export function sanitizeLabel(label) {
  return label.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '');
}

export function deepCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function applyMacroArgs(value, args) {
  if (typeof value === 'string') {
    const exact = value.match(/^\$\{([A-Za-z0-9_]+)\}$/);
    if (exact) {
      const key = exact[1];
      if (Object.prototype.hasOwnProperty.call(args, key)) {
        return args[key];
      }
    }

    return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(args, key)) return match;
      return String(args[key]);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => applyMacroArgs(item, args));
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = applyMacroArgs(v, args);
    }
    return out;
  }

  return value;
}

export function expandScriptMacros(steps, macros) {
  if (!Array.isArray(steps)) {
    throw new Error(`script.steps must be an array`);
  }
  if (macros === undefined || macros === null) return steps;
  if (typeof macros !== 'object') {
    throw new Error(`script.macros must be an object`);
  }

  const expand = (inputSteps, stack) => {
    const output = [];
    for (const step of inputSteps) {
      if (step && typeof step === 'object' && step.type === 'macro') {
        const name = step.name;
        if (typeof name !== 'string' || name.trim().length === 0) {
          throw new Error(`macro step requires non-empty "name"`);
        }
        if (stack.includes(name)) {
          throw new Error(
            `Macro cycle detected: ${[...stack, name].join(' -> ')}`,
          );
        }

        const template = macros[name];
        if (!Array.isArray(template)) {
          throw new Error(`Macro "${name}" must be an array of steps`);
        }
        const args =
          step.args &&
          typeof step.args === 'object' &&
          !Array.isArray(step.args)
            ? step.args
            : {};

        const expandedTemplate = expand(template, [...stack, name]);
        for (const templateStep of expandedTemplate) {
          output.push(applyMacroArgs(deepCloneJson(templateStep), args));
        }
        continue;
      }

      output.push(step);
    }
    return output;
  };

  return expand(steps, []);
}

export function parseToolConfirmationOptions(screen) {
  const options = [];
  const lines = screen.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/^ *│?/, '').replace(/│ *$/, '');
    const match = line.match(/^\s*(?:●\s*)?(\d+)\.\s*(.*?)\s*$/u);
    if (!match) continue;
    const number = Number(match[1]);
    const label = match[2] ?? '';
    if (!Number.isFinite(number) || number <= 0) continue;

    const labelTrimmed = label.trim();
    const labelLower = labelTrimmed.toLowerCase();
    if (
      !labelLower.startsWith('yes') &&
      !labelLower.startsWith('no') &&
      !labelLower.startsWith('modify')
    ) {
      continue;
    }

    options.push({
      number,
      label: labelTrimmed,
      selected: line.includes('●'),
    });
  }
  return options;
}

async function captureArtifacts({
  sessionName,
  outDir,
  label,
  scrollbackLines,
}) {
  const safe = sanitizeLabel(label);
  const screen = captureScreen(sessionName);
  const scrollback = captureScrollback(sessionName, scrollbackLines);
  await fs.writeFile(path.join(outDir, `${safe}-screen.txt`), screen, 'utf8');
  await fs.writeFile(
    path.join(outDir, `${safe}-scrollback.txt`),
    scrollback,
    'utf8',
  );
}

async function waitFor({
  sessionName,
  scope,
  matcher,
  timeoutMs,
  pollMs,
  scrollbackLines,
  description,
}) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const text =
      scope === 'scrollback'
        ? captureScrollback(sessionName, scrollbackLines)
        : captureScreen(sessionName);
    if (matchText(text, matcher)) {
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for ${description ?? formatMatcher(matcher)} in ${scope} after ${timeoutMs}ms`,
  );
}

async function waitForNot({
  sessionName,
  scope,
  matcher,
  timeoutMs,
  pollMs,
  scrollbackLines,
  description,
}) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const text =
      scope === 'scrollback'
        ? captureScrollback(sessionName, scrollbackLines)
        : captureScreen(sessionName);
    if (!matchText(text, matcher)) {
      return;
    }
    await sleep(pollMs);
  }
  throw new Error(
    `Timed out waiting for absence of ${description ?? formatMatcher(matcher)} in ${scope} after ${timeoutMs}ms`,
  );
}

function isShellModeActive(sessionName) {
  const screen = captureScreen(sessionName);
  return screen.includes('shell mode enabled');
}

function resolveScopeAndScrollback(step, defaults) {
  const scope = step.scope === 'scrollback' ? 'scrollback' : 'screen';
  const scrollbackLines = Number(
    step.scrollbackLines ?? defaults.scrollbackLines,
  );
  return { scope, scrollbackLines };
}

async function executeWaitStep(step) {
  const ms = Number(step.ms ?? 0);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid wait.ms`);
  }
  await sleep(ms);
}

async function executeLineStep(step, sessionName, sendKeys, defaults) {
  if (typeof step.text !== 'string') {
    throw new Error(`Invalid line.text`);
  }
  const postTypeMs = Number(step.postTypeMs ?? defaults.postTypeMs);

  const submitKeys = (() => {
    if (Array.isArray(step.submitKeys)) return step.submitKeys;
    const treatAsShell =
      step.text.startsWith('!') || isShellModeActive(sessionName);
    return treatAsShell ? defaults.shellSubmitKeys : defaults.submitKeys;
  })();

  runTmux(['send-keys', '-t', sessionName, '-l', step.text]);
  await sleep(postTypeMs);
  await sendKeys(submitKeys);
}

async function executeKeyStep(step, sendKeys) {
  if (typeof step.key !== 'string') {
    throw new Error(`Invalid key.key`);
  }
  await sendKeys([step.key]);
}

async function executeKeysStep(step, sendKeys) {
  if (
    !Array.isArray(step.keys) ||
    step.keys.some((k) => typeof k !== 'string')
  ) {
    throw new Error(`Invalid keys.keys`);
  }
  await sendKeys(step.keys);
}

async function executeSelectToolOptionStep(step, sessionName, sendKeys) {
  const matcher = compileMatcher(step);
  const screen = captureScreen(sessionName);
  const options = parseToolConfirmationOptions(screen);
  if (options.length === 0) {
    throw new Error(`No tool confirmation options found on screen`);
  }

  const currentIndex = options.findIndex((option) => option.selected);
  const startIndex = currentIndex === -1 ? 0 : currentIndex;
  const targetIndex = options.findIndex((option) =>
    matchText(option.label, matcher),
  );
  if (targetIndex === -1) {
    throw new Error(
      `No tool option matches ${formatMatcher(matcher)} (options: ${options.map((o) => o.label).join(', ')})`,
    );
  }

  const delta = targetIndex - startIndex;
  if (delta > 0) {
    await sendKeys(Array.from({ length: delta }, () => 'Down'));
  } else if (delta < 0) {
    await sendKeys(Array.from({ length: -delta }, () => 'Up'));
  }
}

async function executeCopyModeStep(step, sessionName) {
  if (step.enter) {
    runTmux(['copy-mode', '-t', `${sessionName}:0.0`]);
  }
  if (step.exit) {
    runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', 'cancel']);
  }

  const repeatAction = async (action, count) => {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid copyMode count`);
    }
    for (let idx = 0; idx < n; idx += 1) {
      runTmux(['send-keys', '-t', `${sessionName}:0.0`, '-X', action]);
      await sleep(80);
    }
  };

  if (step.pageUp) await repeatAction('page-up', step.pageUp);
  if (step.pageDown) await repeatAction('page-down', step.pageDown);
  if (step.up) await repeatAction('cursor-up', step.up);
  if (step.down) await repeatAction('cursor-down', step.down);
}

async function executeCaptureStep(step, i, sessionName, outDir, defaults) {
  const label = typeof step.label === 'string' ? step.label : `capture_${i}`;
  const scrollbackLines = Number(
    step.scrollbackLines ?? defaults.scrollbackLines,
  );
  const safe = sanitizeLabel(`${String(i).padStart(3, '0')}-${label}`);

  if (step.scope === 'screen') {
    const screen = captureScreen(sessionName);
    await fs.writeFile(path.join(outDir, `${safe}-screen.txt`), screen, 'utf8');
  } else if (step.scope === 'scrollback') {
    const scrollback = captureScrollback(sessionName, scrollbackLines);
    await fs.writeFile(
      path.join(outDir, `${safe}-scrollback.txt`),
      scrollback,
      'utf8',
    );
  } else {
    await captureArtifacts({
      sessionName,
      outDir,
      label: safe,
      scrollbackLines,
    });
  }
}

async function executeWaitForStep(step, i, sessionName, defaults) {
  const matcher = compileMatcher(step);
  const timeoutMs = Number(step.timeoutMs ?? defaults.timeoutMs);
  const pollMs = Number(step.pollMs ?? defaults.pollMs);
  const { scope, scrollbackLines } = resolveScopeAndScrollback(step, defaults);
  await waitFor({
    sessionName,
    scope,
    matcher,
    timeoutMs,
    pollMs,
    scrollbackLines,
    description: `step ${i} (${formatMatcher(matcher)})`,
  });
}

async function executeWaitForNotStep(step, i, sessionName, defaults) {
  const matcher = compileMatcher(step);
  const timeoutMs = Number(step.timeoutMs ?? defaults.timeoutMs);
  const pollMs = Number(step.pollMs ?? defaults.pollMs);
  const { scope, scrollbackLines } = resolveScopeAndScrollback(step, defaults);
  await waitForNot({
    sessionName,
    scope,
    matcher,
    timeoutMs,
    pollMs,
    scrollbackLines,
    description: `step ${i} (${formatMatcher(matcher)})`,
  });
}

async function executeExpectStep(step, sessionName, defaults) {
  const matcher = compileMatcher(step);
  const { scope, scrollbackLines } = resolveScopeAndScrollback(step, defaults);
  const text =
    scope === 'scrollback'
      ? captureScrollback(sessionName, scrollbackLines)
      : captureScreen(sessionName);

  if (step.lineNumber !== undefined) {
    const n = Number(step.lineNumber);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`Invalid expect.lineNumber`);
    }
    const lines = text.split('\n');
    const line = lines[n - 1] ?? '';
    if (!matchText(line, matcher)) {
      throw new Error(
        `Expected ${formatMatcher(matcher)} on ${scope} line ${n}`,
      );
    }
  } else if (!matchText(text, matcher)) {
    throw new Error(`Expected ${formatMatcher(matcher)} in ${scope}`);
  }
}

async function executeExpectCountStep(step, sessionName, defaults) {
  const matcher = compileMatcher(step);
  const { scope, scrollbackLines } = resolveScopeAndScrollback(step, defaults);
  const text =
    scope === 'scrollback'
      ? captureScrollback(sessionName, scrollbackLines)
      : captureScreen(sessionName);
  const count = countMatches(text, matcher);

  if (step.equals !== undefined && count !== Number(step.equals)) {
    throw new Error(`Expected count == ${step.equals} but got ${count}`);
  }
  if (step.atLeast !== undefined && count < Number(step.atLeast)) {
    throw new Error(`Expected count >= ${step.atLeast} but got ${count}`);
  }
  if (step.atMost !== undefined && count > Number(step.atMost)) {
    throw new Error(`Expected count <= ${step.atMost} but got ${count}`);
  }
}

async function sendApprovalChoice(choice, sendKeys) {
  if (choice === 'once') {
    await sendKeys(['Enter']);
  } else if (choice === 'always') {
    await sendKeys(['Down', 'Enter']);
  } else if (choice === 'no') {
    await sendKeys(['Down', 'Down', 'Enter']);
  } else {
    throw new Error(`Invalid approval choice: ${choice}`);
  }
}

async function executeApproveShellStep(
  step,
  i,
  sessionName,
  sendKeys,
  defaults,
) {
  const timeoutMs = Number(step.timeoutMs ?? defaults.timeoutMs);
  await waitFor({
    sessionName,
    scope: 'screen',
    matcher: { kind: 'contains', value: 'Shell Command Execution' },
    timeoutMs,
    pollMs: 200,
    scrollbackLines: defaults.scrollbackLines,
    description: `step ${i} (shell confirmation dialog)`,
  });

  await sendApprovalChoice(step.choice ?? 'once', sendKeys);
}

async function executeApproveToolStep(
  step,
  i,
  sessionName,
  sendKeys,
  defaults,
) {
  const timeoutMs = Number(step.timeoutMs ?? defaults.timeoutMs);
  const confirmMatcher = step.confirmation
    ? compileMatcher(step.confirmation)
    : { kind: 'contains', value: 'Yes, allow once' };

  await waitFor({
    sessionName,
    scope: 'screen',
    matcher: confirmMatcher,
    timeoutMs,
    pollMs: 200,
    scrollbackLines: defaults.scrollbackLines,
    description: `step ${i} (tool confirmation)`,
  });

  const choice = step.choice ?? 'once';
  if (choice === 'always') {
    const screen = captureScreen(sessionName);
    if (!screen.includes('Yes, allow always')) {
      throw new Error(
        `Requested choice "always" but no "Yes, allow always" option is visible`,
      );
    }
    await sendKeys(['Down', 'Enter']);
  } else {
    await sendApprovalChoice(choice, sendKeys);
  }
}

function executeHistorySampleStep(step, i, sessionName, scriptState) {
  scriptState.historySamples.push({
    tMs: Date.now(),
    historySize: getHistorySize(sessionName),
    label: typeof step.label === 'string' ? step.label : `sample_${i}`,
  });
}

function executeExpectHistoryDeltaStep(step, scriptState) {
  const fromLabel = step.fromLabel ?? step.from;
  const toLabel = step.toLabel ?? step.to;
  if (typeof fromLabel !== 'string' || fromLabel.trim().length === 0) {
    throw new Error(`Invalid expectHistoryDelta.fromLabel`);
  }
  if (typeof toLabel !== 'string' || toLabel.trim().length === 0) {
    throw new Error(`Invalid expectHistoryDelta.toLabel`);
  }

  const fromSample = scriptState.historySamples.find(
    (sample) => sample.label === fromLabel,
  );
  const toSample = [...scriptState.historySamples]
    .reverse()
    .find((sample) => sample.label === toLabel);

  if (!fromSample) {
    throw new Error(
      `Missing historySample "${fromLabel}" for expectHistoryDelta`,
    );
  }
  if (!toSample) {
    throw new Error(
      `Missing historySample "${toLabel}" for expectHistoryDelta`,
    );
  }

  const delta = toSample.historySize - fromSample.historySize;

  if (step.equals !== undefined && delta !== Number(step.equals)) {
    throw new Error(
      `Expected history delta == ${step.equals} but got ${delta}`,
    );
  }
  if (step.atLeast !== undefined && delta < Number(step.atLeast)) {
    throw new Error(
      `Expected history delta >= ${step.atLeast} but got ${delta}`,
    );
  }
  if (step.atMost !== undefined && delta > Number(step.atMost)) {
    throw new Error(
      `Expected history delta <= ${step.atMost} but got ${delta}`,
    );
  }
}

async function executeWaitForExitStep(step, sessionName) {
  const timeoutMs = Number(step.timeoutMs ?? 15000);
  const exited = await waitForPaneDead(sessionName, timeoutMs);
  if (!exited) {
    throw new Error(`Timed out waiting for exit`);
  }
}

async function executeStepDispatch(
  step,
  i,
  { sessionName, outDir, sendKeys, scriptState, defaults },
) {
  switch (step.type) {
    case 'wait':
      return executeWaitStep(step);
    case 'line':
      return executeLineStep(step, sessionName, sendKeys, defaults);
    case 'key':
      return executeKeyStep(step, sendKeys);
    case 'keys':
      return executeKeysStep(step, sendKeys);
    case 'selectToolOption':
      return executeSelectToolOptionStep(step, sessionName, sendKeys);
    case 'copyMode':
      return executeCopyModeStep(step, sessionName);
    case 'capture':
      return executeCaptureStep(step, i, sessionName, outDir, defaults);
    case 'waitFor':
      return executeWaitForStep(step, i, sessionName, defaults);
    case 'waitForNot':
      return executeWaitForNotStep(step, i, sessionName, defaults);
    case 'expect':
      return executeExpectStep(step, sessionName, defaults);
    case 'expectCount':
      return executeExpectCountStep(step, sessionName, defaults);
    case 'approveShell':
      return executeApproveShellStep(step, i, sessionName, sendKeys, defaults);
    case 'approveTool':
      return executeApproveToolStep(step, i, sessionName, sendKeys, defaults);
    case 'historySample':
      return executeHistorySampleStep(step, i, sessionName, scriptState);
    case 'expectHistoryDelta':
      return executeExpectHistoryDeltaStep(step, scriptState);
    case 'waitForExit':
      return executeWaitForExitStep(step, sessionName);
    default:
      throw new Error(`Unknown step.type: ${step.type}`);
  }
}

async function runScriptSteps({ sessionName, outDir, steps, defaults }) {
  const scriptState = {
    historySamples: [],
  };

  const sendKeys = async (keys) => {
    for (const key of keys) {
      runTmux(['send-keys', '-t', sessionName, key]);
      await sleep(120);
    }
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step !== 'object') {
      throw new Error(`Invalid step at index ${i}: ${JSON.stringify(step)}`);
    }

    try {
      await executeStepDispatch(step, i, {
        sessionName,
        outDir,
        sendKeys,
        scriptState,
        defaults,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stepLabel = sanitizeLabel(
        `${String(i).padStart(3, '0')}-error-${step.type ?? 'unknown'}`,
      );
      const scrollbackLines = Number(defaults.scrollbackLines);
      await captureArtifacts({
        sessionName,
        outDir,
        label: stepLabel,
        scrollbackLines,
      });
      await fs.writeFile(
        path.join(outDir, `${stepLabel}-step.json`),
        JSON.stringify({ index: i, step, error: message }, null, 2),
        'utf8',
      );
      throw error;
    }
  }

  if (scriptState.historySamples.length > 0) {
    await fs.writeFile(
      path.join(outDir, 'history-samples.json'),
      JSON.stringify(scriptState.historySamples, null, 2),
      'utf8',
    );
  }
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

  const sentinel = 'SCROLLTEST LINE';

  // Produce incremental output for ~15s so the UI updates repeatedly while the
  // output grows beyond a small terminal height.
  const cmd = '!node scripts/scrollback-load.js --total 60 --interval-ms 250';
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

  // Capture before exit: alternate-buffer UIs may not leave output in terminal
  // scrollback after quitting, so we snapshot the screen while the output is
  // still visible.
  const preExitScreen = captureScreen(sessionName);
  const preExitScrollback = captureScrollback(sessionName, 20000);
  await fs.writeFile(
    path.join(outDir, 'during-run-screen.txt'),
    preExitScreen,
    'utf8',
  );
  await fs.writeFile(
    path.join(outDir, 'during-run-scrollback.txt'),
    preExitScrollback,
    'utf8',
  );

  await typeLineAndSubmit('/quit', { enterRepeats: 1 });

  await fs.writeFile(
    path.join(outDir, 'history-samples.json'),
    JSON.stringify(historySamples, null, 2),
    'utf8',
  );

  return {
    kind: 'scrollback',
    sentinel,
    historySamples,
    captures: {
      screenFile: 'during-run-screen.txt',
      scrollbackFile: 'during-run-scrollback.txt',
    },
  };
}

async function loadScript(scriptPath) {
  if (!scriptPath) return null;
  const resolved = path.resolve(process.cwd(), scriptPath);
  try {
    return JSON.parse(await fs.readFile(resolved, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse script file ${resolved}: ${message}`);
  }
}

function resolveTmuxConfig(options, script) {
  return {
    cols: options.cols ?? script?.tmux?.cols ?? 120,
    rows: options.rows ?? script?.tmux?.rows ?? 40,
    initialWaitMs: options.initialWaitMs ?? script?.tmux?.initialWaitMs ?? 6000,
    historyLimit: options.historyLimit ?? script?.tmux?.historyLimit ?? 50000,
    scrollbackLines:
      options.scrollbackLines ?? script?.tmux?.scrollbackLines ?? 2000,
  };
}

function startTmuxSession(sessionName, startArgs, tmuxConfig) {
  // Ensure no stale session with the same name (unlikely, but safe).
  tryTmux(['kill-session', '-t', sessionName]);

  runTmux([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-x',
    String(tmuxConfig.cols),
    '-y',
    String(tmuxConfig.rows),
    ...startArgs,
  ]);
  runTmux(['set-option', '-t', `${sessionName}:0`, 'remain-on-exit', 'on']);
  runTmux([
    'set-option',
    '-t',
    `${sessionName}:0`,
    'history-limit',
    String(tmuxConfig.historyLimit),
  ]);
}

export function buildStartArgs(script, shouldYolo) {
  const command = script?.startCommand;
  if (
    command !== undefined &&
    (!Array.isArray(command) ||
      command.length === 0 ||
      command.some((item) => typeof item !== 'string'))
  ) {
    throw new Error(
      'Invalid script.startCommand: expected non-empty array of strings',
    );
  }

  const startArgs = command ? [...command] : ['node', 'scripts/start.js'];
  if (shouldYolo && !startArgs.includes('--yolo')) {
    startArgs.push('--yolo');
  }
  return startArgs;
}

async function runScenario({
  scenario,
  script,
  sessionName,
  typeLineAndSubmit,
  outDir,
  tmuxConfig,
}) {
  if (script?.steps) {
    await runScriptSteps({
      sessionName,
      outDir,
      steps: script.steps,
      defaults: {
        postTypeMs: 600,
        submitKeys: ['Enter'],
        shellSubmitKeys: ['Enter'],
        timeoutMs: 15000,
        pollMs: 250,
        scrollbackLines: tmuxConfig.scrollbackLines,
      },
    });
    return { kind: 'script' };
  }

  if (scenario === 'haiku') {
    return await runScenarioHaiku({ sessionName, typeLineAndSubmit });
  }

  if (scenario === 'scrollback') {
    return await runScenarioScrollback({
      sessionName,
      typeLineAndSubmit,
      outDir,
    });
  }

  throw new Error(`Unhandled scenario: ${scenario}`);
}

function makeTypeLineAndSubmit(sessionName) {
  return async (
    line,
    { postTypeMs = 600, enterRepeats = 1, escapeBeforeEnter = false } = {},
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
}

async function handleScenarioError({
  error,
  sessionName,
  outDir,
  options,
  script,
  scenario,
}) {
  const message = error instanceof Error ? error.message : String(error);
  const scrollbackLines =
    options.scrollbackLines ?? script?.tmux?.scrollbackLines ?? 2000;
  try {
    await captureArtifacts({
      sessionName,
      outDir,
      label: 'error-final',
      scrollbackLines,
    });
  } catch {
    // ignore
  }
  try {
    await fs.writeFile(
      path.join(outDir, 'error.json'),
      JSON.stringify({ message }, null, 2),
      'utf8',
    );
  } catch {
    // ignore
  }
  if (!options.keepSession) {
    tryTmux(['kill-session', '-t', sessionName]);
  }
  console.error(
    [
      `tmux session: ${sessionName}`,
      `artifacts: ${outDir}`,
      `scenario: ${script?.steps ? 'script' : scenario}`,
    ].join('\n'),
  );
}

async function captureFinalArtifacts({
  sessionName,
  outDir,
  scenario,
  tmuxConfig,
}) {
  const screen = captureScreen(sessionName);
  const scrollbackLines =
    scenario === 'scrollback' ? 20000 : tmuxConfig.scrollbackLines;
  const scrollback = captureScrollback(sessionName, scrollbackLines);
  await fs.writeFile(path.join(outDir, 'screen.txt'), screen, 'utf8');
  await fs.writeFile(path.join(outDir, 'scrollback.txt'), scrollback, 'utf8');
  return { screen, scrollback, scrollbackLines };
}

async function assertScrollbackResults({
  scenarioResult,
  baselineScrollback,
  options,
  outDir,
  tmuxConfig,
}) {
  const sentinelCount =
    baselineScrollback.match(new RegExp(scenarioResult.sentinel, 'g'))
      ?.length ?? 0;
  const tipsCount =
    baselineScrollback.match(/Tips for getting started:/g)?.length ?? 0;

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
          cols: tmuxConfig.cols,
          rows: tmuxConfig.rows,
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
        captures: scenarioResult.captures ?? null,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!options.assert) return null;

  if (sentinelCount < 1) {
    return new Error(
      `Scrollback output missing: expected sentinelCount >= 1 but got ${sentinelCount} (sentinel: "${scenarioResult.sentinel}")`,
    );
  }
  if (historyDelta !== 0) {
    return new Error(
      `Scrollback redraw detected: expected history delta == 0 but got ${historyDelta}`,
    );
  }
  if (tipsCount > 1) {
    return new Error(
      `Scrollback redraw detected: expected tipsCount <= 1 but got ${tipsCount}`,
    );
  }
  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessionName = `llxprt_tmux_${Date.now().toString(16)}`;
  const outDir = options.outDir
    ? path.resolve(process.cwd(), options.outDir)
    : path.join(os.tmpdir(), `llxprt-tmux-harness-${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const script = await loadScript(options.scriptPath);
  if (script?.steps) {
    script.steps = expandScriptMacros(script.steps, script.macros);
  }

  const tmuxConfig = resolveTmuxConfig(options, script);
  const shouldYolo = Boolean(options.yolo || script?.yolo);
  const startArgs = buildStartArgs(script, shouldYolo);
  startTmuxSession(sessionName, startArgs, tmuxConfig);

  // Let Ink render the initial UI.
  await sleep(tmuxConfig.initialWaitMs);

  const typeLineAndSubmit = makeTypeLineAndSubmit(sessionName);

  let scenarioResult;
  const scenario = options.scenario ?? 'haiku';
  try {
    scenarioResult = await runScenario({
      scenario,
      script,
      sessionName,
      typeLineAndSubmit,
      outDir,
      options,
      tmuxConfig,
    });
  } catch (error) {
    await handleScenarioError({
      error,
      sessionName,
      outDir,
      options,
      script,
      scenario,
    });
    throw error;
  }

  // Give the process time to exit cleanly (pane should become "dead").
  const exited = await waitForPaneDead(sessionName, 15000);

  const { scrollback } = await captureFinalArtifacts({
    sessionName,
    outDir,
    scenario,
    tmuxConfig,
  });

  let assertionError = null;
  if (scenarioResult?.kind === 'scrollback') {
    const baselineScrollback = scenarioResult.captures?.scrollbackFile
      ? await fs.readFile(
          path.join(outDir, scenarioResult.captures.scrollbackFile),
          'utf8',
        )
      : scrollback;

    assertionError = await assertScrollbackResults({
      scenarioResult,
      baselineScrollback,
      options,
      outDir,
      tmuxConfig,
    });
  }

  // Tear down so we don't leak sessions.
  if (!options.keepSession) {
    tryTmux(['kill-session', '-t', sessionName]);
  }

  const summary = [
    `tmux session: ${sessionName}`,
    `exited: ${exited ? 'yes' : 'no (killed session)'}`,
    `artifacts: ${outDir}`,
    `scenario: ${script?.steps ? 'script' : scenario}`,
  ].join('\n');
  console.log(summary);

  if (assertionError) {
    throw assertionError;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
