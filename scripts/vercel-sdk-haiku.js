#!/usr/bin/env node
/**
 * Minimal sanity check against the Vercel AI SDK OpenAI provider.
 * Hardcoded to the synthetic endpoint and a haiku prompt.
 */

import { readFileSync } from 'fs';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

async function main() {
  const baseURL = 'https://api.synthetic.new/openai/v1';
  const model = 'hf:zai-org/GLM-4.6';
  const prompt = 'write me a haiku';

  let apiKey;
  try {
    apiKey = readFileSync(`${process.env.HOME}/.synthetic_key`, 'utf8').trim();
  } catch (err) {
    console.error('Failed to read ~/.synthetic_key:', err);
    process.exit(1);
  }

  const openai = createOpenAI({
    apiKey,
    baseURL,
    headers: {
      'x-llxprt-check': 'vercel-sdk-haiku',
    },
  });

  try {
    const result = await generateText({
      model: openai.completion(model),
      prompt,
      maxRetries: 0,
    });
    console.log('Haiku:\n', result.text);
  } catch (err) {
    const status = err?.status ?? err?.response?.status;
    const statusText = err?.response?.statusText;
    const body = err?.response?.data ?? err?.responseBody ?? err?.body;
    console.error(
      'Error:',
      status ? `HTTP ${status}${statusText ? ` ${statusText}` : ''}` : '',
      body ? `\n${body}` : err,
    );
    process.exit(1);
  }
}

main();
