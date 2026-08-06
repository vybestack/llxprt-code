/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as glob from 'glob';
import type { Config } from '@vybestack/llxprt-code-core';
import { FileCommandLoader } from './FileCommandLoader.js';
import { vi, type Mock } from 'bun:test';

const realMockFsModule = { ...(await import('./__testhelpers__/mockFs.js')) };
const realGlobModule = { ...(await import('glob')) };

function assert(condition: unknown, message: string): asserts condition {
  if (condition === undefined || condition === null || condition === false) {
    throw new Error(message);
  }
}
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

const RealDefaultArgumentProcessor = DefaultArgumentProcessor;
const mockShellProcess = vi.fn();
const mockAtFileProcess = vi.fn();

// The settings mock must be available before vi.mock runs (Bun evaluates the
// factory eagerly at vi.mock() call time). Use vi.hoisted with createRequire
// to create the FsMockContext and settingsMock first, then reference them in
// the mock factory.
const settingsMockHoisted: {
  ctx?: InstanceType<
    typeof import('./__testhelpers__/mockFs.js').FsMockContext
  >;
} = {};

vi.mock('@vybestack/llxprt-code-settings', () => {
  // Resolved with vi.importActual inside the factory: it returns the genuine
  // module on both runners, and the factory is the earliest point at which the
  // helper can be loaded on Vitest (which hoists this call above the imports).
  const { FsMockContext } = realMockFsModule;
  const ctx = new FsMockContext();
  settingsMockHoisted.ctx = ctx;
  return ctx.settingsMock();
});

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

// Capture the real constructor before Bun patches the live module namespace.
// Constructor calls stay observable while processor behavior remains real.
vi.mock('./prompt-processors/argumentProcessor.js', () => ({
  DefaultArgumentProcessor: vi
    .fn()
    .mockImplementation(() => new RealDefaultArgumentProcessor()),
}));

vi.mock('glob', () => ({
  glob: vi.fn(),
}));

/**
 * The settings mock factory constructs the filesystem context; reading it
 * through a getter keeps the access after that factory has run on both
 * runners.
 */
function getFsMock(): InstanceType<
  typeof import('./__testhelpers__/mockFs.js').FsMockContext
> {
  assert(
    settingsMockHoisted.ctx,
    'settings mock factory has not initialised the filesystem context',
  );
  return settingsMockHoisted.ctx;
}

describe('FileCommandLoader (processors)', () => {
  const signal: AbortSignal = new AbortController().signal;

  beforeEach(async () => {
    vi.clearAllMocks();
    const fsMock = getFsMock();
    fsMock.clear();
    // Re-establish the real glob implementation. vi.importActual returns the
    // real module snapshot captured at mock-registration time, but
    // vi.clearAllMocks() resets the mock function's implementation, so we
    // restore it here.
    const actualGlob = realGlobModule.glob;
    (glob.glob as unknown as Mock<typeof glob.glob>).mockImplementation(
      actualGlob,
    );
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
    getFsMock().restore();
  });

  afterAll(() => {
    getFsMock().cleanup();
  });

  describe('Default Argument Processor Integration', () => {
    it('correctly processes a command without {{args}}', async () => {
      getFsMock().mock({
        'model_led.toml':
          'prompt = "This is the instruction."\ndescription = "Default processor test"',
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
      getFsMock().mock({
        'args_only.toml': `prompt = "Hello {{args}}"`,
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledWith('args_only');
    });
    it('instantiates ShellProcessor if the trigger is present', async () => {
      getFsMock().mock({
        'shell.toml': `prompt = "Run this: ${SHELL_INJECTION_TRIGGER}echo hello}"`,
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).toHaveBeenCalledWith('shell');
    });

    it('does not instantiate ShellProcessor if no triggers ({{args}} or !{}) are present', async () => {
      getFsMock().mock({
        'regular.toml': `prompt = "Just a regular prompt"`,
      });

      const loader = new FileCommandLoader(null as unknown as Config);
      await loader.loadCommands(signal);

      expect(ShellProcessor).not.toHaveBeenCalled();
    });

    it('returns a "submit_prompt" action if shell processing succeeds', async () => {
      getFsMock().mock({
        'shell.toml': `prompt = "Run !{echo 'hello'}"`,
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
      const rawInvocation = '/shell rm -rf /';
      getFsMock().mock({
        'shell.toml': `prompt = "Run !{rm -rf /}"`,
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
      getFsMock().mock({
        'shell.toml': `prompt = "Run !{something}"`,
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
      getFsMock().mock({
        // This prompt uses !{} but NOT {{args}}, so both processors should be active.
        'pipeline.toml': `
              prompt = "Shell says: ${SHELL_INJECTION_TRIGGER}echo foo}."
            `,
      });

      const defaultProcessMock = vi
        .fn()
        .mockImplementation((p) => Promise.resolve(`${p}-default-processed`));

      mockShellProcess.mockImplementation((p) =>
        Promise.resolve(`${p}-shell-processed`),
      );

      (
        DefaultArgumentProcessor as unknown as Mock<
          (...args: never[]) => unknown
        >
      ).mockImplementation(
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
      getFsMock().mock({
        'at-file.toml':
          'prompt = "Context from file: @{./test.txt}"\ndescription = "@-file test"',
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
      (
        DefaultArgumentProcessor as unknown as Mock<
          (...args: never[]) => unknown
        >
      ).mockImplementation(
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
      getFsMock().mock({
        'test1.toml': 'prompt = "Prompt 1"',
        'test2.toml': 'prompt = "Prompt 2"',
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
      getFsMock().mock({
        'test1.toml': 'prompt = "Prompt 1"',
        'test2.toml': 'prompt = "Prompt 2"',
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
      getFsMock().mock({
        'test1.toml': 'prompt = "Prompt 1"',
      });

      const loader = new FileCommandLoader(mockConfig);

      // Mock glob to throw an AbortError
      const abortError = new DOMException('Aborted', 'AbortError');
      (glob.glob as unknown as Mock<typeof glob.glob>).mockImplementation(
        // The throwing impl is a subset of glob's overloaded+namespaced type.
        (async () => {
          controller.abort(); // Ensure the signal is aborted when the service checks
          throw abortError;
        }) as unknown as typeof glob.glob,
      );

      await loader.loadCommands(abortSignal);

      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
