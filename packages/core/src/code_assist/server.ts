/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from 'google-auth-library';
import {
  type CodeAssistGlobalUserSettingResponse,
  type LoadCodeAssistRequest,
  type LoadCodeAssistResponse,
  type LongRunningOperationResponse,
  type OnboardUserRequest,
  type SetCodeAssistGlobalUserSettingRequest,
} from './types.js';
import {
  type CountTokensParameters,
  CountTokensResponse,
  type EmbedContentParameters,
  EmbedContentResponse,
  type GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import * as readline from 'readline';
import { type ContentGenerator } from '../core/contentGenerator.js';
import { UserTierId } from './types.js';
import {
  type CaCountTokenResponse,
  type CaGenerateContentResponse,
  fromCountTokenResponse,
  fromGenerateContentResponse,
  toCountTokenRequest,
  toGenerateContentRequest,
} from './converter.js';

/** HTTP options to be used in each of the requests. */
export interface HttpOptions {
  /** Additional HTTP headers to be sent with the request. */
  headers?: Record<string, string>;
}

// TODO: Use production endpoint once it supports our methods.
export const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
export const CODE_ASSIST_API_VERSION = 'v1internal';

export class CodeAssistServer implements ContentGenerator {
  constructor(
    readonly client: OAuth2Client,
    readonly projectId?: string,
    readonly httpOptions: HttpOptions = {},
    // PRIVACY FIX: sessionId parameter removed to prevent any potential transmission
    // readonly sessionId?: string,
    readonly userTier?: UserTierId,
    readonly baseURL?: string,
  ) {}

  async generateContentStream(
    req: GenerateContentParameters,
    userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const resps = await this.requestStreamingPost<CaGenerateContentResponse>(
      'streamGenerateContent',
      // PRIVACY FIX: sessionId removed from request to prevent transmission to Google servers
      toGenerateContentRequest(
        req,
        userPromptId,
        this.projectId,
        // this.sessionId, // removed
      ),
      req.config?.abortSignal,
    );
    return (async function* (): AsyncGenerator<GenerateContentResponse> {
      for await (const resp of resps) {
        yield fromGenerateContentResponse(resp);
      }
    })();
  }

  async generateContent(
    req: GenerateContentParameters,
    userPromptId: string,
  ): Promise<GenerateContentResponse> {
    console.log(
      `CodeAssistServer.generateContent: userPromptId=${userPromptId}, model=${req.model}, projectId=${this.projectId}`,
    );
    console.log(
      `CodeAssistServer.generateContent: request contents:`,
      req.contents,
    );
    console.log(
      `CodeAssistServer.generateContent: request config:`,
      req.config,
    );

    try {
      const resp = await this.requestPost<CaGenerateContentResponse>(
        'generateContent',
        // PRIVACY FIX: sessionId removed from request to prevent transmission to Google servers
        toGenerateContentRequest(
          req,
          userPromptId,
          this.projectId,
          // this.sessionId, // removed
        ),
        req.config?.abortSignal,
      );
      console.log(`CodeAssistServer.generateContent: request successful`);
      return fromGenerateContentResponse(resp);
    } catch (error) {
      console.log(
        `CodeAssistServer.generateContent: ERROR during request: ${error}`,
      );
      console.log(`CodeAssistServer.generateContent: Error details:`, error);
      throw error;
    }
  }

  async onboardUser(
    req: OnboardUserRequest,
  ): Promise<LongRunningOperationResponse> {
    return this.requestPost<LongRunningOperationResponse>('onboardUser', req);
  }

  async loadCodeAssist(
    req: LoadCodeAssistRequest,
  ): Promise<LoadCodeAssistResponse> {
    return this.requestPost<LoadCodeAssistResponse>('loadCodeAssist', req);
  }

  async getCodeAssistGlobalUserSetting(): Promise<CodeAssistGlobalUserSettingResponse> {
    return this.requestGet<CodeAssistGlobalUserSettingResponse>(
      'getCodeAssistGlobalUserSetting',
    );
  }

  async setCodeAssistGlobalUserSetting(
    req: SetCodeAssistGlobalUserSettingRequest,
  ): Promise<CodeAssistGlobalUserSettingResponse> {
    return this.requestPost<CodeAssistGlobalUserSettingResponse>(
      'setCodeAssistGlobalUserSetting',
      req,
    );
  }

  async countTokens(req: CountTokensParameters): Promise<CountTokensResponse> {
    const resp = await this.requestPost<CaCountTokenResponse>(
      'countTokens',
      toCountTokenRequest(req),
    );
    return fromCountTokenResponse(resp);
  }

  async embedContent(
    _req: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw Error();
  }

  async requestPost<T>(
    method: string,
    req: object,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.client.request({
      url: this.getMethodUrl(method),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'json',
      body: JSON.stringify(req),
      signal,
    });
    return res.data as T;
  }

  async requestGet<T>(method: string, signal?: AbortSignal): Promise<T> {
    const res = await this.client.request({
      url: this.getMethodUrl(method),
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'json',
      signal,
    });
    return res.data as T;
  }

  async requestStreamingPost<T>(
    method: string,
    req: object,
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<T>> {
    const res = await this.client.request({
      url: this.getMethodUrl(method),
      method: 'POST',
      params: {
        alt: 'sse',
      },
      headers: {
        'Content-Type': 'application/json',
        ...this.httpOptions.headers,
      },
      responseType: 'stream',
      body: JSON.stringify(req),
      signal,
    });

    return (async function* (): AsyncGenerator<T> {
      const rl = readline.createInterface({
        input: res.data as NodeJS.ReadableStream,
        crlfDelay: Infinity, // Recognizes '\r\n' and '\n' as line breaks
      });

      let bufferedLines: string[] = [];
      for await (const line of rl) {
        // blank lines are used to separate JSON objects in the stream
        if (line === '') {
          if (bufferedLines.length === 0) {
            continue; // no data to yield
          }
          yield JSON.parse(bufferedLines.join('\n')) as T;
          bufferedLines = []; // Reset the buffer after yielding
        } else if (line.startsWith('data: ')) {
          bufferedLines.push(line.slice(6).trim());
        } else {
          throw new Error(`Unexpected line format in response: ${line}`);
        }
      }
    })();
  }

  getMethodUrl(method: string): string {
    const endpoint =
      this.baseURL ?? process.env.CODE_ASSIST_ENDPOINT ?? CODE_ASSIST_ENDPOINT;
    return `${endpoint}/${CODE_ASSIST_API_VERSION}:${method}`;
  }
}
