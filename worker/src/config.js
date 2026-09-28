require('dotenv').config();

module.exports = {
  healthPort: parseInt(process.env.WORKER_PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/urlshortener',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  redisStreamName: process.env.REDIS_STREAM_NAME || 'clicks',
  consumerGroup: process.env.CONSUMER_GROUP || 'clicks_group',
  consumerName: process.env.CONSUMER_NAME || `worker-${process.pid || 1}`,
  batchSize: parseInt(process.env.BATCH_SIZE || '100', 10),
  blockTimeMs: parseInt(process.env.BLOCK_TIME_MS || '2000', 10)
};
