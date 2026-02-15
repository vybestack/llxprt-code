/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250212-LSP.P34
 * @requirement REQ-STATUS-010, REQ-STATUS-020, REQ-STATUS-025, REQ-STATUS-030,
 * REQ-STATUS-035, REQ-STATUS-040, REQ-STATUS-045, REQ-STATUS-050
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lspCommand } from './lspCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { MessageActionReturn, SlashCommand } from './types.js';

const isMessageAction = (result: unknown): result is MessageActionReturn =>
  result !== null &&
  typeof result === 'object' &&
  'type' in result &&
  result.type === 'message';

describe('lspCommand (P34)', () => {
  describe('command structure', () => {
    it('should expose the lsp command', () => {
      expect(lspCommand.name).toBe('lsp');
      expect(lspCommand.kind).toBe('built-in');
      expect(lspCommand.description).toBe(
        'Manage Language Server Protocol (LSP) service',
      );
    });

    it('should include status subcommand', () => {
      expect(lspCommand.subCommands).toBeDefined();
      expect(lspCommand.subCommands).toHaveLength(1);
      expect(lspCommand.subCommands?.[0].name).toBe('status');
      expect(lspCommand.subCommands?.[0].action).toBeDefined();
    });

    it('default action should delegate to status action', async () => {
      const context = createMockCommandContext();
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
      };
      config.getLspConfig = vi.fn().mockReturnValue(undefined);

      const result = await lspCommand.action!(context, '');
      expect(isMessageAction(result)).toBe(true);
      expect((result as MessageActionReturn).content).toBe(
        'LSP disabled by configuration',
      );
    });
  });

  describe('status behavior', () => {
    let statusCommand: SlashCommand;
    let context: ReturnType<typeof createMockCommandContext>;

    beforeEach(() => {
      vi.clearAllMocks();
      context = createMockCommandContext();
      const command = lspCommand.subCommands?.find((c) => c.name === 'status');
      if (!command) {
        throw new Error('status command not found');
      }
      statusCommand = command;
    });

    describe('wire-format state contract (P37)', () => {
      /**
       * @plan PLAN-20250212-LSP.P37
       * @requirement REQ-STATUS-020
       */
      it('maps state=ok to active', async () => {
        const config = context.services.config as unknown as {
          getLspConfig: () => unknown;
          getLspServiceClient: () => unknown;
        };
        const client = {
          isAlive: vi.fn().mockReturnValue(true),
          status: vi.fn().mockResolvedValue([{ serverId: 'ts', state: 'ok' }]),
        };
        config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
        config.getLspServiceClient = vi.fn().mockReturnValue(client);

        const result = await statusCommand.action!(context, '');
        expect(isMessageAction(result)).toBe(true);
        expect((result as MessageActionReturn).content).toContain(
          '  ts: active',
        );
      });

      it('maps state=starting to starting', async () => {
        const config = context.services.config as unknown as {
          getLspConfig: () => unknown;
          getLspServiceClient: () => unknown;
        };
        const client = {
          isAlive: vi.fn().mockReturnValue(true),
          status: vi
            .fn()
            .mockResolvedValue([{ serverId: 'ts', state: 'starting' }]),
        };
        config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
        config.getLspServiceClient = vi.fn().mockReturnValue(client);

        const result = await statusCommand.action!(context, '');
        expect(isMessageAction(result)).toBe(true);
        expect((result as MessageActionReturn).content).toContain(
          '  ts: starting',
        );
      });

      it('maps state=broken to broken', async () => {
        const config = context.services.config as unknown as {
          getLspConfig: () => unknown;
          getLspServiceClient: () => unknown;
        };
        const client = {
          isAlive: vi.fn().mockReturnValue(true),
          status: vi
            .fn()
            .mockResolvedValue([{ serverId: 'ts', state: 'broken' }]),
        };
        config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
        config.getLspServiceClient = vi.fn().mockReturnValue(client);

        const result = await statusCommand.action!(context, '');
        expect(isMessageAction(result)).toBe(true);
        expect((result as MessageActionReturn).content).toContain(
          '  ts: broken',
        );
      });

      it('maps unknown state to unavailable', async () => {
        const config = context.services.config as unknown as {
          getLspConfig: () => unknown;
          getLspServiceClient: () => unknown;
        };
        const client = {
          isAlive: vi.fn().mockReturnValue(true),
          status: vi
            .fn()
            .mockResolvedValue([{ serverId: 'ts', state: 'unexpected_value' }]),
        };
        config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
        config.getLspServiceClient = vi.fn().mockReturnValue(client);

        const result = await statusCommand.action!(context, '');
        expect(isMessageAction(result)).toBe(true);
        expect((result as MessageActionReturn).content).toContain(
          '  ts: unavailable',
        );
      });

      it('handles mixed state and status payloads', async () => {
        const config = context.services.config as unknown as {
          getLspConfig: () => unknown;
          getLspServiceClient: () => unknown;
        };
        const client = {
          isAlive: vi.fn().mockReturnValue(true),
          status: vi.fn().mockResolvedValue([
            { serverId: 'a', state: 'ok' },
            { serverId: 'b', status: 'disabled' },
          ]),
        };
        config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
        config.getLspServiceClient = vi.fn().mockReturnValue(client);

        const result = await statusCommand.action!(context, '');
        expect(isMessageAction(result)).toBe(true);
        expect((result as MessageActionReturn).content).toContain(
          '  a: active',
        );
        expect((result as MessageActionReturn).content).toContain(
          '  b: disabled',
        );
      });
    });

    it('returns config not loaded error', async () => {
      context.services.config = null;
      const result = await statusCommand.action!(context, '');
      expect(isMessageAction(result)).toBe(true);
      expect((result as MessageActionReturn).messageType).toBe('error');
      expect((result as MessageActionReturn).content).toBe(
        'Config not loaded.',
      );
    });

    it('returns exact disabled message when LSP config is undefined', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
      };
      config.getLspConfig = vi.fn().mockReturnValue(undefined);

      const result = await statusCommand.action!(context, '');
      expect((result as MessageActionReturn).messageType).toBe('info');
      expect((result as MessageActionReturn).content).toBe(
        'LSP disabled by configuration',
      );
    });

    it('returns unavailable with fallback reason when client is missing', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
      config.getLspServiceClient = vi.fn().mockReturnValue(undefined);

      const result = await statusCommand.action!(context, '');
      expect((result as MessageActionReturn).content).toBe(
        'LSP unavailable: service startup failed',
      );
    });

    it('returns unavailable using getUnavailableReason when client is dead', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(false),
        getUnavailableReason: vi.fn().mockReturnValue('port conflict'),
        status: vi.fn(),
      };
      config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      expect((result as MessageActionReturn).content).toBe(
        'LSP unavailable: port conflict',
      );
      expect(client.status).not.toHaveBeenCalled();
    });

    it('returns unavailable fallback when dead client has no getUnavailableReason', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(false),
        status: vi.fn(),
      };
      config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      expect((result as MessageActionReturn).content).toBe(
        'LSP unavailable: service startup failed',
      );
    });

    it('formats alive output with required header and two-space indents', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(true),
        status: vi
          .fn()
          .mockResolvedValue([{ serverId: 'typescript', status: 'active' }]),
      };
      config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      const content = (result as MessageActionReturn).content;
      expect(content.startsWith('LSP server status:\n')).toBe(true);
      expect(content).toContain('\n  typescript: active');
    });

    it('normalizes raw statuses to allowed vocabulary', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(true),
        status: vi.fn().mockResolvedValue([
          { serverId: 'a', status: 'running' },
          { serverId: 'b', status: 'healthy' },
          { serverId: 'c', status: 'error' },
          { serverId: 'd', status: 'failed' },
          { serverId: 'e', status: 'starting' },
          { serverId: 'f', status: 'disabled' },
          { serverId: 'g', status: 'broken' },
          { serverId: 'h', status: 'mystery' },
        ]),
      };
      config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      const content = (result as MessageActionReturn).content;
      expect(content).toContain('  a: active');
      expect(content).toContain('  b: active');
      expect(content).toContain('  c: broken');
      expect(content).toContain('  d: broken');
      expect(content).toContain('  e: starting');
      expect(content).toContain('  f: disabled');
      expect(content).toContain('  g: broken');
      expect(content).toContain('  h: unavailable');
    });

    it('includes built-in server ids even if absent from config and status', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(true),
        status: vi.fn().mockResolvedValue([]),
      };
      config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      const content = (result as MessageActionReturn).content;
      expect(content).toContain('  eslint: unavailable');
      expect(content).toContain('  gopls: unavailable');
      expect(content).toContain('  pyright: unavailable');
      expect(content).toContain('  rust-analyzer: unavailable');
      expect(content).toContain('  typescript: unavailable');
    });

    it('includes configured custom server ids in output universe', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(true),
        status: vi.fn().mockResolvedValue([]),
      };
      config.getLspConfig = vi.fn().mockReturnValue({
        servers: [{ id: 'custom-zls', command: 'zls' }],
      });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      expect((result as MessageActionReturn).content).toContain(
        '  custom-zls: unavailable',
      );
    });

    it('includes ids returned by status even if not built-in or configured', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(true),
        status: vi
          .fn()
          .mockResolvedValue([{ serverId: 'clangd', status: 'starting' }]),
      };
      config.getLspConfig = vi.fn().mockReturnValue({ servers: [] });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      expect((result as MessageActionReturn).content).toContain(
        '  clangd: starting',
      );
    });

    it('orders all server lines alphabetically by serverId', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(true),
        status: vi.fn().mockResolvedValue([
          { serverId: 'zzz', status: 'active' },
          { serverId: 'aaa', status: 'active' },
        ]),
      };
      config.getLspConfig = vi.fn().mockReturnValue({
        servers: [{ id: 'mmm', command: 'm' }],
      });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      const lines = (result as MessageActionReturn).content
        .split('\n')
        .slice(1);
      const serverIds = lines.map((line) => line.trim().split(':')[0]);
      const sorted = [...serverIds].sort((a, b) => a.localeCompare(b));
      expect(serverIds).toEqual(sorted);
    });

    it('remains usable when navigationTools is false', async () => {
      const config = context.services.config as unknown as {
        getLspConfig: () => unknown;
        getLspServiceClient: () => unknown;
      };
      const client = {
        isAlive: vi.fn().mockReturnValue(true),
        status: vi.fn().mockResolvedValue([]),
      };
      config.getLspConfig = vi.fn().mockReturnValue({
        navigationTools: false,
        servers: [],
      });
      config.getLspServiceClient = vi.fn().mockReturnValue(client);

      const result = await statusCommand.action!(context, '');
      expect((result as MessageActionReturn).content).toContain(
        'LSP server status:',
      );
    });
  });
});
