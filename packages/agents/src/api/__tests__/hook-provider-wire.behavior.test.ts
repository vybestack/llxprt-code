/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  fromConfig,
  toConfigParameters,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { escapeShellArg } from '@vybestack/llxprt-code-core/utils/shell-utils.js';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { createSessionSettingsFixture } from './helpers/session-settings-fixture.js';

const wireSchema = z
  .object({
    model: z.string(),
    messages: z.array(
      z
        .object({
          role: z.string(),
          content: z
            .union([
              z.string(),
              z.array(
                z
                  .object({ type: z.string(), text: z.string().optional() })
                  .passthrough(),
              ),
            ])
            .nullable(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const hookInputSchema = z.object({
  session_id: z.string(),
  cwd: z.string(),
  hook_event_name: z.literal('BeforeModel'),
  llm_request: z
    .object({
      version: z.literal(2),
      model: z.string(),
      contents: z.array(
        z
          .object({
            speaker: z.string(),
            blocks: z.array(
              z
                .object({ type: z.string(), text: z.string().optional() })
                .passthrough(),
            ),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
});

describe('public Agent physical model hooks', () => {
  it('sends the subprocess-modified contents to the actual localhost provider request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hook-provider-wire-'));
    const script = join(directory, 'before-model.ts');
    const inputPath = join(directory, 'input.json');
    await writeFile(
      script,
      `import { writeFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
writeFileSync(${JSON.stringify(inputPath)}, JSON.stringify(input));
console.log(JSON.stringify({ hookSpecificOutput: { llm_request: { contents: [...input.llm_request.contents, { speaker: 'human', blocks: [{ type: 'text', text: input.session_id + ':physical instruction' }] }] } } }));
`,
    );
    const requests: Array<z.infer<typeof wireSchema>> = [];
    const errors: unknown[] = [];
    const handlers: Array<Promise<void>> = [];
    const server = createServer((request, response) => {
      const work = (async (): Promise<void> => {
        const buffers: Buffer[] = [];
        for await (const part of request) buffers.push(Buffer.from(part));
        requests.push(
          wireSchema.parse(JSON.parse(Buffer.concat(buffers).toString('utf8'))),
        );
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.end(
          `data: ${JSON.stringify({ id: 'hook-wire', object: 'chat.completion.chunk', model: 'wire-model', choices: [{ index: 0, delta: { content: 'observed local response' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      })().catch((error: unknown) => {
        errors.push(error);
        response.destroy(error instanceof Error ? error : undefined);
      });
      handlers.push(work);
    });
    let config: Config | undefined;
    let mcp: McpRuntimeOwner | undefined;
    let agent: Agent | undefined;
    const failures: unknown[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing local provider port');
      const baseUrl = `http://127.0.0.1:${address.port}/v1`;
      config = new Config({
        ...toConfigParameters({
          provider: 'openai',
          model: 'wire-model',
          workingDir: directory,
          folderTrust: true,
          interactive: true,
          recording: { enabled: false },
          telemetry: { enabled: false },
        }),
        sessionId: 'same-label',
        enableHooks: true,
        hooks: {
          [HookEventName.BeforeModel]: [
            {
              hooks: [
                {
                  type: HookType.Command,
                  command: `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`,
                },
              ],
            },
          ],
        },
      });
      mcp = await McpRuntimeOwner.create(createTestOAuthBinding(), config);
      agent = await fromConfig({
        ...createSessionSettingsFixture(config),
        config,
        mcpRuntime: mcp,
        mcpOwnership: 'caller',
        activation: {
          provider: 'openai',
          model: 'wire-model',
          cliOverrides: { key: 'local-test-key', baseUrl },
        },
      });
      const runtimeId = agent.getRuntimeId();
      const text: string[] = [];
      for await (const event of agent.stream('initial caller input')) {
        if (event.type === 'text') text.push(event.text);
        if (event.type === 'error') throw new Error(event.error.message);
      }
      const input = hookInputSchema.parse(
        JSON.parse(await readFile(inputPath, 'utf8')),
      );
      const messages = requests
        .flatMap((request) => request.messages)
        .map((message) =>
          typeof message.content === 'string'
            ? message.content
            : (message.content?.map((part) => part.text ?? '').join('') ?? ''),
        );
      expect({
        model: requests.map((request) => request.model),
        inputModel: input.llm_request.model,
        version: input.llm_request.version,
        identity: input.session_id,
        cwd: input.cwd,
        originalPresent: input.llm_request.contents.some((content) =>
          content.blocks.some((block) => block.text === 'initial caller input'),
        ),
        providerInstruction: messages.some((message) =>
          message.includes(`${runtimeId}:physical instruction`),
        ),
        response: text.join(''),
        errors,
      }).toStrictEqual({
        model: ['wire-model'],
        inputModel: 'wire-model',
        version: 2,
        identity: agent.getRuntimeId(),
        cwd: directory,
        originalPresent: true,
        providerInstruction: true,
        response: 'observed local response',
        errors: [],
      });
    } catch (error) {
      failures.push(error);
    } finally {
      const retired = await Promise.allSettled([agent?.dispose()]);
      const resources = await Promise.allSettled([
        mcp?.dispose(),
        config?.dispose(),
      ]);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.all(handlers);
      await rm(directory, { recursive: true, force: true });
      failures.push(
        ...[...retired, ...resources].flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      );
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Public hook fixture cleanup failed');
  });
});
