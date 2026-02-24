import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';

export type ProviderId = 'anthropic' | 'openai-codex';

type OAuthCredential = {
  type: 'oauth';
  access: string;
  accountId?: string;
};

export type WindowKey = '5h' | '1w';

export type WindowUsage = {
  key: WindowKey;
  limit?: number;
  used?: number;
  remaining?: number;
  usedPercent?: number;
  resetAtMs?: number;
};

export type ProviderUsage = {
  provider: ProviderId;
  windows: WindowUsage[];
};

export type SubscriptionUsageEntry = {
  provider: ProviderId;
  usage: ProviderUsage | null;
};

type OpenAiUsagePayload = {
  rate_limit?: unknown;
  additional_rate_limits?: unknown;
};

type AnthropicUsagePayload = {
  five_hour?: unknown;
  seven_day?: unknown;
};

const providerOrder: ProviderId[] = ['openai-codex', 'anthropic'];
const providerWindowOrder: WindowKey[] = ['5h', '1w'];

const openAiUsageEndpoint = 'https://chatgpt.com/backend-api/wham/usage';
const anthropicUsageEndpoint = 'https://api.anthropic.com/api/oauth/usage';

const timeoutMs = 4000;
const debugLogPath = path.resolve(process.cwd(), '.brodzko/statusline-subscription-usage.log');

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const writeDebugLog = async (message: string, details?: unknown): Promise<void> => {
  const line = `${new Date().toISOString()} ${message}${details === undefined ? '' : ` ${safeJson(details)}`}\n`;

  try {
    await mkdir(path.dirname(debugLogPath), { recursive: true });
    await appendFile(debugLogPath, line, 'utf8');
  } catch {
    // Logging must never break footer rendering.
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const numberFromUnknown = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const normalizePercent = (value: unknown): number | undefined => {
  const numeric = numberFromUnknown(value);
  if (numeric === undefined) return undefined;
  if (numeric >= 0 && numeric <= 1) return numeric * 100;
  return numeric;
};

const parseTimestampMs = (value: unknown): number | undefined => {
  const numeric = numberFromUnknown(value);
  if (numeric !== undefined) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return undefined;
};

const normalizeWindowKey = (value: unknown): WindowKey | null => {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();

  if (
    lower.includes('5h') ||
    lower.includes('five_hour') ||
    lower.includes('five-hour') ||
    lower.includes('5_hour') ||
    lower.includes('5-hour') ||
    lower.includes('five hour') ||
    lower.includes('5 hour')
  ) {
    return '5h';
  }

  if (
    lower.includes('seven_day') ||
    lower.includes('7d') ||
    lower.includes('week') ||
    lower.includes('weekly') ||
    lower.includes('1w')
  ) {
    return '1w';
  }

  return null;
};

const toOAuthCredential = (value: unknown): OAuthCredential | null => {
  if (!isObject(value)) return null;
  if (value.type !== 'oauth') return null;
  if (typeof value.access !== 'string' || value.access.length === 0) return null;

  return {
    type: 'oauth',
    access: value.access,
    accountId: typeof value.accountId === 'string' ? value.accountId : undefined,
  };
};

const parseWindowRecordForKey = (
  key: WindowKey,
  record: Record<string, unknown>
): WindowUsage => {
  const limit = numberFromUnknown(
    record.limit ??
      record.max ??
      record.total ??
      record.max_usage ??
      record.max_requests
  );
  const used = numberFromUnknown(
    record.used ??
      record.current ??
      record.count ??
      record.current_usage ??
      record.used_requests
  );

  const remaining = numberFromUnknown(
    record.remaining ??
      record.left ??
      record.remaining_usage ??
      record.remaining_requests
  );

  const percentFromRatio = (() => {
    const ratio = numberFromUnknown(record.used_ratio ?? record.usage_ratio);
    if (ratio === undefined) return undefined;
    return ratio <= 1 ? ratio * 100 : ratio;
  })();

  const percentFromCounts =
    used !== undefined && limit !== undefined && limit > 0
      ? (used / limit) * 100
      : undefined;

  const usedPercent =
    normalizePercent(
      record.utilization ??
        record.used_percent ??
        record.percent_used ??
        record.usage_percent ??
        record.usage
    ) ??
    percentFromRatio ??
    percentFromCounts;

  const resetAtMs = parseTimestampMs(
    record.resets_at ??
      record.reset_at ??
      record.resetsAt ??
      record.resetAt ??
      record.window_reset_at ??
      record.reset_time
  );

  return {
    key,
    limit,
    used,
    remaining,
    usedPercent,
    resetAtMs,
  };
};

const inferWindowKeyFromRecord = (
  keyHint: string,
  record: Record<string, unknown>
): WindowKey | null => {
  const explicit = normalizeWindowKey(record.window ?? record.limit_name ?? keyHint);
  if (explicit) return explicit;

  const resetSeconds = numberFromUnknown(
    record.seconds_until_reset ??
      record.reset_seconds ??
      record.window_seconds ??
      record.interval_seconds
  );

  if (resetSeconds !== undefined) {
    return resetSeconds >= 36 * 3600 ? '1w' : '5h';
  }

  const resetAtMs = parseTimestampMs(
    record.resets_at ??
      record.reset_at ??
      record.resetsAt ??
      record.resetAt ??
      record.window_reset_at
  );

  if (resetAtMs !== undefined) {
    const diffMs = Math.max(0, resetAtMs - Date.now());
    return diffMs >= 36 * 3600 * 1000 ? '1w' : '5h';
  }

  return null;
};

const parseWindowRecord = (
  keyHint: string,
  record: Record<string, unknown>
): WindowUsage | null => {
  const key = inferWindowKeyFromRecord(keyHint, record);
  if (!key) return null;
  return parseWindowRecordForKey(key, record);
};

const readOpenAiWindows = (payload: unknown): WindowUsage[] => {
  if (!isObject(payload)) return [];

  const data = payload as OpenAiUsagePayload;
  const windows = new Map<WindowKey, WindowUsage>();

  const tryAddWindow = (keyHint: string, value: unknown) => {
    if (!isObject(value)) return;
    const parsed = parseWindowRecord(keyHint, value);
    if (parsed) {
      windows.set(parsed.key, parsed);
      return;
    }

    for (const [nestedKey, nested] of Object.entries(value)) {
      if (!isObject(nested)) continue;
      const parsedNested = parseWindowRecord(nestedKey, nested);
      if (parsedNested) {
        windows.set(parsedNested.key, parsedNested);
      }
    }
  };

  if (isObject(data.rate_limit)) {
    const primaryWindow = data.rate_limit.primary_window;
    const secondaryWindow = data.rate_limit.secondary_window;

    if (isObject(primaryWindow)) {
      windows.set('5h', parseWindowRecordForKey('5h', primaryWindow));
    }

    if (isObject(secondaryWindow)) {
      windows.set('1w', parseWindowRecordForKey('1w', secondaryWindow));
    }

    if (!windows.has('5h')) {
      const parsedPrimary = parseWindowRecord('rate_limit', data.rate_limit);
      windows.set(
        parsedPrimary?.key ?? '5h',
        parsedPrimary ?? parseWindowRecordForKey('5h', data.rate_limit)
      );
    }
  }

  if (Array.isArray(data.additional_rate_limits)) {
    for (const entry of data.additional_rate_limits) {
      if (!isObject(entry)) continue;
      const limitName =
        typeof entry.limit_name === 'string' ? entry.limit_name : 'additional';
      tryAddWindow(limitName, entry.rate_limit ?? entry);

      if (!windows.has('1w') && isObject(entry.rate_limit ?? entry)) {
        const candidate = (entry.rate_limit ?? entry) as Record<string, unknown>;
        windows.set('1w', parseWindowRecordForKey('1w', candidate));
      }
    }
  }

  return providerWindowOrder
    .filter(key => windows.has(key))
    .map(key => windows.get(key)!);
};

const readAnthropicWindows = (payload: unknown): WindowUsage[] => {
  if (!isObject(payload)) return [];

  const data = payload as AnthropicUsagePayload;
  const windows = new Map<WindowKey, WindowUsage>();

  const fiveHour = isObject(data.five_hour)
    ? parseWindowRecord('five_hour', data.five_hour)
    : null;
  if (fiveHour) windows.set(fiveHour.key, fiveHour);

  const sevenDay = isObject(data.seven_day)
    ? parseWindowRecord('seven_day', data.seven_day)
    : null;
  if (sevenDay) windows.set(sevenDay.key, sevenDay);

  return providerWindowOrder
    .filter(key => windows.has(key))
    .map(key => windows.get(key)!);
};

type FetchJsonResult = {
  status: number | null;
  ok: boolean;
  payload: unknown;
  error?: string;
};

const fetchJson = async (
  provider: ProviderId,
  url: string,
  headers: Record<string, string>
): Promise<FetchJsonResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await writeDebugLog(`[${provider}] request`, {
      url,
      hasAuthorization: typeof headers.Authorization === 'string',
      hasAccountId: typeof headers['ChatGPT-Account-Id'] === 'string',
      hasAnthropicBeta: typeof headers['anthropic-beta'] === 'string',
    });

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      await writeDebugLog(`[${provider}] response not ok`, {
        url,
        status: response.status,
      });
      return { status: response.status, ok: false, payload: null };
    }

    const payload = await response.json();
    await writeDebugLog(`[${provider}] response ok`, {
      url,
      status: response.status,
      topLevelKeys: isObject(payload) ? Object.keys(payload) : null,
    });

    return { status: response.status, ok: true, payload };
  } catch (error) {
    await writeDebugLog(`[${provider}] request failed`, {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: null,
      ok: false,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const fetchOpenAiUsage = async (
  credential: OAuthCredential
): Promise<ProviderUsage | null> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.access}`,
    Accept: 'application/json',
  };

  if (credential.accountId) {
    headers['ChatGPT-Account-Id'] = credential.accountId;
  }

  const result = await fetchJson('openai-codex', openAiUsageEndpoint, headers);
  if (!result.ok) {
    await writeDebugLog('[openai-codex] usage unavailable', {
      status: result.status,
      error: result.error,
    });
    return null;
  }

  if (isObject(result.payload)) {
    await writeDebugLog('[openai-codex] payload details', {
      rateLimitKeys: isObject(result.payload.rate_limit)
        ? Object.keys(result.payload.rate_limit)
        : null,
      primaryWindowKeys:
        isObject(result.payload.rate_limit) &&
        isObject(result.payload.rate_limit.primary_window)
          ? Object.keys(result.payload.rate_limit.primary_window)
          : null,
      secondaryWindowKeys:
        isObject(result.payload.rate_limit) &&
        isObject(result.payload.rate_limit.secondary_window)
          ? Object.keys(result.payload.rate_limit.secondary_window)
          : null,
      additionalCount: Array.isArray(result.payload.additional_rate_limits)
        ? result.payload.additional_rate_limits.length
        : null,
      firstAdditionalKeys:
        Array.isArray(result.payload.additional_rate_limits) &&
        isObject(result.payload.additional_rate_limits[0])
          ? Object.keys(result.payload.additional_rate_limits[0])
          : null,
      firstAdditionalRateLimitKeys:
        Array.isArray(result.payload.additional_rate_limits) &&
        isObject(result.payload.additional_rate_limits[0]) &&
        isObject(result.payload.additional_rate_limits[0].rate_limit)
          ? Object.keys(result.payload.additional_rate_limits[0].rate_limit)
          : null,
    });
  }

  const windows = readOpenAiWindows(result.payload);
  await writeDebugLog('[openai-codex] parsed windows', {
    count: windows.length,
    windows,
  });

  if (windows.length === 0) return null;

  return {
    provider: 'openai-codex',
    windows,
  };
};

const fetchAnthropicUsage = async (
  credential: OAuthCredential
): Promise<ProviderUsage | null> => {
  const result = await fetchJson('anthropic', anthropicUsageEndpoint, {
    Authorization: `Bearer ${credential.access}`,
    Accept: 'application/json',
    'anthropic-beta': 'oauth-2025-04-20',
  });

  if (!result.ok) {
    await writeDebugLog('[anthropic] usage unavailable', {
      status: result.status,
      error: result.error,
    });
    return null;
  }

  const windows = readAnthropicWindows(result.payload);
  await writeDebugLog('[anthropic] parsed windows', {
    count: windows.length,
    windows,
  });

  if (windows.length === 0) return null;

  return {
    provider: 'anthropic',
    windows,
  };
};

const fetchProviderUsage = async (
  provider: ProviderId,
  credential: OAuthCredential
): Promise<ProviderUsage | null> => {
  if (provider === 'openai-codex') {
    return fetchOpenAiUsage(credential);
  }

  return fetchAnthropicUsage(credential);
};

export const fetchSubscriptionUsageEntries = async (
  ctx: ExtensionContext,
  activeProvider?: ProviderId
): Promise<SubscriptionUsageEntry[] | null> => {
  const entries: SubscriptionUsageEntry[] = [];

  const providers = activeProvider ? [activeProvider] : providerOrder;

  for (const provider of providers) {
    const credential = toOAuthCredential(ctx.modelRegistry.authStorage.get(provider));
    if (!credential) {
      await writeDebugLog(`[${provider}] no oauth credential found`);
      continue;
    }

    const usage = await fetchProviderUsage(provider, credential);
    entries.push({ provider, usage });
  }

  if (entries.length === 0) {
    await writeDebugLog('[summary] no providers produced usage line');
    return null;
  }

  await writeDebugLog('[summary] entries', {
    entries: entries.map(entry => ({
      provider: entry.provider,
      available: entry.usage !== null,
      windowCount: entry.usage?.windows.length ?? 0,
    })),
  });

  return entries;
};
