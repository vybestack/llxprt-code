/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  requestHookConsent,
  computeHookConsentDelta,
  requestConsentNonInteractive,
  requestConsentInteractive,
  maybeRequestConsentOrFail,
  INSTALL_WARNING_MESSAGE,
  SKILLS_WARNING_MESSAGE,
} from './consent.js';
import { escapeAnsiCtrlCodes } from '../../ui/utils/textUtils.js';
import type { ConfirmationRequest } from '../../ui/types.js';
import type { ExtensionConfig } from '../extension.js';
import { debugLogger, type SkillDefinition } from '@vybestack/llxprt-code-core';

const mockReadline = vi.hoisted(() => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn(),
    close: vi.fn(),
  }),
}));

const mockReaddir = vi.hoisted(() => vi.fn());
const originalReaddir = vi.hoisted(() => ({
  current: null as typeof fs.readdir | null,
}));

vi.mock('node:readline', () => ({
  default: mockReadline,
  createInterface: mockReadline.createInterface,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  originalReaddir.current = actual.readdir;
  return {
    ...actual,
    readdir: mockReaddir,
  };
});

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    debugLogger: {
      log: vi.fn(),
    },
  };
});

describe('consent', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    if (originalReaddir.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockReaddir.mockImplementation(originalReaddir.current as any);
    }
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'consent-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('requestHookConsent', () => {
    it('should return true if no hooks to register', async () => {
      const result = await requestHookConsent('test-extension', []);
      expect(result).toBe(true);
    });
  });

  describe('consent rendering safety', () => {
    it('should escape control characters in hook names', () => {
      const maliciousHookName = 'hook\u001b[12D\u001b[Kname';
      const escaped = escapeAnsiCtrlCodes(maliciousHookName);

      expect(escaped).not.toContain('\u001b');
      expect(escaped).toContain('\\u001b');
    });

    it('should handle multiple control characters', () => {
      const hookName = 'hook\u001b[31m\u001b[1mbad\u001b[0m';
      const escaped = escapeAnsiCtrlCodes(hookName);

      expect(escaped).not.toContain('\u001b');
      expect(escaped).toContain('\\u001b[');
    });

    it('should preserve normal text', () => {
      const normalHookName = 'pre-commit';
      const escaped = escapeAnsiCtrlCodes(normalHookName);

      expect(escaped).toBe(normalHookName);
    });

    it('should handle empty strings', () => {
      const escaped = escapeAnsiCtrlCodes('');
      expect(escaped).toBe('');
    });

    it('should handle unicode hook names', () => {
      const unicodeHookName = 'pre-commit-';
      const escaped = escapeAnsiCtrlCodes(unicodeHookName);

      expect(escaped).toBe(unicodeHookName);
    });
  });

  describe('update delta policy', () => {
    it('should detect new hook names as requiring consent', () => {
      const previousHooks = {
        'pre-commit': { command: 'lint' },
      };
      const currentHooks = {
        'pre-commit': { command: 'lint' },
        'post-install': { command: 'setup' },
      };

      const delta = computeHookConsentDelta(currentHooks, previousHooks);

      expect(delta.newHooks).toStrictEqual(['post-install']);
      expect(delta.changedHooks).toStrictEqual([]);
    });

    it('should not require consent for unchanged hooks', () => {
      const previousHooks = {
        'pre-commit': { command: 'lint' },
      };
      const currentHooks = {
        'pre-commit': { command: 'lint' },
      };

      const delta = computeHookConsentDelta(currentHooks, previousHooks);

      expect(delta.newHooks).toStrictEqual([]);
      expect(delta.changedHooks).toStrictEqual([]);
    });

    it('should not require consent for removed hooks', () => {
      const previousHooks = {
        'pre-commit': { command: 'lint' },
        'post-install': { command: 'setup' },
      };
      const currentHooks = {
        'pre-commit': { command: 'lint' },
      };

      const delta = computeHookConsentDelta(currentHooks, previousHooks);

      expect(delta.newHooks).toStrictEqual([]);
      expect(delta.changedHooks).toStrictEqual([]);
    });

    it('should require consent for changed hook definitions', () => {
      const previousHooks = {
        'pre-commit': { command: 'lint' },
      };
      const currentHooks = {
        'pre-commit': { command: 'lint --fix' },
      };

      const delta = computeHookConsentDelta(currentHooks, previousHooks);

      expect(delta.newHooks).toStrictEqual([]);
      expect(delta.changedHooks).toStrictEqual(['pre-commit']);
    });

    it('should use sorted JSON comparison for hook definitions', () => {
      const previousHooks = {
        'pre-commit': { command: 'lint', args: ['--strict'] },
      };
      const currentHooks = {
        'pre-commit': { args: ['--strict'], command: 'lint' },
      };

      const delta = computeHookConsentDelta(currentHooks, previousHooks);

      expect(delta.newHooks).toStrictEqual([]);
      expect(delta.changedHooks).toStrictEqual([]);
    });

    it('should treat case-sensitive hook names as distinct', () => {
      const previousHooks = {
        'Pre-Commit': { command: 'lint' },
      };
      const currentHooks = {
        'Pre-Commit': { command: 'lint' },
        'pre-commit': { command: 'lint' },
      };

      const delta = computeHookConsentDelta(currentHooks, previousHooks);

      expect(delta.newHooks).toStrictEqual(['pre-commit']);
      expect(delta.changedHooks).toStrictEqual([]);
    });

    it('should handle undefined previous hooks', () => {
      const currentHooks = {
        'pre-commit': { command: 'lint' },
      };

      const delta = computeHookConsentDelta(currentHooks, undefined);

      expect(delta.newHooks).toStrictEqual(['pre-commit']);
      expect(delta.changedHooks).toStrictEqual([]);
    });

    it('should handle undefined current hooks', () => {
      const previousHooks = {
        'pre-commit': { command: 'lint' },
      };

      const delta = computeHookConsentDelta(undefined, previousHooks);

      expect(delta.newHooks).toStrictEqual([]);
      expect(delta.changedHooks).toStrictEqual([]);
    });
  });

  describe('non-interactive context', () => {
    it('should refuse installation with new hooks in non-interactive context', async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
      });

      try {
        await expect(
          requestHookConsent('test-extension', ['pre-commit']),
        ).rejects.toThrow(/non-interactive/);
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });

    it('should allow installation with no hooks in non-interactive context', async () => {
      const originalIsTTY = process.stdin.isTTY;
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
      });

      try {
        const result = await requestHookConsent('test-extension', []);
        expect(result).toBe(true);
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', {
          value: originalIsTTY,
          configurable: true,
        });
      }
    });
  });

  describe('requestConsentNonInteractive', () => {
    it.each([
      { input: 'y', expected: true },
      { input: 'Y', expected: true },
      { input: '', expected: true },
      { input: 'n', expected: false },
      { input: 'N', expected: false },
      { input: 'yes', expected: false },
    ])(
      'should return $expected for input "$input"',
      async ({ input, expected }) => {
        const questionMock = vi.fn().mockImplementation((_, callback) => {
          callback(input);
        });
        mockReadline.createInterface.mockReturnValue({
          question: questionMock,
          close: vi.fn(),
        });

        const consent = await requestConsentNonInteractive('Test consent');
        expect(debugLogger.log).toHaveBeenCalledWith('Test consent');
        expect(questionMock).toHaveBeenCalledWith(
          'Do you want to continue? [Y/n]: ',
          expect.any(Function),
        );
        expect(consent).toBe(expected);
      },
    );
  });

  describe('requestConsentInteractive', () => {
    it.each([
      { confirmed: true, expected: true },
      { confirmed: false, expected: false },
    ])(
      'should resolve with $expected when user confirms with $confirmed',
      async ({ confirmed, expected }) => {
        const addExtensionUpdateConfirmationRequest = vi
          .fn()
          .mockImplementation((request: ConfirmationRequest) => {
            request.onConfirm(confirmed);
          });

        const consent = await requestConsentInteractive(
          'Test consent',
          addExtensionUpdateConfirmationRequest,
        );

        expect(addExtensionUpdateConfirmationRequest).toHaveBeenCalledWith({
          prompt: 'Test consent\n\nDo you want to continue?',
          onConfirm: expect.any(Function),
        });
        expect(consent).toBe(expected);
      },
    );
  });

  describe('maybeRequestConsentOrFail', () => {
    const baseConfig: ExtensionConfig = {
      name: 'test-ext',
      version: '1.0.0',
    };

    it('should request consent if there is no previous config', async () => {
      const requestConsent = vi.fn().mockResolvedValue(true);
      await maybeRequestConsentOrFail(
        baseConfig,
        requestConsent,
        false,
        undefined,
      );
      expect(requestConsent).toHaveBeenCalledTimes(1);
    });

    it('should request consent if contextFileName changes', async () => {
      const prevConfig: ExtensionConfig = { ...baseConfig };
      const newConfig: ExtensionConfig = {
        ...baseConfig,
        contextFileName: 'new-context.md',
      };
      const requestConsent = vi.fn().mockResolvedValue(true);
      await maybeRequestConsentOrFail(
        newConfig,
        requestConsent,
        false,
        prevConfig,
        false,
      );
      expect(requestConsent).toHaveBeenCalledTimes(1);
    });

    it('should request consent if excludeTools changes', async () => {
      const prevConfig: ExtensionConfig = { ...baseConfig };
      const newConfig: ExtensionConfig = {
        ...baseConfig,
        excludeTools: ['new-tool'],
      };
      const requestConsent = vi.fn().mockResolvedValue(true);
      await maybeRequestConsentOrFail(
        newConfig,
        requestConsent,
        false,
        prevConfig,
        false,
      );
      expect(requestConsent).toHaveBeenCalledTimes(1);
    });

    it('should include warning when hooks are present', async () => {
      const requestConsent = vi.fn().mockResolvedValue(true);
      await maybeRequestConsentOrFail(
        baseConfig,
        requestConsent,
        true,
        undefined,
      );

      expect(requestConsent).toHaveBeenCalledWith(
        expect.stringContaining(
          'This extension contains Hooks which can automatically execute commands.',
        ),
      );
    });

    it('should request consent if hooks status changes', async () => {
      const requestConsent = vi.fn().mockResolvedValue(true);
      await maybeRequestConsentOrFail(
        baseConfig,
        requestConsent,
        true,
        baseConfig,
        false,
      );
      expect(requestConsent).toHaveBeenCalledTimes(1);
    });

    it('should request consent if skills change', async () => {
      const skill1Dir = path.join(tempDir, 'skill1');
      const skill2Dir = path.join(tempDir, 'skill2');
      await fs.mkdir(skill1Dir, { recursive: true });
      await fs.mkdir(skill2Dir, { recursive: true });
      await fs.writeFile(path.join(skill1Dir, 'SKILL.md'), 'body1');
      await fs.writeFile(path.join(skill1Dir, 'extra.txt'), 'extra');
      await fs.writeFile(path.join(skill2Dir, 'SKILL.md'), 'body2');

      const skill1: SkillDefinition = {
        name: 'skill1',
        description: 'desc1',
        location: path.join(skill1Dir, 'SKILL.md'),
        body: 'body1',
      };
      const skill2: SkillDefinition = {
        name: 'skill2',
        description: 'desc2',
        location: path.join(skill2Dir, 'SKILL.md'),
        body: 'body2',
      };

      const config: ExtensionConfig = {
        ...baseConfig,
        mcpServers: {
          server1: { command: 'npm', args: ['start'] },
          server2: { httpUrl: 'https://remote.com' },
        },
        contextFileName: 'my-context.md',
        excludeTools: ['tool1', 'tool2'],
      };
      const requestConsent = vi.fn().mockResolvedValue(true);
      await maybeRequestConsentOrFail(
        config,
        requestConsent,
        false,
        undefined,
        false,
        [skill1, skill2],
      );

      const expectedConsentString = [
        'Installing extension "test-ext".',
        INSTALL_WARNING_MESSAGE,
        'This extension will run the following MCP servers:',
        '  * server1 (local): npm start',
        '  * server2 (remote): https://remote.com',
        'This extension will append info to your LLXPRT.md context using my-context.md',
        'This extension will exclude the following core tools: tool1,tool2',
        '',
        chalk.bold('Skills:'),
        SKILLS_WARNING_MESSAGE,
        'This extension will install the following skills:',
        `  * ${chalk.bold('skill1')}: desc1`,
        `    (Location: ${skill1.location}) (2 items in directory)`,
        '',
        `  * ${chalk.bold('skill2')}: desc2`,
        `    (Location: ${skill2.location}) (1 items in directory)`,
        '',
      ].join('\n');

      expect(requestConsent).toHaveBeenCalledWith(expectedConsentString);
    });

    it('should show a warning if the skill directory cannot be read', async () => {
      const lockedDir = path.join(tempDir, 'locked');
      await fs.mkdir(lockedDir, { recursive: true });

      const skill: SkillDefinition = {
        name: 'locked-skill',
        description: 'A skill in a locked dir',
        location: path.join(lockedDir, 'SKILL.md'),
        body: 'body',
      };

      // Mock readdir to simulate a permission error.
      mockReaddir.mockRejectedValueOnce(
        new Error('EACCES: permission denied, scandir'),
      );

      const requestConsent = vi.fn().mockResolvedValue(true);
      await maybeRequestConsentOrFail(
        baseConfig,
        requestConsent,
        false,
        undefined,
        false,
        [skill],
      );

      expect(requestConsent).toHaveBeenCalledWith(
        expect.stringContaining(
          `    (Location: ${skill.location}) ${chalk.red('(Could not count items in directory)')}`,
        ),
      );
    });
  });
});
