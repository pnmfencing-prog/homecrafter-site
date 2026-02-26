// Simple in-memory rate limiter (resets on cold start, which is fine for serverless)
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return true; // allowed
  }
  
  if (entry.count >= maxRequests) {
    return false; // blocked
  }
  
  entry.count++;
  return true; // allowed
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of hits) {
    if (now > entry.resetAt) hits.delete(key);
  }
}, 60_000);
