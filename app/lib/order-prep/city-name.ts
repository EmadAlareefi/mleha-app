/** Matching form of a city name: «جده» = «جدة», «الأحساء» = «الاحساء», case and spaces ignored. Pure (client-safe). */
export function normalizeCity(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ');
}
