import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';
import { reportNonInteractiveError } from './errorReporting.js';
import { markMachineErrorReported } from './machineErrorReporting.js';

const { writeToStderr } = vi.hoisted(() => ({
  writeToStderr: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return { ...actual, writeToStderr };
});

describe('reportNonInteractiveError', () => {
  beforeEach(() => {
    writeToStderr.mockClear();
  });

  it('preserves a provider category in emitted stream-json output', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.STREAM_JSON,
    };
    const error: Error & { status?: number; category?: string } = new Error(
      'Rate limit retries exhausted',
    );
    error.status = 429;
    error.category = 'rate_limit';

    reportNonInteractiveError(config, error);

    expect(writeToStderr).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(writeToStderr.mock.calls[0][0]))).toMatchObject({
      type: 'error',
      severity: 'error',
      category: 'rate_limit',
    });
  });

  it('does not emit a second terminal record already reported by stream processing', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.STREAM_JSON,
    };
    const error = new Error('already reported');
    markMachineErrorReported(error);

    reportNonInteractiveError(config, error);

    expect(writeToStderr).not.toHaveBeenCalled();
  });

  it('tracks a frozen error without mutating it', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.STREAM_JSON,
    };
    const error = Object.freeze(new Error('already reported'));

    expect(() => markMachineErrorReported(error)).not.toThrow();
    reportNonInteractiveError(config, error);

    expect(writeToStderr).not.toHaveBeenCalled();
  });

  it('reports a frozen unmarked error without mutating it', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.STREAM_JSON,
    };
    const error = Object.freeze(new Error('frozen provider failure'));

    expect(() => reportNonInteractiveError(config, error)).not.toThrow();
    expect(writeToStderr).toHaveBeenCalledTimes(1);
  });
});
