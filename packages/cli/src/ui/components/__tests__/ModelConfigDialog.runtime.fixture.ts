/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Stateful fake runtime. Instead of vi.fn() spies returning fixed values,
 * this mutable object reflects writes immediately so re-renders observe
 * the updated state — exercising real save/clear behavior end-to-end.
 */
export interface StatefulRuntimeState {
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

export function createStatefulRuntime(
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
