/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';

// Mock the providers runtime barrel to avoid the broken dist dependency
// chain, but delegate parseEphemeralSettingValue to the REAL source
// implementation so tests exercise actual parsing/validation behavior.
const real = await import(
  '@vybestack/llxprt-code-providers/runtime/ephemeralSettings.js'
);

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  parseEphemeralSettingValue: real.parseEphemeralSettingValue,
  ephemeralSettingHelp: real.ephemeralSettingHelp,
}));

// Use the real parseValue from setCommand (source-resolved, no broken deps)
import { ModelConfigDialog } from './ModelConfigDialog.js';

function isModelFieldLine(line: string): boolean {
  return line.includes('○') || line.includes('●');
}

/**
 * Stateful fake runtime. Instead of vi.fn() spies returning fixed values,
 * this mutable object reflects writes immediately so re-renders observe
 * the updated state — exercising real save/clear behavior end-to-end.
 */
interface StatefulRuntimeState {
  providerName: string;
  modelName: string;
  modelParams: Record<string, unknown>;
  ephemeralSettings: Record<string, unknown>;
  unallowedParameters?: string[];
  // Listed keys make the corresponding write method throw, so tests can
  // exercise the dialog's rollback path against a stateful fake.
  failSetParamKeys?: string[];
  failClearParamKeys?: string[];
  failSetEphemeralKeys?: string[];
}

function createStatefulRuntime(
  overrides: Partial<StatefulRuntimeState> = {},
): StatefulRuntimeState & {
  getActiveProviderName: () => string;
  getActiveModelName: () => string;
  getActiveModelParams: () => Record<string, unknown>;
  getEphemeralSettings: () => Record<string, unknown>;
  setActiveModelParam: (key: string, value: unknown) => void;
  clearActiveModelParam: (key: string) => void;
  setEphemeralSetting: (key: string, value: unknown) => void;
  getUnallowedParametersForActiveModel: () => string[];
  writeCounts: () => Record<string, number>;
} {
  const state: StatefulRuntimeState = {
    providerName: 'openai',
    modelName: 'gpt-5',
    modelParams: { temperature: 0.7 },
    ephemeralSettings: { 'reasoning.enabled': true },
    ...overrides,
  };
  // Completed-write counters keyed as `<op>:<key>` (setParam, clearParam,
  // setEphemeral). A write that throws is not counted: the counters record
  // mutations that actually landed.
  const writes: Record<string, number> = {};
  return {
    ...state,
    getActiveProviderName: () => state.providerName,
    getActiveModelName: () => state.modelName,
    getActiveModelParams: () => ({ ...state.modelParams }),
    getEphemeralSettings: () => ({ ...state.ephemeralSettings }),
    setActiveModelParam: (key: string, value: unknown) => {
      if (state.failSetParamKeys?.includes(key) === true) {
        throw new Error(`write failed: ${key}`);
      }
      writes[`setParam:${key}`] = (writes[`setParam:${key}`] ?? 0) + 1;
      state.modelParams[key] = value;
    },
    clearActiveModelParam: (key: string) => {
      if (state.failClearParamKeys?.includes(key) === true) {
        throw new Error(`write failed: ${key}`);
      }
      writes[`clearParam:${key}`] = (writes[`clearParam:${key}`] ?? 0) + 1;
      delete state.modelParams[key];
    },
    setEphemeralSetting: (key: string, value: unknown) => {
      if (state.failSetEphemeralKeys?.includes(key) === true) {
        throw new Error(`write failed: ${key}`);
      }
      writes[`setEphemeral:${key}`] = (writes[`setEphemeral:${key}`] ?? 0) + 1;
      state.ephemeralSettings[key] = value;
    },
    getUnallowedParametersForActiveModel: () => state.unallowedParameters ?? [],
    writeCounts: () => ({ ...writes }),
  };
}

let activeRuntime: ReturnType<typeof createStatefulRuntime>;

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => activeRuntime,
}));

const DOWN = '\x1b[B';
const ENTER = '\r';
const ESC = '\x1b[27u';
const RIGHT = '\x1b[C';

// Edits are STAGED in the dialog; nothing commits until [s]ave (list-mode
// 's' key). Esc discards all staged edits and closes.
async function saveDialog(stdin: { write: (data: string) => void }) {
  await act(async () => {
    stdin.write('s');
  });
}

const DEFAULT_UNALLOWED: readonly string[] = [];
const PARAM_KEYS = [
  'max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'frequency_penalty',
  'presence_penalty',
] as const;
const EPHEMERAL_KEYS = [
  'reasoning.enabled',
  'reasoning.effort',
  'streaming',
  'prompt-caching',
] as const;

function fieldIndex(
  key: string,
  unallowed: readonly string[] = DEFAULT_UNALLOWED,
): number {
  // context-limit leads, then max_tokens, then remaining params + ephemerals.
  const keys = [
    ...(['context-limit', 'max_tokens'] as const).filter(
      (k) => !unallowed.includes(k),
    ),
    ...PARAM_KEYS.filter((k) => k !== 'max_tokens' && !unallowed.includes(k)),
    ...EPHEMERAL_KEYS.filter((k) => !unallowed.includes(k)),
  ];
  const index = keys.indexOf(key as (typeof keys)[number]);
  if (index < 0) {
    throw new Error(`Unknown field key: ${key}`);
  }
  return index;
}

function navigateToField(
  stdin: { write: (data: string) => void },
  key: string,
  unallowed?: readonly string[],
): void {
  for (let i = 0; i < fieldIndex(key, unallowed); i++) {
    act(() => {
      stdin.write(DOWN);
    });
  }
}

// The issue-#2831 tests stage several fields in one dialog session. The list
// only navigates DOWN, so each staging helper takes the current index and
// returns the field's index for the next call.

function moveDownTo(
  stdin: { write: (data: string) => void },
  from: number,
  target: number,
): number {
  for (let i = from; i < target; i++) {
    act(() => {
      stdin.write(DOWN);
    });
  }
  return target;
}

// Navigate to `key`, enter its text editor, clear any pre-filled value
// (ctrl-a home + ctrl-k kill-to-end), type `value`, Enter to stage.
async function stageTextAt(
  stdin: { write: (data: string) => void },
  key: string,
  value: string,
  from: number,
): Promise<number> {
  const at = moveDownTo(stdin, from, fieldIndex(key));
  act(() => {
    stdin.write(ENTER);
  });
  act(() => {
    stdin.write('\x01');
  });
  act(() => {
    stdin.write('\x0b');
  });
  for (const ch of value) {
    act(() => {
      stdin.write(ch);
    });
  }
  await act(async () => {
    stdin.write(ENTER);
  });
  return at;
}

// Navigate to the enum field `key`, enter its editor, press RIGHT
// `rightSteps` times from the enum's start, Enter to stage.
async function stageEnumAt(
  stdin: { write: (data: string) => void },
  key: string,
  from: number,
  rightSteps: number,
): Promise<number> {
  const at = moveDownTo(stdin, from, fieldIndex(key));
  act(() => {
    stdin.write(ENTER);
  });
  for (let i = 0; i < rightSteps; i++) {
    act(() => {
      stdin.write(RIGHT);
    });
  }
  await act(async () => {
    stdin.write(ENTER);
  });
  return at;
}

function defaultProps() {
  return { onClose: vi.fn() };
}

function setupRuntime(overrides: Partial<StatefulRuntimeState> = {}) {
  activeRuntime = createStatefulRuntime(overrides);
}

describe('<ModelConfigDialog />', () => {
  beforeEach(() => {
    setupRuntime();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the header with active provider and model name (AC2)', () => {
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    const output = lastFrame();
    expect(output).toContain('Model Configuration');
    expect(output).toContain('openai');
    expect(output).toContain('gpt-5');
  });

  it('renders context-limit first and max_tokens second (field reorder)', () => {
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    const output = lastFrame();
    expect(output).toBeDefined();
    const lines = output!.split('\n');
    const fieldLines = lines.filter(isModelFieldLine);
    expect(fieldLines[0]).toContain('context-limit');
    expect(fieldLines[1]).toContain('max_tokens');
  });

  it('renders the model parameters section with current values (AC3)', () => {
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    const output = lastFrame();
    expect(output).toContain('max_tokens');
    expect(output).toContain('temperature');
    expect(output).toContain('0.7');
    expect(output).toContain('top_p');
    expect(output).toContain('top_k');
    expect(output).toContain('frequency_penalty');
    expect(output).toContain('presence_penalty');
  });

  it('shows (not set) for params without a value (AC3)', () => {
    setupRuntime({ modelParams: {} });
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    expect(lastFrame()).toContain('(not set)');
  });

  it('renders the model behavior section with ephemeral settings (AC7)', () => {
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    const output = lastFrame();
    expect(output).toContain('context-limit');
    expect(output).toContain('reasoning.enabled');
    expect(output).toContain('reasoning.effort');
    expect(output).toContain('streaming');
    expect(output).toContain('prompt-caching');
  });

  it('navigates down and selects the expected field (AC4)', () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    navigateToField(stdin, 'temperature');

    // Enter edit mode to reveal which field is selected via the prompt text
    act(() => {
      stdin.write(ENTER);
    });

    expect(lastFrame()).toContain('temperature');
  });

  it('edits a model param inline and stages the new value on Enter (AC5)', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    expect(lastFrame()).toContain('temperature');

    navigateToField(stdin, 'temperature');

    // Enter edit mode — the editor pre-fills the current value (0.7) with the
    // cursor at the end.
    act(() => {
      stdin.write(ENTER);
    });

    // ctrl+a moves the cursor home, ctrl+k deletes to end of line — together
    // they clear the pre-filled value, matching real terminal usage.
    act(() => {
      stdin.write('\x01');
    });
    act(() => {
      stdin.write('\x0b');
    });

    // Type a new value
    for (const ch of '0.9') {
      act(() => {
        stdin.write(ch);
      });
    }

    // Enter stages the edit — the list row immediately reflects the staged
    // value even though the runtime is only written on [s]ave.
    await act(async () => {
      stdin.write(ENTER);
    });

    // The rendered output must reflect the new staged value (not the old 0.7)
    await waitFor(() => {
      expect(lastFrame()).toContain('0.9');
      expect(lastFrame()).not.toContain('0.70.9');
    });
  });

  it('clears a model param from list mode and shows (not set) after clear (AC6)', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // temperature starts at 0.7
    expect(lastFrame()).toContain('0.7');

    navigateToField(stdin, 'temperature');

    // Press 'c' in list mode to clear the selected param field
    await act(async () => {
      stdin.write('c');
    });

    // The clear is STAGED — runtime keeps the old value until [s]ave.
    await waitFor(() => {
      expect(lastFrame()).toContain('(not set)');
    });
    expect(activeRuntime.getActiveModelParams().temperature).toBe(0.7);

    await saveDialog(stdin);

    // After save the runtime state reflects the clear.
    await waitFor(() => {
      expect(activeRuntime.getActiveModelParams()).not.toHaveProperty(
        'temperature',
      );
    });
  });

  it('toggles reasoning.enabled with Space (boolean select)', async () => {
    setupRuntime({ ephemeralSettings: { 'reasoning.enabled': false } });
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // reasoning.enabled starts at false
    expect(lastFrame()).toContain('false');

    navigateToField(stdin, 'reasoning.enabled');

    // Press Space to toggle boolean in list mode
    await act(async () => {
      stdin.write(' ');
    });

    // Toggle is STAGED — the row shows the pending value, runtime unchanged.
    await waitFor(() => {
      expect(lastFrame()).toMatch(/reasoning\.enabled\s+true/);
    });
    expect(activeRuntime.getEphemeralSettings()['reasoning.enabled']).toBe(
      false,
    );

    // The pending ON value renders as immutable-ON (forced-on behavior is
    // not silently flippable): Space is a no-op.
    await act(async () => {
      stdin.write(' ');
    });
    await waitFor(() => {
      expect(lastFrame()).toContain('always-on for this model');
    });

    await saveDialog(stdin);

    await waitFor(() => {
      expect(activeRuntime.getEphemeralSettings()['reasoning.enabled']).toBe(
        true,
      );
    });
  });

  it('reasoning.enabled=true is immutable — Enter does not toggle and shows the always-on hint', async () => {
    // Default runtime has reasoning.enabled: true (forced on by model
    // defaults). Enter/Space must NOT silently flip it or enter edit mode;
    // the always-on reason is visible directly in the list row.
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    navigateToField(stdin, 'reasoning.enabled');

    await act(async () => {
      stdin.write(ENTER);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('always-on for this model');
    });
    expect(activeRuntime.getEphemeralSettings()['reasoning.enabled']).toBe(
      true,
    );

    // Space is also a no-op for an immutable boolean
    await act(async () => {
      stdin.write(' ');
    });
    expect(activeRuntime.getEphemeralSettings()['reasoning.enabled']).toBe(
      true,
    );
    // No edit mode was entered: the editor footer hint is absent
    expect(lastFrame()).not.toContain('[Enter] stage');
  });

  it('cycles reasoning.effort enum with Left/Right and Enter persists the selection', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    navigateToField(stdin, 'reasoning.effort');

    // Enter enum edit mode (no inherited default → starts at first value)
    act(() => {
      stdin.write(ENTER);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('[minimal]');
    });

    // Press Right to cycle to low
    act(() => {
      stdin.write(RIGHT);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('[low]');
    });

    // Press Enter — stages the cycled value; the row shows it but the
    // runtime is unchanged until [s]ave.
    await act(async () => {
      stdin.write(ENTER);
    });

    await waitFor(() => {
      expect(lastFrame()).toMatch(/reasoning\.effort\s+low/);
    });
    expect(
      activeRuntime.getEphemeralSettings()['reasoning.effort'],
    ).toBeUndefined();

    await saveDialog(stdin);

    await waitFor(() => {
      expect(activeRuntime.getEphemeralSettings()['reasoning.effort']).toBe(
        'low',
      );
    });
  });

  it('cycles streaming enum with Left/Right in edit mode', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    navigateToField(stdin, 'streaming');

    // Enter edit mode on streaming
    act(() => {
      stdin.write(ENTER);
    });

    // Should show enum values
    expect(lastFrame()).toContain('[enabled]');

    // Press Right to cycle to disabled
    act(() => {
      stdin.write(RIGHT);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('[disabled]');
    });

    // Press Enter to stage, then [s]ave to commit
    await act(async () => {
      stdin.write(ENTER);
    });
    await saveDialog(stdin);

    // Value should be saved as disabled
    await waitFor(() => {
      expect(activeRuntime.getEphemeralSettings()['streaming']).toBe(
        'disabled',
      );
    });
  });

  it('shows validation error when committing an invalid context-limit value', async () => {
    setupRuntime({ ephemeralSettings: { 'context-limit': 4096 } });
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // Enter edit mode — the editor pre-fills the current value (4096) with
    // the cursor at the end.
    act(() => {
      stdin.write(ENTER);
    });

    // Clear the pre-filled value (ctrl+a home, ctrl+k kill-to-end) before
    // typing the invalid replacement.
    act(() => {
      stdin.write('\x01');
    });
    act(() => {
      stdin.write('\x0b');
    });

    // Type an invalid value (context-limit requires a positive integer)
    for (const ch of 'not-a-number') {
      act(() => {
        stdin.write(ch);
      });
    }

    // Enter stages the text edit — validation happens at [s]ave time.
    await act(async () => {
      stdin.write(ENTER);
    });

    // Save — the staged invalid value fails validation; the dialog stays
    // open with an error and the committed value is untouched.
    await saveDialog(stdin);

    await waitFor(() => {
      expect(lastFrame()).toContain('positive integer');
    });
    expect(activeRuntime.getEphemeralSettings()['context-limit']).toBe(4096);
  });

  it('Esc discards all staged edits and closes without committing', async () => {
    const props = defaultProps();
    const { stdin } = renderWithProviders(<ModelConfigDialog {...props} />);

    // Stage a text edit: temperature 0.7 -> 9.9 (pre-fill cleared first)
    navigateToField(stdin, 'temperature');
    act(() => {
      stdin.write(ENTER);
    });
    act(() => {
      stdin.write('\x01');
      stdin.write('\x0b');
    });
    for (const ch of '9.9') {
      act(() => {
        stdin.write(ch);
      });
    }
    await act(async () => {
      stdin.write(ENTER);
    });

    // Stage a boolean toggle: reasoning.enabled is true (immutable ON), so
    // use a mutable default — toggle a fresh boolean from false.
    // (reasoning.enabled seeded true in default runtime, so instead verify
    // the staged text edit is discarded.)
    await act(async () => {
      stdin.write(ESC);
    });

    await waitFor(() => {
      expect(props.onClose).toHaveBeenCalled();
    });
    // Runtime untouched: the staged 9.9 was discarded, not committed.
    expect(activeRuntime.getActiveModelParams().temperature).toBe(0.7);
  });

  it('closes on Escape from the list view (AC9)', async () => {
    const props = defaultProps();
    const { stdin } = renderWithProviders(<ModelConfigDialog {...props} />);

    act(() => {
      stdin.write(ESC);
    });

    await waitFor(() => {
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it('cancel edit mode with Escape returns to the list without closing (AC9)', async () => {
    const props = defaultProps();
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...props} />,
    );

    // Enter edit mode on context-limit (index 0)
    act(() => {
      stdin.write(ENTER);
    });

    // Cancel with Escape
    act(() => {
      stdin.write(ESC);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('Model Parameters');
    });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('Escape in edit mode cancels without saving the edited value', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    navigateToField(stdin, 'temperature');

    // Enter edit mode (pre-filled with current 0.7)
    act(() => {
      stdin.write(ENTER);
    });

    // Replace the value entirely (Ctrl+A + Ctrl+K clears the pre-fill)
    act(() => {
      stdin.write('\x01');
      stdin.write('\x0b');
    });
    for (const ch of '9.9') {
      act(() => {
        stdin.write(ch);
      });
    }

    // Esc must cancel — the runtime value stays 0.7
    await act(async () => {
      stdin.write(ESC);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('navigate');
    });
    expect(activeRuntime.getActiveModelParams().temperature).toBe(0.7);
    expect(lastFrame()).not.toContain('9.9');
  });

  it('shows [Enter] stage / [Esc] back hint while editing and [s]ave/[Esc]cancel in list mode', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    expect(lastFrame()).toContain('navigate');

    act(() => {
      stdin.write(ENTER);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('[Enter] stage');
      expect(lastFrame()).toContain('[Esc] back');
    });

    // Back to list mode — footer shows the explicit save/cancel affordance.
    await act(async () => {
      stdin.write(ESC);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('[s]ave');
      expect(lastFrame()).toContain('[Esc]cancel');
    });
  });

  it('hides unallowed sampling params (e.g. kimi-k3 fixed params)', async () => {
    setupRuntime({
      providerName: 'kimi',
      modelName: 'kimi-k3',
      modelParams: { temperature: 1.0 },
      unallowedParameters: [
        'temperature',
        'top_p',
        'top_k',
        'frequency_penalty',
        'presence_penalty',
      ],
    });

    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('Model Parameters');
    });
    const output = lastFrame();
    expect(output).toContain('max_tokens');
    expect(output).not.toContain('temperature');
    expect(output).not.toContain('top_p');
    expect(output).not.toContain('top_k');
    expect(output).not.toContain('frequency_penalty');
    expect(output).not.toContain('presence_penalty');
  });

  it('shows inherited modelDefaults (global ephemerals) for unset provider params', async () => {
    setupRuntime({
      providerName: 'kimi',
      modelName: 'kimi-k3',
      modelParams: {},
      ephemeralSettings: { max_tokens: 131072 },
      unallowedParameters: ['temperature'],
    });

    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('max_tokens');
    });
    const output = lastFrame();
    // The inherited default renders on the max_tokens row.
    expect(output).toMatch(/max_tokens\s+131072/);
  });

  it('prefers the provider-scoped param over the inherited global value', async () => {
    setupRuntime({
      modelParams: { max_tokens: 4096 },
      ephemeralSettings: { max_tokens: 131072 },
    });

    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    await waitFor(() => {
      expect(lastFrame()).toContain('4096');
    });
    expect(lastFrame()).not.toContain('131072');
  });

  // Issue #2831: [s]ave plans (validates) every staged edit first, then
  // applies writes in field order, rolling back to snapshotted priors if
  // one throws. Streaming/prompt-caching below are enum editors.

  // Shared preamble for the tests below: tracked onClose plus the view.
  function renderTracked() {
    const props = defaultProps();
    const view = renderWithProviders(<ModelConfigDialog {...props} />);
    return { ...view, props };
  }

  // Live-state assertions against the stateful fake (issue #2831 suite);
  // activeRuntime is re-read on every call, after setupRuntime overrides.
  const expectParams = (obj: Record<string, unknown>) =>
    expect(activeRuntime.getActiveModelParams()).toStrictEqual(obj);
  const expectEphemeral = (obj: Record<string, unknown>) =>
    expect(activeRuntime.getEphemeralSettings()).toStrictEqual(obj);

  it('T1: later-field validation failure leaves the runtime untouched (issue #2831)', async () => {
    const { lastFrame, stdin, props } = renderTracked();

    const at = await stageTextAt(stdin, 'temperature', '9.9', 0);
    await stageTextAt(stdin, 'top_k', 'abc', at);

    await saveDialog(stdin);

    // The first invalid field in field order is reported...
    await waitFor(() => {
      expect(lastFrame()).toContain('top_k: must be a number');
    });
    // ...and the earlier VALID edit was not half-committed.
    expectParams({ temperature: 0.7 });
    expectEphemeral({ 'reasoning.enabled': true });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('9.9');
    expect(lastFrame()).toContain('abc');
  });

  it('T2: recovery after a failed save commits every staged edit exactly once (issue #2831)', async () => {
    const { stdin, props } = renderTracked();

    let at = await stageTextAt(stdin, 'temperature', '9.9', 0);
    at = await stageTextAt(stdin, 'top_k', 'abc', at);
    await saveDialog(stdin);
    expect(props.onClose).not.toHaveBeenCalled();

    // Correct the invalid field and re-save: both staged edits land.
    await stageTextAt(stdin, 'top_k', '40', at);
    await saveDialog(stdin);

    expectParams({ temperature: 9.9, top_k: 40 });
    // Each staged key was written exactly once across both saves.
    expect(activeRuntime.writeCounts()['setParam:temperature']).toBe(1);
    expect(activeRuntime.writeCounts()['setParam:top_k']).toBe(1);
    await waitFor(() => {
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it('T3: mid-loop write throw rolls back already-applied writes (issue #2831)', async () => {
    setupRuntime({ failSetParamKeys: ['top_p'] });
    const { lastFrame, stdin, props } = renderTracked();

    const at = await stageTextAt(stdin, 'temperature', '9.9', 0);
    await stageTextAt(stdin, 'top_p', '0.5', at);

    await saveDialog(stdin);

    // temperature is restored when the top_p write throws.
    await waitFor(() => {
      expect(lastFrame()).toContain('top_p: write failed: top_p');
    });
    expectParams({ temperature: 0.7 });
    expect(activeRuntime.getActiveModelParams()).not.toHaveProperty('top_p');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('9.9');
    expect(lastFrame()).toContain('0.5');
  });

  it('T4: staged clear is rolled back when a later write throws (issue #2831)', async () => {
    setupRuntime({ failSetParamKeys: ['top_p'] });
    const { lastFrame, stdin, props } = renderTracked();

    // Stage a temperature clear, then a top_p edit whose write throws.
    const clearAt = moveDownTo(stdin, 0, fieldIndex('temperature'));
    await act(async () => {
      stdin.write('c');
    });
    await stageTextAt(stdin, 'top_p', '0.5', clearAt);

    await saveDialog(stdin);

    await waitFor(() => {
      expect(lastFrame()).toContain('top_p: write failed: top_p');
    });
    expectParams({ temperature: 0.7 });
    expect(activeRuntime.getActiveModelParams()).not.toHaveProperty('top_p');
    expect(props.onClose).not.toHaveBeenCalled();
    // Restored value visible in the row ('(not set)' would be vacuous).
    expect(activeRuntime.getActiveModelParams().temperature).toBe(0.7);
    expect(lastFrame()).toMatch(/temperature\s+0\.7/);
  });

  it('T5: multi-kind save lands param, clear, boolean, and enum edits together (issue #2831)', async () => {
    setupRuntime({
      modelParams: { temperature: 0.7 },
      ephemeralSettings: { 'reasoning.enabled': false },
    });
    const { lastFrame, stdin, props } = renderTracked();

    let at = await stageTextAt(stdin, 'max_tokens', '32000', 0);

    at = moveDownTo(stdin, at, fieldIndex('temperature'));
    await act(async () => {
      stdin.write('c');
    });

    at = moveDownTo(stdin, at, fieldIndex('reasoning.enabled'));
    await act(async () => {
      stdin.write(' ');
    });

    // streaming starts at 'enabled' (one RIGHT: disabled); prompt-caching
    // starts at 'off' (one RIGHT: 5m).
    at = await stageEnumAt(stdin, 'streaming', at, 1);
    await stageEnumAt(stdin, 'prompt-caching', at, 1);
    await waitFor(() => {
      expect(lastFrame()).toMatch(/streaming\s+disabled/);
      expect(lastFrame()).toMatch(/prompt-caching\s+5m/);
    });

    await saveDialog(stdin);

    expectParams({ max_tokens: 32000 });
    expectEphemeral({
      'reasoning.enabled': true,
      streaming: 'disabled',
      'prompt-caching': '5m',
    });
    await waitFor(() => {
      expect(props.onClose).toHaveBeenCalled();
    });
  });

  it('T6: ephemeral write throwing mid-loop rolls back earlier param clear and ephemeral edit (issue #2831)', async () => {
    // failSetEphemeralKeys must be set at runtime creation (snapshotted).
    setupRuntime({ failSetEphemeralKeys: ['streaming'] });
    const { lastFrame, stdin, props } = renderTracked();

    // Stage a temperature clear (writes first), then a streaming enum edit
    // whose write throws mid-loop. The clear is verified via runtime state.
    const clearAt = moveDownTo(stdin, 0, fieldIndex('temperature'));
    await act(async () => {
      stdin.write('c');
    });

    // streaming starts at 'enabled'; one RIGHT lands on 'disabled'.
    await stageEnumAt(stdin, 'streaming', clearAt, 1);

    await saveDialog(stdin);

    // The throwing field is reported...
    await waitFor(() => {
      expect(lastFrame()).toContain('streaming: write failed: streaming');
    });
    // ...the clear rolled back and the failed write never landed.
    expectParams({ temperature: 0.7 });
    expectEphemeral({ 'reasoning.enabled': true });
    // streaming threw before mutating: absent, not present-with-undefined.
    expect('streaming' in activeRuntime.getEphemeralSettings()).toBe(false);
    expect(props.onClose).not.toHaveBeenCalled();
    // Staged edits survive: streaming 'disabled', temperature restored 0.7.
    expect(lastFrame()).toMatch(/temperature\s+0\.7/);
    expect(lastFrame()).toMatch(/streaming\s+disabled/);
  });

  it('T7: later ephemeral parse failure aborts before any write (issue #2831)', async () => {
    const { lastFrame, stdin, props } = renderTracked();

    // context-limit precedes temperature, so its 'abc' is first invalid.
    const at = await stageTextAt(stdin, 'context-limit', 'abc', 0);
    await stageTextAt(stdin, 'temperature', '0.9', at);

    await saveDialog(stdin);

    // The first invalid field in field order is reported...
    await waitFor(() => {
      expect(lastFrame()).toContain('context-limit:');
      expect(lastFrame()).toContain('must be a positive integer');
    });
    // ...and phase 1 aborted before ANY write (ledger empty).
    expectParams({ temperature: 0.7 });
    expectEphemeral({ 'reasoning.enabled': true });
    expect(activeRuntime.writeCounts()).toStrictEqual({});
    expect(props.onClose).not.toHaveBeenCalled();
    expect(lastFrame()).toMatch(/context-limit\s+abc/);
    expect(lastFrame()).toContain('0.9');
  });

  it('T8: first planned write throwing rolls back nothing and names the failing field (issue #2831)', async () => {
    setupRuntime({ failClearParamKeys: ['temperature'] });
    const { lastFrame, stdin, props } = renderTracked();

    // Stage ONLY the clear of temperature.
    moveDownTo(stdin, 0, fieldIndex('temperature'));
    await act(async () => {
      stdin.write('c');
    });

    await saveDialog(stdin);

    await waitFor(() => {
      expect(lastFrame()).toMatch(/temperature: write failed: temperature/);
    });
    // Nothing applied; the rollback loop body never ran (ledger empty).
    expectParams({ temperature: 0.7 });
    expect(activeRuntime.writeCounts()).toStrictEqual({});
    expect(props.onClose).not.toHaveBeenCalled();
    expect(lastFrame()).toMatch(/temperature\s+0\.7/);
  });

  it('T9: rolling back an ephemeral edit on a previously-absent key restores undefined (issue #2831)', async () => {
    setupRuntime({ failSetEphemeralKeys: ['prompt-caching'] });
    const { lastFrame, stdin, props } = renderTracked();

    // streaming starts at 'enabled'; one RIGHT lands on 'disabled'.
    const at = await stageEnumAt(stdin, 'streaming', 0, 1);
    // prompt-caching starts at 'off'; one RIGHT lands on '5m'.
    await stageEnumAt(stdin, 'prompt-caching', at, 1);

    await saveDialog(stdin);

    await waitFor(() => {
      expect(lastFrame()).toMatch(
        /prompt-caching: write failed: prompt-caching/,
      );
    });
    expect(activeRuntime.getEphemeralSettings()['reasoning.enabled']).toBe(
      true,
    );
    // The rollback restores the prior value as present-but-undefined,
    // mirroring the real SettingsService's set(key, undefined) semantics
    // (the dialog's pre-existing clear idiom).
    expect(activeRuntime.getEphemeralSettings().streaming).toBeUndefined();
    expect('streaming' in activeRuntime.getEphemeralSettings()).toBe(true);
    const counts = activeRuntime.writeCounts();
    expect(counts).toStrictEqual({ 'setEphemeral:streaming': 2 });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('T10: restore failure is recorded, rollback continues, and the original error is surfaced (issue #2831)', async () => {
    setupRuntime({
      modelParams: {},
      failSetParamKeys: ['top_p'],
      failClearParamKeys: ['temperature'],
    });
    const { lastFrame, stdin, props } = renderTracked();

    // temperature is initially ABSENT: its forward write is a set-param
    // whose snapshotted prior is a clear-param.
    const at = await stageTextAt(stdin, 'temperature', '9.9', 0);
    await stageTextAt(stdin, 'top_p', '0.5', at);

    await saveDialog(stdin);

    await waitFor(() => {
      expect(lastFrame()).toContain('top_p: write failed: top_p');
      expect(lastFrame()).toContain('rollback incomplete: temperature');
    });
    // The clear-param restore ALSO threw (failClearParamKeys): temperature
    // stays at its written value — degraded but reported.
    expectParams({ temperature: 9.9 });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
