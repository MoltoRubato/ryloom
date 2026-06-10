/**
 * Defensive normalization of `analytics.getVideoInsights` output into the
 * stable shape the insights UI renders. The analytics router is built against
 * the CONTEXT.md contract; this mapper tolerates minor naming drift
 * (watchPct vs watchPercent, viewsByDay arrays vs records, 0..1 vs 0..100
 * percentages) without crashing the page.
 */

export type ViewerInsight = {
  name: string | null;
  email: string | null;
  anonymous: boolean;
  avatarUrl: string | null;
  watchPct: number;
  completed: boolean;
  lastViewedAt: Date | null;
  sessionCount: number;
};

export type DayViews = { date: string; views: number };
export type NameCount = { name: string; count: number };

export type VideoInsights = {
  totalViews: number;
  uniqueViewers: number;
  avgWatchPct: number;
  completionRate: number;
  eventCounts: {
    ctaClicks: number;
    downloads: number;
    comments: number;
    reactions: number;
  };
  /** Exactly 100 buckets, each the % of viewers still watching (0..100). */
  engagementTimeline: number[];
  viewsByDay: DayViews[];
  topReferrers: NameCount[];
  devices: NameCount[];
  browsers: NameCount[];
  viewers: ViewerInsight[];
};

// ---------------------------------------------------------------------------
// Primitive coercion helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pick(record: Record<string, unknown> | null, keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    const v = record[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Coerces a 0..1 fraction or a 0..100 percentage into 0..100. */
function toPct(value: unknown): number {
  const n = toNumber(value, 0);
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, pct));
}

function toStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Section mappers
// ---------------------------------------------------------------------------

function toNameCounts(value: unknown, nameKeys: string[]): NameCount[] {
  let entries: NameCount[] = [];
  if (Array.isArray(value)) {
    entries = value.map((item) => {
      const record = asRecord(item);
      const rawName = pick(record, nameKeys);
      return {
        name: typeof rawName === "string" && rawName.length > 0 ? rawName : "Unknown",
        count: Math.max(
          0,
          Math.round(toNumber(pick(record, ["count", "views", "value", "total", "sessions"]), 0)),
        ),
      };
    });
  } else {
    const record = asRecord(value);
    if (record) {
      entries = Object.entries(record).map(([name, count]) => ({
        name: name.length > 0 ? name : "Unknown",
        count: Math.max(0, Math.round(toNumber(count, 0))),
      }));
    }
  }
  return entries
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count);
}

function toTimeline(value: unknown): number[] {
  let values: number[] = [];
  if (Array.isArray(value)) {
    values = value.map((item) => {
      if (typeof item === "number") return Number.isFinite(item) ? item : 0;
      const record = asRecord(item);
      return toNumber(
        pick(record, ["pct", "percent", "percentage", "value", "viewers", "watching", "count"]),
        0,
      );
    });
  }
  if (values.length === 0) return Array.from({ length: 100 }, () => 0);

  const max = Math.max(...values);
  let scaled = values;
  if (max > 0 && max <= 1) {
    scaled = values.map((n) => n * 100);
  } else if (max > 100) {
    // Raw viewer counts — normalize against the peak.
    scaled = values.map((n) => (n / max) * 100);
  }

  // Resample to exactly 100 buckets.
  return Array.from({ length: 100 }, (_, i) => {
    const idx = Math.min(scaled.length - 1, Math.floor((i / 100) * scaled.length));
    const v = scaled[idx] ?? 0;
    return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  });
}

const ISO_DAY = /^(\d{4}-\d{2}-\d{2})/;

function toDayKey(value: unknown): string | null {
  if (typeof value === "string") {
    const match = ISO_DAY.exec(value);
    if (match?.[1]) return match[1];
  }
  const d = toDate(value);
  if (!d) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDayViews(value: unknown): DayViews[] {
  const out: DayViews[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      const key = toDayKey(pick(record, ["date", "day", "label", "key"]));
      if (!key) continue;
      out.push({
        date: key,
        views: Math.max(0, Math.round(toNumber(pick(record, ["views", "count", "value", "total"]), 0))),
      });
    }
  } else {
    const record = asRecord(value);
    if (record) {
      for (const [rawKey, rawViews] of Object.entries(record)) {
        const key = toDayKey(rawKey);
        if (!key) continue;
        out.push({ date: key, views: Math.max(0, Math.round(toNumber(rawViews, 0))) });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function toViewers(value: unknown): ViewerInsight[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    const name = toStr(pick(record, ["name", "viewerName", "displayName"]));
    const email = toStr(pick(record, ["email", "identityEmail", "viewerEmail"]));
    const anonRaw = pick(record, ["anonymous", "isAnonymous"]);
    return {
      name,
      email,
      anonymous: typeof anonRaw === "boolean" ? anonRaw : !name && !email,
      avatarUrl: toStr(pick(record, ["avatarUrl", "avatar", "imageUrl"])),
      watchPct: toPct(
        pick(record, ["watchPct", "watchPercent", "watchPercentage", "pctWatched", "percentWatched"]),
      ),
      completed: pick(record, ["completed", "isCompleted", "hasCompleted"]) === true,
      lastViewedAt: toDate(
        pick(record, ["lastViewedAt", "lastSeenAt", "lastHeartbeatAt", "lastViewed", "startedAt"]),
      ),
      sessionCount: Math.max(
        1,
        Math.round(toNumber(pick(record, ["sessionCount", "sessions", "viewCount", "views"]), 1)),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function normalizeVideoInsights(raw: unknown): VideoInsights {
  const record = asRecord(raw);
  const eventCounts = asRecord(pick(record, ["eventCounts", "events", "counts"]));
  return {
    totalViews: Math.max(0, Math.round(toNumber(pick(record, ["totalViews", "views", "viewCount"]), 0))),
    uniqueViewers: Math.max(
      0,
      Math.round(toNumber(pick(record, ["uniqueViewers", "uniqueViewerCount", "unique"]), 0)),
    ),
    avgWatchPct: toPct(
      pick(record, ["avgWatchPct", "averageWatchPct", "avgWatchPercent", "avgWatchPercentage"]),
    ),
    completionRate: toPct(pick(record, ["completionRate", "completionPct", "completionPercent"])),
    eventCounts: {
      ctaClicks: Math.max(
        0,
        Math.round(toNumber(pick(eventCounts, ["ctaClicks", "cta_clicked", "ctaClicked", "cta"]), 0)),
      ),
      downloads: Math.max(
        0,
        Math.round(
          toNumber(pick(eventCounts, ["downloads", "download_clicked", "downloadClicks"]), 0),
        ),
      ),
      comments: Math.max(
        0,
        Math.round(toNumber(pick(eventCounts, ["comments", "comment_created", "commentCount"]), 0)),
      ),
      reactions: Math.max(
        0,
        Math.round(toNumber(pick(eventCounts, ["reactions", "reaction_added", "reactionCount"]), 0)),
      ),
    },
    engagementTimeline: toTimeline(
      pick(record, ["engagementTimeline", "engagement", "timeline", "engagementBuckets"]),
    ),
    viewsByDay: toDayViews(pick(record, ["viewsByDay", "viewsOverTime", "viewsByDate", "dailyViews"])),
    topReferrers: toNameCounts(pick(record, ["topReferrers", "referrers"]), [
      "referrer",
      "source",
      "host",
      "name",
    ]),
    devices: toNameCounts(pick(record, ["devices", "deviceBreakdown"]), ["device", "name", "type"]),
    browsers: toNameCounts(pick(record, ["browsers", "browserBreakdown"]), ["browser", "name"]),
    viewers: toViewers(pick(record, ["viewers", "viewerList"])),
  };
}
