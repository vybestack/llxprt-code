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
 * Detect whether a base URL points to a Qwen/DashScope endpoint.
 *
 * Covers dashscope.aliyuncs.com, portal.qwen.ai, api.qwen.com, and
 * their subdomains.
 */
export function isQwenBaseURL(baseURL: string | undefined): boolean {
  const candidate = baseURL?.trim();
  if (!candidate) return false;

  const normalized = candidate.includes('://')
    ? candidate
    : `https://${candidate}`;

  try {
    const hostname = new URL(normalized).hostname.toLowerCase();
    return (
      hostname === 'dashscope.aliyuncs.com' ||
      hostname.endsWith('.dashscope.aliyuncs.com') ||
      hostname === 'portal.qwen.ai' ||
      hostname.endsWith('.qwen.ai') ||
      hostname === 'api.qwen.com' ||
      hostname.endsWith('.qwen.com')
    );
  } catch {
    return false;
  }
}
