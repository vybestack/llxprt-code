/**
 * Local AI server utilities for LM Studio and similar local servers
 * Provides undici Agent configuration and fetch wrapper to prevent connection termination
 */
import { Agent } from 'undici';
import * as http from 'http';
import * as https from 'https';

// Singleton instance
let localAIAgentInstance: Agent | null = null;

/**
 * Default API key for local AI servers
 * Used as a placeholder since OpenAI SDK requires a key
 */
export const LOCAL_AI_DEFAULT_KEY = 'lmstudio';

/**
 * Configuration for local AI server connections
 * These settings are optimized to prevent the "terminated" errors
 * that occur with local AI servers like LM Studio
 */
const LOCAL_AI_AGENT_CONFIG = {
  keepAliveTimeout: 4000,       // 4s (under local server's 5s limit)
  keepAliveMaxTimeout: 60000,   // 1min max keep-alive duration  
  headersTimeout: 90000,        // 90s for headers
  bodyTimeout: 300000,          // 5min for streaming responses
  connectTimeout: 90000,        // 90s connection timeout
  connections: 2,               // Conservative connection pooling
  pipelining: 1,                // Enable pipelining for better performance
};

/**
 * Checks if a URL is pointing to a local server
 * @param url The URL to check
 * @returns true if the URL is localhost or 127.0.0.1
 */
export function isLocalServerUrl(url: string | undefined): boolean {
  return !!(url && (url.includes('localhost') || url.includes('127.0.0.1')));
}

/**
 * Creates or returns a singleton undici Agent configured for local AI servers
 * @returns Agent configured for local AI server compatibility
 */
export function getLocalAIAgent(): Agent {
  if (!localAIAgentInstance) {
    // Create Agent with socket configuration interceptor
    localAIAgentInstance = new Agent({
      ...LOCAL_AI_AGENT_CONFIG,
      connect: {
        timeout: LOCAL_AI_AGENT_CONFIG.connectTimeout,
        // Apply socket configuration on connect
        lookup: undefined,
        // Note: We'll handle socket config in the dispatcher intercept below
      }
    });
    
    // Intercept dispatcher to configure sockets
    const originalDispatch = localAIAgentInstance.dispatch.bind(localAIAgentInstance);
    (localAIAgentInstance as any).dispatch = function(opts: any, handler: any) {
      const originalOnConnect = handler.onConnect;
      handler.onConnect = function(abort: any, context: any) {
        if (context?.socket) {
          console.log('[LocalAI] Configuring socket in undici dispatcher');
          context.socket.setNoDelay(true);
          context.socket.setKeepAlive(true, 1000);
        }
        return originalOnConnect?.call(this, abort, context);
      };
      return originalDispatch(opts, handler);
    };
  }
  return localAIAgentInstance;
}

/**
 * Resets the singleton instances (mainly for testing)
 */
export function resetLocalAIAgent(): void {
  if (localAIAgentInstance) {
    localAIAgentInstance.close();
    localAIAgentInstance = null;
  }
  
  // Also reset configured agents
  if (configuredAgents) {
    // Destroy the agents to clean up resources
    if (configuredAgents.httpAgent && typeof configuredAgents.httpAgent.destroy === 'function') {
      configuredAgents.httpAgent.destroy();
    }
    if (configuredAgents.httpsAgent && typeof configuredAgents.httpsAgent.destroy === 'function') {
      configuredAgents.httpsAgent.destroy();
    }
    configuredAgents = null;
  }
}

// Singleton socket-configured agents
let configuredAgents: { httpAgent: any; httpsAgent: any } | null = null;

/**
 * Creates HTTP/HTTPS agents with socket configuration for local servers
 * This ensures proper TCP socket settings (NoDelay and KeepAlive)
 * Returns singleton instances to avoid creating multiple event listeners
 */
export function getConfiguredAgents() {
  if (!configuredAgents) {
    
    const httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
    });
    
    const httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
    });
    
    // Configure sockets when created - this is the critical fix
    httpAgent.on('socket', (socket: any) => {
      console.log('[LocalAI] Socket event fired for HTTP agent');
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);
      socket.setTimeout(60000); // 60s timeout like successful tests
      console.log('[LocalAI] Configured HTTP socket with NoDelay, KeepAlive, and 60s timeout - success');
    });
    
    httpsAgent.on('socket', (socket: any) => {
      console.log('[LocalAI] Socket event fired for HTTPS agent');
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);
      socket.setTimeout(60000); // 60s timeout like successful tests
      console.log('[LocalAI] Configured HTTPS socket with NoDelay, KeepAlive, and 60s timeout - success');
    });
    
    configuredAgents = { httpAgent, httpsAgent };
  }
  
  return configuredAgents;
}

/**
 * Retry configuration for LM Studio streaming robustness
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 1 second between retries
  partialResponseThreshold: 2, // Consider response partial if we got at least 2 chunks before disconnect
};

/**
 * Makes a single HTTP request to LM Studio with proper socket configuration
 */
async function makeLocalAIRequest(
  url: string,
  init: RequestInit | undefined,
  isStreamingRequest: boolean,
  attemptNumber: number = 1
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    console.log(`[LocalAI] Attempt ${attemptNumber}: Making ${isStreamingRequest ? 'streaming' : 'non-streaming'} request to ${url}`);
    
    // Parse request body
    const requestBody = init?.body ? 
      (typeof init.body === 'string' ? init.body :
       init.body instanceof Buffer ? init.body.toString() :
       JSON.stringify(init.body)) : '';
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: init?.method || 'GET',
      headers: {
        ...(init?.headers as any || {}),
        'Content-Type': 'application/json',
        'Accept': isStreamingRequest ? 'text/event-stream' : 'application/json',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'User-Agent': 'llxprt-local-ai/1.0',
      },
      agent: false, // Disable agent pooling for LM Studio compatibility
    };
    
    const req = httpModule.request(options, (res) => {
      console.log(`[LocalAI] Attempt ${attemptNumber}: Response received: ${res.statusCode}`);
      
      let responseStream: ReadableStream;
      
      if (isStreamingRequest) {
        console.log(`[LocalAI] Attempt ${attemptNumber}: Creating SSE streaming response`);
        responseStream = new ReadableStream({
          start(controller) {
            console.log(`[LocalAI] Attempt ${attemptNumber}: Starting SSE streaming response`);
            let chunkCount = 0;
            let buffer = '';
            let hasReceivedData = false;
            
            res.on('data', (chunk) => {
              chunkCount++;
              hasReceivedData = true;
              const chunkStr = chunk.toString();
              console.log(`[LocalAI] Attempt ${attemptNumber}: SSE chunk ${chunkCount}: ${chunk.length} bytes`);
              
              try {
                buffer += chunkStr;
                const messages = buffer.split('\n\n');
                buffer = messages.pop() || '';
                
                for (const message of messages) {
                  if (message.trim()) {
                    controller.enqueue(new TextEncoder().encode(message + '\n\n'));
                  }
                }
              } catch (error) {
                console.error(`[LocalAI] Attempt ${attemptNumber}: Error processing SSE chunk:`, error);
                controller.error(error);
              }
            });
            
            res.on('end', () => {
              console.log(`[LocalAI] Attempt ${attemptNumber}: SSE stream completed normally after ${chunkCount} chunks`);
              try {
                if (buffer.trim()) {
                  controller.enqueue(new TextEncoder().encode(buffer + '\n\n'));
                }
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                controller.close();
              } catch (error) {
                console.error(`[LocalAI] Attempt ${attemptNumber}: Error closing SSE stream:`, error);
              }
            });
            
            res.on('error', (error) => {
              console.error(`[LocalAI] Attempt ${attemptNumber}: SSE stream error after ${chunkCount} chunks:`, error);
              
              // Check if this was a partial response that should be retried
              if (hasReceivedData && chunkCount >= RETRY_CONFIG.partialResponseThreshold) {
                console.log(`[LocalAI] Attempt ${attemptNumber}: Partial response detected (${chunkCount} chunks) - will trigger retry`);
                // Signal this as a retriable partial response
                const partialError = new Error('Partial response - retry needed');
                (partialError as any).isPartialResponse = true;
                (partialError as any).chunkCount = chunkCount;
                controller.error(partialError);
              } else {
                // Not enough data received, treat as normal error
                try {
                  if (chunkCount > 0) {
                    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                  }
                  controller.close();
                } catch (closeError) {
                  console.error(`[LocalAI] Attempt ${attemptNumber}: Error during SSE error handling:`, closeError);
                  controller.error(error);
                }
              }
            });
          }
        });
      } else {
        console.log(`[LocalAI] Attempt ${attemptNumber}: Creating buffered non-streaming response`);
        responseStream = new ReadableStream({
          start(controller) {
            console.log(`[LocalAI] Attempt ${attemptNumber}: Starting buffered response collection`);
            let chunkCount = 0;
            const chunks: Buffer[] = [];
            
            res.on('data', (chunk) => {
              chunkCount++;
              console.log(`[LocalAI] Attempt ${attemptNumber}: Buffered chunk ${chunkCount}: ${chunk.length} bytes`);
              chunks.push(chunk);
            });
            
            res.on('end', () => {
              console.log(`[LocalAI] Attempt ${attemptNumber}: Buffered response completed after ${chunkCount} chunks`);
              try {
                const fullResponse = Buffer.concat(chunks);
                controller.enqueue(fullResponse);
                controller.close();
              } catch (error) {
                console.error(`[LocalAI] Attempt ${attemptNumber}: Error sending buffered response:`, error);
                controller.error(error);
              }
            });
            
            res.on('error', (error) => {
              console.error(`[LocalAI] Attempt ${attemptNumber}: Buffered response error after ${chunkCount} chunks:`, error);
              controller.error(error);
            });
          }
        });
      }
      
      const response = new Response(responseStream, {
        status: res.statusCode || 200,
        statusText: res.statusMessage || 'OK',
        headers: res.headers as any,
      });
      
      console.log(`[LocalAI] Attempt ${attemptNumber}: ${isStreamingRequest ? 'SSE streaming' : 'Buffered'} response created`);
      resolve(response);
    });
    
    // Configure socket when it's assigned
    req.on('socket', (socket) => {
      console.log(`[LocalAI] Attempt ${attemptNumber}: Socket event fired - configuring socket`);
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);
      socket.setTimeout(60000);
      console.log(`[LocalAI] Attempt ${attemptNumber}: Socket configured with NoDelay, KeepAlive, and 60s timeout`);
    });
    
    req.on('error', (error) => {
      console.error(`[LocalAI] Attempt ${attemptNumber}: Request error:`, error);
      reject(error);
    });
    
    // Write request body if present
    if (init?.body && requestBody) {
      console.log(`[LocalAI] Attempt ${attemptNumber}: Writing ${isStreamingRequest ? 'streaming' : 'non-streaming'} request body (${Buffer.byteLength(requestBody)} bytes)`);
      
      if (!options.headers['content-length'] && !options.headers['Content-Length']) {
        req.setHeader('Content-Length', Buffer.byteLength(requestBody));
      }
      
      req.write(requestBody);
    }
    
    req.end();
  });
}

/**
 * Creates a fetch function that uses Node's native http/https with socket configuration
 * This gives us direct control over socket settings for local AI servers
 * Includes intelligent retry logic for LM Studio streaming disconnections
 */
export function createLocalAIFetch(): typeof fetch {
  console.log('[LocalAI] Creating robust fetch wrapper with retry logic and socket configuration');
  
  const customFetch = async function localAIFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    // Get URL string from input
    const url = typeof input === 'string' ? input : 
                input instanceof URL ? input.toString() :
                (input as Request).url;
    
    console.log(`[LocalAI] Robust fetch called for URL: ${url}`);
    
    // Check if this is a local server request
    if (isLocalServerUrl(url)) {
      // Parse request body to detect streaming
      const requestBody = init?.body ? 
        (typeof init.body === 'string' ? init.body :
         init.body instanceof Buffer ? init.body.toString() :
         JSON.stringify(init.body)) : '';
      
      const isStreamingRequest = requestBody.includes('"stream":true') || requestBody.includes('"stream": true');
      
      console.log(`[LocalAI] Detected ${isStreamingRequest ? 'streaming' : 'non-streaming'} request to local server`);
      
      // For non-streaming requests, use single attempt (they work perfectly)
      if (!isStreamingRequest) {
        console.log(`[LocalAI] Using single attempt for non-streaming request`);
        return makeLocalAIRequest(url, init, false, 1);
      }
      
      // For streaming requests, implement retry logic
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
        try {
          console.log(`[LocalAI] Streaming attempt ${attempt}/${RETRY_CONFIG.maxRetries}`);
          
          // Create a promise that resolves when the stream completes or rejects on partial response
          const result = await new Promise<Response>((resolve, reject) => {
            makeLocalAIRequest(url, init, true, attempt)
              .then(response => {
                const reader = response.body?.getReader();
                if (!reader) {
                  reject(new Error('No response body reader available'));
                  return;
                }
                
                let chunkCount = 0;
                const chunks: Uint8Array[] = [];
                
                const readChunks = async () => {
                  try {
                    while (true) {
                      const { done, value } = await reader.read();
                      
                      if (done) {
                        console.log(`[LocalAI] Streaming attempt ${attempt}: Completed successfully with ${chunkCount} total chunks`);
                        
                        // Create a successful response with all the chunks
                        const fullData = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
                        let offset = 0;
                        for (const chunk of chunks) {
                          fullData.set(chunk, offset);
                          offset += chunk.length;
                        }
                        
                        const successResponse = new Response(fullData, {
                          status: response.status,
                          statusText: response.statusText,
                          headers: response.headers,
                        });
                        
                        resolve(successResponse);
                        break;
                      }
                      
                      chunkCount++;
                      chunks.push(value);
                      console.log(`[LocalAI] Streaming attempt ${attempt}: Buffering chunk ${chunkCount}: ${value.length} bytes`);
                    }
                  } catch (error: any) {
                    console.error(`[LocalAI] Streaming attempt ${attempt}: Stream error after ${chunkCount} chunks:`, error);
                    
                    // Check if this qualifies as a partial response worth retrying
                    if (chunkCount >= RETRY_CONFIG.partialResponseThreshold && attempt < RETRY_CONFIG.maxRetries) {
                      console.log(`[LocalAI] Streaming attempt ${attempt}: Partial response detected (${chunkCount} chunks) - will retry`);
                      const partialError = new Error(`Partial response - got ${chunkCount} chunks before disconnect`);
                      (partialError as any).isPartialResponse = true;
                      (partialError as any).chunkCount = chunkCount;
                      reject(partialError);
                    } else {
                      console.log(`[LocalAI] Streaming attempt ${attempt}: Not enough chunks (${chunkCount}) or final attempt - failing`);
                      reject(error);
                    }
                  }
                };
                
                readChunks();
              })
              .catch(reject);
          });
          
          // If we get here, the request succeeded completely
          console.log(`[LocalAI] Streaming attempt ${attempt}: Successfully completed`);
          return result;
          
        } catch (error: any) {
          lastError = error;
          
          // Check if we should retry based on error type
          const shouldRetry = attempt < RETRY_CONFIG.maxRetries && 
                             (error.isPartialResponse || 
                              error.code === 'ECONNRESET' || 
                              error.message?.includes('aborted'));
          
          if (shouldRetry) {
            console.log(`[LocalAI] Streaming attempt ${attempt}: Retrying after ${error.isPartialResponse ? 'partial response' : 'error'} (${error.message}) in ${RETRY_CONFIG.retryDelay}ms`);
            await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.retryDelay));
          } else {
            console.error(`[LocalAI] Streaming attempt ${attempt}: Final failure, no more retries`);
            throw error;
          }
        }
      }
      
      // If we get here, all retries failed
      console.error(`[LocalAI] All ${RETRY_CONFIG.maxRetries} streaming attempts failed`);
      throw lastError || new Error('All streaming attempts failed');
    }
    
    console.log(`[LocalAI] Using default fetch for non-local URL: ${url}`);
    // For non-local servers, use the default fetch
    return fetch(input, init);
  };
  
  console.log('[LocalAI] Custom fetch wrapper created and ready');
  return customFetch;
}

/**
 * Get fetch function appropriate for the base URL
 * Returns custom fetch for local servers, standard fetch otherwise
 */
export function getFetchForUrl(baseUrl?: string): typeof fetch {
  if (isLocalServerUrl(baseUrl)) {
    return createLocalAIFetch();
  }
  return fetch;
}

/**
 * Get the appropriate API key for a given base URL
 * Returns default key for local servers if no key is provided
 */
export function getApiKeyForUrl(baseUrl?: string, providedKey?: string): string {
  // If a key is provided, use it
  if (providedKey && providedKey !== 'placeholder') {
    return providedKey;
  }
  
  // For local servers, use the default key
  if (isLocalServerUrl(baseUrl)) {
    return LOCAL_AI_DEFAULT_KEY;
  }
  
  // Otherwise return the provided key or placeholder
  return providedKey || 'placeholder';
}

/**
 * Get the appropriate HTTP agent for OpenAI SDK
 * Returns socket-configured agent for local servers
 * This is for the httpAgent option (which might work even though undocumented)
 */
export function getHttpAgentForUrl(baseUrl?: string): any {
  if (baseUrl && isLocalServerUrl(baseUrl)) {
    const urlObj = new URL(baseUrl);
    const isHttps = urlObj.protocol === 'https:';
    const { httpAgent, httpsAgent } = getConfiguredAgents();
    return isHttps ? httpsAgent : httpAgent;
  }
  return undefined;
}

/**
 * Configure OpenAI client options for local AI servers
 * This applies all necessary settings for robust local AI server connections
 */
export function configureLocalAIClientOptions(
  clientOptions: any,
  baseUrl?: string,
  context?: string
): void {
  if (!baseUrl || !isLocalServerUrl(baseUrl)) {
    return;
  }

  // Use our custom fetch that handles socket configuration
  const customFetch = getFetchForUrl(baseUrl);
  clientOptions.fetch = customFetch;
  
  const logContext = context ? `[${context}]` : '[LocalAI]';
  console.log(`${logContext} Configuring local AI server: ${baseUrl}`);
  console.log(`${logContext} Custom fetch attached:`, typeof customFetch === 'function' ? 'YES' : 'NO');
  
  // Use undici dispatcher for connection pooling
  clientOptions.fetchOptions = {
    dispatcher: getLocalAIAgent()
  };
  
  // Try httpAgent option (undocumented but might work)
  clientOptions.httpAgent = getHttpAgentForUrl(baseUrl);
  
  console.log(`${logContext} Socket configuration applied for local AI server`);
}