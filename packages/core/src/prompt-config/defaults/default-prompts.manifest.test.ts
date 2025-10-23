import { describe, it, expect, vi, afterEach } from 'vitest';

describe('default prompt manifest fallback', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:fs');
  });

  it('serves defaults from the bundled manifest when file system lookup fails', async () => {
    vi.resetModules();

    vi.doMock('node:fs', () => {
      const stub = {
        readFileSync: () => {
          throw new Error(
            'readFileSync should not be invoked when using the bundled manifest',
          );
        },
        existsSync: () => false,
        readdirSync: () => [],
      };
      return {
        ...stub,
        default: stub,
      };
    });

    const { CORE_DEFAULTS } = await import('./core-defaults.js');

    expect(CORE_DEFAULTS['core.md']).toContain('You are LLxprt Code');
  });
});
