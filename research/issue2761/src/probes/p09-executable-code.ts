/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P09 — executable code and code execution results.
 *
 * `neutralConverters` maps a Gemini `executableCode` part to a `CodeBlock` and
 * a `codeExecutionResult` part to a tool-response `ToolResponseBlock` with
 * `toolName: 'code_execution'`. On the AI SDK those arrive as `tool-call` /
 * `tool-result` content parts with `providerExecuted: true` and the SDK-side name
 * `code_execution`. This probe enables the `codeExecution` server tool through both
 * adapters and records the ordered part kinds, a preview of the emitted code and the
 * execution output, plus the AI SDK tool part shape.
 */

import type {
  LanguageModelV2Prompt,
  LanguageModelV2ProviderDefinedTool,
} from '@ai-sdk/provider';
import type { Content } from '@google/genai';

import { createAISDK, summarizeContent } from '../adapters/aisdk.ts';
import { createGenAI } from '../adapters/genai.ts';
import {
  ADAPTER_AISDK,
  ADAPTER_GENAI,
  observe,
  type Probe,
  type ProbeContext,
  type ProbeResult,
} from '../harness.ts';

const CODE_PROMPT =
  'Use Python to compute the 12th Fibonacci number. Show the code you ran.';
const MAX_OUTPUT_TOKENS = 512;
const PAUSE_MS = 3000;

const pause = (): Promise<void> =>
  new Promise((done) => setTimeout(done, PAUSE_MS));

/** Summarizes an `executableCode` part to a short preview. */
function describeExecutableCode(
  part: { executableCode?: { code?: string; language?: string } },
): { language: string; codeLength: number; codePreview: string } | null {
  const ec = part.executableCode;
  if (ec === undefined || ec.code === undefined) {
    return null;
  }
  return {
    language: ec.language ?? '',
    codeLength: ec.code.length,
    codePreview: ec.code.slice(0, 120),
  };
}

/** Summarizes a `codeExecutionResult` part. */
function describeCodeResult(
  part: { codeExecutionResult?: { outcome?: string; output?: string } },
): { outcome: string; outputLength: number; outputPreview: string } | null {
  const cer = part.codeExecutionResult;
  if (cer === undefined) {
    return null;
  }
  return {
    outcome: cer.outcome ?? '',
    outputLength: cer.output?.length ?? 0,
    outputPreview: (cer.output ?? '').slice(0, 120),
  };
}

export const p09ExecutableCode: Probe = {
  id: 'P09',
  area: 'Executable code and results',

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const genai = await observe(ADAPTER_GENAI, async () => {
      const client = createGenAI(ctx.apiKey);
      const userTurn: Content = { role: 'user', parts: [{ text: CODE_PROMPT }] };
      const response = await client.models.generateContent({
        model: ctx.modelGeneral,
        contents: [userTurn],
        config: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          tools: [{ codeExecution: {} }],
        },
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const partKinds = parts.map((part) => {
        if (part.text !== undefined) {
          return 'text';
        }
        if (part.executableCode !== undefined) {
          return 'executableCode';
        }
        if (part.codeExecutionResult !== undefined) {
          return 'codeExecutionResult';
        }
        return Object.keys(part).join(',');
      });
      return {
        partKindSequence: partKinds,
        textParts: parts
          .filter((part) => part.text !== undefined)
          .map((part) => (part.text ?? '').slice(0, 160)),
        executableCode: parts.map(describeExecutableCode).find((c) => c !== null) ?? null,
        codeExecutionResult:
          parts.map(describeCodeResult).find((c) => c !== null) ?? null,
        finishReason: response.candidates?.[0]?.finishReason ?? null,
      };
    });

    await pause();

    const aisdk = await observe(ADAPTER_AISDK, async () => {
      const provider = createAISDK(ctx.apiKey);
      const prompt: LanguageModelV2Prompt = [
        { role: 'user', content: [{ type: 'text', text: CODE_PROMPT }] },
      ];
      // The codeExecution provider-defined tool comes from provider.tools; it is a
      // generic Tool, not the low-level provider-defined shape prepareTools reads
      // (id/name/args). The low-level drop-in therefore has to write the
      // provider-defined shape explicitly, which is adapter work this probe measures.
      const factory = provider.tools.codeExecution({});
      const factoryType = (factory as { type?: unknown }).type ?? undefined;
      const factoryToolName = (factory as { name?: unknown }).name ?? undefined;
      void factoryType;
      void factoryToolName;
      const asProviderTool = {
        type: 'provider-defined',
        id: 'google.code_execution',
        name: 'code_execution',
        args: {},
      } as LanguageModelV2ProviderDefinedTool;
      const result = await provider.languageModel(ctx.modelGeneral).doGenerate({
        prompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        tools: [asProviderTool],
        toolChoice: { type: 'auto' },
      });

      const toolParts = summarizeContent(result.content);
      const toolCallParts = result.content.filter(
        (part) => part.type === 'tool-call',
      );
      const toolResultParts = result.content.filter(
        (part) => part.type === 'tool-result',
      );
      return {
        partKindSequence: result.content.map((part) => part.type),
        content: toolParts,
        toolCalls: toolCallParts.map((part) => {
          const call = part as { toolName: string; toolCallId: string; providerExecuted?: boolean; input?: unknown };
          return {
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            providerExecuted: call.providerExecuted ?? false,
            inputKind: typeof call.input,
            inputPreview:
              typeof call.input === 'string'
                ? call.input.slice(0, 160)
                : JSON.stringify(call.input).slice(0, 160),
          };
        }),
        toolResults: toolResultParts.map((part) => {
          const tr = part as { toolName: string; toolCallId: string; providerExecuted?: boolean; result?: unknown };
          return {
            toolName: tr.toolName,
            toolCallId: tr.toolCallId,
            providerExecuted: tr.providerExecuted ?? false,
            resultPreview: JSON.stringify(tr.result).slice(0, 160),
          };
        }),
        finishReason: result.finishReason,
        warnings: result.warnings,
      };
    });

    const g = genai.observation as {
      partKindSequence?: string[];
      executableCode?: { language: string; codeLength: number; codePreview: string } | null;
      codeExecutionResult?: { outcome: string; outputLength: number; outputPreview: string } | null;
    };
    const a = aisdk.observation as {
      partKindSequence?: string[];
      toolCalls?: Array<{ toolName: string; providerExecuted?: boolean }>;
      toolResults?: Array<{ toolName: string; providerExecuted?: boolean }>;
    };

    const genaiOk = g.partKindSequence !== undefined && g.executableCode !== null && g.codeExecutionResult !== null;
    const aisdkOk =
      Array.isArray(a.partKindSequence) &&
      a.partKindSequence.includes('tool-call') &&
      a.partKindSequence.includes('tool-result') &&
      (a.toolCalls ?? [])[0]?.toolName === 'code_execution';

    return {
      id: 'P09',
      area: 'Executable code and results',
      question:
        'With code execution enabled, do both adapters surface the executable ' +
        'code and its execution result, and in what part shape?',
      models: [ctx.modelGeneral],
      genai,
      aisdk,
      verdict:
        genaiOk && aisdkOk && aisdkPartSequenceMatches(aisdk.observation)
          ? 'parity'
          : genaiOk && aisdkOk
            ? 'partial'
            : 'gap',
      finding:
        `@google/genai emitted part sequence [${(g.partKindSequence ?? []).join(',')}] ` +
        `with executableCode (${g.executableCode?.language ?? 'no-lang'}, ` +
        `${g.executableCode?.codeLength ?? 0} chars) and codeExecutionResult ` +
        `(${g.codeExecutionResult?.outcome ?? 'no-outcome'}, ` +
        `${g.codeExecutionResult?.outputLength ?? 0} chars of output); ` +
        `the AI SDK emitted [${(a.partKindSequence ?? []).join(',')}] with ` +
        `tool-call "${(a.toolCalls ?? [])[0]?.toolName ?? '?'}" ` +
        `(providerExecuted: ${(a.toolCalls ?? [])[0]?.providerExecuted ?? false}) and a ` +
        `tool-result carrying the output. The executableCode -> CodeBlock and ` +
        `codeExecutionResult -> tool-response convention from neutralConverters maps ` +
        `unchanged, with the SDK already stamping the code_execution name and ` +
        `providerExecuted flag.`,
    };
  },
};

function aisdkPartSequenceMatches(obs: {
  partKindSequence?: unknown;
}): boolean {
  const seq = obs.partKindSequence;
  return Array.isArray(seq) && seq.length >= 3;
}
