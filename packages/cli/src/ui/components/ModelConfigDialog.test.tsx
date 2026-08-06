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

vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => {
  return {
    parseEphemeralSettingValue: real.parseEphemeralSettingValue,
    ephemeralSettingHelp: real.ephemeralSettingHelp,
  };
});

// Use the real parseValue from setCommand (source-resolved, no broken deps)
import { ModelConfigDialog } from './ModelConfigDialog.js';

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
} {
  const state: StatefulRuntimeState = {
    providerName: 'openai',
    modelName: 'gpt-5',
    modelParams: { temperature: 0.7 },
    ephemeralSettings: { 'reasoning.enabled': true },
    ...overrides,
  };
  return {
    ...state,
    getActiveProviderName: () => state.providerName,
    getActiveModelName: () => state.modelName,
    getActiveModelParams: () => ({ ...state.modelParams }),
    getEphemeralSettings: () => ({ ...state.ephemeralSettings }),
    setActiveModelParam: (key: string, value: unknown) => {
      state.modelParams[key] = value;
    },
    clearActiveModelParam: (key: string) => {
      delete state.modelParams[key];
    },
    setEphemeralSetting: (key: string, value: unknown) => {
      state.ephemeralSettings[key] = value;
    },
    getUnallowedParametersForActiveModel: () => state.unallowedParameters ?? [],
  };
}

let activeRuntime: ReturnType<typeof createStatefulRuntime>;

vi.mock('../contexts/RuntimeContext.js', () => ({
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
    const fieldLines = lines.filter((l) => l.includes('○') || l.includes('●'));
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
});
