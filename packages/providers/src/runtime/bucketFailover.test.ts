import { describe, expect, it } from 'vitest';

import { executeWithBucketFailover } from './bucketFailover.js';

describe('executeWithBucketFailover', () => {
  it('normalizes non-Error failover throws before retrying the next bucket', async () => {
    const buckets = ['primary', 'secondary'];
    const seenBuckets: string[] = [];

    const result = await executeWithBucketFailover(
      { prompt: 'hello' },
      buckets,
      async (_request, bucket) => {
        seenBuckets.push(bucket);
        if (bucket === 'primary') {
          throw { message: 'quota exceeded', status: 429 };
        }
        return { content: 'ok' };
      },
    );

    expect(result).toStrictEqual({ content: 'ok' });
    expect(seenBuckets).toStrictEqual(buckets);
  });

  it('normalizes non-Error non-failover throws before rethrowing', async () => {
    const seenBuckets: string[] = [];

    await expect(
      executeWithBucketFailover(
        { prompt: 'hello' },
        ['primary', 'secondary'],
        (_request, bucket) => {
          seenBuckets.push(bucket);
          return Promise.reject('bad request');
        },
      ),
    ).rejects.toThrow('bad request');
    expect(seenBuckets).toStrictEqual(['primary']);
  });
});
