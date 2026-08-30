/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';

import { capRaceFreezesOnCiWindows } from './utils/shellJobManagerCancelRaceGate.js';

describe('capRaceFreezesOnCiWindows', () => {
  it('identifies GitHub-hosted Actions Windows runners', () => {
    expect(capRaceFreezesOnCiWindows('win32', 'true', 'github-hosted')).toBe(
      true,
    );
  });

  it('does not identify local Windows (no runner variables)', () => {
    expect(capRaceFreezesOnCiWindows('win32', undefined, undefined)).toBe(
      false,
    );
  });

  it("does not identify Windows when GITHUB_ACTIONS is 'false'", () => {
    expect(capRaceFreezesOnCiWindows('win32', 'false', 'github-hosted')).toBe(
      false,
    );
  });

  it('does not identify self-hosted Actions Windows runners', () => {
    expect(capRaceFreezesOnCiWindows('win32', 'true', 'self-hosted')).toBe(
      false,
    );
  });

  it('does not identify GitHub-hosted Actions macOS runners', () => {
    expect(capRaceFreezesOnCiWindows('darwin', 'true', 'github-hosted')).toBe(
      false,
    );
  });

  it('does not identify local Linux', () => {
    expect(capRaceFreezesOnCiWindows('linux', undefined, undefined)).toBe(
      false,
    );
  });

  it('does not identify GitHub-hosted Actions Linux runners', () => {
    expect(capRaceFreezesOnCiWindows('linux', 'true', 'github-hosted')).toBe(
      false,
    );
  });
});
