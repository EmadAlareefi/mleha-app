// Reserved namespace: excluded from the generic settings API and helpers.
export const EXPENSE_CREDENTIAL_SETTINGS_PREFIX = 'expense_provider_credentials:';
export function isPrivateExpenseSetting(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith(EXPENSE_CREDENTIAL_SETTINGS_PREFIX);
}
