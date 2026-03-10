/**
 * Shared filesystem cache for subscription usage data.
 *
 * Multiple pi windows independently poll subscription usage. Without coordination,
 * N windows × 2-minute cooldown = N× the API calls. This cache file acts as a
 * cross-window shared store: any window that fetches writes the result here, and
 * other windows read it instead of re-fetching until the TTL expires.
 *
 * Both successful and failed fetches are cached. On failure (429, network error,
 * no usable data), the cache records the attempt timestamp so all windows back off
 * together — no window will retry for at least CACHE_TTL_MS.
 *
 * TTL: 5 minutes. No file locking — worst case two windows fetch simultaneously
 * and the second write wins, which is benign (same or equivalent data).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import {
  fetchSubscriptionUsageEntries,
  type ProviderId,
  type SubscriptionUsageEntry,
} from './subscription-limits';

/** 5 minutes — shared across all windows. */
const CACHE_TTL_MS = 5 * 60_000;

const CACHE_FILE_PATH = path.join(
  os.homedir(),
  '.pi',
  '.cache',
  'subscription-usage.json'
);

type CachePayload = {
  fetchedAtMs: number;
  provider: ProviderId | null;
  /** null when the fetch failed or returned no usable data. */
  entries: SubscriptionUsageEntry[] | null;
};

const isValidPayload = (value: unknown): value is CachePayload => {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.fetchedAtMs === 'number' &&
    (obj.entries === null || Array.isArray(obj.entries)) &&
    (obj.provider === null ||
      obj.provider === 'anthropic' ||
      obj.provider === 'openai-codex')
  );
};

type CacheReadResult =
  | { hit: true; entries: SubscriptionUsageEntry[] | null }
  | { hit: false };

const readCache = async (
  activeProvider: ProviderId | null
): Promise<CacheReadResult> => {
  try {
    const raw = await readFile(CACHE_FILE_PATH, 'utf8');
    const parsed: unknown = JSON.parse(raw);

    if (!isValidPayload(parsed)) return { hit: false };

    // Cache is only valid for the same provider scope that wrote it.
    if (parsed.provider !== activeProvider) return { hit: false };

    const age = Date.now() - parsed.fetchedAtMs;
    if (age >= CACHE_TTL_MS) return { hit: false };

    // Cache is fresh — return entries (may be null if last fetch failed).
    return { hit: true, entries: parsed.entries };
  } catch {
    // File missing, corrupt, or unreadable — treat as cache miss.
    return { hit: false };
  }
};

const writeCache = async (
  entries: SubscriptionUsageEntry[] | null,
  activeProvider: ProviderId | null
): Promise<void> => {
  const payload: CachePayload = {
    fetchedAtMs: Date.now(),
    provider: activeProvider,
    entries,
  };

  try {
    await mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
    await writeFile(CACHE_FILE_PATH, JSON.stringify(payload), 'utf8');
  } catch {
    // Best-effort — if we can't write, other windows just re-fetch.
  }
};

/**
 * Returns subscription usage entries, using a shared filesystem cache to avoid
 * redundant API calls across multiple pi windows.
 *
 * - If cached data exists and is fresh (< 5 min), returns it immediately —
 *   including cached failures (null entries), so no window retries after a 429.
 * - Otherwise, fetches from the API, writes the result (success or failure)
 *   to the cache, and returns.
 */
export const getSubscriptionUsageEntries = async (
  ctx: ExtensionContext,
  activeProvider?: ProviderId
): Promise<SubscriptionUsageEntry[] | null> => {
  const providerKey = activeProvider ?? null;

  const cached = await readCache(providerKey);
  if (cached.hit) return cached.entries;

  const entries = await fetchSubscriptionUsageEntries(ctx, activeProvider);

  // Cache both success and failure so all windows back off together.
  await writeCache(entries, providerKey);

  return entries;
};
