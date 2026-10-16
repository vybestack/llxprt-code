/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-003.4
 */
import { describe, expect, it } from 'bun:test';
import type { ToolDeclaration } from './toolDeclaration.js';
import type { ModelGenerationRequest } from './modelRequest.js';
import type { IContent } from '../services/history/IContent.js';
import type {
  RuntimeProviderToolset,
  RuntimeGenerateChatOptions,
} from '../runtime/contracts/RuntimeProviderChat.js';

async function* streamRows(
  rows: readonly IContent[],
): RuntimeGenerateChatOptions['contents'] {
  yield* rows;
}

describe('neutral request assignability', () => {
  it('IContent[] assigns to ModelGenerationRequest.contents', async () => {
    const contents: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'hello' }] },
    ];
    const req: ModelGenerationRequest = { contents };
    expect(req.contents).toBe(contents);
    expect(req.contents).toHaveLength(2);

    const streamed = streamRows(contents);
    const drained: IContent[] = [];
    for await (const row of streamed) drained.push(row);
    expect(drained).toStrictEqual(contents);
  });

  it('runtime request tools assign directly to the model request', () => {
    const contents: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'run' }] },
    ];
    const tools: RuntimeProviderToolset = [
      { name: 'exec', parametersJsonSchema: {} },
    ];
    const declarations: ToolDeclaration[] = tools;
    const runtime: RuntimeGenerateChatOptions = {
      contents: streamRows(contents),
      tools: declarations,
    };
    const req: ModelGenerationRequest = { contents, tools: runtime.tools };
    expect(req.tools).toBe(tools);
    expect(req.tools?.[0].name).toBe('exec');
  });

  it('keeps runtime history lazy while sharing ordered flat tool schemas', async () => {
    let reads = 0;
    const schema = {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    };
    const tools: ToolDeclaration[] = [
      {
        name: 'read_file',
        description: 'Read a file',
        parametersJsonSchema: schema,
      },
      { name: 'no_args', parametersJsonSchema: true },
    ];
    async function* contents(): RuntimeGenerateChatOptions['contents'] {
      reads++;
      yield { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] };
      reads++;
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'second' }] };
    }
    const runtime: RuntimeGenerateChatOptions = { contents: contents(), tools };
    expect(reads).toBe(0);
    expect(runtime.tools?.map(({ name }) => name)).toStrictEqual([
      'read_file',
      'no_args',
    ]);
    expect(runtime.tools?.[0].parametersJsonSchema).toBe(schema);
    expect(runtime.tools?.[1].parametersJsonSchema).toBe(true);
    const speakers: string[] = [];
    for await (const row of runtime.contents) speakers.push(row.speaker);
    expect(speakers).toStrictEqual(['human', 'ai']);
    expect(reads).toBe(2);
  });
});
