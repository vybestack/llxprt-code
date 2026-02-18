/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read-only provider key storage that proxies read operations through
 * the credential proxy Unix socket. Write operations are blocked.
 *
 * @plan PLAN-20250214-CREDPROXY.P12
 * @requirement R9
 * @pseudocode analysis/pseudocode/004-proxy-provider-key-storage.md
 */

import { ProxySocketClient } from './proxy-socket-client.js';

export class ProxyProviderKeyStorage {
  private readonly client: ProxySocketClient;

  constructor(client: ProxySocketClient) {
    this.client = client;
  }

  async getKey(name: string): Promise<string | null> {
    const response = await this.client.request('get_api_key', { name });
    if (!response.ok) {
      if (response.code === 'NOT_FOUND') return null;
      throw new Error(response.error ?? 'proxy error');
    }
    return response.data!.key as string;
  }

  async listKeys(): Promise<string[]> {
    const response = await this.client.request('list_api_keys', {});
    if (!response.ok) {
      throw new Error(response.error ?? 'proxy error');
    }
    return response.data!.keys as string[];
  }

  async hasKey(name: string): Promise<boolean> {
    const response = await this.client.request('has_api_key', { name });
    if (!response.ok) {
      throw new Error(response.error ?? 'proxy error');
    }
    return response.data!.exists as boolean;
  }

  async saveKey(_name: string, _apiKey: string): Promise<void> {
    throw new Error('API key management is not available in sandbox mode');
  }

  async deleteKey(_name: string): Promise<boolean> {
    throw new Error('API key management is not available in sandbox mode');
  }
}
