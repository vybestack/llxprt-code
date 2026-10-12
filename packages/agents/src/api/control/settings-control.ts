/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

export interface AgentSettingsControl {
  getEphemeralSetting(key: string): unknown;
  getEphemeralSettings(): Readonly<Record<string, unknown>>;
  setEphemeralSetting(key: string, value: unknown): void;
  getSessionSetting(key: string): unknown;
  setSessionSetting(key: string, value: unknown): void;
  clearSessionSetting(key: string): void;
}

export function assembleSettingsControl(
  readOwner: () => Pick<
    SessionSettingsOwner,
    | 'readNamedParameter'
    | 'captureNamedParameters'
    | 'writeUserParameter'
    | 'readSessionOverride'
    | 'writeSessionOverride'
    | 'clearSessionOverride'
  >,
  assertReadAdmission: () => void,
  assertWriteAdmission: () => void,
): AgentSettingsControl {
  return {
    getEphemeralSetting: (key) => {
      assertReadAdmission();
      return readOwner().readNamedParameter(key);
    },
    getEphemeralSettings: () => {
      assertReadAdmission();
      return readOwner().captureNamedParameters();
    },
    setEphemeralSetting: (key, value) => {
      assertWriteAdmission();
      readOwner().writeUserParameter(key, value);
    },
    getSessionSetting: (key) => {
      assertReadAdmission();
      return readOwner().readSessionOverride(key);
    },
    setSessionSetting: (key, value) => {
      assertWriteAdmission();
      readOwner().writeSessionOverride(key, value);
    },
    clearSessionSetting: (key) => {
      assertWriteAdmission();
      readOwner().clearSessionOverride(key);
    },
  };
}
