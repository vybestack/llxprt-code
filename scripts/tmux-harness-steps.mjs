/**
 * Step-executor engine extracted from scripts/tmux-harness.js.
 *
 * Each `execute*Step` function implements one `script.steps[].type`. They take
 * their runtime dependencies (sessionName, sendKeys, outDir, defaults) as
 * parameters and import the tmux I/O primitives from tmux-harness-io.mjs and
 * the pure matchers from tmux-harness-helpers.mjs.
 *
 * scripts/tmux-harness.js imports and re-exports executeStepDispatch to
 * preserve its public API.
 *
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  compileMatcher,
  matchText,
  formatMatcher,
  countMatches,
  sanitizeLabel,
  parseToolConfirmationOptions,
} from './tmux-harness-helpers.mjs';
import {
  runTmux,
  sleep,
  getHistorySize,
  captureScreen,
  captureScrollback,
  captureArtifacts,
  captureScreenWithFallback,
  resolveCapturedText,
  waitFor,
  waitForNot,
  waitForPaneDead,
  isShellModeActive,
  resolveScopeAndScrollback,
} from './tmux-harness-io.mjs';

export async function executeWaitStep(step) {
  const ms = Number(step.ms ?? 0);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Invalid wait.ms`);
  }
  await sleep(ms);
}

export async function executeLineStep(step, sessionName, sendKeys, defaults) {
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

export async function executeKeyStep(step, sendKeys) {
  if (typeof step.key !== 'string') {
    throw new Error(`Invalid key.key`);
  }
  await sendKeys([step.key]);
}

export async function executeKeysStep(step, sendKeys) {
  if (
    !Array.isArray(step.keys) ||
    step.keys.some((k) => typeof k !== 'string')
  ) {
    throw new Error(`Invalid keys.keys`);
  }
  await sendKeys(step.keys);
}

export async function executeSelectToolOptionStep(step, sessionName, sendKeys) {
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

export async function executeCopyModeStep(step, sessionName) {
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

export async function executeCaptureStep(
  step,
  i,
  sessionName,
  outDir,
  defaults,
) {
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

export async function executeWaitForStep(
  step,
  i,
  sessionName,
  outDir,
  defaults,
) {
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
    outDir,
  });
}

export async function executeWaitForNotStep(
  step,
  i,
  sessionName,
  outDir,
  defaults,
) {
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
    outDir,
  });
}

export async function executeExpectStep(step, sessionName, outDir, defaults) {
  const matcher = compileMatcher(step);
  const { scope, scrollbackLines } = resolveScopeAndScrollback(step, defaults);
  const text = resolveCapturedText({
    sessionName,
    scope,
    scrollbackLines,
    outDir,
  });

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

export async function executeExpectCountStep(
  step,
  sessionName,
  outDir,
  defaults,
) {
  const matcher = compileMatcher(step);
  const { scope, scrollbackLines } = resolveScopeAndScrollback(step, defaults);
  const text = resolveCapturedText({
    sessionName,
    scope,
    scrollbackLines,
    outDir,
    allowPaneOutputFallback: false,
  });
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

export async function sendApprovalChoice(choice, sendKeys) {
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

export async function executeApproveShellStep(
  step,
  i,
  sessionName,
  outDir,
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
    outDir,
  });

  await sendApprovalChoice(step.choice ?? 'once', sendKeys);
}

export async function executeApproveToolStep(
  step,
  i,
  sessionName,
  outDir,
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
    outDir,
  });

  const choice = step.choice ?? 'once';
  if (choice === 'always') {
    const screen = captureScreenWithFallback(sessionName, outDir);
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

export function executeHistorySampleStep(step, i, sessionName, scriptState) {
  scriptState.historySamples.push({
    tMs: Date.now(),
    historySize: getHistorySize(sessionName),
    label: typeof step.label === 'string' ? step.label : `sample_${i}`,
  });
}

export function executeExpectHistoryDeltaStep(step, scriptState) {
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

export async function executeWaitForExitStep(step, sessionName) {
  const timeoutMs = Number(step.timeoutMs ?? 15000);
  const exited = await waitForPaneDead(sessionName, timeoutMs);
  if (!exited) {
    throw new Error(`Timed out waiting for exit`);
  }
}

export async function executeStepDispatch(
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
      return executeWaitForStep(step, i, sessionName, outDir, defaults);
    case 'waitForNot':
      return executeWaitForNotStep(step, i, sessionName, outDir, defaults);
    case 'expect':
      return executeExpectStep(step, sessionName, outDir, defaults);
    case 'expectCount':
      return executeExpectCountStep(step, sessionName, outDir, defaults);
    case 'approveShell':
      return executeApproveShellStep(
        step,
        i,
        sessionName,
        outDir,
        sendKeys,
        defaults,
      );
    case 'approveTool':
      return executeApproveToolStep(
        step,
        i,
        sessionName,
        outDir,
        sendKeys,
        defaults,
      );
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
