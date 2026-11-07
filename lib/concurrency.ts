/**
 * Runs `fn` over `items` with at most `limit` calls in flight, keeping result
 * order. Used to fan out Salla calls without hitting its rate limits.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, worker));
  return results;
}
