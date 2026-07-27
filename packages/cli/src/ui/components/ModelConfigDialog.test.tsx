/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';

// Mock the providers runtime barrel to avoid the broken dist dependency
// chain, but delegate parseEphemeralSettingValue to the REAL source
// implementation so tests exercise actual parsing/validation behavior.
vi.mock('@vybestack/llxprt-code-providers/runtime.js', async () => {
  const real = await import(
    '@vybestack/llxprt-code-providers/runtime/ephemeralSettings.js'
  );
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

const DOWN = '[B';
const ENTER = '\r';
const ESC = '[27u';
const RIGHT = '[C';

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
  'context-limit',
  'reasoning.enabled',
  'reasoning.effort',
  'streaming',
  'prompt-caching',
] as const;

function fieldIndex(
  key: string,
  unallowed: readonly string[] = DEFAULT_UNALLOWED,
): number {
  const keys = [
    ...PARAM_KEYS.filter((k) => !unallowed.includes(k)),
    ...EPHEMERAL_KEYS,
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

  it('renders max_tokens and context-limit at the top (field reorder)', () => {
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    const output = lastFrame();
    expect(output).toBeDefined();
    const lines = output!.split('\n');
    const fieldLines = lines.filter((l) => l.includes('○') || l.includes('●'));
    expect(fieldLines[0]).toContain('max_tokens');
    expect(fieldLines[6]).toContain('context-limit');
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

  it('edits a model param inline and shows the new value after save (AC5)', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    expect(lastFrame()).toContain('temperature');

    navigateToField(stdin, 'temperature');

    // Enter edit mode
    act(() => {
      stdin.write(ENTER);
    });

    // Type a new value
    for (const ch of '0.9') {
      act(() => {
        stdin.write(ch);
      });
    }

    // Save
    await act(async () => {
      stdin.write(ENTER);
    });

    // The rendered output must reflect the new value (not the old 0.7)
    await waitFor(() => {
      expect(lastFrame()).toContain('0.9');
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

    // The runtime state must reflect the clear — rendered text alone is
    // ambiguous because hints contain literal "true"/"false" strings.
    await waitFor(() => {
      expect(activeRuntime.getActiveModelParams()).not.toHaveProperty(
        'temperature',
      );
      expect(lastFrame()).toContain('(not set)');
    });
  });

  it('toggles reasoning.enabled with Enter (boolean select)', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // reasoning.enabled starts at true
    expect(lastFrame()).toContain('true');

    navigateToField(stdin, 'reasoning.enabled');

    // Press Enter to toggle boolean
    await act(async () => {
      stdin.write(ENTER);
    });

    await waitFor(() => {
      expect(activeRuntime.getEphemeralSettings()['reasoning.enabled']).toBe(
        false,
      );
      expect(lastFrame()).toContain('false');
    });

    // Toggle back
    await act(async () => {
      stdin.write(ENTER);
    });

    // Assert the runtime state, not rendered text — the hint string
    // "Enable thinking/reasoning (true/false)" always contains "true".
    await waitFor(() => {
      expect(activeRuntime.getEphemeralSettings()['reasoning.enabled']).toBe(
        true,
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

    // Press Enter to confirm
    await act(async () => {
      stdin.write(ENTER);
    });

    // Value should be saved as disabled
    await waitFor(() => {
      expect(lastFrame()).toContain('disabled');
    });
  });

  it('shows validation error when committing an invalid ephemeral value', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    navigateToField(stdin, 'reasoning.effort');

    // Enter edit mode
    act(() => {
      stdin.write(ENTER);
    });

    // Type an invalid value (reasoning.effort only accepts known enum values)
    for (const ch of 'invalid-effort') {
      act(() => {
        stdin.write(ch);
      });
    }

    // Save — should show validation error and stay in edit mode
    await act(async () => {
      stdin.write(ENTER);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('must be one of');
    });
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

    // Enter edit mode on max_tokens (index 0)
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
