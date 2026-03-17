type SessionUserLike = {
  id?: string | null;
  name?: string | null;
  username?: string | null;
};

const SYSTEM_USER_PREFIX = 'admin-';

const isSystemUser = (user?: SessionUserLike | null) =>
  typeof user?.id === 'string' && user.id.startsWith(SYSTEM_USER_PREFIX);

const normalizeString = (value?: string | null) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const getAuditUser = (user?: SessionUserLike | null) => {
  const normalizedName = normalizeString(user?.name) || normalizeString(user?.username);

  return {
    id: !isSystemUser(user) && user?.id ? user.id : null,
    name: normalizedName,
    username: normalizeString(user?.username),
  };
};
