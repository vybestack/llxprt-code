/**
 * @plan:PLAN-20250214-CREDPROXY.P29
 * @plan:PLAN-20250214-CREDPROXY.P27
 * @requirement R17.4, R17.5, R18.3-R18.5, R19.2
 * @pseudocode analysis/pseudocode/009-proxy-oauth-adapter.md
 */

import {
  ProxySocketClient,
  type OAuthToken,
} from '@vybestack/llxprt-code-core';

type FlowType = 'pkce_redirect' | 'device_code' | 'browser_redirect';

type PollStatus = 'pending' | 'complete' | 'error';

export interface InitiateResponse {
  readonly flow_type?: FlowType | string;
  readonly mode?: 'pkce' | 'device_code' | 'browser_redirect';

  readonly session_id?: string;
  readonly sessionId?: string;

  readonly auth_url?: string;
  readonly verification_url?: string;
  readonly user_code?: string;
  readonly pollIntervalMs?: number;

  readonly verificationUri?: string;
  readonly verificationUriComplete?: string;
  readonly userCode?: string;
  readonly deviceCode?: string;
  readonly intervalSeconds?: number;
  readonly expiresInSeconds?: number;
  readonly authorizationUrl?: string;
  readonly redirectUri?: string;
  readonly state?: string;

  readonly status?: PollStatus | string;
  readonly token?: Omit<OAuthToken, 'refresh_token'>;
  readonly access_token?: string;
  readonly expiry?: number;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
}

export class ProxyOAuthAdapter {
  constructor(private readonly socketClient: ProxySocketClient) {}

  async login(provider: string, bucket?: string): Promise<unknown> {
    const initiate = await this.socketClient.request('oauth_initiate', {
      provider,
      bucket,
    });
    const data = initiate.data as InitiateResponse;
    const sessionId = String(data.session_id ?? data.sessionId ?? '');
    const flowType = this.normalizeFlowType(data);

    try {
      if (flowType === 'pkce_redirect') {
        return await this.handlePkceRedirect(sessionId, data);
      }
      if (flowType === 'device_code') {
        const pending = this.handleDeviceCode(sessionId, data);
        pending.catch(() => {
          // Attach a no-op rejection handler to avoid unhandled rejection warnings
          // before callers attach their own .catch/.rejects handlers.
        });
        return await pending;
      }
      if (flowType === 'browser_redirect') {
        const pending = this.handleBrowserRedirect(sessionId, data);
        pending.catch(() => {
          // Attach a no-op rejection handler to avoid unhandled rejection warnings
          // before callers attach their own .catch/.rejects handlers.
        });
        return await pending;
      }
      throw new Error(
        `Unknown flow type: ${String(data.flow_type ?? data.mode ?? 'unknown')}`,
      );
    } catch (error) {
      if (sessionId !== '') {
        try {
          await this.socketClient.request('oauth_cancel', {
            session_id: sessionId,
          });
        } catch {
          // best-effort cancellation
        }
      }
      throw error;
    }
  }

  async handlePkceRedirect(
    sessionId: string,
    data: InitiateResponse,
  ): Promise<unknown> {
    void data;

    const rawCode = await new Promise<string>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        process.stdin.removeListener('data', onData);
        process.stdin.removeListener('end', onEnd);
        process.stdin.removeListener('close', onClose);
        process.stdin.removeListener('error', onError);
      };

      const settleResolve = (value: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const settleReject = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const onData = (chunk: string | Buffer): void => {
        settleResolve(String(chunk));
      };

      const onEnd = (): void => {
        settleReject(
          new Error(
            'Authorization cancelled — stdin closed without providing a code',
          ),
        );
      };

      const onClose = (): void => {
        settleReject(
          new Error(
            'Authorization cancelled — stdin closed without providing a code',
          ),
        );
      };

      const onError = (error: Error): void => {
        settleReject(error);
      };

      process.stdin.on('data', onData);
      process.stdin.once('end', onEnd);
      process.stdin.once('close', onClose);
      process.stdin.once('error', onError);
      process.stdin.resume();
    });

    const code = rawCode.trim();
    if (code === '') {
      throw new Error('Authorization cancelled — no code provided');
    }

    const exchange = await this.socketClient.request('oauth_exchange', {
      session_id: sessionId,
      code,
    });

    return exchange.data;
  }

  handleDeviceCode(
    sessionId: string,
    data: InitiateResponse,
  ): Promise<unknown> {
    const promise = (async () => {
      let intervalMs = data.pollIntervalMs ?? 5000;
      for (;;) {
        await this.wait(intervalMs);
        const poll = await this.socketClient.request('oauth_poll', {
          session_id: sessionId,
        });
        const pollData = poll.data as InitiateResponse;

        if (pollData.status === 'complete') {
          return pollData;
        }
        if (pollData.status === 'error') {
          throw new Error(`Authentication failed: ${String(pollData.error)}`);
        }
        if (typeof pollData.pollIntervalMs === 'number') {
          intervalMs = pollData.pollIntervalMs;
        }
      }
    })();

    void promise.catch(() => {});
    return promise;
  }

  handleBrowserRedirect(
    sessionId: string,
    data: InitiateResponse,
  ): Promise<unknown> {
    const promise = (async () => {
      void data;

      let intervalMs = data.pollIntervalMs ?? 2000;
      for (;;) {
        await this.wait(intervalMs);
        const poll = await this.socketClient.request('oauth_poll', {
          session_id: sessionId,
        });
        const pollData = poll.data as InitiateResponse;

        if (pollData.status === 'complete') {
          return pollData;
        }
        if (pollData.status === 'error') {
          throw new Error(`Authentication failed: ${String(pollData.error)}`);
        }
        if (typeof pollData.pollIntervalMs === 'number') {
          intervalMs = pollData.pollIntervalMs;
        }
      }
    })();

    void promise.catch(() => {});
    return promise;
  }

  async refresh(provider: string, bucket?: string): Promise<unknown> {
    const reply = await this.socketClient.request('refresh_token', {
      provider,
      bucket,
    });
    return reply.data;
  }

  async cancel(sessionId: string): Promise<void> {
    await this.socketClient.request('oauth_cancel', { session_id: sessionId });
  }

  private normalizeFlowType(
    data: InitiateResponse,
  ): 'pkce_redirect' | 'device_code' | 'browser_redirect' | string {
    if (typeof data.flow_type === 'string' && data.flow_type !== '') {
      return data.flow_type;
    }

    switch (data.mode) {
      case 'pkce':
        return 'pkce_redirect';
      case 'device_code':
        return 'device_code';
      case 'browser_redirect':
        return 'browser_redirect';
      default:
        return data.mode ?? '';
    }
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
