import { describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SessionConfig } from './llxprtAdapter';
import { handleModelListCommand } from './llxprtCommands';

const BASE: SessionConfig = {
  provider: 'openai',
  'base-url': 'https://example.test/api',
  keyFilePath: path.join(os.tmpdir(), 'nui-test-key'),
  model: 'dummy',
};

describe('handleModelListCommand', () => {
  it('returns missing config messages when incomplete', async () => {
    const result = await handleModelListCommand({ provider: 'openai' });
    expect(result.handled).toBe(true);
    expect(
      result.messages.some((m) => m.toLowerCase().includes('base url')),
    ).toBe(true);
  });

  it('lists models from provider', async () => {
    const listModelsImpl = vi.fn().mockResolvedValue([
      { id: 'm1', name: 'Model One' },
      { id: 'm2', name: 'Model Two' },
    ]);
    const result = await handleModelListCommand(BASE, { listModelsImpl });
    expect(listModelsImpl).toHaveBeenCalledOnce();
    expect(result.messages[0]).toContain('Available models');
    expect(result.messages.some((line) => line.includes('m1'))).toBe(true);
    expect(result.messages.some((line) => line.includes('m2'))).toBe(true);
  });

  it('handles provider errors', async () => {
    const listModelsImpl = vi.fn().mockRejectedValue(new Error('boom'));
    const result = await handleModelListCommand(BASE, { listModelsImpl });
    expect(result.messages[0]).toContain('Failed to list models');
  });
});
