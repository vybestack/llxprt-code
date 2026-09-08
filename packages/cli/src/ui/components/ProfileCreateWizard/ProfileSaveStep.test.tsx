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

import { describe, expect, it, vi, beforeEach, afterEach } from 'bun:test';
import { act } from 'react';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderWithProviders, waitFor } from '../../../test-utils/render.js';
import { ProfileSaveStep } from './ProfileSaveStep.js';
import { WizardStep, type WizardState } from './types.js';

// A lone ESC byte only decodes to an 'escape' keypress after the
// KeypressProvider's escape timeout, so tests drive the synchronous kitty/CSI-u
// keycode instead (same convention as ModelDialog.test.tsx).
const ESCAPE_KEY = '\u001B[27u';

const EXISTING_PROFILE = 'dupe';

function makeSaveStepState(): WizardState {
  return {
    currentStep: WizardStep.SAVE_PROFILE,
    stepHistory: [
      WizardStep.PROVIDER_SELECT,
      WizardStep.MODEL_SELECT,
      WizardStep.AUTHENTICATION,
      WizardStep.ADVANCED_PARAMS,
      WizardStep.SAVE_PROFILE,
    ],
    config: {
      provider: 'ollama',
      model: 'tiny-model',
      auth: { type: null },
    },
    validationErrors: {},
    skipValidation: false,
  };
}

interface SaveStepRenderResult {
  lastFrame: () => string | undefined;
  stdin: { write: (data: string) => void };
  onContinue: ReturnType<typeof vi.fn>;
  onBack: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
}

function renderSaveStep(): SaveStepRenderResult {
  const onContinue = vi.fn();
  const onBack = vi.fn();
  const onCancel = vi.fn();
  const { lastFrame, stdin } = renderWithProviders(
    <ProfileSaveStep
      state={makeSaveStepState()}
      onUpdateProfileName={vi.fn()}
      onContinue={onContinue}
      onBack={onBack}
      onCancel={onCancel}
    />,
  );
  return { lastFrame, stdin, onContinue, onBack, onCancel };
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

describe('ProfileSaveStep', () => {
  let tempConfigHome: string;
  let previousConfigHome: string | undefined;
  let profilesDir: string;

  beforeEach(async () => {
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    tempConfigHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'issue2020-save-step-'),
    );
    process.env.LLXPRT_CONFIG_HOME = tempConfigHome;
    profilesDir = path.join(tempConfigHome, 'profiles');
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    // Restore writability in case a test revoked it, so cleanup can delete.
    await fs.chmod(profilesDir, 0o755).catch(() => undefined);
    await fs.rm(tempConfigHome, { recursive: true, force: true });
  });

  /**
   * Lets the step's mount effect finish scanning the profiles directory
   * before keystrokes start, so duplicate validation sees seeded files.
   */
  async function flushExistingProfilesScan(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }

  async function seedExistingProfile(name: string): Promise<void> {
    await fs.writeFile(
      path.join(profilesDir, `${name}.json`),
      JSON.stringify({ version: 1, provider: 'zai', model: 'glm-4.7' }),
      'utf8',
    );
    await flushExistingProfilesScan();
  }

  it('shows the empty-name validation error on submit without saving', async () => {
    const step = renderSaveStep();

    await act(async () => {
      step.stdin.write('\r');
    });

    const frame = step.lastFrame() ?? '';
    expect(frame).toContain('✗ Profile name cannot be empty');
    expect(frame).not.toContain('✓ Name is available');
    expect(step.onContinue).not.toHaveBeenCalled();
  });

  it('rejects a name containing a forward slash', async () => {
    const step = renderSaveStep();

    await typeText(step.stdin, 'bad/name');

    const frame = step.lastFrame() ?? '';
    expect(frame).toContain('✗ Profile name cannot contain path separators');
    expect(frame).not.toContain('✓ Name is available');
  });

  it('rejects a name containing a backslash', async () => {
    const step = renderSaveStep();

    await typeText(step.stdin, 'bad');
    // The keypress parser holds a backslash for a few milliseconds to detect
    // backslash+enter, so send it alone and let the flush timer fire inside
    // the act window before asserting.
    await act(async () => {
      step.stdin.write('\\');
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const frame = step.lastFrame() ?? '';
    expect(frame).toContain('✗ Profile name cannot contain path separators');
    expect(frame).toContain('> bad\\');
  });

  it('flags a name that matches an existing profile file', async () => {
    await seedExistingProfile(EXISTING_PROFILE);
    const step = renderSaveStep();

    await typeText(step.stdin, EXISTING_PROFILE);

    const frame = step.lastFrame() ?? '';
    expect(frame).toContain('✗ Profile name already exists');
    expect(frame).not.toContain('✓ Name is available');
  });

  it('marks a fresh name as available', async () => {
    await seedExistingProfile(EXISTING_PROFILE);
    const step = renderSaveStep();

    await typeText(step.stdin, 'fresh-one');

    const frame = step.lastFrame() ?? '';
    expect(frame).toContain('✓ Name is available');
    expect(frame).not.toContain('✗');
  });

  it('renders the save error and stays on the input when the write fails', async () => {
    // A read-only profiles directory keeps the listing readable (so the name
    // still validates as available) but makes every write path fail with a
    // real filesystem permission error rather than a mocked literal.
    await fs.chmod(profilesDir, 0o555);
    const step = renderSaveStep();

    await typeText(step.stdin, 'fresh-one');
    expect(step.lastFrame() ?? '').toContain('✓ Name is available');

    await act(async () => {
      step.stdin.write('\r');
    });

    await waitFor(() => {
      const frame = step.lastFrame() ?? '';
      expect(frame).toMatch(/✗ .*(EACCES|permission denied)/);
    });
    expect(step.onContinue).not.toHaveBeenCalled();
    // Still on the name input, so the user can retry.
    expect(step.lastFrame() ?? '').toContain('Profile name:');
  });

  it('writes the profile through the real store and continues', async () => {
    const step = renderSaveStep();

    await typeText(step.stdin, 'wizard-e2e');
    await act(async () => {
      step.stdin.write('\r');
    });

    await waitFor(() => {
      expect(step.onContinue).toHaveBeenCalledTimes(1);
    });
    expect(step.onBack).not.toHaveBeenCalled();
    expect(step.onCancel).not.toHaveBeenCalled();

    // The profile really landed on disk via saveProfile -> writeProfileFile.
    const savedPath = path.join(profilesDir, 'wizard-e2e.json');
    const saved = JSON.parse(await fs.readFile(savedPath, 'utf8')) as {
      provider: string;
      model: string;
    };
    expect(saved.provider).toBe('ollama');
    expect(saved.model).toBe('tiny-model');
  });

  it('routes a duplicate submit into the conflict dialog and Escape returns to the name input', async () => {
    await seedExistingProfile(EXISTING_PROFILE);
    const step = renderSaveStep();

    await typeText(step.stdin, EXISTING_PROFILE);
    await act(async () => {
      step.stdin.write('\r');
    });

    await waitFor(() => {
      expect(step.lastFrame() ?? '').toContain('Profile Name Conflict');
    });
    expect(step.onContinue).not.toHaveBeenCalled();

    // Escape from the conflict view goes back to the name input, keeping the
    // typed (invalid) name and its validation error for editing.
    await act(async () => {
      step.stdin.write(ESCAPE_KEY);
    });

    const frame = step.lastFrame() ?? '';
    expect(frame).not.toContain('Profile Name Conflict');
    expect(frame).toContain('Profile name:');
    expect(frame).toContain('✗ Profile name already exists');
  });
});
