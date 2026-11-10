import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ReviewError,
  ErrorCodes,
  withRetry,
  withTimeout,
  formatError,
  isReviewError
} from '../src/utils/error-handler.js';
import { RateLimiter, withRateLimit } from '../src/utils/rate-limiter.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the result without retrying on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, 3, 100)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    const promise = withRetry(fn, 3, 100);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws RETRY_EXHAUSTED after all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always'));
    const promise = withRetry(fn, 3, 100);
    const assertion = expect(promise).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff with jitter between attempts', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // no jitter -> exact delays
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fn = vi.fn().mockRejectedValue(new Error('always'));

    const promise = withRetry(fn, 3, 100);
    const assertion = expect(promise).rejects.toBeInstanceOf(ReviewError);
    await vi.runAllTimersAsync();
    await assertion;

    // 3 attempts -> waits only between attempts: 100 * 2^0, 100 * 2^1
    const delays = setTimeoutSpy.mock.calls.map(call => call[1]);
    expect(delays).toEqual([100, 200]);
  });

  it('adds jitter of less than 100ms', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');

    const promise = withRetry(fn, 2, 100);
    await vi.runAllTimersAsync();
    await promise;

    expect(setTimeoutSpy.mock.calls[0]?.[1]).toBe(150); // 100 backoff + 0.5 * 100 jitter
  });

  it('does not retry errors rejected by shouldRetry', async () => {
    const error = new ReviewError('bad key', ErrorCodes.MISSING_API_KEY);
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, 3, 100, () => false)).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the function finishes in time', async () => {
    const promise = withTimeout(async () => 'done', 1000);
    await expect(promise).resolves.toBe('done');
  });

  it('rejects with AGENT_TIMEOUT when the function is too slow', async () => {
    const slow = () => new Promise<string>(resolve => setTimeout(() => resolve('late'), 5000));
    const promise = withTimeout(slow, 1000, 'took too long');
    const assertion = expect(promise).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT,
      message: 'took too long',
      metadata: { timeoutMs: 1000 }
    });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('propagates errors thrown by the function', async () => {
    await expect(
      withTimeout(async () => {
        throw new Error('inner');
      }, 1000)
    ).rejects.toThrow('inner');
  });

  it('clears the timer after completion', async () => {
    await withTimeout(async () => 'done', 1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('error helpers', () => {
  it('formats ReviewError, Error and unknown values', () => {
    expect(formatError(new ReviewError('nope', ErrorCodes.PR_NOT_FOUND))).toBe('[PR_NOT_FOUND] nope');
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError('text')).toBe('text');
  });

  it('detects ReviewError instances', () => {
    expect(isReviewError(new ReviewError('x', ErrorCodes.UNKNOWN_ERROR))).toBe(true);
    expect(isReviewError(new Error('x'))).toBe(false);
  });
});

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limits and tracks them', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 10000, maxConcurrent: 5 });
    expect(limiter.canProceed(1000)).toBe(true);

    await limiter.acquire(1000);
    const status = limiter.getStatus();
    expect(status.activeRequests).toBe(1);
    expect(status.requestsInWindow).toBe(1);
    expect(status.tokensInWindow).toBe(1000);
  });

  it('blocks when the concurrent limit is reached', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await limiter.acquire();
    expect(limiter.canProceed()).toBe(false);
    limiter.release();
    expect(limiter.canProceed()).toBe(true);
  });

  it('blocks when the request-per-minute limit is reached', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 2, maxConcurrent: 10 });
    await limiter.acquire();
    limiter.release();
    await limiter.acquire();
    limiter.release();
    expect(limiter.canProceed()).toBe(false);
  });

  it('blocks when the token limit would be exceeded', async () => {
    const limiter = new RateLimiter({ maxTokensPerMinute: 1000, maxConcurrent: 10 });
    await limiter.acquire(800);
    limiter.release();
    expect(limiter.canProceed(300)).toBe(false);
    expect(limiter.canProceed(200)).toBe(true);
  });

  it('prunes records older than 60 seconds (sliding window)', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxConcurrent: 10 });
    await limiter.acquire();
    limiter.release();
    expect(limiter.canProceed()).toBe(false);

    vi.advanceTimersByTime(59_000);
    expect(limiter.canProceed()).toBe(false); // still inside the window

    vi.advanceTimersByTime(2_000);
    expect(limiter.canProceed()).toBe(true); // oldest record fell out
    expect(limiter.getStatus().requestsInWindow).toBe(0);
  });

  it('queues a second acquire until the first is released', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await limiter.acquire();

    let secondAcquired = false;
    const second = limiter.acquire().then(() => {
      secondAcquired = true;
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(secondAcquired).toBe(false);

    limiter.release();
    await second;
    expect(secondAcquired).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });

  it('waits for the window to slide when the request limit is hit', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxConcurrent: 10 });
    await limiter.acquire();
    limiter.release();

    let acquired = false;
    const second = limiter.acquire().then(() => {
      acquired = true;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(acquired).toBe(false);

    await vi.advanceTimersByTimeAsync(31_000);
    await second;
    expect(acquired).toBe(true);
  });

  it('updates the token record with the actual usage on release', async () => {
    const limiter = new RateLimiter();
    await limiter.acquire(1000);
    limiter.release(250);
    expect(limiter.getStatus().tokensInWindow).toBe(250);
  });

  it('withRateLimit releases the slot after the function runs', async () => {
    const limiter = new RateLimiter({ maxConcurrent: 1 });
    await expect(withRateLimit(limiter, async () => 'result')).resolves.toBe('result');
    expect(limiter.getStatus().activeRequests).toBe(0);
  });
});
