/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P16
 * @requirement:REQ-009
 * @requirement:REQ-004
 * @requirement:REQ-005
 * @pseudocode switch-rebind.md steps 70-78 (apply), 30-42 (provider switch),
 *   90-94 (param mutators)
 *
 * ProfilesControl resolves a ProfileDetail by name and applies it onto the live
 * agent via the SAME context-preserving switch path as a manual setProvider/
 * setModel/setModelParam sequence. P18 implements saveCurrent + in-memory
 * saved-profile round-tripping (saveCurrent stores the key REFERENCE, never the
 * raw secret). P19 implements in-memory CRUD (create/delete/setDefault/
 * getDefault) and extends apply to resolve savedProfiles FIRST before the
 * dir-scan fallback.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentProfileControl,
  ProfileDetail,
  ProfileSummary,
} from '../agent.js';
import type { AgentProviderState } from '../agentImpl.js';

/**
 * Reads a directory's entry names, returning an empty array when the directory
 * does not exist or is unreadable (the hermetic fallback path).
 */
function safeReadDir(dir: string): readonly string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Callback bundle injected by AgentImpl so ProfilesControl can drive the
 * context-preserving switch + read/write per-agent state without holding a
 * back-reference to the whole AgentImpl.
 * @plan:PLAN-20260617-COREAPI.P16
 * @requirement:REQ-009
 */
export interface ProfilesControlDeps {
  /** Reads the mutable per-agent provider/model/param state. */
  readonly getState: () => AgentProviderState;
  /**
   * Applies a provider (+optional model) switch preserving context (the same
   * path setProvider uses). Returns a promise.
   */
  readonly applySwitch: (provider: string, model?: string) => Promise<void>;
  /**
   * Applies a record of model params via the lazy runtime mutators and updates
   * the per-agent map.
   */
  readonly applyParams: (params: Readonly<Record<string, unknown>>) => void;
  /** Sets the per-agent keyName (authKeyName from a profile). */
  readonly setKeyName: (keyName: string | undefined) => void;
  /** Sets the per-agent load-balancer flag. */
  readonly setLoadBalancer: (isLb: boolean) => void;
  /** The agent's working directory (config.getTargetDir()). */
  readonly workingDir: string;
}

/** A parsed public-shape profile candidate (loosely validated). */
interface PublicProfileCandidate {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly detail: ProfileDetail;
}

/**
 * Narrows an unknown parsed-JSON value to a public-shape ProfileDetail: must be
 * a record with string provider+model (+string name). No cast — the type guard
 * narrows to ProfileDetail via assignment.
 */
function isPublicProfileShape(
  raw: unknown,
): raw is ProfileDetail & { readonly name: string } {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const r = raw as Record<string, unknown>;
  return (
    typeof r['name'] === 'string' &&
    typeof r['provider'] === 'string' &&
    typeof r['model'] === 'string'
  );
}

export class ProfilesControl implements AgentProfileControl {
  /**
   * In-memory saved profiles populated by saveCurrent. A saved profile
   * round-trips through get/list even though no file exists on disk. NEVER
   * stores a raw secret — only the key REFERENCE (authKeyName).
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-009
   */
  private readonly savedProfiles = new Map<string, ProfileDetail>();

  /**
   * The name of the profile currently marked as default (tracked by
   * setDefault). Surfaced as isDefault:true on the matching summary/detail.
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   */
  private defaultName: string | undefined;

  constructor(private readonly deps: ProfilesControlDeps) {}

  /**
   * Returns resolvable profile summaries, merging in-memory saved profiles
   * (saveCurrent) with the public-shape profiles discoverable in the working
   * directory's fixtures/ folder. Saved profiles take precedence (dedupe by
   * name). Ordering is deterministic: saved profiles first, then dir-scan.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-009
   */
  list(): readonly ProfileSummary[] {
    const savedSummaries: ProfileSummary[] = Array.from(
      this.savedProfiles.values(),
    ).map((d) => ({
      name: d.name,
      provider: d.provider,
      model: d.model,
      isDefault: d.name === this.defaultName,
      ...(d.isLoadBalancer !== undefined
        ? { isLoadBalancer: d.isLoadBalancer }
        : {}),
    }));
    const dirCandidates = this.scanPublicProfiles();
    const savedNames = new Set(savedSummaries.map((s) => s.name));
    const dirSummaries: ProfileSummary[] = dirCandidates
      .filter((c) => !savedNames.has(c.name))
      .map((c) => ({
        name: c.name,
        provider: c.provider,
        model: c.model,
        isDefault: c.name === this.defaultName,
        ...(c.detail.isLoadBalancer !== undefined
          ? { isLoadBalancer: c.detail.isLoadBalancer }
          : {}),
      }));
    return [...savedSummaries, ...dirSummaries];
  }

  /**
   * Returns the resolved ProfileDetail by name, or undefined. Checks the
   * in-memory savedProfiles store FIRST; if absent, falls back to the
   * dir-scan resolver. Surfaced isDefault reflects defaultName (P19).
   * @plan:PLAN-20260617-COREAPI.P16
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   */
  get(name: string): ProfileDetail | undefined {
    const saved = this.savedProfiles.get(name);
    if (saved !== undefined) {
      return this.withSurfacedDefault(saved);
    }
    const candidate = this.resolvePublicProfile(name);
    if (candidate === undefined) {
      return undefined;
    }
    return this.withSurfacedDefault(candidate.detail);
  }

  /**
   * Creates a profile in the in-memory savedProfiles store from the provided
   * partial detail. The new profile is a standard (non-LB) profile; isDefault
   * is computed from defaultName at surfacing time, so it is stored false.
   * modelParams is deep-copied so external mutation cannot leak into the
   * stored copy. Undefined-valued optional keys are omitted (matching
   * saveCurrent's style).
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   */
  async create(
    name: string,
    detail: Readonly<Omit<ProfileDetail, 'isDefault' | 'isLoadBalancer'>>,
  ): Promise<void> {
    const fullDetail: ProfileDetail = {
      name,
      provider: detail.provider,
      model: detail.model,
      isDefault: false,
      ...(detail.modelParams !== undefined
        ? { modelParams: { ...detail.modelParams } }
        : {}),
      ...(detail.baseUrl !== undefined ? { baseUrl: detail.baseUrl } : {}),
      ...(detail.authKeyName !== undefined
        ? { authKeyName: detail.authKeyName }
        : {}),
      ...(detail.authKeyFile !== undefined
        ? { authKeyFile: detail.authKeyFile }
        : {}),
    };
    this.savedProfiles.set(name, fullDetail);
  }

  /**
   * Saves the current agent state (provider/model/modelParams/baseUrl/
   * authKeyName) into the in-memory savedProfiles store. Stores the key
   * REFERENCE (authKeyName from providerState) — NEVER the raw secret value.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-009
   * @requirement:REQ-008
   */
  async saveCurrent(name: string): Promise<void> {
    const s = this.deps.getState();
    const detail: ProfileDetail = {
      name,
      provider: s.provider,
      model: s.model,
      isDefault: false,
      ...(this.hasNonEmptyModelParams(s.modelParams)
        ? { modelParams: { ...s.modelParams } }
        : {}),
      ...(s.baseUrl !== undefined ? { baseUrl: s.baseUrl } : {}),
      ...(s.keyName !== undefined ? { authKeyName: s.keyName } : {}),
    };
    this.savedProfiles.set(name, detail);
  }

  /**
   * Deletes a profile from the in-memory savedProfiles store. Idempotent —
   * deleting an absent name is a no-op, not an error. Also clears the
   * defaultName tracking if it matches the deleted name.
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   */
  async delete(name: string): Promise<void> {
    this.savedProfiles.delete(name);
    if (this.defaultName === name) {
      this.defaultName = undefined;
    }
  }

  /**
   * Resolves a ProfileDetail by name and applies it onto the live agent via
   * the context-preserving switch path (the same transfer path as a manual
   * switch — switch ≡ failover). The durable store is primary; the working-dir
   * public-shape scan is the hermetic fallback.
   *
   * Basis: @pseudocode switch-rebind.md steps 70-78 (applyProfile). The
   * pseudocode's applyProfileSnapshot requires legacy Profile shape
   * (version+ephemeralSettings) and is a no-op under the fake seam; this
   * implementation reuses the setProvider/setModel/param primitives so profile
   * application is behaviorally identical to a manual switch (the spec requires
   * "LB-failover path = profiles.apply (the same transfer path as a manual
   * switch)").
   *
   * @plan:PLAN-20260617-COREAPI.P16
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   * @requirement:REQ-004
   * @requirement:REQ-005
   * @pseudocode switch-rebind.md steps 70-78
   */
  async apply(name: string): Promise<void> {
    // P19: resolve the in-memory savedProfiles store FIRST, then fall back to
    // the public-shape dir-scan resolver. Both feed the SAME downstream apply
    // logic, so created/standard/LB profiles all share one code path.
    const saved = this.savedProfiles.get(name);
    const candidate =
      saved === undefined ? this.resolvePublicProfile(name) : undefined;
    if (saved === undefined && candidate === undefined) {
      throw new Error(`Profile '${name}' not found`);
    }
    const detail: ProfileDetail =
      saved ?? (candidate as PublicProfileCandidate).detail;
    // Apply provider + model via the context-preserving switch path.
    await this.deps.applySwitch(detail.provider, detail.model);
    // Apply model params (lazy runtime mutator + per-agent map update).
    if (detail.modelParams !== undefined) {
      this.deps.applyParams(detail.modelParams);
    }
    // Record authKeyName so getProviderStatus().keyName reflects it.
    this.deps.setKeyName(detail.authKeyName);
    // Record the load-balancer flag (LB uses targets[]; the fixture's
    // provider/model fields ARE the active selection).
    const detailRecord = detail as unknown as Readonly<Record<string, unknown>>;
    const isLb = detail.isLoadBalancer ?? detailRecord['targets'] !== undefined;
    this.deps.setLoadBalancer(isLb);
  }

  /**
   * Marks a profile as the default. The profile must be resolvable (in the
   * in-memory savedProfiles store OR via the dir-scan fallback) otherwise an
   * error is thrown. The default is tracked in defaultName and surfaced as
   * isDefault:true on the matching summary/detail.
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   */
  async setDefault(name: string): Promise<void> {
    const resolvable =
      this.savedProfiles.has(name) ||
      this.resolvePublicProfile(name) !== undefined;
    if (!resolvable) {
      throw new Error(`Profile '${name}' not found`);
    }
    this.defaultName = name;
  }

  /**
   * Returns the ProfileSummary for the current default profile, or undefined
   * when no default is set or the default is no longer resolvable.
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   */
  getDefault(): ProfileSummary | undefined {
    if (this.defaultName === undefined) {
      return undefined;
    }
    const detail = this.get(this.defaultName);
    if (detail === undefined) {
      return undefined;
    }
    return {
      name: detail.name,
      provider: detail.provider,
      model: detail.model,
      isDefault: true,
      ...(detail.isLoadBalancer !== undefined
        ? { isLoadBalancer: detail.isLoadBalancer }
        : {}),
    };
  }

  // ─── Public-shape profile resolution (hermetic fallback) ─────────────────

  /**
   * Returns true when the modelParams record has at least one own key.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-009
   */
  private hasNonEmptyModelParams(
    params: Readonly<Record<string, unknown>>,
  ): boolean {
    return Object.keys(params).length > 0;
  }

  /**
   * Returns a copy of the given ProfileDetail with isDefault recomputed from
   * defaultName (so a stored profile's isDefault:false is overridden to true
   * when it is the current default). All other keys (including modelParams)
   * are preserved exactly. The stored object is NOT mutated.
   * @plan:PLAN-20260617-COREAPI.P19
   * @requirement:REQ-009
   */
  private withSurfacedDefault(detail: ProfileDetail): ProfileDetail {
    const isDefault = detail.name === this.defaultName;
    return {
      ...detail,
      isDefault,
    };
  }

  /**
   * Resolves a public-shape ProfileDetail by name from the working directory.
   * The durable store (profileSnapshot.ts/ProfileManager) is homedir-keyed and
   * validates LEGACY shape; it cannot resolve the public-shape fixtures the
   * harness loads. This scan is the public-shape resolution seam: it reads
   * `<workingDir>/fixtures/*.json` and `<workingDir>/*.json`, parses each, and
   * selects the one whose parsed `.name === name`.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-009
   */
  private resolvePublicProfile(
    name: string,
  ): PublicProfileCandidate | undefined {
    return this.scanPublicProfiles().find((c) => c.name === name);
  }

  /**
   * Scans the working directory for public-shape profile JSON files and returns
   * the validated candidates. Looks in `<workingDir>/fixtures/` first, then
   * `<workingDir>` itself.
   * @plan:PLAN-20260617-COREAPI.P16
   * @requirement:REQ-009
   */
  private scanPublicProfiles(): readonly PublicProfileCandidate[] {
    const dirs = [join(this.deps.workingDir, 'fixtures'), this.deps.workingDir];
    const candidates: PublicProfileCandidate[] = [];
    const seenPaths = new Set<string>();
    const seenNames = new Set<string>();
    for (const dir of dirs) {
      // Sort entries deterministically so list()/name-resolution order does not
      // depend on filesystem enumeration order.
      const entries = [...safeReadDir(dir)].sort((a, b) => a.localeCompare(b));
      const newCandidates = entries
        .filter((entry) => entry.endsWith('.json'))
        .map((entry) => join(dir, entry))
        .filter((abs) => !seenPaths.has(abs))
        .map((abs) => {
          seenPaths.add(abs);
          return this.readPublicProfile(abs);
        })
        .filter((c): c is PublicProfileCandidate => c !== undefined)
        // De-duplicate by profile NAME across dirs so name resolution is
        // stable. The fixtures dir is scanned first, so it wins on a name
        // collision (matching this function's documented precedence).
        .filter((c) => {
          if (seenNames.has(c.name)) {
            return false;
          }
          seenNames.add(c.name);
          return true;
        });
      candidates.push(...newCandidates);
    }
    return candidates;
  }

  /**
   * Reads + parses a single JSON file as a public-shape ProfileDetail.
   * Synchronous read (profiles.list/get are synchronous per the interface).
   */
  private readPublicProfile(
    absPath: string,
  ): PublicProfileCandidate | undefined {
    let raw: string;
    try {
      raw = readFileSync(absPath, 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isPublicProfileShape(parsed)) {
      return undefined;
    }
    const detail = parsed as ProfileDetail;
    return {
      name: detail.name,
      provider: detail.provider,
      model: detail.model,
      detail,
    };
  }
}
