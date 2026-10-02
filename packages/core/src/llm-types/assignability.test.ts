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

describe('neutral request assignability', () => {
  it('IContent[] assigns to ModelGenerationRequest.contents', () => {
    const contents: RuntimeGenerateChatOptions['contents'] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'hello' }] },
    ];
    const req: ModelGenerationRequest = { contents };
    expect(req.contents).toBe(contents);
    expect(req.contents).toHaveLength(2);
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
      contents,
      tools: declarations,
    };
    const req: ModelGenerationRequest = {
      contents: runtime.contents,
      tools: runtime.tools,
    };
    expect(req.tools).toBe(tools);
    expect(req.tools?.[0].name).toBe('exec');
  });
});
