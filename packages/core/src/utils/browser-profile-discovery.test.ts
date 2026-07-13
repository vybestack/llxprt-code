/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { discoverBrowserProfiles } from './browser-profile-discovery.js';

describe('discoverBrowserProfiles', () => {
  describe('Chrome', () => {
    it('discovers profiles from Chrome Local State JSON', () => {
      const localState = {
        profile: {
          info_cache: {
            Default: { name: 'Person 1', gaia_name: '' },
            'Profile 1': { name: 'Work', gaia_name: 'work@example.com' },
            'Profile 2': {
              name: 'Personal',
              gaia_name: 'personal@example.com',
            },
          },
        },
      };

      const profiles = discoverBrowserProfiles('chrome', {
        platform: 'darwin',
        homeDir: '/home/user',
        fileExists: () => true,
        readFile: () => JSON.stringify(localState),
      });

      expect(profiles).toHaveLength(3);
      expect(profiles).toContainEqual({
        directoryName: 'Default',
        displayName: 'Person 1',
      });
      expect(profiles).toContainEqual({
        directoryName: 'Profile 1',
        displayName: 'Work',
      });
      expect(profiles).toContainEqual({
        directoryName: 'Profile 2',
        displayName: 'Personal',
      });
    });

    it('returns empty array when Local State file is missing', () => {
      const profiles = discoverBrowserProfiles('chrome', {
        platform: 'darwin',
        homeDir: '/home/user',
        fileExists: () => false,
        readFile: () => '',
      });

      expect(profiles).toStrictEqual([]);
    });

    it('returns empty array when Local State JSON is malformed', () => {
      const profiles = discoverBrowserProfiles('chrome', {
        platform: 'darwin',
        homeDir: '/home/user',
        fileExists: () => true,
        readFile: () => 'not valid json {{{',
      });

      expect(profiles).toStrictEqual([]);
    });

    it('returns empty array when info_cache is missing', () => {
      const profiles = discoverBrowserProfiles('chrome', {
        platform: 'darwin',
        homeDir: '/home/user',
        fileExists: () => true,
        readFile: () => JSON.stringify({ profile: {} }),
      });

      expect(profiles).toStrictEqual([]);
    });

    it('uses the default userDataDir for darwin', () => {
      let capturedPath = '';
      const localState = {
        profile: {
          info_cache: {
            Default: { name: 'Default' },
          },
        },
      };

      discoverBrowserProfiles('chrome', {
        platform: 'darwin',
        homeDir: '/Users/testuser',
        fileExists: (p) => {
          capturedPath = p;
          return true;
        },
        readFile: () => JSON.stringify(localState),
      });

      expect(capturedPath).toContain(
        'Library/Application Support/Google/Chrome/Local State',
      );
    });

    it('uses the default userDataDir for linux', () => {
      let capturedPath = '';
      const localState = {
        profile: {
          info_cache: {
            Default: { name: 'Default' },
          },
        },
      };

      discoverBrowserProfiles('chrome', {
        platform: 'linux',
        homeDir: '/home/testuser',
        fileExists: (p) => {
          capturedPath = p;
          return true;
        },
        readFile: () => JSON.stringify(localState),
      });

      expect(capturedPath).toContain('.config/google-chrome/Local State');
    });

    it('uses the default userDataDir for win32', () => {
      let capturedPath = '';
      const localState = {
        profile: {
          info_cache: {
            Default: { name: 'Default' },
          },
        },
      };

      discoverBrowserProfiles('chrome', {
        platform: 'win32',
        homeDir: 'C:\\Users\\testuser',
        fileExists: (p) => {
          capturedPath = p;
          return true;
        },
        readFile: () => JSON.stringify(localState),
      });

      expect(capturedPath).toContain('Google');
      expect(capturedPath).toContain('Chrome');
      expect(capturedPath).toContain('Local State');
    });

    it('uses provided userDataDir override', () => {
      let capturedPath = '';
      const localState = {
        profile: {
          info_cache: {
            Default: { name: 'Default' },
          },
        },
      };

      discoverBrowserProfiles('chrome', {
        platform: 'linux',
        userDataDir: '/custom/chrome/dir',
        fileExists: (p) => {
          capturedPath = p;
          return true;
        },
        readFile: () => JSON.stringify(localState),
      });

      expect(capturedPath).toBe('/custom/chrome/dir/Local State');
    });
  });

  describe('Firefox', () => {
    it('discovers profiles from profiles.ini using Name (not Path) as the profile identifier', () => {
      // Firefox's -P flag selects by Name, not Path. When they differ (as
      // they do for the "dev" profile below), discovery must surface Name so
      // the launcher passes the correct value to -P.
      const profilesIni = `[General]
StartWithLastProfile=1

[Profile0]
Name=default
IsRelative=1
Path=xxxxxxxx.default

[Profile1]
Name=dev
IsRelative=1
Path=yyyyyyyy.dev`;

      const profiles = discoverBrowserProfiles('firefox', {
        platform: 'darwin',
        homeDir: '/home/user',
        fileExists: () => true,
        readFile: () => profilesIni,
      });

      expect(profiles).toHaveLength(2);
      expect(profiles).toContainEqual({
        directoryName: 'default',
        displayName: 'default',
      });
      expect(profiles).toContainEqual({
        directoryName: 'dev',
        displayName: 'dev',
      });
    });

    it('returns empty array when profiles.ini is missing', () => {
      const profiles = discoverBrowserProfiles('firefox', {
        platform: 'darwin',
        homeDir: '/home/user',
        fileExists: () => false,
        readFile: () => '',
      });

      expect(profiles).toStrictEqual([]);
    });

    it('returns empty array when profiles.ini has no Profile sections', () => {
      const profiles = discoverBrowserProfiles('firefox', {
        platform: 'darwin',
        homeDir: '/home/user',
        fileExists: () => true,
        readFile: () => '[General]\nStartWithLastProfile=1\n',
      });

      expect(profiles).toStrictEqual([]);
    });
  });

  describe('Safari', () => {
    it('returns a single default entry', () => {
      const profiles = discoverBrowserProfiles('safari', {
        platform: 'darwin',
      });

      expect(profiles).toStrictEqual([
        { directoryName: 'Default', displayName: 'Safari' },
      ]);
    });
  });
});
