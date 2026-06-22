/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanupExpiredSessions } from './sessionCleanup.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { SESSION_FILE_PREFIX } from '@vybestack/llxprt-code-storage';
import type { Settings } from '../config/settings.js';
import * as fs from 'node:fs/promises';
import { getAllSessionFiles } from './sessionUtils.js';

vi.mock('fs/promises');
vi.mock('./sessionUtils.js', () => ({
  getAllSessionFiles: vi.fn(),
}));

import {
  createMockConfig,
  createTestSessions,
} from './sessionCleanup-test-helpers.js';

const mockFs = vi.mocked(fs);
const mockGetAllSessionFiles = vi.mocked(getAllSessionFiles);

describe('Session Cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const sessions = createTestSessions();
    mockGetAllSessionFiles.mockResolvedValue(
      sessions.map((session) => ({
        fileName: session.fileName,
        sessionInfo: session,
      })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseRetentionPeriod format validation', () => {
    // Test all supported formats
    it.each([
      ['1h', 60 * 60 * 1000],
      ['24h', 24 * 60 * 60 * 1000],
      ['168h', 168 * 60 * 60 * 1000],
      ['1d', 24 * 60 * 60 * 1000],
      ['7d', 7 * 24 * 60 * 60 * 1000],
      ['30d', 30 * 24 * 60 * 60 * 1000],
      ['365d', 365 * 24 * 60 * 60 * 1000],
      ['1w', 7 * 24 * 60 * 60 * 1000],
      ['2w', 14 * 24 * 60 * 60 * 1000],
      ['4w', 28 * 24 * 60 * 60 * 1000],
      ['52w', 364 * 24 * 60 * 60 * 1000],
      ['1m', 30 * 24 * 60 * 60 * 1000],
      ['3m', 90 * 24 * 60 * 60 * 1000],
      ['6m', 180 * 24 * 60 * 60 * 1000],
      ['12m', 360 * 24 * 60 * 60 * 1000],
    ])('should correctly parse valid format %s', async (input) => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: input,
          // Set minRetention to 1h to allow testing of hour-based maxAge values
          minRetention: '1h',
        },
      };

      mockGetAllSessionFiles.mockResolvedValue([]);

      // If it parses correctly, cleanup should proceed without error
      const result = await cleanupExpiredSessions(config, settings);
      expect(result.disabled).toBe(false);
      expect(result.failed).toBe(0);
    });

    // Test invalid formats
    it.each([
      '30', // Missing unit
      '30x', // Invalid unit
      'd', // No number
      '1.5d', // Decimal not supported
      '-5d', // Negative number
      '1 d', // Space in format
      '1dd', // Double unit
      'abc', // Non-numeric
      '30s', // Unsupported unit (seconds)
      '30y', // Unsupported unit (years)
      '0d', // Zero value (technically valid regex but semantically invalid)
    ])('should reject invalid format %s', async (input) => {
      const config = createMockConfig({
        getDebugMode: vi.fn().mockReturnValue(true),
      });
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: input,
        },
      };

      const errorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          input === '0d'
            ? 'Invalid retention period: 0d. Value must be greater than 0'
            : `Invalid retention period format: ${input}`,
        ),
      );

      errorSpy.mockRestore();
    });

    // Test special case - empty string
    it('should reject empty string', async () => {
      const config = createMockConfig({
        getDebugMode: vi.fn().mockReturnValue(true),
      });
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '',
        },
      };

      const errorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      // Empty string means no valid retention method specified
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Either maxAge or maxCount must be specified'),
      );

      errorSpy.mockRestore();
    });

    // Test edge cases
    it('should handle very large numbers', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '9999d', // Very large number
        },
      };

      mockGetAllSessionFiles.mockResolvedValue([]);

      const result = await cleanupExpiredSessions(config, settings);
      expect(result.disabled).toBe(false);
      expect(result.failed).toBe(0);
    });

    it('should validate minRetention format', async () => {
      const config = createMockConfig({
        getDebugMode: vi.fn().mockReturnValue(true),
      });
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '5d',
          minRetention: 'invalid-format', // Invalid minRetention
        },
      };

      mockGetAllSessionFiles.mockResolvedValue([]);

      // Should fall back to default minRetention and proceed
      const result = await cleanupExpiredSessions(config, settings);

      // Since maxAge (5d) > default minRetention (1d), this should succeed
      expect(result.disabled).toBe(false);
      expect(result.failed).toBe(0);
    });
  });

  describe('Configuration validation', () => {
    it('should require either maxAge or maxCount', async () => {
      const config = createMockConfig({
        getDebugMode: vi.fn().mockReturnValue(true),
      });
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          // Neither maxAge nor maxCount specified
        },
      };

      const errorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Either maxAge or maxCount must be specified'),
      );

      errorSpy.mockRestore();
    });

    it('should validate maxCount range', async () => {
      const config = createMockConfig({
        getDebugMode: vi.fn().mockReturnValue(true),
      });
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxCount: 0, // Invalid count
        },
      };

      const errorSpy = vi
        .spyOn(DebugLogger.prototype, 'error')
        .mockImplementation(() => {});

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(true);
      expect(result.scanned).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('maxCount must be at least 1'),
      );

      errorSpy.mockRestore();
    });

    describe('maxAge format validation', () => {
      it('should reject invalid maxAge format - no unit', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '30', // Missing unit
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid retention period format: 30'),
        );

        errorSpy.mockRestore();
      });

      it('should reject invalid maxAge format - invalid unit', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '30x', // Invalid unit 'x'
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid retention period format: 30x'),
        );

        errorSpy.mockRestore();
      });

      it('should reject invalid maxAge format - no number', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: 'd', // No number
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid retention period format: d'),
        );

        errorSpy.mockRestore();
      });

      it('should reject invalid maxAge format - decimal number', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '1.5d', // Decimal not supported
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid retention period format: 1.5d'),
        );

        errorSpy.mockRestore();
      });

      it('should reject invalid maxAge format - negative number', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '-5d', // Negative not allowed
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid retention period format: -5d'),
        );

        errorSpy.mockRestore();
      });

      it('should accept valid maxAge format - hours', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '48h', // Valid: 48 hours
            maxCount: 10, // Need at least one valid retention method
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should not reject the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should accept valid maxAge format - days', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '7d', // Valid: 7 days
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should not reject the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should accept valid maxAge format - weeks', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '2w', // Valid: 2 weeks
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should not reject the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should accept valid maxAge format - months', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '3m', // Valid: 3 months
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should not reject the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });
    });

    describe('minRetention validation', () => {
      it('should reject maxAge less than default minRetention (1d)', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '12h', // Less than default 1d minRetention
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'maxAge cannot be less than minRetention (1d)',
          ),
        );

        errorSpy.mockRestore();
      });

      it('should reject maxAge less than custom minRetention', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '2d',
            minRetention: '3d', // maxAge < minRetention
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'maxAge cannot be less than minRetention (3d)',
          ),
        );

        errorSpy.mockRestore();
      });

      it('should accept maxAge equal to minRetention', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '2d',
            minRetention: '2d', // maxAge == minRetention (edge case)
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should not reject the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should accept maxAge greater than minRetention', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '7d',
            minRetention: '2d', // maxAge > minRetention
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should not reject the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should handle invalid minRetention format gracefully', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '5d',
            minRetention: 'invalid', // Invalid format
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        // When minRetention is invalid, it should default to 1d
        // Since maxAge (5d) > default minRetention (1d), this should be valid
        const result = await cleanupExpiredSessions(config, settings);

        // Should not reject due to minRetention (falls back to default)
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });
    });

    describe('maxCount boundary validation', () => {
      it('should accept maxCount = 1 (minimum valid)', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxCount: 1, // Minimum valid value
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should accept the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should accept maxCount = 1000 (maximum valid)', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxCount: 1000, // Maximum valid value
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should accept the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should reject negative maxCount', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxCount: -1, // Negative value
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('maxCount must be at least 1'),
        );

        errorSpy.mockRestore();
      });

      it('should accept valid maxCount in normal range', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxCount: 50, // Normal valid value
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should accept the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });
    });

    describe('combined configuration validation', () => {
      it('should accept valid maxAge and maxCount together', async () => {
        const config = createMockConfig();
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: '30d',
            maxCount: 10,
          },
        };

        mockGetAllSessionFiles.mockResolvedValue([]);

        const result = await cleanupExpiredSessions(config, settings);

        // Should accept the configuration
        expect(result.disabled).toBe(false);
        expect(result.scanned).toBe(0);
        expect(result.failed).toBe(0);
      });

      it('should reject if both maxAge and maxCount are invalid', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: 'invalid',
            maxCount: 0,
          },
        };

        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        // Should fail on first validation error (maxAge format)
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid retention period format'),
        );

        errorSpy.mockRestore();
      });

      it('should reject if maxAge is invalid even when maxCount is valid', async () => {
        const config = createMockConfig({
          getDebugMode: vi.fn().mockReturnValue(true),
        });
        const settings: Settings = {
          sessionRetention: {
            enabled: true,
            maxAge: 'invalid', // Invalid format
            maxCount: 5, // Valid count
          },
        };

        // The validation logic rejects invalid maxAge format even if maxCount is valid
        const errorSpy = vi
          .spyOn(DebugLogger.prototype, 'error')
          .mockImplementation(() => {});

        const result = await cleanupExpiredSessions(config, settings);

        // Should reject due to invalid maxAge format
        expect(result.disabled).toBe(true);
        expect(result.scanned).toBe(0);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid retention period format'),
        );

        errorSpy.mockRestore();
      });
    });

    it('should never throw an exception, always returning a result', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '7d',
        },
      };

      // Mock getSessionFiles to throw an error
      mockGetAllSessionFiles.mockRejectedValue(
        new Error('Failed to read directory'),
      );

      // Should not throw, should return a result with errors
      const result = await cleanupExpiredSessions(config, settings);

      expect(result).toBeDefined();
      expect(result.disabled).toBe(false);
      expect(result.failed).toBe(1);
    });

    it('should delete corrupted session files', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '30d',
        },
      };

      // Mock getAllSessionFiles to return both valid and corrupted files
      const validSession = createTestSessions()[0];
      mockGetAllSessionFiles.mockResolvedValue([
        { fileName: validSession.fileName, sessionInfo: validSession },
        {
          fileName: `${SESSION_FILE_PREFIX}2025-01-02T10-00-00-corrupt1.json`,
          sessionInfo: null,
        },
        {
          fileName: `${SESSION_FILE_PREFIX}2025-01-03T10-00-00-corrupt2.json`,
          sessionInfo: null,
        },
      ]);

      mockFs.unlink.mockResolvedValue(undefined);

      const result = await cleanupExpiredSessions(config, settings);

      expect(result.disabled).toBe(false);
      expect(result.scanned).toBe(3); // 1 valid + 2 corrupted
      expect(result.deleted).toBe(2); // Should delete the 2 corrupted files
      expect(result.skipped).toBe(1); // The valid session is kept

      // Verify corrupted files were deleted
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('corrupt1.json'),
      );
      expect(mockFs.unlink).toHaveBeenCalledWith(
        expect.stringContaining('corrupt2.json'),
      );
    });

    it('should handle unexpected errors without throwing', async () => {
      const config = createMockConfig();
      const settings: Settings = {
        sessionRetention: {
          enabled: true,
          maxAge: '7d',
        },
      };

      // Mock getSessionFiles to throw a non-Error object
      mockGetAllSessionFiles.mockRejectedValue('String error');

      // Should not throw, should return a result with errors
      const result = await cleanupExpiredSessions(config, settings);

      expect(result).toBeDefined();
      expect(result.disabled).toBe(false);
      expect(result.failed).toBe(1);
    });
  });
});
