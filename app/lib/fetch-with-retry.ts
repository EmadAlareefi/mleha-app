import { log } from './logger';

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (response: Response) => boolean;
}

/**
 * Fetch with exponential backoff retry logic
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @param retryOptions - Retry configuration
 * @returns Response
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    shouldRetry = (response) => response.status >= 500,
  } = retryOptions;

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If successful or not retryable, return immediately
      if (response.ok || !shouldRetry(response)) {
        return response;
      }

      // Store for potential final return
      lastResponse = response.clone();

      // If this was the last attempt, return the response
      if (attempt === maxRetries) {
        return response;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

      log.warn('Request failed, retrying...', {
        url,
        attempt,
        maxRetries,
        status: response.status,
        delayMs: delay,
      });

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        log.error('All retry attempts failed', {
          url,
          attempts: maxRetries,
          error: lastError.message,
        });
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

      log.warn('Request failed with error, retrying...', {
        url,
        attempt,
        maxRetries,
        error: lastError.message,
        delayMs: delay,
      });

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript needs it
  if (lastResponse) {
    return lastResponse;
  }
  throw lastError || new Error('Fetch failed after all retries');
}

/**
 * Fetch with retry specifically configured for Salla API
 */
export async function fetchSallaWithRetry(
  url: string,
  accessToken: string,
  options?: RequestInit
): Promise<Response> {
  return fetchWithRetry(
    url,
    {
      ...options,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    },
    {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 8000,
      // Retry on 5xx errors and rate limiting
      shouldRetry: (response) =>
        response.status >= 500 || response.status === 429,
    }
  );
}
