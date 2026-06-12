import { useCallback, useEffect, useState } from "react";

export type TimeRange = [number, number];
export type TimeRangePreset = "today" | "last7days";

const STORAGE_KEY_PREFIX = "qms_time_range:";

interface CachedTimeRange {
  start: number;
  end: number;
  preset?: TimeRangePreset | "custom";
}

interface TimeRangeState {
  range: TimeRange;
  preset?: TimeRangePreset | "custom";
}

interface UseCachedTimeRangeOptions {
  initialRange?: TimeRange;
  defaultPreset?: TimeRangePreset;
}

function isValidTimeRange(range: unknown): range is TimeRange {
  return (
    Array.isArray(range) &&
    range.length === 2 &&
    Number.isFinite(range[0]) &&
    Number.isFinite(range[1]) &&
    range[0] > 0 &&
    range[1] > range[0]
  );
}

function getStartOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getEndOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function normalizeTimeRange(range: TimeRange): TimeRange {
  return [getStartOfDay(range[0]), getEndOfDay(range[1])];
}

function readCachedTimeRange(storageKey: string): CachedTimeRange | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedTimeRange>;
    const start = parsed.start;
    const end = parsed.end;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start <= 0 ||
      end <= start
    ) {
      return null;
    }

    return {
      start,
      end,
      preset: parsed.preset,
    };
  } catch {
    return null;
  }
}

function writeCachedTimeRange(storageKey: string, state: TimeRangeState): void {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        start: state.range[0],
        end: state.range[1],
        preset: state.preset,
      })
    );
  } catch {
    // Ignore storage failures so filters keep working in private or restricted contexts.
  }
}

export function getTimeRangePresetRange(preset: TimeRangePreset): TimeRange {
  const now = Date.now();

  if (preset === "today") {
    return [getStartOfDay(now), getEndOfDay(now)];
  }

  const firstDay = new Date(now);
  firstDay.setDate(firstDay.getDate() - 6);
  return [getStartOfDay(firstDay.getTime()), getEndOfDay(now)];
}

export function useCachedTimeRange(
  storageKey: string,
  options: UseCachedTimeRangeOptions = {}
): {
  timeRange: TimeRange;
  activePreset?: TimeRangePreset | "custom";
  setTimeRange: (range: TimeRange) => void;
  applyPreset: (preset: TimeRangePreset) => TimeRange;
} {
  const { initialRange, defaultPreset = "last7days" } = options;
  const resolvedStorageKey = `${STORAGE_KEY_PREFIX}${storageKey}`;

  const [state, setState] = useState<TimeRangeState>(() => {
    if (isValidTimeRange(initialRange)) {
      return { range: normalizeTimeRange(initialRange), preset: "custom" };
    }

    const cached = readCachedTimeRange(resolvedStorageKey);
    if (cached) {
      if (cached.preset === "today" || cached.preset === "last7days") {
        return { range: getTimeRangePresetRange(cached.preset), preset: cached.preset };
      }

      return { range: normalizeTimeRange([cached.start, cached.end]), preset: "custom" };
    }

    return { range: getTimeRangePresetRange(defaultPreset), preset: defaultPreset };
  });

  useEffect(() => {
    writeCachedTimeRange(resolvedStorageKey, state);
  }, [state, resolvedStorageKey]);

  const setTimeRange = useCallback((range: TimeRange) => {
    if (!isValidTimeRange(range)) return;
    setState({ range: normalizeTimeRange(range), preset: "custom" });
  }, []);

  const applyPreset = useCallback((preset: TimeRangePreset) => {
    const range = getTimeRangePresetRange(preset);
    setState({ range, preset });
    return range;
  }, []);

  return {
    timeRange: state.range,
    activePreset: state.preset,
    setTimeRange,
    applyPreset,
  };
}
