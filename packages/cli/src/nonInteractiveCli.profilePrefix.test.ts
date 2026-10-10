/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for createProfileNameWriter's profile-qualified prefix
 * (issue #2263).
 *
 * The writer must emit [profileName:modelName] on the first event of a turn,
 * suppress it on subsequent events (firstEventInTurn guard), and suppress it
 * entirely when JSON output is enabled.
 */

import { StreamJsonFormatter } from '@vybestack/llxprt-code-core';
import {
  vi,
  type Mock,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';
import { createProfileNameWriter } from './nonInteractiveCli.js';

describe('createProfileNameWriter profile-qualified prefix (issue #2263)', () => {
  let processStdoutSpy: Mock<(...args: never[]) => unknown>;

  beforeEach(() => {
    processStdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    processStdoutSpy.mockRestore();
  });

  it('writes [profileName:modelName] on the first call of a turn', () => {
    const writer = createProfileNameWriter(false, null, () => 'work:gpt-4');

    writer();

    expect(processStdoutSpy).toHaveBeenCalledWith('[work:gpt-4]\n');
  });

  it('does not write on the second call (firstEventInTurn guard)', () => {
    const writer = createProfileNameWriter(false, null, () => 'work:gpt-4');

    writer();
    processStdoutSpy.mockClear();
    writer();

    expect(processStdoutSpy).not.toHaveBeenCalled();
  });

  it('does not write when jsonOutput is true', () => {
    const writer = createProfileNameWriter(true, null, () => 'work:gpt-4');

    writer();

    expect(processStdoutSpy).not.toHaveBeenCalled();
  });

  it('does not write when the identity resolves to null', () => {
    const writer = createProfileNameWriter(false, null, () => null);

    writer();

    expect(processStdoutSpy).not.toHaveBeenCalled();
  });

  it('does not write when a stream formatter is present', () => {
    const streamFormatter = new StreamJsonFormatter();
    const writer = createProfileNameWriter(
      false,
      streamFormatter,
      () => 'work:gpt-4',
    );

    writer();

    expect(processStdoutSpy).not.toHaveBeenCalled();
  });
});
