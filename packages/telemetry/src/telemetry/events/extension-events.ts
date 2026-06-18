/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum IdeConnectionType {
  EXTENSION = 'extension',
  CLI = 'cli',
  WEB = 'web',
}

export class IdeConnectionEvent {
  'event.name': 'ide_connection';
  'event.timestamp': string;
  connectionType: IdeConnectionType;
  version?: string;

  constructor(connectionType: IdeConnectionType, version?: string) {
    this['event.name'] = 'ide_connection';
    this['event.timestamp'] = new Date().toISOString();
    this.connectionType = connectionType;
    this.version = version;
  }
}

export class ExtensionInstallEvent {
  extension_name: string;
  extension_version: string;
  extension_source: string;
  status: string;

  constructor(name: string, version: string, source: string, status: string) {
    this.extension_name = name;
    this.extension_version = version;
    this.extension_source = source;
    this.status = status;
  }
}

export class ExtensionUninstallEvent {
  extension_name: string;
  status: string;

  constructor(name: string, status: string) {
    this.extension_name = name;
    this.status = status;
  }
}

export class ExtensionEnableEvent {
  extension_name: string;
  setting_scope: string;

  constructor(name: string, scope: string) {
    this.extension_name = name;
    this.setting_scope = scope;
  }
}

export class ExtensionDisableEvent {
  extension_name: string;
  setting_scope: string;

  constructor(name: string, scope: string) {
    this.extension_name = name;
    this.setting_scope = scope;
  }
}
