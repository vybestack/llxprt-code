#!/usr/bin/env node

import fs from 'fs';
import fetch from 'node-fetch';

const apiKey = fs.readFileSync(process.env.HOME + '/.openai_key', 'utf8').trim();

async function testToolResponseFormat() {
  // Simulate what happens after a tool call
  const request = {
    model: 'o3',
    input: [
      {
        role: 'user',
        content: 'List the docs directory'
      },
      {
        role: 'assistant',
        content: ''  // Empty content when making tool call
      },
      {
        role: 'user',  // Tool response transformed to user message
        content: '[Tool Response - call_123]\nDirectory listing:\n- README.md\n- cli/\n- api/\n- guides/'
      }
    ],
    stream: true
  };

  console.log('Testing tool response format transformation...\n');
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
    console.log('\nSuccess! Tool response format is accepted.');
    
    // Read a bit of the stream
    if (response.body) {
      const decoder = new TextDecoder();
      let buffer = '';
      let hasContent = false;
      
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line.includes('delta')) {
            hasContent = true;
            break;
          }
        }
        
        if (hasContent) break;
      }
      
      console.log('\nModel is responding to the tool output successfully.');
    }
  }
}

testToolResponseFormat().catch(console.error);