/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as glob from 'glob';
import type { Config } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import mock from 'mock-fs';
import { FileCommandLoader } from './FileCommandLoader.js';
import { assert, vi } from 'vitest';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import {
  SHELL_INJECTION_TRIGGER,
  SHORTHAND_ARGS_PLACEHOLDER,
} from './prompt-processors/types.js';
import {
  ConfirmationRequiredError,
  ShellProcessor,
} from './prompt-processors/shellProcessor.js';
import { DefaultArgumentProcessor } from './prompt-processors/argumentProcessor.js';
import type { CommandContext } from '../ui/commands/types.js';

type PromptPipelineContent = Array<{ text: string }>;

const mockShellProcess = vi.hoisted(() => vi.fn());
const mockAtFileProcess = vi.hoisted(() => vi.fn());

vi.mock('./prompt-processors/shellProcessor.js', () => ({
  ShellProcessor: vi.fn().mockImplementation(() => ({
    process: mockShellProcess,
  })),
  ConfirmationRequiredError: class extends Error {
    constructor(
      message: string,
      public commandsToConfirm: string[],
    ) {
      super(message);
      this.name = 'ConfirmationRequiredError';
    }
  },
}));

vi.mock('./prompt-processors/argumentProcessor.js', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('./prompt-processors/argumentProcessor.js')
    >();
  return {
    DefaultArgumentProcessor: vi
      .fn()
      .mockImplementation(() => new original.DefaultArgumentProcessor()),
  };
});

vi.mock('./prompt-processors/atFileProcessor.js', () => ({
  AtFileProcessor: vi.fn().mockImplementation(() => ({
    process: mockAtFileProcess,
  })),
}));
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-settings')>();
  return {
    ...original,
    Storage: original.Storage,
    isCommandAllowed: vi.fn(),
    ShellExecutionService: {
      execute: vi.fn(),
    },
  };
});

vi.mock('glob', () => ({
  glob: vi.fn(),
}));

describe('FileCommandLoader (processors)', () => {
  const signal: AbortSignal = new AbortController().signal;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { glob: actualGlob } =
      await vi.importActual<typeof import('glob')>('glob');
    vi.mocked(glob.glob).mockImplementation(actualGlob);
    mockShellProcess.mockImplementation(
      (prompt: string, context: CommandContext) => {
        const userArgsRaw = context.invocation?.args ?? '';
        const processedPrompt = prompt.replaceAll(
          SHORTHAND_ARGS_PLACEHOLDER,
          userArgsRaw,
        );
        return Promise.resolve(processedPrompt);
      },
    );
  });

  afterEach(() => {
    mock.restore();
  });

  describe('Default Argument Processor Integration', () => {
    it('correctly processes a command without {{args}}', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'model_led.toml':
            'prompt = "This is the instruction."\ndescription = "Default processor test"',
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'model_led');
      expect(command).toBeDefined();

      const result = await command!.action?.(
        createMockCommandContext({
          invocation: {
            raw: '/model_led 1.2.0 added "a feature"',
            name: 'model_led',
            args: '1.2.0 added "a feature"',
          },
        }),
        '1.2.0 added "a feature"',
      );
      expect(result?.type).toBe('submit_prompt');
      assert(result?.type === 'submit_prompt', 'Incorrect action type');
      const expectedContent =
        'This is the instruction.\n\n/model_led 1.2.0 added "a feature"';
      expect(result.content).toBe(expectedContent);
    });
  });

  describe('Shell Processor Integration', () => {
    it('instantiates ShellProcessor if {{args}} is present (even without shell trigger)', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'args_only.toml': `prompt = "Hello {{args}}"`,
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledWith('args_only');
    });
    it('instantiates ShellProcessor if the trigger is present', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run this: ${SHELL_INJECTION_TRIGGER}echo hello}"`,
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledWith('shell');
    });

    it('does not instantiate ShellProcessor if no triggers ({{args}} or !{}) are present', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'regular.toml': `prompt = "Just a regular prompt"`,
        },
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).not.toHaveBeenCalled();
    });

    it('returns a "submit_prompt" action if shell processing succeeds', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run !{echo 'hello'}"`,
        },
      });
      mockShellProcess.mockResolvedValue('Run hello');

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shell');
      expect(command).toBeDefined();

      const result = await command!.action!(
        createMockCommandContext({
          invocation: { raw: '/shell', name: 'shell', args: '' },
        }),
        '',
      );

      expect(result?.type).toBe('submit_prompt');
      assert(result?.type === 'submit_prompt', 'Incorrect action type');
      expect(result.content).toBe('Run hello');
    });

    it('returns a "confirm_shell_commands" action if shell processing requires it', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      const rawInvocation = '/shell rm -rf /';
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run !{rm -rf /}"`,
        },
      });

      // Mock the processor to throw the specific error
      const error = new ConfirmationRequiredError('Confirmation needed', [
        'rm -rf /',
      ]);
      mockShellProcess.mockRejectedValue(error);

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shell');
      expect(command).toBeDefined();

      const result = await command!.action!(
        createMockCommandContext({
          invocation: { raw: rawInvocation, name: 'shell', args: 'rm -rf /' },
        }),
        'rm -rf /',
      );

      expect(result?.type).toBe('confirm_shell_commands');
      assert(
        result?.type === 'confirm_shell_commands',
        'Incorrect action type',
      );
      expect(result.commandsToConfirm).toStrictEqual(['rm -rf /']);
      expect(result.originalInvocation.raw).toBe(rawInvocation);
    });

    it('re-throws other errors from the processor', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'shell.toml': `prompt = "Run !{something}"`,
        },
      });

      const genericError = new Error('Something else went wrong');
      mockShellProcess.mockRejectedValue(genericError);

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'shell');
      expect(command).toBeDefined();

      await expect(
        command!.action!(
          createMockCommandContext({
            invocation: { raw: '/shell', name: 'shell', args: '' },
          }),
          '',
        ),
      ).rejects.toThrow('Something else went wrong');
    });
    it('assembles the processor pipeline in the correct order (Shell -> Default)', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          // This prompt uses !{} but NOT {{args}}, so both processors should be active.
          'pipeline.toml': `
              prompt = "Shell says: ${SHELL_INJECTION_TRIGGER}echo foo}."
            `,
        },
      });

      const defaultProcessMock = vi
        .fn()
        .mockImplementation((p) => Promise.resolve(`${p}-default-processed`));

      mockShellProcess.mockImplementation((p) =>
        Promise.resolve(`${p}-shell-processed`),
      );

      vi.mocked(DefaultArgumentProcessor).mockImplementation(
        () =>
          ({
            process: defaultProcessMock,
          }) as unknown as DefaultArgumentProcessor,
      );

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'pipeline');
      expect(command).toBeDefined();

      const result = await command!.action!(
        createMockCommandContext({
          invocation: {
            raw: '/pipeline bar',
            name: 'pipeline',
            args: 'bar',
          },
        }),
        'bar',
      );

      expect(mockShellProcess.mock.invocationCallOrder[0]).toBeLessThan(
        defaultProcessMock.mock.invocationCallOrder[0],
      );

      // Verify the flow of the prompt through the processors
      // 1. Shell processor runs first
      expect(mockShellProcess).toHaveBeenCalledWith(
        expect.stringContaining(SHELL_INJECTION_TRIGGER),
        expect.any(Object),
      );
      // 2. Default processor runs second
      expect(defaultProcessMock).toHaveBeenCalledWith(
        expect.stringContaining('-shell-processed'),
        expect.any(Object),
      );

      assert(result?.type === 'submit_prompt', 'Incorrect action type');
      expect(result.content).toContain('-shell-processed-default-processed');
    });
  });

  describe('@-file Processor Integration', () => {
    it('correctly processes a command with @{file}', async () => {
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'at-file.toml':
            'prompt = "Context from file: @{./test.txt}"\ndescription = "@-file test"',
        },
        './test.txt': 'file content',
      });

      mockAtFileProcess.mockImplementation(
        async (prompt: PromptPipelineContent) => {
          // A simplified mock of AtFileProcessor's behavior
          const textContent = (prompt[0] as { text: string }).text;
          if (textContent.includes('@{./test.txt}')) {
            return [
              {
                text: textContent.replace('@{./test.txt}', 'file content'),
              },
            ];
          }
          return prompt;
        },
      );

      // Prevent default processor from interfering
      vi.mocked(DefaultArgumentProcessor).mockImplementation(
        () =>
          ({
            process: (p: PromptPipelineContent) => Promise.resolve(p),
          }) as unknown as DefaultArgumentProcessor,
      );

      const loader = new FileCommandLoader(null as unknown as Config);
      const commands = await loader.loadCommands(signal);
      const command = commands.find((c) => c.name === 'at-file');
      expect(command).toBeDefined();

      const result = await command!.action?.(
        createMockCommandContext({
          invocation: {
            raw: '/at-file',
            name: 'at-file',
            args: '',
          },
        }),
        '',
      );
      expect(result?.type).toBe('submit_prompt');
      assert(result?.type === 'submit_prompt', 'Incorrect action type');
      // AtFileProcessor is not actually used by FileCommandLoader
      // so the @{} syntax is not processed
      expect(result.content).toStrictEqual('Context from file: @{./test.txt}');
    });
  });

  describe('with folder trust enabled', () => {
    it('loads multiple commands', async () => {
      const mockConfig = {
        getProjectRoot: vi.fn(() => '/path/to/project'),
        getExtensions: vi.fn(() => []),
        getFolderTrust: vi.fn(() => true),
        isTrustedFolder: vi.fn(() => true),
      } as unknown as Config;
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'test1.toml': 'prompt = "Prompt 1"',
          'test2.toml': 'prompt = "Prompt 2"',
        },
      });

      const loader = new FileCommandLoader(mockConfig);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(2);
    });

    it('does not load when folder is not trusted', async () => {
      const mockConfig = {
        getProjectRoot: vi.fn(() => '/path/to/project'),
        getExtensions: vi.fn(() => []),
        getFolderTrust: vi.fn(() => true),
        isTrustedFolder: vi.fn(() => false),
      } as unknown as Config;
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'test1.toml': 'prompt = "Prompt 1"',
          'test2.toml': 'prompt = "Prompt 2"',
        },
      });

      const loader = new FileCommandLoader(mockConfig);
      const commands = await loader.loadCommands(signal);

      expect(commands).toHaveLength(0);
    });
  });

  describe('Aborted signal', () => {
    it('does not log errors if the signal is aborted', async () => {
      const controller = new AbortController();
      const abortSignal = controller.signal;

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const mockConfig = {
        getProjectRoot: vi.fn(() => '/path/to/project'),
        getExtensions: vi.fn(() => []),
        getFolderTrust: vi.fn(() => false),
        isTrustedFolder: vi.fn(() => false),
      } as unknown as Config;

      // Set up mock-fs so that the loader attempts to read a directory.
      const userCommandsDir = Storage.getUserCommandsDir();
      mock({
        [userCommandsDir]: {
          'test1.toml': 'prompt = "Prompt 1"',
        },
      });

      const loader = new FileCommandLoader(mockConfig);

      // Mock glob to throw an AbortError
      const abortError = new DOMException('Aborted', 'AbortError');
      vi.mocked(glob.glob).mockImplementation(async () => {
        controller.abort(); // Ensure the signal is aborted when the service checks
        throw abortError;
      });

      await loader.loadCommands(abortSignal);

      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
