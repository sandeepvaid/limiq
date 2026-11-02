/**
 * Atomic Lua scripts — one per strategy. Each runs in a single round-trip and
 * mirrors the exact math in @limiq/store-memory's algorithms.
 *
 * Time comes from Redis `TIME` (server clock) so multiple app nodes never drift.
 * Every script returns the array: {allowed(0|1), limit, remaining, resetMs, retryAfterMs}.
 * All returned values are integers (Redis truncates floats on return).
 */

const NOW = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
`;

export const FIXED_WINDOW = `
${NOW}
local base = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local windowId = math.floor(now / windowMs)
local key = base .. ':' .. windowId
local count = tonumber(redis.call('GET', key) or '0')
local resetMs = (windowId + 1) * windowMs - now
local allowed = 0
if count + cost <= limit then
  allowed = 1
  count = redis.call('INCRBY', key, cost)
  redis.call('PEXPIRE', key, resetMs)
end
local remaining = math.max(0, limit - count)
local retry = 0
if allowed == 0 then retry = resetMs end
return {allowed, limit, remaining, resetMs, retry}
`;

export const SLIDING_WINDOW_COUNTER = `
${NOW}
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local curId = math.floor(now / windowMs)
local data = redis.call('HMGET', key, 'id', 'cur', 'prev')
local sid = tonumber(data[1])
local cur = tonumber(data[2]) or 0
local prev = tonumber(data[3]) or 0
local curCount = 0
local prevCount = 0
if sid ~= nil then
  if sid == curId then curCount = cur; prevCount = prev
  elseif sid == curId - 1 then prevCount = cur end
end
local elapsedInCur = now - curId * windowMs
local prevWeight = (windowMs - elapsedInCur) / windowMs
local estimate = prevCount * prevWeight + curCount
local allowed = 0
if estimate + cost <= limit then allowed = 1; curCount = curCount + cost end
local estimateAfter = prevCount * prevWeight + curCount
local resetMs = (curId + 1) * windowMs - now
redis.call('HMSET', key, 'id', curId, 'cur', curCount, 'prev', prevCount)
redis.call('PEXPIRE', key, 2 * windowMs)
local remaining = math.max(0, math.floor(limit - estimateAfter))
local retry = 0
if allowed == 0 then retry = resetMs end
return {allowed, limit, remaining, resetMs, retry}
`;

export const SLIDING_WINDOW_LOG = `
${NOW}
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local reqId = ARGV[4]
local cutoff = now - windowMs
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
local allowed = 0
if count + cost <= limit then
  allowed = 1
  for i = 1, cost do
    redis.call('ZADD', key, now, reqId .. '-' .. i)
  end
  count = count + cost
end
redis.call('PEXPIRE', key, windowMs)
local resetMs = 0
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
if oldest[2] ~= nil then resetMs = math.max(0, tonumber(oldest[2]) + windowMs - now) end
local retry = 0
if allowed == 0 then retry = resetMs end
return {allowed, limit, math.max(0, limit - count), resetMs, retry}
`;

export const TOKEN_BUCKET = `
${NOW}
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillTokens = tonumber(ARGV[2])
local interval = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local rate = refillTokens / interval
local data = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])
if tokens == nil then tokens = capacity; last = now end
local elapsed = now - last
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * rate)
local allowed = 0
if tokens >= cost then allowed = 1; tokens = tokens - cost end
local timeToFull = math.ceil((capacity - tokens) / rate)
redis.call('HMSET', key, 'tokens', tokens, 'last', now)
redis.call('PEXPIRE', key, math.max(interval, timeToFull))
local retry = 0
if allowed == 0 then retry = math.ceil((cost - tokens) / rate) end
return {allowed, capacity, math.floor(tokens), timeToFull, retry}
`;

export const LEAKY_BUCKET = `
${NOW}
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local leakPerSec = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local leakPerMs = leakPerSec / 1000
local data = redis.call('HMGET', key, 'level', 'last')
local level = tonumber(data[1])
local last = tonumber(data[2])
if level == nil then level = 0; last = now end
local elapsed = now - last
if elapsed < 0 then elapsed = 0 end
level = math.max(0, level - elapsed * leakPerMs)
local allowed = 0
if level + cost <= capacity then allowed = 1; level = level + cost end
local resetMs = math.ceil(level / leakPerMs)
redis.call('HMSET', key, 'level', level, 'last', now)
redis.call('PEXPIRE', key, math.max(1, math.ceil(capacity / leakPerMs)))
local retry = 0
if allowed == 0 then retry = math.ceil((level + cost - capacity) / leakPerMs) end
return {allowed, capacity, math.floor(capacity - level), resetMs, retry}
`;

export const SCRIPTS = {
  "fixed-window": FIXED_WINDOW,
  "sliding-window-counter": SLIDING_WINDOW_COUNTER,
  "sliding-window-log": SLIDING_WINDOW_LOG,
  "token-bucket": TOKEN_BUCKET,
  "leaky-bucket": LEAKY_BUCKET,
} as const;
