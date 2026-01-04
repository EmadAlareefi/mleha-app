const DATE_OBJECT_KEYS = ['date', 'datetime', 'value', 'timestamp'] as const;

const isNumericLike = (value: string) => /^-?\d+(\.\d+)?$/.test(value);

const timestampToDate = (timestamp: number): Date | null => {
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeOrderDateValue = (value: unknown): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (isNumericLike(trimmed)) {
      return timestampToDate(Number(trimmed));
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    if (trimmed.includes(' ')) {
      const isoCandidate = trimmed.replace(' ', 'T');
      const fallback = new Date(isoCandidate);
      if (!Number.isNaN(fallback.getTime())) {
        return fallback;
      }
    }

    return null;
  }

  if (typeof value === 'number') {
    return timestampToDate(value);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'object') {
    for (const key of DATE_OBJECT_KEYS) {
      const nestedValue = (value as Record<string, unknown>)[key];
      const normalized = normalizeOrderDateValue(nestedValue);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
};

export interface OrderDateResult {
  date: Date | null;
  source?: string;
  rawValue?: unknown;
  candidates: Record<string, unknown>;
}

export const extractOrderDate = (order: Record<string, any> | null | undefined): OrderDateResult => {
  if (!order) {
    return { date: null, candidates: {} };
  }

  const candidateList: Array<{ source: string; value: unknown }> = [
    { source: 'date.updated', value: order.date?.updated },
    { source: 'date.created', value: order.date?.created },
    { source: 'updated_at', value: order.updated_at },
    { source: 'created_at', value: order.created_at },
    { source: 'updatedAt', value: order.updatedAt },
    { source: 'createdAt', value: order.createdAt },
    { source: 'updatedAtRemote', value: order.updatedAtRemote },
    { source: 'placedAt', value: order.placedAt },
  ];

  const candidates: Record<string, unknown> = {};
  for (const candidate of candidateList) {
    candidates[candidate.source] = candidate.value;
  }

  for (const candidate of candidateList) {
    const normalized = normalizeOrderDateValue(candidate.value);
    if (normalized) {
      return {
        date: normalized,
        source: candidate.source,
        rawValue: candidate.value,
        candidates,
      };
    }
  }

  return { date: null, candidates };
};
