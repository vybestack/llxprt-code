/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
  NIGHTLY_TESTS_WORKFLOW_NAME,
  scaleTestLane,
  selectScaleCases,
} from './scale-test-lane.js';

describe('scale test lane', () => {
  it('uses explicit overrides before workflow inference', () => {
    expect(scaleTestLane({ LLXPRT_SCALE_EXTENDED: '1' })).toBe('extended');
    expect(
      scaleTestLane({
        LLXPRT_SCALE_EXTENDED: '0',
        GITHUB_WORKFLOW: NIGHTLY_TESTS_WORKFLOW_NAME,
        GITHUB_EVENT_NAME: 'schedule',
      }),
    ).toBe('default');
  });

  it('infers extended only for scheduled or manually dispatched nightly tests', () => {
    for (const event of [
      'schedule',
      'workflow_dispatch',
      'push',
      'pull_request',
      undefined,
    ]) {
      for (const workflow of [NIGHTLY_TESTS_WORKFLOW_NAME, 'CI', undefined]) {
        expect(
          scaleTestLane({
            GITHUB_WORKFLOW: workflow,
            GITHUB_EVENT_NAME: event,
          }),
        ).toBe(
          workflow === NIGHTLY_TESTS_WORKFLOW_NAME &&
            (event === 'schedule' || event === 'workflow_dispatch')
            ? 'extended'
            : 'default',
        );
      }
    }
  });

  it('rejects malformed explicit values rather than silently dropping cases', () => {
    for (const value of ['', 'true', 'false', '2', ' 1', '0 ']) {
      expect(() => scaleTestLane({ LLXPRT_SCALE_EXTENDED: value })).toThrow(
        'LLXPRT_SCALE_EXTENDED must be absent, "0", or "1"',
      );
    }
  });

  it('keeps default cases in both lanes and adds every extended case', () => {
    expect(selectScaleCases([40, 400], [25_000, 100_000], {})).toStrictEqual([
      40, 400,
    ]);
    expect(
      selectScaleCases([40, 400], [25_000, 100_000], {
        LLXPRT_SCALE_EXTENDED: '1',
      }),
    ).toStrictEqual([40, 400, 25_000, 100_000]);
  });

  it('fails visibly if the nightly workflow name changes', async () => {
    const workflow = await readFile(
      new URL('../../../../.github/workflows/nightly.yml', import.meta.url),
      'utf8',
    );
    const name = workflow
      .split('\n')
      .find((line) => line.startsWith('name:'))
      ?.slice(5)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    expect(name).toBe(NIGHTLY_TESTS_WORKFLOW_NAME);
  });
});
