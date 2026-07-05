/**
 * @plan PLAN-20260702-LLMTYPES.P04
 * @requirement REQ-003.4
 * @pseudocode llm-types-envelope.md "Integration Points"
 *
 * Compile-time assignability proof that existing legacy shapes convert to
 * neutral llm-types WITHOUT casts. Structural shapes are replicated LOCALLY
 * (NOT imported from @vybestack/llxprt-code-providers to avoid inverting
 * package dependency direction). Sources cited inline.
 */
import { describe, expect, it } from 'vitest';
import {
  toolDeclarationsFromLegacyToolset,
  type ToolDeclaration,
} from './toolDeclaration.js';
import type { ModelGenerationRequest } from './modelRequest.js';
import type { IContent } from '../services/history/IContent.js';
import type {
  RuntimeProviderToolset,
  RuntimeGenerateChatOptions,
} from '../runtime/contracts/RuntimeProviderChat.js';

// ---------------------------------------------------------------------------
// Local structural shapes mirroring the legacy runtime contracts.
//
// Source: packages/providers/src/IProvider.ts (ProviderToolset) — the
// type used by every provider's GenerateChatOptions.tools today.
// Source: packages/core/src/runtime/contracts/RuntimeProviderChat.ts
// (RuntimeProviderToolset) — the core runtime toolset type.
// ---------------------------------------------------------------------------

/** Mirrors packages/providers/src/IProvider.ts:ProviderToolset */
type ProviderToolsetLocal = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
    parameters?: unknown;
  }>;
}>;

/**
 * The runtime contracts live in THIS package, so the REAL types are used
 * directly — no mirror, no drift risk. Only the providers-package shape
 * above must be mirrored (importing it would invert package dependencies);
 * drift there is caught by the providers package itself, whose
 * ProviderToolset literally reuses this structural shape.
 */
type RuntimeProviderToolsetLocal = RuntimeProviderToolset;

type RuntimeContentsLocal = NonNullable<RuntimeGenerateChatOptions['contents']>;

describe('REQ-003.4 compile-time assignability (no casts needed)', () => {
  it('ProviderToolset-shaped literal converts via toolDeclarationsFromLegacyToolset', () => {
    // This is a COMPILE-TIME proof: the literal matches LegacyToolsetLike
    // because LegacyToolsetLike is structurally wider. No cast.
    const legacy: ProviderToolsetLocal = [
      {
        functionDeclarations: [
          {
            name: 'getWeather',
            description: 'Get weather',
            parametersJsonSchema: { type: 'object', properties: {} },
          },
          {
            name: 'legacyTool',
            parameters: { type: 'object' },
          },
        ],
      },
    ];

    const result: ToolDeclaration[] = toolDeclarationsFromLegacyToolset(legacy);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('getWeather');
    expect(result[0].description).toBe('Get weather');
    expect(result[0].parametersJsonSchema).toStrictEqual({
      type: 'object',
      properties: {},
    });
    expect(result[1].name).toBe('legacyTool');
    // Verify the `parameters` fallback was resolved as schema
    expect(result[1].parametersJsonSchema).toStrictEqual({ type: 'object' });
  });

  it('RuntimeProviderToolset-shaped literal converts via toolDeclarationsFromLegacyToolset', () => {
    const runtime: RuntimeProviderToolsetLocal = [
      {
        functionDeclarations: [
          {
            name: 'search',
            description: 'Search the web',
            parametersJsonSchema: { type: 'object' },
          },
        ],
      },
    ];

    const result: ToolDeclaration[] =
      toolDeclarationsFromLegacyToolset(runtime);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('search');
  });

  it('falls back to empty schema when no valid schema is present', () => {
    const legacy: ProviderToolsetLocal = [
      {
        functionDeclarations: [{ name: 'noSchema' }],
      },
    ];

    const result: ToolDeclaration[] = toolDeclarationsFromLegacyToolset(legacy);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('noSchema');
    expect(result[0].parametersJsonSchema).toStrictEqual({});
  });

  it('IContent[] assigns to ModelGenerationRequest.contents', () => {
    // COMPILE-TIME proof: IContent[] is assignable to the request's contents field.
    const contents: RuntimeContentsLocal = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'hello' }] },
    ];

    const req: ModelGenerationRequest = { contents };
    expect(req.contents).toBe(contents);
    expect(req.contents).toHaveLength(2);
  });

  it('a full GenerateChatOptions-shaped object is assignable to ModelGenerationRequest (contents subset)', () => {
    // This proves the neutral request type accepts the shapes that flow through
    // existing provider boundaries today — IContent[] plus legacy toolsets.
    const contents: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'run' }] },
    ];
    const tools: ProviderToolsetLocal = [
      { functionDeclarations: [{ name: 'exec', parameters: {} }] },
    ];

    const req: ModelGenerationRequest = {
      contents,
      tools: toolDeclarationsFromLegacyToolset(tools),
    };
    expect(req.tools).toHaveLength(1);
    expect(req.tools?.[0].name).toBe('exec');
  });
});
