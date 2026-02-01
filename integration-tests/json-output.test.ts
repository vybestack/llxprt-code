/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, beforeEach, afterEach } from 'vitest';
import { TestRig } from './test-helper.js';
import { join } from 'node:path';

describe('JSON output', () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = new TestRig();
    await rig.setup('json-output-test');
  });

  afterEach(async () => {
    await rig.cleanup();
  });

  it('should return a valid JSON with response and stats', async () => {
    const result = await rig.run(
      'What is the capital of France?',
      '--output-format',
      'json',
    );
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('response');
    expect(typeof parsed.response).toBe('string');
    expect(parsed.response.toLowerCase()).toContain('paris');

    expect(parsed).toHaveProperty('stats');
    expect(typeof parsed.stats).toBe('object');
  });

  // REMOVED (issue #443): Enforced auth type mismatch test removed.
  // The enforced auth type checking was vestigial code that caused
  // more problems than it solved. Providers now handle auth internally.

  it('should not exit on tool errors and allow model to self-correct in JSON mode', async () => {
    rig.setup('json-output-error', {
      fakeResponsesPath: join(
        import.meta.dirname,
        'json-output.error.responses',
      ),
    });
    const result = await rig.run(
      `Read the contents of ${rig.testDir}/path/to/nonexistent/file.txt and tell me what it says. ` +
        'On error, respond to the user with exactly the text "File not found".',
      '--output-format',
      'json',
    );

    const parsed = JSON.parse(result);

    // The response should contain an actual response from the model,
    // not a fatal error that caused the CLI to exit
    expect(parsed).toHaveProperty('response');
    expect(typeof parsed.response).toBe('string');

    // The model should acknowledge the error in its response with exactly the
    // text "File not found" based on the instruction above, but we also match
    // some other forms. If you get flakes for this test please file an issue to
    // come up with a more robust solution.
    expect(parsed.response.toLowerCase()).toMatch(
      /cannot|does not exist|doesn't exist|not found|unable to|error|couldn't/,
    );

    // Stats should be present, indicating the session completed normally.
    expect(parsed).toHaveProperty('stats');

    // Should see one failed tool call in the stats.
    expect(parsed.stats).toHaveProperty('tools');
    expect(parsed.stats.tools.totalCalls).toBe(1);
    expect(parsed.stats.tools.totalFail).toBe(1);
    expect(parsed.stats.tools.totalSuccess).toBe(0);

    // Should NOT have an error field at the top level
    expect(parsed.error).toBeUndefined();
  });
});
