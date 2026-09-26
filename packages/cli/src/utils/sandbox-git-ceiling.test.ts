/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { addContainerEnvVars } from './sandbox-containers.js';

const config = { command: 'docker', image: 'test' } as const;
const originalCeiling = process.env.GIT_CEILING_DIRECTORIES;
const originalSandboxEnv = process.env.SANDBOX_ENV;

describe('container Git discovery ceiling', () => {
  afterEach(() => {
    if (originalCeiling === undefined) {
      delete process.env.GIT_CEILING_DIRECTORIES;
    } else {
      process.env.GIT_CEILING_DIRECTORIES = originalCeiling;
    }
    if (originalSandboxEnv === undefined) {
      delete process.env.SANDBOX_ENV;
    } else {
      process.env.SANDBOX_ENV = originalSandboxEnv;
    }
  });

  it('passes the host ceiling into the container', () => {
    process.env.GIT_CEILING_DIRECTORIES = '/workspace/.integration-tests';
    delete process.env.SANDBOX_ENV;
    const args: string[] = [];
    addContainerEnvVars(args, config, 'git-ceiling-test', [], '/workspace');
    expect(args).toContain(
      'GIT_CEILING_DIRECTORIES=/workspace/.integration-tests',
    );
  });

  it('rejects an override that could detach the pinned Git ceiling', () => {
    process.env.GIT_CEILING_DIRECTORIES = '/workspace/.integration-tests';
    process.env.SANDBOX_ENV = 'GIT_CEILING_DIRECTORIES=/';
    expect(() =>
      addContainerEnvVars([], config, 'git-ceiling-test', [], '/workspace'),
    ).toThrow(FatalSandboxError);
  });
});
