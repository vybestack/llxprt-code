/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P10
 * @requirement REQ-D01-002.1
 * @requirement REQ-D01-002.2
 * @requirement REQ-D01-002.3
 * @requirement REQ-D01-003.1
 * @requirement REQ-D01-003.2
 * @pseudocode lines 112-121
 */
function scanTypescriptFiles(
  projectRoot: string,
  pathArg: string,
  pattern: string,
): string[] {
  try {
    const output = execSync(
      `rg -n --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts' --glob '!**/dist/**' --glob '!**/node_modules/**' "${pattern}" ${pathArg}`,
      {
        cwd: projectRoot,
        encoding: 'utf8',
      },
    );

    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) {
      return [];
    }
    throw error;
  }
}

describe('MessageBus legacy API removal gate', () => {
  const projectRoot = resolve(__dirname, '../../../..');
  const coreSrcRoot = 'packages/core/src';
  const cliSrcRoot = 'packages/cli/src';

  it('forbids Config from owning or exposing MessageBus in production code', () => {
    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P10
     * @requirement REQ-D01-002.1
     * @requirement REQ-D01-002.2
     * @requirement REQ-D01-002.3
     * @pseudocode lines 112-121
     */
    const configExposureMatches = scanTypescriptFiles(
      projectRoot,
      coreSrcRoot,
      'MessageBusRemovalSeam|messageBusRemovalSeam|getMessageBus\\(|getMessageBusRemovalSeam\\(|createMessageBusRemovalSeam\\(|private readonly messageBus: MessageBus|readonly messageBus: MessageBus',
    ).filter((line) => line.includes('config/config.ts'));

    expect(configExposureMatches).toEqual([]);
  });

  it('forbids production service-locator MessageBus access through config.getMessageBus()', () => {
    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P10
     * @requirement REQ-D01-002.1
     * @requirement REQ-D01-002.2
     * @requirement REQ-D01-002.3
     * @pseudocode lines 112-121
     */
    const productionMatches = [
      ...scanTypescriptFiles(projectRoot, coreSrcRoot, '\\.getMessageBus\\('),
      ...scanTypescriptFiles(projectRoot, cliSrcRoot, '\\.getMessageBus\\('),
    ];

    expect(productionMatches).toEqual([]);
  });

  it('forbids replacement locator or seam wrappers from keeping legacy MessageBus access reachable under renamed production APIs', () => {
    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P10
     * @requirement REQ-D01-002.1
     * @requirement REQ-D01-002.2
     * @requirement REQ-D01-002.3
     * @requirement REQ-D01-003.1
     * @requirement REQ-D01-003.2
     * @pseudocode lines 112-121
     */
    const replacementLocatorMatches = [
      ...scanTypescriptFiles(
        projectRoot,
        coreSrcRoot,
        'MessageBusRemovalSeam|ToolRegistryRemovalSeam|DeclarativeToolRemovalSeam|messageBusRemovalSeam|getMessageBusRemovalSeam\\(|createMessageBusRemovalSeam\\(|getRemovalSeam\\(|createRemovalSeam\\(',
      ),
      ...scanTypescriptFiles(
        projectRoot,
        cliSrcRoot,
        'MessageBusRemovalSeam|ToolRegistryRemovalSeam|DeclarativeToolRemovalSeam|getMessageBusRemovalSeam\\(|createMessageBusRemovalSeam\\(|getRemovalSeam\\(|createRemovalSeam\\(',
      ),
    ];

    expect(replacementLocatorMatches).toEqual([]);
  });

  it('forbids mutable setMessageBus shim APIs and production call sites', () => {
    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P10
     * @requirement REQ-D01-003.1
     * @requirement REQ-D01-003.2
     * @pseudocode lines 112-121
     */
    const shimDefinitionMatches = [
      ...scanTypescriptFiles(projectRoot, coreSrcRoot, 'setMessageBus\\('),
      ...scanTypescriptFiles(projectRoot, cliSrcRoot, 'setMessageBus\\('),
    ];

    expect(shimDefinitionMatches).toEqual([]);
  });
});
