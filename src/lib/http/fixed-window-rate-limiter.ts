export type FixedWindowRateLimit = {
  key: string;
  limit: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs: number;
  private readonly maxBuckets: number;

  constructor(windowMs: number, maxBuckets: number) {
    if (windowMs <= 0 || maxBuckets <= 0) {
      throw new Error("Rate limiter bounds must be positive");
    }
    this.windowMs = windowMs;
    this.maxBuckets = maxBuckets;
  }

  allows(rules: readonly FixedWindowRateLimit[], now = Date.now()) {
    this.pruneExpired(now);

    // 모든 조건을 먼저 확인해, 결제 키 제한에 걸린 요청이 IP 할당량까지
    // 소모하는 부분 적용을 만들지 않는다.
    for (const rule of rules) {
      const bucket = this.buckets.get(rule.key);
      if (bucket && bucket.resetAt > now && bucket.count >= rule.limit) {
        return false;
      }
    }

    for (const rule of rules) {
      const bucket = this.buckets.get(rule.key);
      const nextBucket =
        bucket && bucket.resetAt > now
          ? { count: bucket.count + 1, resetAt: bucket.resetAt }
          : { count: 1, resetAt: now + this.windowMs };

      // Map 삽입 순서를 최근 사용 순서로 유지한다. 새 키 공격이 오래된 IP
      // 버킷부터 밀어내어 제한을 우회하지 못하게 한다.
      this.buckets.delete(rule.key);
      this.buckets.set(rule.key, nextBucket);
    }

    this.trimToBound();
    return true;
  }

  get size() {
    return this.buckets.size;
  }

  private pruneExpired(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  private trimToBound() {
    while (this.buckets.size > this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value;
      if (typeof oldestKey !== "string") return;
      this.buckets.delete(oldestKey);
    }
  }
}
