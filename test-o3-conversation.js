#!/usr/bin/env node

import fs from 'fs';
import fetch from 'node-fetch';

const apiKey = fs
  .readFileSync(process.env.HOME + '/.openai_key', 'utf8')
  .trim();

async function testConversationWithTools() {
  // Initial request with tools
  const request1 = {
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
    stream: false,
  };

  console.log('Step 1: Sending initial request...\n');

  const response1 = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request1),
  });

  if (!response1.ok) {
    const error = await response1.text();
    console.error('Error in initial request:', error);
    return;
  }

  const data1 = await response1.json();
  console.log('Initial response:', JSON.stringify(data1, null, 2));

  // Check if there are tool calls
  if (data1.choices?.[0]?.message?.tool_calls) {
    console.log('\nStep 2: Tool calls detected, simulating tool response...\n');

    const toolCall = data1.choices[0].message.tool_calls[0];

    // Continue conversation with tool result
    const request2 = {
      model: 'o3',
      input: [
        {
          role: 'user',
          content: 'What is the weather in San Francisco?',
        },
        {
          role: 'assistant',
          content: '',
          // Note: we're NOT including tool_calls in the input
        },
        {
          role: 'tool',
          content: 'The weather in San Francisco is 72°F and sunny.',
          tool_call_id: toolCall.id,
        },
      ],
      stream: false,
    };

    console.log(
      'Sending follow-up with tool result (without tool_calls field)...\n',
    );

    const response2 = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request2),
    });

    if (!response2.ok) {
      const error = await response2.text();
      console.error('Error in follow-up request:', error);
      return;
    }

    const data2 = await response2.json();
    console.log('Follow-up response:', JSON.stringify(data2, null, 2));
  }
}

testConversationWithTools().catch(console.error);
