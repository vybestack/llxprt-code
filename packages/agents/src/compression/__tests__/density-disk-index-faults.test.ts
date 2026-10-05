/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { DensityDiskIndex } from '../densityDiskIndex.js';

describe('density index resource cleanup', () => {
  it('closes all descriptors when allocating hash buckets fails', () => {
    const descriptors: number[] = [];
    const open = fs.openSync;
    const spy = vi
      .spyOn(fs, 'openSync')
      .mockImplementation((path, flags, mode) => {
        const fd = open(path, flags, mode);
        descriptors.push(fd);
        return fd;
      });
    const primary = new Error('hash bucket allocation failed');
    const truncate = vi.spyOn(fs, 'ftruncateSync').mockImplementation(() => {
      throw primary;
    });
    try {
      expect(() => new DensityDiskIndex()).toThrow(primary);
      expect(descriptors).toHaveLength(2);
      for (const fd of descriptors)
        expect(() => fs.fstatSync(fd)).toThrow('bad file descriptor');
    } finally {
      truncate.mockRestore();
      spy.mockRestore();
    }
  });
  it('propagates zero-progress writes and closes the failed index', () => {
    const index = new DensityDiskIndex();
    const write = vi.spyOn(fs, 'writeSync').mockReturnValue(0);
    try {
      expect(() => index.set('path', [1])).toThrow('made no progress');
    } finally {
      write.mockRestore();
      index.close();
    }
    expect(() => index.get('path')).toThrow('bad file descriptor');
  });
});
