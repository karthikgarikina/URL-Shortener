const Redis = require('ioredis');
const config = require('./config');

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    return Math.min(times * 200, 3000);
  }
});

redis.on('error', (err) => {
  console.error('Worker Redis error:', err);
});

module.exports = redis;
