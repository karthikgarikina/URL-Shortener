const express = require('express');
const router = express.Router();
const db = require('../db');
const redis = require('../redis');
const config = require('../config');

// Helper to publish click event to Redis Stream
async function publishClickEvent(shortCode, req) {
  try {
    const payload = [
      config.redisStreamName,
      '*',
      'short_code', shortCode,
      'timestamp', new Date().toISOString(),
      'user_agent', req.headers['user-agent'] || 'unknown',
      'ip', req.ip || (req.socket && req.socket.remoteAddress) || 'unknown'
    ];
    await redis.xadd(...payload);
  } catch (err) {
    console.error('Failed to publish click event to Redis stream:', err);
  }
}

router.get('/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  // Ignore static assets or system paths if they hit this handler
  if (!shortCode || shortCode === 'favicon.ico' || shortCode === 'robots.txt') {
    return res.status(404).json({ error: 'Not found' });
  }

  const cacheKey = `url:${shortCode}`;

  try {
    // 1. Read-Through Cache Check
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      let parsed;
      try {
        parsed = JSON.parse(cachedData);
      } catch (e) {
        // Fallback if plain string was stored
        parsed = { original_url: cachedData, expires_at: null };
      }

      // Check if cached entry is expired
      if (parsed.expires_at) {
        const expiresTime = new Date(parsed.expires_at).getTime();
        if (Date.now() >= expiresTime) {
          // Evict expired entry from cache
          await redis.del(cacheKey);
          return res.status(404).json({ error: 'URL has expired' });
        }
      }

      // Cache HIT!
      res.setHeader('X-Cache-Status', 'HIT');
      await publishClickEvent(shortCode, req);
      return res.redirect(302, parsed.original_url);
    }

    // 2. Cache Miss: Query Database (PostgreSQL)
    const result = await db.query(
      `SELECT short_code, original_url, expires_at FROM urls WHERE short_code = $1`,
      [shortCode]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Short URL not found' });
    }

    const row = result.rows[0];

    // Check expiration in DB
    if (row.expires_at) {
      const expiresTime = new Date(row.expires_at).getTime();
      const remainingSeconds = Math.floor((expiresTime - Date.now()) / 1000);

      if (remainingSeconds <= 0) {
        return res.status(404).json({ error: 'URL has expired' });
      }

      // Store in Redis with TTL bounded by remaining expiration time
      const ttl = Math.min(remainingSeconds, config.cacheTtlSeconds);
      await redis.set(
        cacheKey,
        JSON.stringify({ original_url: row.original_url, expires_at: row.expires_at }),
        'EX',
        ttl
      );
    } else {
      // No expiration set: store with default TTL
      await redis.set(
        cacheKey,
        JSON.stringify({ original_url: row.original_url, expires_at: null }),
        'EX',
        config.cacheTtlSeconds
      );
    }

    // Cache MISS!
    res.setHeader('X-Cache-Status', 'MISS');
    await publishClickEvent(shortCode, req);
    return res.redirect(302, row.original_url);
  } catch (err) {
    console.error('Error handling redirect for shortCode:', shortCode, err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
