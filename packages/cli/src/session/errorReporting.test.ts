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

  it('preserves structured fields in emitted stream-json output', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.STREAM_JSON,
    };
    const error: Error & {
      status?: number;
      category?: string;
      reason?: string;
    } = new Error('Rate limit retries exhausted');
    error.status = 429;
    error.category = 'rate_limit';
    error.reason = 'retries_exhausted';

    reportNonInteractiveError(config, error);

    expect(writeToStderr).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(writeToStderr.mock.calls[0][0]))).toStrictEqual({
      type: 'error',
      timestamp: expect.any(String),
      severity: 'error',
      message: expect.stringContaining('Rate limit retries exhausted'),
      status: 429,
      category: 'rate_limit',
      reason: 'retries_exhausted',
    });
  });

  it('serializes a terminal error in JSON output', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.JSON,
    };
    const error: Error & { status?: number; category?: string } = new Error(
      'JSON provider failure',
    );
    error.status = 503;
    error.category = 'server_error';

    reportNonInteractiveError(config, error);

    expect(JSON.parse(String(writeToStderr.mock.calls[0][0]))).toStrictEqual({
      error: {
        type: 'Error',
        message: 'JSON provider failure',
        status: 503,
        category: 'server_error',
      },
    });
    expect(String(writeToStderr.mock.calls[0][0])).toMatch(/\n$/);
  });

  it('formats a terminal error in text output', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.TEXT,
    };
    const error = new Error('text provider failure');

    reportNonInteractiveError(config, error);

    expect(String(writeToStderr.mock.calls[0][0])).toMatch(
      /^Non-interactive run failed: \[API Error: text provider failure\]/,
    );
  });

  it('marks an emitted error so reporting it twice produces one record', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.STREAM_JSON,
    };
    const error = new Error('single terminal record');

    reportNonInteractiveError(config, error);
    reportNonInteractiveError(config, error);

    expect(writeToStderr).toHaveBeenCalledTimes(1);
  });

  it('tracks suppression per error identity', () => {
    const config: Pick<Config, 'getOutputFormat'> = {
      getOutputFormat: () => OutputFormat.STREAM_JSON,
    };
    const reported = new Error('reported');
    const unreported = new Error('unreported');
    markMachineErrorReported(reported);

    reportNonInteractiveError(config, reported);
    reportNonInteractiveError(config, unreported);

    expect(writeToStderr).toHaveBeenCalledTimes(1);
    expect(String(writeToStderr.mock.calls[0][0])).toContain('unreported');
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
