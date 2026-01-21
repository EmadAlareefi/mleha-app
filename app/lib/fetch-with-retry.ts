import { log } from './logger';

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (response: Response) => boolean;
  timeoutMs?: number;
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
    timeoutMs,
  } = retryOptions;

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let controller: AbortController | null = null;
    let cleanup: (() => void) | undefined;
    let timeoutError: Error | null = null;

    try {
      ({ controller, timeoutError, cleanup } = createTimeoutController(options, timeoutMs));
      const response = await fetch(
        url,
        controller
          ? {
              ...options,
              signal: controller.signal,
            }
          : options
      );

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
      const isTimeoutError =
        !!controller &&
        !!timeoutError &&
        controller.signal.aborted &&
        controller.signal.reason === timeoutError;
      lastError = isTimeoutError
        ? timeoutError
        : error instanceof Error
          ? error
          : new Error(String(error));

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        const message = lastError?.message || 'Unknown error';
        log.error('All retry attempts failed', {
          url,
          attempts: maxRetries,
          error: message,
        });
        throw lastError ?? new Error(message);
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

      log.warn('Request failed with error, retrying...', {
        url,
        attempt,
        maxRetries,
        error: lastError?.message || 'Unknown error',
        delayMs: delay,
      });

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      cleanup?.();
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
type FetchSallaOptions = RequestInit & { timeoutMs?: number };

export async function fetchSallaWithRetry(
  url: string,
  accessToken: string,
  options?: FetchSallaOptions
): Promise<Response> {
  const { timeoutMs, ...requestOptions } = options ?? {};
  return fetchWithRetry(
    url,
    {
      ...requestOptions,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...requestOptions?.headers,
      },
    },
    {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 8000,
      timeoutMs: timeoutMs ?? 12000,
      // Retry on 5xx errors and rate limiting
      shouldRetry: (response) =>
        response.status >= 500 || response.status === 429,
    }
  );
}

const createTimeoutController = (options?: RequestInit, timeoutMs?: number) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return { controller: null, timeoutError: null, cleanup: undefined };
  }

  const controller = new AbortController();
  const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
  const timeoutId = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const originalSignal = options?.signal;
  let abortHandler: (() => void) | null = null;

  if (originalSignal) {
    if (originalSignal.aborted) {
      controller.abort(originalSignal.reason);
    } else {
      abortHandler = () => controller.abort(originalSignal.reason);
      originalSignal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (abortHandler && originalSignal) {
      originalSignal.removeEventListener('abort', abortHandler);
    }
  };

  return { controller, timeoutError, cleanup };
};
