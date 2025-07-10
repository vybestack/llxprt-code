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
        content: 'What is the weather in San Francisco and New York?',
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

  console.log('Sending request to o3 with tools...\n');

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
    let toolCallCount = 0;
    let textContent = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;

        if (line.startsWith('data: ')) {
          const dataLine = line.slice(6);
          if (dataLine === '[DONE]') continue;

          try {
            const event = JSON.parse(dataLine);

            // Track different event types
            if (
              event.type === 'response.output_item.added' &&
              event.item?.type === 'function_call'
            ) {
              toolCallCount++;
              console.log(
                `\n🔧 Tool Call #${toolCallCount}: ${event.item.name}`,
              );
            } else if (
              event.type === 'response.function_call_arguments.delta'
            ) {
              process.stdout.write('.');
            } else if (
              event.type === 'response.output_item.done' &&
              event.item?.type === 'function_call'
            ) {
              console.log(
                `\n✅ Completed: ${event.item.name} with args: ${event.item.arguments}`,
              );
            } else if (
              event.type === 'response.output_text.delta' &&
              event.delta
            ) {
              textContent += event.delta;
              process.stdout.write(event.delta);
            } else if (event.type === 'response.completed') {
              console.log('\n\n📊 Response completed');
              if (event.response?.usage) {
                console.log('Usage:', event.response.usage);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    console.log(`\n\nSummary:\n- Tool calls made: ${toolCallCount}`);
    console.log(`- Text generated: ${textContent ? 'Yes' : 'No'}`);
    console.log(`- Response completed successfully: Yes`);
  }
}

testResponsesAPIWithTools().catch(console.error);
