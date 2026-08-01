const IORedis = require("ioredis");
const redis = new IORedis(process.env.REDIS_URL || "redis://redis:6379");

async function getCachedAnalysis(fprint) {
  const key = `error:fingerprint:${fprint}`;
  const v = await redis.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

async function setCachedAnalysis(fprint, analysis, ttlSeconds = 30 * 24 * 3600) {
  const key = `error:fingerprint:${fprint}`;
  await redis.set(key, JSON.stringify(analysis), "EX", ttlSeconds);
}

module.exports = { getCachedAnalysis, setCachedAnalysis, redis };
