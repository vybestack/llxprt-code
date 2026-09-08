/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Behavioral tests for OpenAIResponsesInputBuilder PDF handling (issue #2608).
 * Each test calls buildOpenAIResponsesInput with realistic IContent[] histories.
 */

import { describe, it, expect } from 'bun:test';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ToolOutputSettingsProvider } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  buildOpenAIResponsesInput,
  type ResponsesInputBuildContext,
} from '../OpenAIResponsesInputBuilder.js';
import type {
  ResponsesInputItem,
  ResponsesContentPart,
} from '../OpenAIResponsesTypes.js';
import { PDF_AGGREGATE_MAX_BYTES } from '../../utils/mediaUtils.js';

const stubConfig: ToolOutputSettingsProvider = {
  getEphemeralSettings: () => ({}),
};

function buildContext(
  overrides: Partial<ResponsesInputBuildContext> = {},
): ResponsesInputBuildContext {
  return {
    includeReasoningInContext: true,
    outputLimiterConfig: stubConfig,
    debug: () => {},
    mediaPdfEnabled: true,
    ...overrides,
  };
}

function pdfMediaBlock(overrides: Partial<MediaBlock> = {}): MediaBlock {
  return {
    type: 'media',
    mimeType: 'application/pdf',
    data: 'JVBERi0xLjQKJdPr6e0=',
    encoding: 'base64',
    filename: 'quarterly-report.pdf',
    ...overrides,
  };
}

type InputArray = Parameters<typeof buildOpenAIResponsesInput>[0];

function toolCall(id: string, path: string): Record<string, unknown> {
  return {
    type: 'tool_call',
    id,
    name: 'read_file',
    parameters: { path },
  };
}

function toolResponse(callId: string): Record<string, unknown> {
  return {
    type: 'tool_response',
    callId,
    toolName: 'read_file',
    result: { output: 'Binary content provided (1 item(s)).' },
  };
}

/** A single tool_call + single tool_response + single media block. */
function singlePdfTurn(
  callId: string,
  media: Partial<MediaBlock> = {},
): InputArray {
  return [
    { speaker: 'ai', blocks: [toolCall(callId, media.filename ?? 'doc.pdf')] },
    {
      speaker: 'tool',
      blocks: [toolResponse(callId), pdfMediaBlock(media)],
    },
  ];
}

function allUserParts(input: ResponsesInputItem[]): ResponsesContentPart[] {
  return input
    .filter(
      (i): i is { role: 'user'; content: ResponsesContentPart[] } =>
        'role' in i && i.role === 'user' && Array.isArray(i.content),
    )
    .flatMap((u) => u.content);
}

function inputFiles(parts: ResponsesContentPart[]) {
  return parts.filter(
    (p): p is Extract<ResponsesContentPart, { type: 'input_file' }> =>
      p.type === 'input_file',
  );
}

function inputTexts(parts: ResponsesContentPart[]) {
  return parts.filter(
    (p): p is Extract<ResponsesContentPart, { type: 'input_text' }> =>
      p.type === 'input_text',
  );
}

function calls(input: ResponsesInputItem[]) {
  return input.filter(
    (i): i is Extract<ResponsesInputItem, { type: 'function_call' }> =>
      'type' in i && i.type === 'function_call',
  );
}

function outputs(input: ResponsesInputItem[]) {
  return input.filter(
    (i): i is Extract<ResponsesInputItem, { type: 'function_call_output' }> =>
      'type' in i && i.type === 'function_call_output',
  );
}

function filesFrom(input: ResponsesInputItem[]) {
  return inputFiles(allUserParts(input));
}

function textsFrom(input: ResponsesInputItem[]) {
  return inputTexts(allUserParts(input));
}

describe('OpenAIResponsesInputBuilder PDF @issue:2608', () => {
  describe('enabled PDF input (default)', () => {
    it('emits input_file with data URI and source filename', () => {
      const input = buildOpenAIResponsesInput(
        singlePdfTurn('call_pdf'),
        buildContext(),
      );
      const files = filesFrom(input);
      expect(files).toHaveLength(1);
      expect(files[0].file_data).toMatch(/^data:application\/pdf;base64,/);
      expect(files[0].filename).toBe('quarterly-report.pdf');
    });

    it.each([
      ['no filename', undefined],
      ['empty-string filename', ''],
      ['whitespace-only filename', '   '],
    ])('falls back to document.pdf when media has %s', (_label, filename) => {
      const input = buildOpenAIResponsesInput(
        singlePdfTurn('call_fb', { filename }),
        buildContext(),
      );
      expect(filesFrom(input)[0].filename).toBe('document.pdf');
    });

    it('preserves a nonempty filename exactly without trimming', () => {
      const input = buildOpenAIResponsesInput(
        singlePdfTurn('call_sp', { filename: 'my report.pdf' }),
        buildContext(),
      );
      expect(filesFrom(input)[0].filename).toBe('my report.pdf');
    });

    it('preserves tool-call / tool-response pairing alongside enabled PDF media', () => {
      const input = buildOpenAIResponsesInput(
        singlePdfTurn('call_pair'),
        buildContext(),
      );
      expect(calls(input)).toHaveLength(1);
      expect(outputs(input)).toHaveLength(1);
      expect(calls(input)[0].call_id).toBe('call_pair');
    });
  });

  describe('disabled PDF input', () => {
    function disabledTurn(callId: string): InputArray {
      return singlePdfTurn(callId, { filename: 'report.pdf' });
    }

    it('emits input_text notice instead of input_file', () => {
      const input = buildOpenAIResponsesInput(
        disabledTurn('call_disabled'),
        buildContext({ mediaPdfEnabled: false }),
      );
      expect(filesFrom(input)).toHaveLength(0);
      expect(textsFrom(input)).toHaveLength(1);
    });

    it('notice states the PDF was not read', () => {
      const input = buildOpenAIResponsesInput(
        disabledTurn('call_notice'),
        buildContext({ mediaPdfEnabled: false }),
      );
      expect(textsFrom(input)[0].text.toLowerCase()).toContain('not read');
    });

    it('notice names the file and suggests extraction or rendering', () => {
      const input = buildOpenAIResponsesInput(
        disabledTurn('call_named'),
        buildContext({ mediaPdfEnabled: false }),
      );
      const notice = textsFrom(input)[0].text.toLowerCase();
      expect(notice).toContain('report.pdf');
      expect(notice).toMatch(/extract|render/);
    });

    it('retains valid tool-call / tool-response pairing', () => {
      const input = buildOpenAIResponsesInput(
        disabledTurn('call_paired_disabled'),
        buildContext({ mediaPdfEnabled: false }),
      );
      expect(calls(input)).toHaveLength(1);
      expect(outputs(input)).toHaveLength(1);
      expect(calls(input)[0].call_id).toBe('call_paired_disabled');
    });
  });

  describe('parallel PDF tool results (separate tool IContents)', () => {
    it('serializes each once without cross-tool duplication', () => {
      const input = buildOpenAIResponsesInput(
        [
          {
            speaker: 'ai',
            blocks: [toolCall('call_a', 'a.pdf'), toolCall('call_b', 'b.pdf')],
          },
          {
            speaker: 'tool',
            blocks: [
              toolResponse('call_a'),
              pdfMediaBlock({ filename: 'a.pdf', data: 'YWFhYWE=' }),
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              toolResponse('call_b'),
              pdfMediaBlock({ filename: 'b.pdf', data: 'YmJiYmI=' }),
            ],
          },
        ],
        buildContext(),
      );
      const files = filesFrom(input);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.filename).sort()).toStrictEqual([
        'a.pdf',
        'b.pdf',
      ]);
    });
  });

  describe('production-flattened tool turn (recordCompletedToolHistory shape) @issue:2608', () => {
    // recordCompletedToolHistory flattens ALL parallel tool responses + media
    // into ONE tool IContent. N responses + M media must emit exactly M media,
    // not N*M.
    function flattenedTurn(): InputArray {
      return [
        {
          speaker: 'ai',
          blocks: [toolCall('call_a', 'a.pdf'), toolCall('call_b', 'b.pdf')],
        },
        {
          speaker: 'tool',
          blocks: [
            toolResponse('call_a'),
            toolResponse('call_b'),
            pdfMediaBlock({ filename: 'a.pdf' }),
            pdfMediaBlock({ filename: 'b.pdf' }),
          ],
        },
      ];
    }

    it('emits exactly two input_file parts when enabled (not 4 from duplication)', () => {
      const input = buildOpenAIResponsesInput(flattenedTurn(), buildContext());
      const files = filesFrom(input);
      expect(files).toHaveLength(2);
      expect(files.map((f) => f.filename).sort()).toStrictEqual([
        'a.pdf',
        'b.pdf',
      ]);
    });

    it('emits exactly two distinct notices when disabled (not 4 from duplication)', () => {
      const input = buildOpenAIResponsesInput(
        flattenedTurn(),
        buildContext({ mediaPdfEnabled: false }),
      );
      const texts = textsFrom(input);
      expect(texts).toHaveLength(2);
      expect(texts.some((t) => t.text.includes('a.pdf'))).toBe(true);
      expect(texts.some((t) => t.text.includes('b.pdf'))).toBe(true);
    });

    it('preserves two function_call and two function_call_output pairing', () => {
      const input = buildOpenAIResponsesInput(flattenedTurn(), buildContext());
      expect(calls(input)).toHaveLength(2);
      expect(outputs(input)).toHaveLength(2);
    });

    it('does not emit orphan media when no valid function_call_output exists', () => {
      const input = buildOpenAIResponsesInput(
        [
          {
            speaker: 'tool',
            blocks: [
              toolResponse('call_orphan'),
              pdfMediaBlock({ filename: 'orphan.pdf' }),
            ],
          },
        ],
        buildContext(),
      );
      expect(filesFrom(input)).toHaveLength(0);
    });
  });

  describe('existing image/media behavior unchanged', () => {
    it('still emits input_image for image media blocks regardless of mediaPdfEnabled', () => {
      const input = buildOpenAIResponsesInput(
        [
          {
            speaker: 'ai',
            blocks: [toolCall('call_img', 'diagram.png')],
          },
          {
            speaker: 'tool',
            blocks: [
              toolResponse('call_img'),
              {
                type: 'media',
                mimeType: 'image/png',
                data: 'iVBORw0KGgo=',
                encoding: 'base64',
                filename: 'diagram.png',
              },
            ],
          },
        ],
        buildContext({ mediaPdfEnabled: false }),
      );
      expect(
        allUserParts(input).filter((p) => p.type === 'input_image'),
      ).toHaveLength(1);
    });
  });

  describe('aggregate 50 MB native PDF preflight', () => {
    function pdfOfSizeBytes(bytes: number, filename: string): MediaBlock {
      return {
        type: 'media',
        mimeType: 'application/pdf',
        data: Buffer.from('A'.repeat(bytes)).toString('base64'),
        encoding: 'base64',
        filename,
      };
    }

    it('passes when aggregate native PDF payload is exactly at the boundary', () => {
      expect(() =>
        buildOpenAIResponsesInput(
          [
            {
              speaker: 'ai',
              blocks: [toolCall('call_boundary', 'big.pdf')],
            },
            {
              speaker: 'tool',
              blocks: [
                toolResponse('call_boundary'),
                pdfOfSizeBytes(PDF_AGGREGATE_MAX_BYTES, 'big.pdf'),
              ],
            },
          ],
          buildContext(),
        ),
      ).not.toThrow();
    });

    it('fails when aggregate native PDF payload is one byte over the boundary', () => {
      const overBytes = PDF_AGGREGATE_MAX_BYTES + 1;
      expect(() =>
        buildOpenAIResponsesInput(
          [
            {
              speaker: 'ai',
              blocks: [toolCall('call_over', 'huge.pdf')],
            },
            {
              speaker: 'tool',
              blocks: [
                toolResponse('call_over'),
                pdfOfSizeBytes(overBytes, 'huge.pdf'),
              ],
            },
          ],
          buildContext(),
        ),
      ).toThrow(
        new RegExp(`${overBytes}.*${PDF_AGGREGATE_MAX_BYTES}.*50\\s*MB`, 'i'),
      );
    });

    it('fails with an unambiguous error including exact actual/allowed bytes and 50 MB', () => {
      const overBytes = PDF_AGGREGATE_MAX_BYTES + 1024;
      let thrown: unknown;
      try {
        buildOpenAIResponsesInput(
          [
            {
              speaker: 'ai',
              blocks: [toolCall('call_msg', 'huge.pdf')],
            },
            {
              speaker: 'tool',
              blocks: [
                toolResponse('call_msg'),
                pdfOfSizeBytes(overBytes, 'huge.pdf'),
              ],
            },
          ],
          buildContext(),
        );
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = String((thrown as Error).message);
      expect(message).toContain(String(overBytes));
      expect(message).toContain(String(PDF_AGGREGATE_MAX_BYTES));
      expect(message).toMatch(/50\s*MB/i);
    });

    it('passes four 4 MB PDFs in a production-flattened multi-response turn (16 MB actual, no duplication)', () => {
      const input = buildOpenAIResponsesInput(
        [
          {
            speaker: 'ai',
            blocks: [
              toolCall('call_f1', 'f1.pdf'),
              toolCall('call_f2', 'f2.pdf'),
              toolCall('call_f3', 'f3.pdf'),
              toolCall('call_f4', 'f4.pdf'),
            ],
          },
          {
            speaker: 'tool',
            blocks: [
              toolResponse('call_f1'),
              toolResponse('call_f2'),
              toolResponse('call_f3'),
              toolResponse('call_f4'),
              pdfOfSizeBytes(4 * 1024 * 1024, 'f1.pdf'),
              pdfOfSizeBytes(4 * 1024 * 1024, 'f2.pdf'),
              pdfOfSizeBytes(4 * 1024 * 1024, 'f3.pdf'),
              pdfOfSizeBytes(4 * 1024 * 1024, 'f4.pdf'),
            ],
          },
        ],
        buildContext(),
      );
      expect(filesFrom(input)).toHaveLength(4);
    });

    it('does not count disabled PDFs toward the aggregate limit', () => {
      expect(() =>
        buildOpenAIResponsesInput(
          [
            {
              speaker: 'ai',
              blocks: [toolCall('call_disabled_huge', 'huge.pdf')],
            },
            {
              speaker: 'tool',
              blocks: [
                toolResponse('call_disabled_huge'),
                pdfOfSizeBytes(PDF_AGGREGATE_MAX_BYTES + 1024, 'huge.pdf'),
              ],
            },
          ],
          buildContext({ mediaPdfEnabled: false }),
        ),
      ).not.toThrow();
    });

    it('does not count oversized PDFs in orphan tool content (no matching tool_call)', () => {
      expect(() =>
        buildOpenAIResponsesInput(
          [
            {
              speaker: 'tool',
              blocks: [
                toolResponse('call_orphan'),
                pdfOfSizeBytes(PDF_AGGREGATE_MAX_BYTES + 1024, 'orphan.pdf'),
              ],
            },
          ],
          buildContext(),
        ),
      ).not.toThrow();
    });
  });
});
