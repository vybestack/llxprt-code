/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function sourceMembers(relativePath: string, declaration: string): string[] {
  const path = new URL(relativePath, import.meta.url);
  const source = ts.createSourceFile(
    path.pathname,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of source.statements) {
    if (
      (ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement)) &&
      statement.name?.text === declaration
    ) {
      return statement.members.flatMap((member) =>
        member.name === undefined ? [] : [member.name.getText(source)],
      );
    }
  }
  throw new Error(`Missing declaration ${declaration}`);
}

describe('raw authority producer removal', () => {
  describe('public facade raw authority', () => {
    it.each(['agentClient', 'providerManager', 'getMessageBus'])(
      'does not publish %s on the Agent contract or concrete facade',
      (name) => {
        expect(sourceMembers('../agent.ts', 'Agent')).not.toContain(name);
        expect(sourceMembers('../agentImpl.ts', 'AgentImpl')).not.toContain(
          name,
        );
      },
    );
    it.each([
      'config',
      'settingsOwner',
      'ownerClient',
      'messageBus',
      'ownership',
      'historyService',
      'injectedFactoryScheduler',
      'injectedFactoryCoordinator',
    ])(
      'does not leave the reverse-probe member %s on the concrete facade',
      (name) => {
        expect(sourceMembers('../agentImpl.ts', 'AgentImpl')).not.toContain(
          name,
        );
      },
    );
    it('does not export a raw temporary-client acquisition operation', () => {
      const source = readFileSync(
        new URL('../../session/session-new-client.ts', import.meta.url),
        'utf8',
      );
      expect(source).not.toMatch(
        /export\s+async\s+function\s+prepareDetachedSessionClient\b/,
      );
    });
  });
  it('does not publish resource-tuple provider acquisition helpers', () => {
    const source = readFileSync(
      new URL('../fromConfig-session.ts', import.meta.url),
      'utf8',
    );
    expect(
      sourceMembers('../fromConfig-session.ts', 'AdoptedSessionAssembly'),
    ).toContain('acquireAdoptedProviderManager');
    expect(source).not.toMatch(
      /export\s+(?:async\s+)?function\s+(?:acquireAdoptedProviderManager|acquireAdoptedOAuth|activateAdoptedProviders)\b/,
    );
  });
  it('does not expose a detached-client producer on the session owner', () => {
    expect(
      sourceMembers(
        '../../session/session-client-owner.ts',
        'SessionClientOwner',
      ),
    ).not.toContain('createDetachedAgentClient');
    const contract = readFileSync(
      new URL('../agent.ts', import.meta.url),
      'utf8',
    );
    expect(contract).not.toContain('createDetachedAgentClient');
  });
});
