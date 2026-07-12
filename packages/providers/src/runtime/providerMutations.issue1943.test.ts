/**
 * @issue #1943 - /toolformat is not persisted into profile ephemerals
 *
 * Behavioral tests for setActiveToolFormatOverride() writing to both
 * SettingsService and Config ephemeral settings, so the tool-format value is
 * captured during profile saves.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  setActiveToolFormatOverride,
  type ToolFormatMutationDependencies,
  type ToolFormatState,
} from './providerMutations.js';

const setEphemeralSetting = vi.fn();
const updateSettings = vi.fn().mockResolvedValue(undefined);
const state: ToolFormatState = {
  providerName: 'openai',
  currentFormat: 'openai',
  override: 'openai',
  isAutoDetected: false,
};

const dependencies: ToolFormatMutationDependencies = {
  getRuntimeServices: () => ({
    config: { setEphemeralSetting },
    settingsService: { updateSettings },
  }),
  getActiveProvider: () => ({ name: 'openai' }),
  getToolFormatState: async () => state,
};

describe('setActiveToolFormatOverride ephemeral persistence (issue #1943)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['openai', 'openai'],
    [null, 'auto'],
    ['auto', 'auto'],
    ['kimi', 'kimi'],
  ] as const)(
    'persists %s as %s in settings and ephemerals',
    async (input, expected) => {
      expect(await setActiveToolFormatOverride(input, dependencies)).toBe(
        state,
      );
      expect(updateSettings).toHaveBeenCalledWith('openai', {
        toolFormat: expected,
      });
      expect(setEphemeralSetting).toHaveBeenCalledWith('tool-format', expected);
    },
  );

  it('updates settings and ephemerals exactly once', async () => {
    await setActiveToolFormatOverride('openai', dependencies);

    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(setEphemeralSetting).toHaveBeenCalledTimes(1);
  });
});
