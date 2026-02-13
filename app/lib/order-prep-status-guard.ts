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

const normalizeStatusName = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const hasRecognizedStatusName = (names: Array<unknown>): boolean => {
  return names.some((value) => {
    const normalized = normalizeStatusName(value);
    return Boolean(normalized && ALLOWED_ORDER_STATUS_NAMES.has(normalized));
  });
};

export function isAllowedOrderStatus(status: any): boolean {
  if (!status || typeof status !== 'object') {
    return false;
  }

  const idCandidates = [
    status.id,
    status.status_id,
    status.statusId,
    status.code,
    status.original?.id,
    status.original_id,
    status.originalId,
  ];

  for (const candidate of idCandidates) {
    const normalized = normalizeStatusId(candidate);
    if (normalized && ALLOWED_ORDER_STATUS_IDS.has(normalized)) {
      return true;
    }
  }

  const nameCandidates = [
    status.name,
    status.name_en,
    status.nameEn,
    status.label,
    status.status_name,
    status.statusName,
    status.translations?.ar?.name,
    status.translations?.en?.name,
  ];

  if (hasRecognizedStatusName(nameCandidates)) {
    return true;
  }

  const slugCandidates = [status.slug, status.status, status.code].map((value) =>
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
  const status = data?.status || null;
  const subStatus =
    status?.sub_status ||
    status?.subStatus ||
    data?.sub_status ||
    data?.subStatus ||
    null;

  return { status, subStatus };
}

export const ORDER_PREP_ALLOWED_STATUS_META = {
  ids: ALLOWED_ORDER_STATUS_IDS,
  slugs: ALLOWED_ORDER_STATUS_SLUGS,
  names: ALLOWED_ORDER_STATUS_NAMES,
};
