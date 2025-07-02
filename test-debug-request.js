#!/usr/bin/env node

import fs from 'fs';
import fetch from 'node-fetch';

const apiKey = fs.readFileSync(process.env.HOME + '/.openai_key', 'utf8').trim();

async function debugRequest() {
  // Simulate the exact scenario that's failing
  const request = {
    model: 'o3',
    input: [
      {
        role: 'user',
        content: 'List the directory /Users/acoliver/projects/gemini-code/gemini-cli/packages/core/src'
      },
      {
        role: 'assistant',
        content: '',
        // This is what causes the error - tool_calls should not be here
        tool_calls: [
          {
            id: 'call_ASsQpq1tdpbMIPZMuDAW5K59',
            type: 'function',
            function: {
              name: 'list_directory',
              arguments: '{"path":"/Users/acoliver/projects/gemini-code/gemini-cli/packages/core/src"}'
            }
          }
        ]
      },
      {
        role: 'tool',
        content: 'Directory listing for /Users/acoliver/projects/gemini-code/gemini-cli/packages/core/src:\n[DIR] __mocks__\n[DIR] code_assist\n[DIR] config\n[DIR] core\n[DIR] providers\n[DIR] services\n[DIR] telemetry\n[DIR] tools\n[DIR] utils\nindex.test.ts\nindex.ts',
        tool_call_id: 'call_ASsQpq1tdpbMIPZMuDAW5K59'
      },
      {
        role: 'user',
        content: 'Using 2 GEMINI.md files'
      }
    ],
    tools: [
      {
        type: 'function',
        name: 'list_directory',
        description: 'Lists the names of files and subdirectories directly within a specified directory path.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The absolute path to the directory to list'
            }
          },
          required: ['path']
        },
        strict: null
      }
    ],
    stream: true
  };

  console.log('Testing request that would cause "Unknown parameter: input[1].tool_calls" error...\n');
  console.log('Request body:', JSON.stringify(request, null, 2));
  
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  console.log('\nResponse status:', response.status);
  
  if (!response.ok) {
    const error = await response.text();
    console.error('\nError response:', error);
  } else {
    console.log('\nSuccess! The request was accepted.');
  }
  
  // Now test with cleaned request (no tool_calls)
  console.log('\n\n--- Testing cleaned request (without tool_calls) ---\n');
  
  const cleanedRequest = {
    ...request,
    input: request.input.map(msg => {
      const { tool_calls, ...cleanMsg } = msg;
      return cleanMsg;
    })
  };
  
  console.log('Cleaned request body:', JSON.stringify(cleanedRequest, null, 2));
  
  const response2 = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cleanedRequest),
  });

  console.log('\nResponse status:', response2.status);
  
  if (!response2.ok) {
    const error = await response2.text();
    console.error('\nError response:', error);
  } else {
    console.log('\nSuccess! The cleaned request was accepted.');
    
    // Read a bit of the stream to see if it works
    if (response2.body) {
      const decoder = new TextDecoder();
      let buffer = '';
      let eventCount = 0;
      
      for await (const chunk of response2.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.startsWith('data: ')) {
            eventCount++;
            if (eventCount <= 3) {
              console.log(`Event ${eventCount}:`, line);
            }
          }
        }
        
        if (eventCount > 10) break; // Just read first few events
      }
      
      console.log(`\nReceived ${eventCount} events from stream.`);
    }
  }
}

debugRequest().catch(console.error);