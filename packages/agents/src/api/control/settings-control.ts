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
  readNamedParameter: SessionSettingsOwner['readNamedParameter'],
  captureNamedParameters: SessionSettingsOwner['captureNamedParameters'],
  writeUserParameter: SessionSettingsOwner['writeUserParameter'],
  readSessionOverride: SessionSettingsOwner['readSessionOverride'],
  writeSessionOverride: SessionSettingsOwner['writeSessionOverride'],
  clearSessionOverride: SessionSettingsOwner['clearSessionOverride'],
  assertReadAdmission: () => void,
  assertWriteAdmission: () => void,
): AgentSettingsControl {
  return {
    getEphemeralSetting: (key) => {
      assertReadAdmission();
      return readNamedParameter(key);
    },
    getEphemeralSettings: () => {
      assertReadAdmission();
      return captureNamedParameters();
    },
    setEphemeralSetting: (key, value) => {
      assertWriteAdmission();
      writeUserParameter(key, value);
    },
    getSessionSetting: (key) => {
      assertReadAdmission();
      return readSessionOverride(key);
    },
    setSessionSetting: (key, value) => {
      assertWriteAdmission();
      writeSessionOverride(key, value);
    },
    clearSessionSetting: (key) => {
      assertWriteAdmission();
      clearSessionOverride(key);
    },
  };
}
