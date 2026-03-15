const LABEL_FIELD_PATHS: ReadonlyArray<readonly (string | number)[]> = [
  ['waybills', 0, 'awbFile'],
  ['waybill', 'awbFile'],
  ['awbFile'],
] as const;

const getNestedValue = (source: unknown, path: readonly (string | number)[]): unknown => {
  if (!source || typeof source !== 'object') {
    return undefined;
  }
  let current: any = source;
  for (const key of path) {
    if (current == null) {
      return undefined;
    }
    current = current[key as any];
  }
  return current;
};

export const extractSmsaLabelBase64 = (payload: unknown): string | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  for (const path of LABEL_FIELD_PATHS) {
    const value = getNestedValue(payload, path);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

export const buildSmsaLabelDataUrl = (base64: string | null | undefined): string | null => {
  if (!base64 || typeof base64 !== 'string') {
    return null;
  }

  const trimmed = base64.trim();
  if (!trimmed) {
    return null;
  }

  return `data:application/pdf;base64,${trimmed}`;
};
