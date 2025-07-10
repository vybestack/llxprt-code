#!/usr/bin/env node

import fs from 'fs';
import fetch from 'node-fetch';

const apiKey = fs
  .readFileSync(process.env.HOME + '/.openai_key', 'utf8')
  .trim();

async function testResponsesAPIWithTools() {
  const request = {
    model: 'o3',
    input: [
      {
        role: 'user',
        content: 'What is the weather in San Francisco?',
      },
    ],
    tools: [
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
          },
          required: ['location'],
        },
        strict: null,
      },
    ],
    stream: true,
  };

  console.log('Sending request with tools...\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  console.log('Response status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.error('Error response:', error);
    return;
  }

  // Handle streaming response
  if (response.body) {
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;

        // Only log tool-related events
        if (line.includes('tool') || line.includes('function')) {
          console.log(line);
        }
      }
    }
  }
}

testResponsesAPIWithTools().catch(console.error);
