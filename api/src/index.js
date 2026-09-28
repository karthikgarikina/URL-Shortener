const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const db = require('./db');
const redis = require('./redis');

const shortenRoute = require('./routes/shorten');
const analyticsRoute = require('./routes/analytics');
const redirectRoute = require('./routes/redirect');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Healthcheck endpoint for Docker healthcheck
app.get('/health', async (req, res) => {
  try {
    // Check DB
    await db.query('SELECT 1');
    // Check Redis
    const pong = await redis.ping();
    if (pong === 'PONG') {
      return res.status(200).json({ status: 'healthy', db: 'up', redis: 'up' });
    }
    return res.status(503).json({ status: 'unhealthy', redis: pong });
  } catch (err) {
    return res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Serve analytics page
app.get('/analytics/:shortCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

// API Routes
app.use('/api', shortenRoute);
app.use('/api', analyticsRoute);

// Dynamic redirection route for short URLs (must be registered last)
app.use('/', redirectRoute);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`URL Shortener API running on http://0.0.0.0:${config.port}`);
  console.log(`Configured BASE_URL: ${config.baseUrl}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down API server gracefully...');
  server.close(async () => {
    try {
      await redis.quit();
      await db.pool.end();
      console.log('API resources closed cleanly.');
      process.exit(0);
    } catch (e) {
      console.error('Error during shutdown:', e);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
