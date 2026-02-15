const ALLOWED_ORDER_STATUS_IDS = new Set([
  '449146439', // Custom "طلب جديد"
  '566146469', // Original "تحت المراجعة / طلب جديد"
  '1956875584', // Custom "جاري التجهيز"
  '1939592358', // Original "قيد التنفيذ / جاري التجهيز"
]);

const ALLOWED_ORDER_STATUS_SLUGS = new Set(['under_review', 'in_progress']);

const ALLOWED_ORDER_STATUS_NAMES = new Set(
  [
    'طلب جديد',
    'new order',
    'under review',
    'جاري التجهيز',
    'in progress',
    'processing',
    'preparing',
    'قيد التنفيذ',
  ].map((value) => value.trim().toLowerCase()),
);

const normalizeStatusId = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || null;
  }
  return null;
};

const ASSIGNABLE_ORDER_STATUS_IDS = new Set(['449146439']);

const ASSIGNABLE_ORDER_STATUS_NAMES = new Set(
  ['طلب جديد', 'new order'].map((value) => value.trim().toLowerCase()),
);

const normalizeStatusName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const toStatusRecord = (status: any): Record<string, any> | null => {
  if (status && typeof status === 'object') {
    return status as Record<string, any>;
  }
  const normalizedId = normalizeStatusId(status);
  if (normalizedId) {
    return { id: normalizedId };
  }
  return null;
};

const hasRecognizedStatusName = (
  names: Array<unknown>,
  allowedNames: Set<string> = ALLOWED_ORDER_STATUS_NAMES,
): boolean => {
  return names.some((value) => {
    const normalized = normalizeStatusName(value);
    return Boolean(normalized && allowedNames.has(normalized));
  });
};

const hasAssignableStatusName = (names: Array<unknown>): boolean => {
  const patterns = Array.from(ASSIGNABLE_ORDER_STATUS_NAMES);
  const containsAllTokens = (value: string, tokens: string[]) =>
    tokens.every((token) => value.includes(token));

  return names.some((value) => {
    const normalized = normalizeStatusName(value);
    if (!normalized) {
      return false;
    }
    if (patterns.some((pattern) => normalized === pattern || normalized.includes(pattern))) {
      return true;
    }
    if (containsAllTokens(normalized, ['طلب', 'جديد'])) {
      return true;
    }
    if (containsAllTokens(normalized, ['new', 'order'])) {
      return true;
    }
    return false;
  });
};

export function isAllowedOrderStatus(status: any): boolean {
  const record = toStatusRecord(status);
  if (!record) {
    return false;
  }

  const idCandidates = [
    record.id,
    record.status_id,
    record.statusId,
    record.code,
    record.original?.id,
    record.original_id,
    record.originalId,
  ];

  for (const candidate of idCandidates) {
    const normalized = normalizeStatusId(candidate);
    if (normalized && ALLOWED_ORDER_STATUS_IDS.has(normalized)) {
      return true;
    }
  }

  const nameCandidates = [
    record.name,
    record.name_en,
    record.nameEn,
    record.label,
    record.status_name,
    record.statusName,
    record.translations?.ar?.name,
    record.translations?.en?.name,
  ];

  if (hasRecognizedStatusName(nameCandidates)) {
    return true;
  }

  const slugCandidates = [record.slug, record.status, record.code].map((value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : null,
  );
  const hasAnyNameValue = nameCandidates.some((value) => typeof value === 'string' && value.trim());

  for (const slug of slugCandidates) {
    if (!slug || !ALLOWED_ORDER_STATUS_SLUGS.has(slug)) {
      continue;
    }
    if (!hasAnyNameValue) {
      return true;
    }
    if (hasRecognizedStatusName(nameCandidates)) {
      return true;
    }
    return false;
  }

  return false;
}

export function isOrderStatusEligible(status: any, subStatus?: any): boolean {
  if (!isAllowedOrderStatus(status)) {
    return false;
  }
  if (subStatus && !isAllowedOrderStatus(subStatus)) {
    return false;
  }
  return true;
}

export function extractSallaStatus(data: any): { status: any; subStatus: any } {
  const statusRecord = toStatusRecord(data?.status);
  const subStatusRecord = toStatusRecord(
    statusRecord?.sub_status ||
      statusRecord?.subStatus ||
      data?.sub_status ||
      data?.subStatus ||
      null,
  );

  return { status: statusRecord, subStatus: subStatusRecord };
}

export const ORDER_PREP_ALLOWED_STATUS_META = {
  ids: ALLOWED_ORDER_STATUS_IDS,
  slugs: ALLOWED_ORDER_STATUS_SLUGS,
  names: ALLOWED_ORDER_STATUS_NAMES,
};

function matchesAssignableStatus(status: any): boolean {
  const record = toStatusRecord(status);
  if (!record) {
    return false;
  }

  const idCandidates = [
    record.id,
    record.status_id,
    record.statusId,
    record.code,
    record.original?.id,
  ];

  for (const candidate of idCandidates) {
    const normalized = normalizeStatusId(candidate);
    if (normalized && ASSIGNABLE_ORDER_STATUS_IDS.has(normalized)) {
      return true;
    }
  }

  const nameCandidates = [
    record.name,
    record.name_en,
    record.nameEn,
    record.label,
    record.status_name,
    record.statusName,
    record.translations?.ar?.name,
    record.translations?.en?.name,
  ];

  if (hasAssignableStatusName(nameCandidates)) {
    return true;
  }

  return false;
}

export function isOrderStatusAssignable(status: any, subStatus?: any): boolean {
  if (matchesAssignableStatus(status)) {
    return true;
  }
  if (subStatus && matchesAssignableStatus(subStatus)) {
    return true;
  }
  return false;
}
