import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { OutputFormat } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';
import { markMachineErrorReported } from './machineErrorReporting.js';

const { writeToStderr } = {
  writeToStderr: vi.fn(),
};

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actual,
  writeToStderr,
}));

// Loaded with top-level await instead of a static import so the module under
// test is evaluated AFTER the core mock above is registered.
const { reportNonInteractiveError } = await import('./errorReporting.js');

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

  it('interpolates the configured model into a Gemini Pro quota message (#2627)', () => {
    const config: Pick<Config, 'getOutputFormat'> & {
      getModel(): string;
      getProvider(): string | undefined;
    } = {
      getOutputFormat: () => OutputFormat.TEXT,
      getProvider: () => 'gemini',
      getModel: () => 'gemini-2.5-pro-configured-here',
    };
    const errorMessage = `got status: 429 Too Many Requests. {"error":{"code":429,"message":"Quota exceeded for quota metric 'Gemini 2.5 Pro Requests' and limit 'RequestsPerDay' of service 'generativelanguage.googleapis.com' for consumer 'project_number:123456789'.","status":"RESOURCE_EXHAUSTED"}}`;

    reportNonInteractiveError(config, errorMessage);

    expect(writeToStderr).toHaveBeenCalledTimes(1);
    const message = String(writeToStderr.mock.calls[0][0]);
    expect(message).toContain(
      'You have reached your daily gemini-2.5-pro-configured-here quota limit',
    );
    expect(message).not.toContain('daily  quota');
  });
});
