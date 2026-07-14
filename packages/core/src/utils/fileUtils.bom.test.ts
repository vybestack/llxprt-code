/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { detectBOM, readFileWithEncoding, isBinaryFile } from './fileUtils.js';

describe('fileUtils - BOM detection and encoding', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fsPromises.mkdtemp(
      path.join(await fsPromises.realpath(os.tmpdir()), 'fileUtils-bom-test-'),
    );
  });

  afterEach(async () => {
    if (testDir) {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    }
  });

  describe('detectBOM', () => {
    it('should detect UTF-8 BOM', () => {
      const buf = Buffer.from([0xef, 0xbb, 0xbf, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      const result = detectBOM(buf);
      expect(result).toStrictEqual({ encoding: 'utf8', bomLength: 3 });
    });

    it('should detect UTF-16 LE BOM', () => {
      const buf = Buffer.from([0xff, 0xfe, 0x48, 0x00, 0x65, 0x00]);
      const result = detectBOM(buf);
      expect(result).toStrictEqual({ encoding: 'utf16le', bomLength: 2 });
    });

    it('should detect UTF-16 BE BOM', () => {
      const buf = Buffer.from([0xfe, 0xff, 0x00, 0x48, 0x00, 0x65]);
      const result = detectBOM(buf);
      expect(result).toStrictEqual({ encoding: 'utf16be', bomLength: 2 });
    });

    it('should detect UTF-32 LE BOM', () => {
      const buf = Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x48, 0x00, 0x00, 0x00]);
      const result = detectBOM(buf);
      expect(result).toStrictEqual({ encoding: 'utf32le', bomLength: 4 });
    });

    it('should detect UTF-32 BE BOM', () => {
      const buf = Buffer.from([0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x00, 0x48]);
      const result = detectBOM(buf);
      expect(result).toStrictEqual({ encoding: 'utf32be', bomLength: 4 });
    });

    it('should return null for no BOM', () => {
      const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      const result = detectBOM(buf);
      expect(result).toBeNull();
    });

    it('should return null for empty buffer', () => {
      const buf = Buffer.alloc(0);
      const result = detectBOM(buf);
      expect(result).toBeNull();
    });

    it('should return null for partial BOM', () => {
      const buf = Buffer.from([0xef, 0xbb]); // Incomplete UTF-8 BOM
      const result = detectBOM(buf);
      expect(result).toBeNull();
    });
  });

  describe('readFileWithEncoding', () => {
    it('should read UTF-8 BOM file correctly', async () => {
      const content = 'Hello, 世界! 🌍';
      const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const utf8Content = Buffer.from(content, 'utf8');
      const fullBuffer = Buffer.concat([utf8Bom, utf8Content]);

      const filePath = path.join(testDir, 'utf8-bom.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await readFileWithEncoding(filePath);
      expect(result).toBe(content);
    });

    it('should read UTF-16 LE BOM file correctly', async () => {
      const content = 'Hello, 世界! 🌍';
      const utf16leBom = Buffer.from([0xff, 0xfe]);
      const utf16leContent = Buffer.from(content, 'utf16le');
      const fullBuffer = Buffer.concat([utf16leBom, utf16leContent]);

      const filePath = path.join(testDir, 'utf16le-bom.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await readFileWithEncoding(filePath);
      expect(result).toBe(content);
    });

    it('should read UTF-16 BE BOM file correctly', async () => {
      const content = 'Hello, 世界! 🌍';
      // Manually encode UTF-16 BE: each char as big-endian 16-bit
      const utf16beBom = Buffer.from([0xfe, 0xff]);
      const chars = Array.from(content);
      const utf16beBytes: number[] = [];

      for (const char of chars) {
        const code = char.codePointAt(0)!;
        if (code > 0xffff) {
          // Surrogate pair for emoji
          const surrogate1 = 0xd800 + ((code - 0x10000) >> 10);
          const surrogate2 = 0xdc00 + ((code - 0x10000) & 0x3ff);
          utf16beBytes.push((surrogate1 >> 8) & 0xff, surrogate1 & 0xff);
          utf16beBytes.push((surrogate2 >> 8) & 0xff, surrogate2 & 0xff);
        } else {
          utf16beBytes.push((code >> 8) & 0xff, code & 0xff);
        }
      }

      const utf16beContent = Buffer.from(utf16beBytes);
      const fullBuffer = Buffer.concat([utf16beBom, utf16beContent]);

      const filePath = path.join(testDir, 'utf16be-bom.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await readFileWithEncoding(filePath);
      expect(result).toBe(content);
    });

    it('should read UTF-32 LE BOM file correctly', async () => {
      const content = 'Hello, 世界! 🌍';
      const utf32leBom = Buffer.from([0xff, 0xfe, 0x00, 0x00]);

      const utf32leBytes: number[] = [];
      for (const char of Array.from(content)) {
        const code = char.codePointAt(0)!;
        utf32leBytes.push(
          code & 0xff,
          (code >> 8) & 0xff,
          (code >> 16) & 0xff,
          (code >> 24) & 0xff,
        );
      }

      const utf32leContent = Buffer.from(utf32leBytes);
      const fullBuffer = Buffer.concat([utf32leBom, utf32leContent]);

      const filePath = path.join(testDir, 'utf32le-bom.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await readFileWithEncoding(filePath);
      expect(result).toBe(content);
    });

    it('should read UTF-32 BE BOM file correctly', async () => {
      const content = 'Hello, 世界! 🌍';
      const utf32beBom = Buffer.from([0x00, 0x00, 0xfe, 0xff]);

      const utf32beBytes: number[] = [];
      for (const char of Array.from(content)) {
        const code = char.codePointAt(0)!;
        utf32beBytes.push(
          (code >> 24) & 0xff,
          (code >> 16) & 0xff,
          (code >> 8) & 0xff,
          code & 0xff,
        );
      }

      const utf32beContent = Buffer.from(utf32beBytes);
      const fullBuffer = Buffer.concat([utf32beBom, utf32beContent]);

      const filePath = path.join(testDir, 'utf32be-bom.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await readFileWithEncoding(filePath);
      expect(result).toBe(content);
    });

    it('should read file without BOM as UTF-8', async () => {
      const content = 'Hello, 世界!';
      const filePath = path.join(testDir, 'no-bom.txt');
      await fsPromises.writeFile(filePath, content, 'utf8');

      const result = await readFileWithEncoding(filePath);
      expect(result).toBe(content);
    });

    it('should handle empty file', async () => {
      const filePath = path.join(testDir, 'empty.txt');
      await fsPromises.writeFile(filePath, '');

      const result = await readFileWithEncoding(filePath);
      expect(result).toBe('');
    });
  });

  describe('isBinaryFile with BOM awareness', () => {
    it('should not treat UTF-8 BOM file as binary', async () => {
      const content = 'Hello, world!';
      const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
      const utf8Content = Buffer.from(content, 'utf8');
      const fullBuffer = Buffer.concat([utf8Bom, utf8Content]);

      const filePath = path.join(testDir, 'utf8-bom-test.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await isBinaryFile(filePath);
      expect(result).toBe(false);
    });

    it('should not treat UTF-16 LE BOM file as binary', async () => {
      const content = 'Hello, world!';
      const utf16leBom = Buffer.from([0xff, 0xfe]);
      const utf16leContent = Buffer.from(content, 'utf16le');
      const fullBuffer = Buffer.concat([utf16leBom, utf16leContent]);

      const filePath = path.join(testDir, 'utf16le-bom-test.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await isBinaryFile(filePath);
      expect(result).toBe(false);
    });

    it('should not treat UTF-16 BE BOM file as binary', async () => {
      const utf16beBom = Buffer.from([0xfe, 0xff]);
      // Simple ASCII in UTF-16 BE
      const utf16beContent = Buffer.from([
        0x00,
        0x48, // H
        0x00,
        0x65, // e
        0x00,
        0x6c, // l
        0x00,
        0x6c, // l
        0x00,
        0x6f, // o
        0x00,
        0x2c, // ,
        0x00,
        0x20, // space
        0x00,
        0x77, // w
        0x00,
        0x6f, // o
        0x00,
        0x72, // r
        0x00,
        0x6c, // l
        0x00,
        0x64, // d
        0x00,
        0x21, // !
      ]);
      const fullBuffer = Buffer.concat([utf16beBom, utf16beContent]);

      const filePath = path.join(testDir, 'utf16be-bom-test.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await isBinaryFile(filePath);
      expect(result).toBe(false);
    });

    it('should not treat UTF-32 LE BOM file as binary', async () => {
      const utf32leBom = Buffer.from([0xff, 0xfe, 0x00, 0x00]);
      const utf32leContent = Buffer.from([
        0x48,
        0x00,
        0x00,
        0x00, // H
        0x65,
        0x00,
        0x00,
        0x00, // e
        0x6c,
        0x00,
        0x00,
        0x00, // l
        0x6c,
        0x00,
        0x00,
        0x00, // l
        0x6f,
        0x00,
        0x00,
        0x00, // o
      ]);
      const fullBuffer = Buffer.concat([utf32leBom, utf32leContent]);

      const filePath = path.join(testDir, 'utf32le-bom-test.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await isBinaryFile(filePath);
      expect(result).toBe(false);
    });

    it('should not treat UTF-32 BE BOM file as binary', async () => {
      const utf32beBom = Buffer.from([0x00, 0x00, 0xfe, 0xff]);
      const utf32beContent = Buffer.from([
        0x00,
        0x00,
        0x00,
        0x48, // H
        0x00,
        0x00,
        0x00,
        0x65, // e
        0x00,
        0x00,
        0x00,
        0x6c, // l
        0x00,
        0x00,
        0x00,
        0x6c, // l
        0x00,
        0x00,
        0x00,
        0x6f, // o
      ]);
      const fullBuffer = Buffer.concat([utf32beBom, utf32beContent]);

      const filePath = path.join(testDir, 'utf32be-bom-test.txt');
      await fsPromises.writeFile(filePath, fullBuffer);

      const result = await isBinaryFile(filePath);
      expect(result).toBe(false);
    });

    it('should still treat actual binary file as binary', async () => {
      // PNG header + some binary data with null bytes
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const binaryData = Buffer.from([
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      ]); // IHDR chunk with nulls
      const fullContent = Buffer.concat([pngHeader, binaryData]);
      const filePath = path.join(testDir, 'test.png');
      await fsPromises.writeFile(filePath, fullContent);

      const result = await isBinaryFile(filePath);
      expect(result).toBe(true);
    });

    it('should treat file with null bytes (no BOM) as binary', async () => {
      const content = Buffer.from([
        0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64,
      ]);
      const filePath = path.join(testDir, 'null-bytes.bin');
      await fsPromises.writeFile(filePath, content);

      const result = await isBinaryFile(filePath);
      expect(result).toBe(true);
    });
  });
});
