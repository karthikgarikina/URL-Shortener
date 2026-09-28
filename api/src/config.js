require('dotenv').config();

module.exports = {
  port: parseInt(process.env.API_PORT || process.env.PORT || '3000', 10),
  baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/urlshortener',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  nodeId: parseInt(process.env.NODE_ID || '1', 10),
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '86400', 10),
  redisStreamName: process.env.REDIS_STREAM_NAME || 'clicks'
};
