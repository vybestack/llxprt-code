/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  escapeShellArg,
  getShellConfiguration,
} from '@vybestack/llxprt-code-core/utils/shell-utils.js';

export const modelHookMode = z.enum([
  'noop',
  'edit',
  'replace',
  'empty',
  'boundary',
  'ambiguous',
  'none',
  'stop',
  'block',
  'malformed',
  'bad-row',
  'bad-contents',
  'bad-specific',
  'bad-continue',
  'bad-decision',
  'bad-reason',
  'model',
  'settings',
  'tools',
  'unknown',
  'error',
  'cancel',
  'restrict',
  'denied-tool',
  'retry',
  'large',
  'retaining',
  'request-absent',
  'contents-absent',
  'null-request',
  'null-contents',
  'malformed-request',
  'v1-request',
  'chain-edit-empty',
  'chain-empty-none',
  'chain-edit-noop',
  'chain-edit-absent',
  'chain-empty-noop',
  'chain-edit-null',
  'parallel-edit-empty',
  'parallel-empty-none',
  'after-noop',
  'after-modify',
  'after-stop',
  'after-block',
  'after-error',
  'after-partial',
  'after-multi',
  'after-restrict',
  'after-omit-tools',
  'after-cancel',
]);
export type ModelHookMode = z.infer<typeof modelHookMode>;
export const modelFactsSchema = z.object({
  error: z.string().optional(),
  errorName: z.string().optional(),
  output: z.string(),
  bodies: z.array(
    z.object({
      bytes: z.number(),
      sha256: z.string(),
      text: z.string().optional(),
    }),
  ),
  estimate: z.unknown(),
  oracle: z.unknown(),
  owners: z.array(z.object({ closed: z.boolean(), count: z.number() })),
  activeBodies: z.number(),
  hooks: z.array(z.unknown()),
  logs: z.array(z.string()),
  restrictions: z.array(z.unknown()),
  firstLive: z.number(),
  lastLive: z.number(),
  directories: z.array(z.string()),
  boundary: z
    .object({
      first: z.number(),
      last: z.number(),
      closed: z.number(),
      reads: z.number(),
    })
    .optional(),
  requests: z.array(z.unknown()),
});
export type ModelFacts = z.infer<typeof modelFactsSchema>;

const emptyAction =
  'const output={hookSpecificOutput:{llm_request:{contents:[]}}};';
const newContextAction =
  "const output={hookSpecificOutput:{llm_request:{contents:[{speaker:'human',blocks:[{type:'text',text:'new context'}]}]}}};";
const editAction =
  'input.llm_request.contents.at(-1).blocks[0].text=input.llm_request.contents.at(-1).blocks[0].text.toUpperCase();const output={hookSpecificOutput:{llm_request:input.llm_request}};';
const absentAction = 'const output={hookSpecificOutput:{llm_request:{}}};';
const nullAction = 'const output={hookSpecificOutput:{llm_request:null}};';
const afterModifyAction =
  "const output={hookSpecificOutput:{llm_response:{content:{speaker:'ai',blocks:[{type:'text',text:'modified by hook'}]}}}};";
const actions: Record<ModelHookMode, string | readonly string[]> = {
  noop: 'const output={};',
  edit: 'input.llm_request.contents.at(-1).blocks[0].text=input.llm_request.contents.at(-1).blocks[0].text.toUpperCase();const output={hookSpecificOutput:{llm_request:input.llm_request}};',
  replace:
    'const output={hookSpecificOutput:{llm_request:{contents:input.llm_request.contents.map(row=>({...row,blocks:row.blocks.map(block=>({...block,text:block.text.toUpperCase()}))}))}}};',
  empty: 'const output={hookSpecificOutput:{llm_request:{contents:[]}}};',
  boundary:
    "input.llm_request.contents[0].blocks[0].text+=' edited';const output={hookSpecificOutput:{llm_request:input.llm_request,llm_request_boundary:{pendingMessageStartIndex:input.llm_request.contents.length-1}}};",
  ambiguous:
    'const output={hookSpecificOutput:{llm_request:{contents:[...input.llm_request.contents].reverse()}}};',
  none: "const output={hookSpecificOutput:{llm_request:{contents:[{speaker:'human',blocks:[{type:'text',text:'new context'}]}]}}};",
  stop: "const output={continue:false,stopReason:'required stop'};",
  block: "const output={decision:'deny',reason:'required block'};",
  malformed: "const output='broken JSON';",
  'bad-row':
    "const output={hookSpecificOutput:{llm_request:{contents:[{speaker:'nope',blocks:[]}]}}};",
  'bad-contents':
    'const output={hookSpecificOutput:{llm_request:{contents:false}}};',
  'bad-specific': 'const output={hookSpecificOutput:[]};',
  'bad-continue': "const output={continue:'false'};",
  'bad-decision': "const output={decision:'bogus'};",
  'bad-reason': 'const output={reason:[]};',
  model:
    "const output={hookSpecificOutput:{llm_request:{model:'another-model'}}};",
  settings:
    'const output={hookSpecificOutput:{llm_request:{settings:{temperature:0.3}}}};',
  tools: 'const output={hookSpecificOutput:{llm_request:{tools:[]}}};',
  unknown:
    "const output={hookSpecificOutput:{llm_request:{systemInstruction:'changed'}}};",
  error: "throw new Error('required model command failed');",
  cancel:
    'await new Promise(resolve=>setTimeout(resolve,30000));const output={};',
  restrict:
    'const output={hookSpecificOutput:{llm_request:input.llm_request}};',
  'denied-tool':
    "input.llm_request.tools.push({name:'calendar',parametersJsonSchema:{type:'object',properties:{}}});const output={hookSpecificOutput:{llm_request:input.llm_request}};",
  retry: 'const output={};',
  large: 'const output={};',
  retaining: 'const output={};',
  'request-absent': 'const output={hookSpecificOutput:{}};',
  'contents-absent': absentAction,
  'null-request': nullAction,
  'null-contents':
    'const output={hookSpecificOutput:{llm_request:{contents:null}}};',
  'malformed-request': 'const output={hookSpecificOutput:{llm_request:[]}};',
  'v1-request':
    "const output={hookSpecificOutput:{llm_request:{messages:[{role:'user',content:'different'}]}}};",
  'chain-edit-empty': [editAction, emptyAction],
  'chain-empty-none': [emptyAction, newContextAction],
  'chain-edit-noop': [editAction, 'const output={};'],
  'chain-edit-absent': [editAction, absentAction],
  'chain-empty-noop': [emptyAction, 'const output={};'],
  'chain-edit-null': [editAction, nullAction],
  'parallel-edit-empty': [editAction, emptyAction],
  'parallel-empty-none': [emptyAction, newContextAction],
  'after-noop': 'const output={};',
  'after-modify': afterModifyAction,
  'after-stop': "const output={continue:false,stopReason:'after stop'};",
  'after-block': "const output={decision:'deny',reason:'after block'};",
  'after-error': "throw new Error('after command failed');",
  'after-partial': [
    afterModifyAction,
    "throw new Error('after command failed');",
  ],
  'after-multi': [
    afterModifyAction,
    'const output={};',
    "const output={systemMessage:'after note'};",
  ],
  'after-restrict': afterModifyAction,
  'after-omit-tools': afterModifyAction,
  'after-cancel':
    'await new Promise(resolve=>setTimeout(resolve,30000));const output={};',
};

function modelCommand(root: string, action: string): string {
  const record = JSON.stringify(join(root, 'model-hooks.jsonl'));
  const script = `(async()=>{const fs=require('node:fs');let data='';for await(const chunk of process.stdin)data+=chunk;const input=JSON.parse(data);fs.appendFileSync(${record},JSON.stringify({input})+'\\n');${action}fs.appendFileSync(${record},JSON.stringify({output})+'\\n');console.log(typeof output==='string'?output:JSON.stringify(output));})().catch(error=>{console.error(String(error));process.exitCode=1;});`;
  return `exec node -e ${escapeShellArg(script, getShellConfiguration().shell)}`;
}

export function registerModelHook(
  config: Config,
  root: string,
  mode: ModelHookMode,
): void {
  const selected = actions[mode];
  const commands = typeof selected === 'string' ? [selected] : selected;
  const hooks = config.getHooks();
  if (!hooks) throw new Error('Missing real hook configuration');
  hooks[
    mode.startsWith('after-')
      ? HookEventName.AfterModel
      : HookEventName.BeforeModel
  ] = [
    {
      sequential: mode.startsWith('chain-'),
      hooks: commands.map((action, index) => ({
        type: HookType.Command,
        name: `actual-model-hook-${index}`,
        command: modelCommand(root, action),
      })),
    },
  ];
}

export async function modelHookWorker(
  root: string,
  mode: ModelHookMode,
  source = true,
): Promise<ModelFacts> {
  mkdirSync(root, { recursive: true });
  const runtime = join(root, 'runtime');
  mkdirSync(runtime, { recursive: true });
  const result = join(root, 'result.json');
  const worker = new URL(
    './streamprocessor-model-hook-worker.ts',
    import.meta.url,
  );
  const child = Bun.spawn(
    [process.execPath, worker.pathname, root, mode, String(source), result],
    {
      env: { ...process.env, TMPDIR: runtime },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    },
  );
  if ((await child.exited) !== 0)
    throw new Error(`Model-hook worker failed: ${child.pid}`);
  const facts = modelFactsSchema.parse(
    JSON.parse(readFileSync(result, 'utf8')),
  );
  const evidence = process.env.ISSUE854_MODEL_HOOK_EVIDENCE;
  if (evidence !== undefined)
    writeFileSync(
      join(evidence, `${mode}-${source}-${child.pid}.json`),
      JSON.stringify(facts, null, 2),
    );
  return facts;
}
