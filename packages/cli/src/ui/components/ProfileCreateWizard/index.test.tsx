/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so component state updates driven through
// the act-wrapped stdin are flushed without warnings.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderWithProviders, waitFor } from '../../../test-utils/render.js';

// ModelSelectStep loads its model list through the runtime API. The runtime is
// infrastructure here: the holder lets each test decide what the provider
// reports without standing up a real provider registry.
const runtimeHolder: {
  listAvailableModels: (providerName: string) => Promise<never[]>;
} = {
  listAvailableModels: () => Promise.resolve([]),
};

void vi.mock('../../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => runtimeHolder,
}));

import { ProfileCreateWizard } from './index.js';

// A lone ESC byte only decodes to an 'escape' keypress after the
// KeypressProvider's escape timeout, so tests drive the synchronous kitty/CSI-u
// keycode instead (same convention as ModelDialog.test.tsx).
const ESCAPE_KEY = '\u001B[27u';
const DOWN_ARROW = '\u001B[B';

const PROVIDER = 'ollama';
const MODEL_NAME = 'tiny-model';

interface WizardRenderResult {
  lastFrame: () => string | undefined;
  stdin: { write: (data: string) => void };
  onClose: ReturnType<typeof vi.fn>;
  onLoadProfile: ReturnType<typeof vi.fn>;
}

function renderWizard(): WizardRenderResult {
  const onClose = vi.fn();
  const onLoadProfile = vi.fn();
  const { lastFrame, stdin } = renderWithProviders(
    <ProfileCreateWizard
      onClose={onClose}
      onLoadProfile={onLoadProfile}
      availableProviders={[PROVIDER]}
    />,
  );
  return { lastFrame, stdin, onClose, onLoadProfile };
}

/**
 * Types text one keystroke per act() flush. TextInput recomputes its
 * keypress handler from a closure over the current value, so delivering a
 * whole word in one synchronous stdin write would drop every character but
 * the last.
 */
async function typeText(
  stdin: { write: (data: string) => void },
  text: string,
): Promise<void> {
  for (const char of text) {
    await act(async () => {
      stdin.write(char);
    });
  }
}

/**
 * Walks the wizard onto the Advanced Parameters step, where Escape routes to
 * the wizard-level cancel handler (the model and auth steps route Escape to
 * step-back instead). 'ollama' needs no base URL and the test runtime lists no
 * models, so the model step is manual entry and auth is skipped.
 */
async function advanceToAdvancedParamsStep(result: WizardRenderResult) {
  expect(result.lastFrame() ?? '').toContain('Select AI Provider:');

  // Commit the only listed provider.
  await act(async () => {
    result.stdin.write('\r');
  });
  await waitFor(() => {
    expect(result.lastFrame() ?? '').toContain('Enter the model name manually');
  });

  // Type a custom model name and submit it.
  await typeText(result.stdin, MODEL_NAME);
  await act(async () => {
    result.stdin.write('\r');
  });
  await waitFor(() => {
    expect(result.lastFrame() ?? '').toContain('Skip for now');
  });

  // Authentication: move to 'Skip for now (configure manually later)' (third
  // of four items) and select it.
  await act(async () => {
    result.stdin.write(DOWN_ARROW);
    result.stdin.write(DOWN_ARROW);
    result.stdin.write('\r');
  });
  await waitFor(() => {
    const frame = result.lastFrame() ?? '';
    expect(frame).toContain('Create New Profile - Step 4 of 6');
    expect(frame).toContain('Advanced Parameters:');
  });
}

describe('ProfileCreateWizard cancel confirmation', () => {
  it('closes immediately from the first step when no provider is chosen', () => {
    const result = renderWizard();

    const beforeFrame = result.lastFrame() ?? '';
    expect(beforeFrame).toContain('Create New Profile - Step 1 of 6');
    expect(beforeFrame).not.toContain('Cancel Profile Creation?');

    act(() => {
      result.stdin.write(ESCAPE_KEY);
    });

    expect(result.onClose).toHaveBeenCalledTimes(1);
    expect(result.onLoadProfile).not.toHaveBeenCalled();
    // The confirmation view must never have been shown for a first-step
    // cancel with nothing configured yet.
    expect(result.lastFrame() ?? '').not.toContain('Cancel Profile Creation?');
  });

  it('asks for confirmation after configuration has started and lists what is lost', async () => {
    const result = renderWizard();
    await advanceToAdvancedParamsStep(result);

    act(() => {
      result.stdin.write(ESCAPE_KEY);
    });

    const frame = result.lastFrame() ?? '';
    expect(frame).toContain('Cancel Profile Creation?');
    expect(frame).toContain(`• Provider: ${PROVIDER}`);
    expect(frame).toContain(`• Model: ${MODEL_NAME}`);
    expect(frame).toContain('No, continue editing');
    expect(frame).toContain('Yes, discard and exit');
    expect(result.onClose).not.toHaveBeenCalled();
  });

  it('resumes onto the same step with the selections preserved', async () => {
    const result = renderWizard();
    await advanceToAdvancedParamsStep(result);

    act(() => {
      result.stdin.write(ESCAPE_KEY);
    });
    expect(result.lastFrame() ?? '').toContain('Cancel Profile Creation?');

    // 'No, continue editing' is the first radio item and already highlighted.
    await act(async () => {
      result.stdin.write('\r');
    });

    const resumedFrame = result.lastFrame() ?? '';
    // Back on Advanced Parameters (step 4), NOT a restart at provider select,
    // and the confirmation view is gone.
    expect(resumedFrame).toContain('Create New Profile - Step 4 of 6');
    expect(resumedFrame).toContain('Advanced Parameters:');
    expect(resumedFrame).not.toContain('Cancel Profile Creation?');
    expect(resumedFrame).not.toContain('Select AI Provider:');
    expect(result.onClose).not.toHaveBeenCalled();

    // The selections survived the cancel/resume round trip: cancelling again
    // still reports both the provider and the model as what would be lost.
    act(() => {
      result.stdin.write(ESCAPE_KEY);
    });
    const confirmFrame = result.lastFrame() ?? '';
    expect(confirmFrame).toContain('Cancel Profile Creation?');
    expect(confirmFrame).toContain(`• Provider: ${PROVIDER}`);
    expect(confirmFrame).toContain(`• Model: ${MODEL_NAME}`);
  });

  it('discards and exits from the confirmation view without persisting', async () => {
    const result = renderWizard();
    await advanceToAdvancedParamsStep(result);

    act(() => {
      result.stdin.write(ESCAPE_KEY);
    });
    expect(result.lastFrame() ?? '').toContain('Cancel Profile Creation?');

    // 'Yes, discard and exit' is the second radio item.
    await act(async () => {
      result.stdin.write(DOWN_ARROW);
      result.stdin.write('\r');
    });

    expect(result.onClose).toHaveBeenCalledTimes(1);
    // Discarding never advanced to the save step, so a profile name was never
    // requested and nothing could have been persisted.
    expect(result.lastFrame() ?? '').not.toContain('Name Your Profile:');
    expect(result.onLoadProfile).not.toHaveBeenCalled();
  });
});
