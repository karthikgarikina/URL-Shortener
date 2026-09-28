const Redis = require('ioredis');
const config = require('./config');

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    return delay;
  }
});

redis.on('error', (err) => {
  console.error('Redis client error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

module.exports = redis;
