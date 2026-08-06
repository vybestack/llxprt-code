/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { statsCommand } from './statsCommand.js';
import type { CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';

const maybeGetCliOAuthManagerMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    maybeGetCliOAuthManager: maybeGetCliOAuthManagerMock,
  }),
}));

function getBucketsSubCommand() {
  const sub = statsCommand.subCommands?.find((sc) => sc.name === 'buckets');
  if (!sub) {
    throw new Error('buckets subcommand not found');
  }
  return sub;
}

function makeTokenStore(
  providerBuckets: Record<string, { buckets: string[]; stats: unknown }>,
) {
  return {
    listBuckets: vi.fn(async (provider: string) =>
      provider in providerBuckets ? providerBuckets[provider].buckets : [],
    ),
    getBucketStats: vi.fn(async (provider: string, bucket: string) => {
      if (!(provider in providerBuckets)) {
        return null;
      }
      const statsMap = providerBuckets[provider].stats as Record<
        string,
        unknown
      >;
      return statsMap[bucket] ?? null;
    }),
  };
}

function getBucketResultItem(context: CommandContext): {
  type: MessageType;
  text?: string;
} {
  const calls = (context.ui.addItem as Mock<typeof context.ui.addItem>).mock
    .calls;
  const items = calls.map((call) => call[0]) as Array<{
    type: MessageType;
    text?: string;
  }>;
  const bucketMarkers = [
    'OAuth Bucket Statistics',
    'No OAuth buckets available',
    'OAuth is not available or configured',
    'Failed to retrieve bucket statistics',
    'Usage data unavailable',
  ];
  const bucketItem = items.find((item) => {
    const text = item.text ?? '';
    return bucketMarkers.some((marker) => text.includes(marker));
  });
  if (!bucketItem) {
    throw new Error(
      `No /stats buckets result found in ${items.length} UI items`,
    );
  }
  return bucketItem;
}

describe('/stats buckets subcommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext();
    maybeGetCliOAuthManagerMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the codex bucket when the runtime manager has codex/default', async () => {
    const tokenStore = makeTokenStore({
      codex: {
        buckets: ['default'],
        stats: {
          default: {
            bucket: 'default',
            requestCount: 5,
            percentage: 100,
            lastUsed: 1700000000000,
          },
        },
      },
    });
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('codex');
    expect(lastItem.text).toContain('default');
    expect(lastItem.text).not.toContain('OAuth is not available or configured');
    expect(lastItem.text).not.toContain('No OAuth buckets available');
  });

  it('renders the claudecode bucket when the runtime manager has claudecode/default', async () => {
    const tokenStore = makeTokenStore({
      claudecode: {
        buckets: ['default'],
        stats: {
          default: {
            bucket: 'default',
            requestCount: 3,
            percentage: 100,
            lastUsed: 1700000000000,
          },
        },
      },
    });
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['claudecode'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('claudecode');
    expect(lastItem.text).toContain('default');
    expect(lastItem.text).not.toContain('OAuth is not available or configured');
  });

  it('renders both codex and claudecode providers together', async () => {
    const tokenStore = makeTokenStore({
      codex: {
        buckets: ['default'],
        stats: {
          default: {
            bucket: 'default',
            requestCount: 5,
            percentage: 62.5,
            lastUsed: 1700000000000,
          },
        },
      },
      claudecode: {
        buckets: ['default'],
        stats: {
          default: {
            bucket: 'default',
            requestCount: 3,
            percentage: 37.5,
            lastUsed: 1700000000000,
          },
        },
      },
    });
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex', 'claudecode'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('codex');
    expect(lastItem.text).toContain('claudecode');
  });

  it('shows the unavailable message when the runtime manager is genuinely absent', async () => {
    maybeGetCliOAuthManagerMock.mockReturnValue(null);

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('OAuth is not available or configured');
  });

  it('shows No OAuth buckets available when the manager exists but has zero buckets', async () => {
    const tokenStore = makeTokenStore({});
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex', 'claudecode'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('No OAuth buckets available');
    expect(lastItem.text).not.toContain('OAuth is not available or configured');
  });

  it('does not hide buckets from one provider when listing another fails', async () => {
    const tokenStore = {
      listBuckets: vi.fn(async (provider: string) => {
        if (provider === 'codex') {
          throw new Error('codex store read failure');
        }
        return ['default'];
      }),
      getBucketStats: vi.fn(async () => ({
        bucket: 'default',
        requestCount: 3,
        percentage: 100,
        lastUsed: 1700000000000,
      })),
    };
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex', 'claudecode'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('claudecode');
    expect(lastItem.text).toContain('default');
    expect(lastItem.text).not.toContain('OAuth is not available or configured');
    expect(lastItem.text).not.toContain('No OAuth buckets available');
  });

  it('does not hide buckets from one provider when getBucketStats throws for another', async () => {
    const tokenStore = {
      listBuckets: vi.fn(async () => ['default']),
      getBucketStats: vi.fn(async (provider: string) => {
        if (provider === 'codex') {
          throw new Error('codex stats read failure');
        }
        return {
          bucket: 'default',
          requestCount: 3,
          percentage: 100,
          lastUsed: 1700000000000,
        };
      }),
    };
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex', 'claudecode'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('claudecode');
    expect(lastItem.text).toContain('default');
    expect(lastItem.text).toContain('codex');
    expect(lastItem.text).toContain('unavailable');
    expect(lastItem.text).not.toContain('OAuth is not available or configured');
    expect(lastItem.text).not.toContain('No OAuth buckets available');
  });

  it('shows real request count and percentage from attributed bucket stats', async () => {
    const tokenStore = makeTokenStore({
      codex: {
        buckets: ['default', 'work'],
        stats: {
          default: {
            bucket: 'default',
            requestCount: 7,
            percentage: 70,
            lastUsed: 1700000000000,
          },
          work: {
            bucket: 'work',
            requestCount: 3,
            percentage: 30,
            lastUsed: 1700000000001,
          },
        },
      },
    });
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('7 requests (70.0%)');
    expect(lastItem.text).toContain('3 requests (30.0%)');
  });

  it('represents unavailable usage as unavailable instead of fabricated zeros when getBucketStats returns null', async () => {
    const tokenStore = makeTokenStore({
      codex: {
        buckets: ['default'],
        stats: {
          default: null,
        },
      },
    });
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex'],
      getTokenStore: () => tokenStore,
    });

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('codex');
    expect(lastItem.text).toContain('default');
    expect(lastItem.text).not.toContain('0 requests');
    expect(lastItem.text).toContain('unavailable');
  });

  it('does not depend on context.services.oauthManager', async () => {
    const tokenStore = makeTokenStore({
      codex: {
        buckets: ['default'],
        stats: {
          default: {
            bucket: 'default',
            requestCount: 5,
            percentage: 100,
            lastUsed: 1700000000000,
          },
        },
      },
    });
    maybeGetCliOAuthManagerMock.mockReturnValue({
      getSupportedProviders: () => ['codex'],
      getTokenStore: () => tokenStore,
    });
    // Explicitly do NOT set context.services.oauthManager — the command must
    // discover the manager through the runtime API, not command context.
    mockContext.services.oauthManager = undefined;

    await getBucketsSubCommand().action!(mockContext, '');

    const lastItem = getBucketResultItem(mockContext);

    expect(lastItem.type).toBe(MessageType.INFO);
    expect(lastItem.text).toContain('codex');
    expect(lastItem.text).not.toContain('OAuth is not available or configured');
  });
});
