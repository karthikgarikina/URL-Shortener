const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { generateShortCode } = require('../id_generator');

router.post('/shorten', async (req, res) => {
  try {
    const { url, strategy = 'hash', expires_at } = req.body;

    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const trimmedUrl = url.trim();

    // Basic URL validation
    try {
      new URL(trimmedUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const selectedStrategy = strategy.toLowerCase() === 'snowflake' ? 'snowflake' : 'hash';

    let expiresAt = null;
    if (expires_at) {
      const parsedDate = new Date(expires_at);
      if (isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'Invalid expires_at timestamp format' });
      }
      expiresAt = parsedDate.toISOString();
    }

    // Collision retry loop
    const maxRetries = 10;
    let shortCode = '';
    let inserted = false;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const salt = attempt === 0 ? '' : `${attempt}-${Date.now()}`;
      shortCode = generateShortCode(trimmedUrl, selectedStrategy, salt);

      try {
        await db.query(
          `INSERT INTO urls (short_code, original_url, strategy, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [shortCode, trimmedUrl, selectedStrategy, expiresAt]
        );
        inserted = true;
        break;
      } catch (err) {
        // Postgres unique violation code is 23505
        if (err.code === '23505') {
          console.warn(`Collision detected for short_code: ${shortCode} on attempt ${attempt + 1}. Retrying...`);
          continue;
        }
        throw err;
      }
    }

    if (!inserted) {
      return res.status(500).json({ error: 'Failed to generate unique short URL due to collisions' });
    }

    const shortUrl = `${config.baseUrl}/${shortCode}`;

    return res.status(201).json({
      short_url: shortUrl,
      short_code: shortCode,
      original_url: trimmedUrl,
      strategy: selectedStrategy,
      expires_at: expiresAt
    });
  } catch (err) {
    console.error('Error in /api/shorten:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
