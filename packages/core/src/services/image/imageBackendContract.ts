/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Optional operation overrides. Absence delegates to the endpoint default. */
export interface ImageGenerateRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly background?: 'auto' | 'transparent' | 'opaque';
  readonly quality?: 'auto' | 'high' | 'medium' | 'low' | 'xhigh' | 'max';
  readonly size?:
    | 'auto'
    | '256x256'
    | '512x512'
    | '1024x1024'
    | '1024x1536'
    | '1536x1024';
  readonly n?: number;
  readonly sessionId?: string;
}

export interface ImageEditRequest extends Omit<ImageGenerateRequest, 'n'> {
  readonly inputPaths: readonly string[];
}

/** Adapters materialize remote results before crossing the backend boundary. */
export interface ImageBackendResult {
  readonly mimeType: 'image/png';
  readonly encoding: 'base64';
  readonly data: string;
  readonly caption?: string;
  readonly revisedPrompt?: string;
  readonly quality?: string;
  readonly size?: string;
  readonly usage?: Readonly<Record<string, unknown>>;
}

/** One operation contract for Codex, OpenAI Images and local dialects. */
export interface ImageBackend {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageBackendResult>;
  edit(
    request: ImageEditRequest,
    signal: AbortSignal,
  ): Promise<ImageBackendResult>;
}
