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
  };
}

let activeRuntime: ReturnType<typeof createStatefulRuntime>;

vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => activeRuntime,
}));

const DOWN = '\u001B[B';
const ENTER = '\r';
const ESC = '\u001b';

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

  it('renders the model parameters section with current values (AC3)', () => {
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    const output = lastFrame();
    expect(output).toContain('Model Parameters');
    expect(output).toContain('temperature');
    expect(output).toContain('0.7');
    expect(output).toContain('max_tokens');
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
    expect(output).toContain('Model Behavior');
    expect(output).toContain('reasoning.enabled');
    expect(output).toContain('reasoning.effort');
    expect(output).toContain('context-limit');
    expect(output).toContain('streaming');
    expect(output).toContain('prompt-caching');
  });

  it('navigates down and selects the expected field (AC4)', () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // Navigate down once from temperature (index 0) to max_tokens (index 1)
    act(() => {
      stdin.write(DOWN);
    });

    // Enter edit mode to reveal which field is selected via the prompt text
    act(() => {
      stdin.write(ENTER);
    });

    expect(lastFrame()).toContain('Edit max_tokens');
  });

  it('edits a model param and shows the new value after save (AC5)', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    expect(lastFrame()).toContain('temperature');

    // Enter edit mode on temperature (index 0, default selection)
    act(() => {
      stdin.write(ENTER);
    });

    // EditValue is pre-populated with the current value (0.7).
    // Clear the pre-filled text before typing the new value.
    act(() => {
      stdin.write('\u0015'); // Ctrl+U clears the line in TextInput
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

    // temperature starts at 0.7, selected by default (index 0)
    expect(lastFrame()).toContain('0.7');

    // Press 'c' in list mode to clear the selected param field
    await act(async () => {
      stdin.write('c');
    });

    // The rendered output must show (not set) for temperature
    await waitFor(() => {
      expect(lastFrame()).toContain('(not set)');
    });
  });

  it('ignores c=clear on ephemeral fields in list mode', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // Navigate to reasoning.enabled (index 6) — an ephemeral field
    for (let i = 0; i < 6; i++) {
      act(() => {
        stdin.write(DOWN);
      });
    }

    // Press 'c' in list mode — should NOT clear an ephemeral field
    await act(async () => {
      stdin.write('c');
    });

    // reasoning.enabled should still be true
    await waitFor(() => {
      expect(lastFrame()).toContain('true');
    });
  });

  it('edits an ephemeral setting and shows the new value after save (AC8)', async () => {
    // Navigate to context-limit (index 8): 6 params + 2 ephemeral before it
    // reasoning.enabled=6, reasoning.effort=7, context-limit=8
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // Press down 8 times to reach context-limit
    for (let i = 0; i < 8; i++) {
      act(() => {
        stdin.write(DOWN);
      });
    }

    // Enter edit mode
    act(() => {
      stdin.write(ENTER);
    });

    expect(lastFrame()).toContain('Edit context-limit');

    // Clear the pre-filled text (context-limit has no value by default)
    act(() => {
      stdin.write('\u0015'); // Ctrl+U clears the line
    });

    // Type a new value
    for (const ch of '100000') {
      act(() => {
        stdin.write(ch);
      });
    }

    // Save
    await act(async () => {
      stdin.write(ENTER);
    });

    // The rendered output must reflect the new value
    await waitFor(() => {
      expect(lastFrame()).toContain('100000');
    });
  });

  it('does not show c=clear in edit mode help text (clear is list-mode only)', () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // Navigate to reasoning.enabled (index 6)
    for (let i = 0; i < 6; i++) {
      act(() => {
        stdin.write(DOWN);
      });
    }

    // Enter edit mode
    act(() => {
      stdin.write(ENTER);
    });

    const output = lastFrame();
    expect(output).toContain('Edit reasoning.enabled');
    expect(output).not.toContain('c=clear');
  });

  it('shows c=clear in list mode help text', () => {
    const { lastFrame } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // In list mode (no edit), help text should mention c=clear
    const output = lastFrame();
    expect(output).toContain('c=clear');
  });

  it('shows validation error when committing an invalid ephemeral value', async () => {
    const { lastFrame, stdin } = renderWithProviders(
      <ModelConfigDialog {...defaultProps()} />,
    );

    // Navigate to reasoning.effort (index 7)
    for (let i = 0; i < 7; i++) {
      act(() => {
        stdin.write(DOWN);
      });
    }

    // Enter edit mode
    act(() => {
      stdin.write(ENTER);
    });

    expect(lastFrame()).toContain('Edit reasoning.effort');

    // Clear the pre-filled text if any
    act(() => {
      stdin.write('\u0015'); // Ctrl+U clears the line
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
      const frame = lastFrame();
      // Still in edit mode (validation failed, not saved)
      expect(frame).toContain('Edit reasoning.effort');
      // The validation error message from parseEphemeralSettingValue
      // must be rendered (enum values: minimal/low/medium/high/xhigh/max)
      expect(frame).toContain('must be one of');
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

    act(() => {
      stdin.write(ENTER);
    });

    expect(lastFrame()).toContain('>');

    act(() => {
      stdin.write(ESC);
    });

    await waitFor(() => {
      expect(lastFrame()).toContain('Model Parameters');
    });
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
