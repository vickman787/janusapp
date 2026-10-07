import {
  consumeRateLimit,
  type RateLimitResult,
} from "@/lib/serverStore";

const WINDOW_MS = 60_000;

function requestAddress(req: Request): string {
  // Proxies append the connecting address; the first entry can be supplied
  // by a client and must not choose our rate-limit bucket.
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return (
    forwarded ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export async function rateLimitRequest(
  req: Request,
  bucket: string,
  limit: number,
  subject?: string
): Promise<RateLimitResult> {
  const ipResult = await consumeRateLimit(
    `${bucket}:ip:${requestAddress(req)}`,
    limit,
    WINDOW_MS
  );
  if (!subject) return ipResult;

  const subjectResult = await consumeRateLimit(
    `${bucket}:user:${subject.toLowerCase()}`,
    limit,
    WINDOW_MS
  );
  if (!ipResult.allowed || !subjectResult.allowed) {
    return {
      allowed: false,
      limit: Math.min(ipResult.limit, subjectResult.limit),
      remaining: 0,
      resetAt: Math.max(ipResult.resetAt, subjectResult.resetAt),
    };
  }
  return {
    allowed: true,
    limit: Math.min(ipResult.limit, subjectResult.limit),
    remaining: Math.min(ipResult.remaining, subjectResult.remaining),
    resetAt: Math.max(ipResult.resetAt, subjectResult.resetAt),
  };
}

export async function rateLimitSubject(
  bucket: string,
  subject: string,
  limit: number
): Promise<RateLimitResult> {
  return await consumeRateLimit(
    `${bucket}:user:${subject.toLowerCase()}`,
    limit,
    WINDOW_MS
  );
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    "Retry-After": String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))),
  };
}
