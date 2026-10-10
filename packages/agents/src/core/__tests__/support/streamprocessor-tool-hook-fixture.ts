/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core/utils/shell-utils.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

export const toolHookMode = z.enum([
  'none',
  'restrict',
  'absent',
  'disabled',
  'error',
  'malformed-mode',
  'malformed-names',
  'malformed-specific',
  'unsupported-replacement',
  'noop',
]);
export type ToolHookMode = z.infer<typeof toolHookMode>;
export const toolHookTools = [
  {
    name: 'weather',
    description: 'Get weather',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
  {
    name: 'calendar',
    description: 'Get calendar',
    parametersJsonSchema: { type: 'object', properties: {} },
  },
];
const estimateSchema = z
  .object({ estimatedPromptTokens: z.number() })
  .passthrough();
const resultSchema = z.object({
  error: z.string().optional(),
  output: z.string(),
  restrictions: z.array(
    z.object({ allowedToolNames: z.array(z.string()) }).nullish(),
  ),
  bodies: z.array(
    z.object({ bytes: z.number(), sha256: z.string(), text: z.string() }),
  ),
  estimate: estimateSchema.nullable(),
  oracle: estimateSchema,
  owners: z.array(z.object({ closed: z.boolean(), count: z.number() })),
  registry: z.array(
    z.object({
      enabled: z.boolean(),
      eventName: z.string(),
      config: z.object({ command: z.string() }),
    }),
  ),
  activeBodies: z.number(),
  hookInput: z.unknown().optional(),
  hookOutput: z.unknown().optional(),
  hookStderr: z.string().optional(),
});
export type ToolHookFacts = z.infer<typeof resultSchema>;

export function registerToolHook(
  config: Config,
  root: string,
  mode: ToolHookMode,
): void {
  if (mode === 'absent') return;
  const actions: Record<ToolHookMode, string> = {
    none: "const output={hookSpecificOutput:{toolChoice:{mode:'none'}}};",
    restrict:
      "const output={hookSpecificOutput:{toolChoice:{mode:'auto',allowedToolNames:input.llm_request.tools.filter(tool=>tool.name.startsWith('weather')).map(tool=>tool.name)}}};",
    absent: '',
    disabled: "throw new Error('disabled hook must not run');",
    error: "throw new Error('required selection command failed');",
    'malformed-mode':
      "const output={hookSpecificOutput:{toolChoice:{mode:'bogus'}}};",
    'malformed-names':
      "const output={hookSpecificOutput:{toolChoice:{mode:'auto',allowedToolNames:'weather'}}};",
    'malformed-specific': 'const output={hookSpecificOutput:[]};',
    'unsupported-replacement':
      "const output={hookSpecificOutput:{llm_request:{contents:[{speaker:'human',blocks:[{type:'text',text:'replace'}]}]}}};",
    noop: 'const output={};',
  };
  const input = JSON.stringify(join(root, 'hook-input.json'));
  const output = JSON.stringify(join(root, 'hook-output.json'));
  const stderr = JSON.stringify(join(root, 'hook-stderr.txt'));
  const script = `(async()=>{const fs=require('node:fs');try{let data='';for await(const chunk of process.stdin)data+=chunk;const input=JSON.parse(data);fs.writeFileSync(${input},data);${actions[mode]}fs.writeFileSync(${output},JSON.stringify(output));console.log(JSON.stringify(output));}catch(error){const message=String(error);fs.writeFileSync(${stderr},message);console.error(message);process.exitCode=1;}})();`;
  const hooks = config.getHooks();
  if (!hooks) throw new Error('Missing actual fixture hooks');
  hooks[HookEventName.BeforeToolSelection] = [
    {
      hooks: [
        {
          type: HookType.Command,
          name: 'actual-tool-hook',
          command: `exec node -e ${escapeShellArg(script, getShellConfiguration().shell)}`,
        },
      ],
    },
  ];
}

export function observedHook(root: string): Record<string, unknown> {
  const read = (name: string): unknown => {
    const path = join(root, name);
    return existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : undefined;
  };
  const stderr = join(root, 'hook-stderr.txt');
  return {
    hookInput: read('hook-input.json'),
    hookOutput: read('hook-output.json'),
    hookStderr: existsSync(stderr) ? readFileSync(stderr, 'utf8') : undefined,
  };
}

export async function toolHookWorker(
  root: string,
  mode: ToolHookMode,
  source = true,
): Promise<ToolHookFacts> {
  const worker = new URL(
    './streamprocessor-tool-hook-worker.ts',
    import.meta.url,
  );
  const resultPath = join(root, `tool-hook-${mode}-${source}.json`);
  const child = Bun.spawn(
    [process.execPath, worker.pathname, root, mode, String(source), resultPath],
    {
      env: process.env,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  const exit = await child.exited;
  if (exit !== 0) throw new Error(`Actual tool-hook worker exited ${exit}`);
  const result = resultSchema.parse(
    JSON.parse(readFileSync(resultPath, 'utf8')),
  );
  return result;
}
