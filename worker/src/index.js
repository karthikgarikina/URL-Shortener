const http = require('http');
const config = require('./config');
const db = require('./db');
const redis = require('./redis');

let isRunning = true;
let isHealthy = false;

// 1. Healthcheck HTTP server for Docker
const healthServer = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    try {
      await db.query('SELECT 1');
      const pong = await redis.ping();
      if (pong === 'PONG') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'healthy', worker: config.consumerName }));
      }
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'unhealthy', error: e.message }));
    }
  }
  res.writeHead(404);
  res.end();
});

healthServer.listen(config.healthPort, '0.0.0.0', () => {
  console.log(`Worker health server listening on port ${config.healthPort}`);
});

// Helper: parse flat [k1, v1, k2, v2] array from Redis Stream into an object
function parseFields(fieldArray) {
  const result = {};
  for (let i = 0; i < fieldArray.length; i += 2) {
    result[fieldArray[i]] = fieldArray[i + 1];
  }
  return result;
}

// Process a batch of messages from the Redis Stream
async function processBatch(messages) {
  if (!messages || messages.length === 0) return;

  const aggregations = new Map(); // key: `${short_code}:::${hourIso}` -> count
  const messageIds = [];

  for (const [id, fields] of messages) {
    messageIds.push(id);
    const data = parseFields(fields);
    const shortCode = data.short_code;
    const rawTimestamp = data.timestamp;

    if (!shortCode) continue;

    const date = rawTimestamp ? new Date(rawTimestamp) : new Date();
    // Truncate to the start of the hour
    date.setMinutes(0, 0, 0);
    const hourIso = date.toISOString();

    const key = `${shortCode}:::${hourIso}`;
    aggregations.set(key, (aggregations.get(key) || 0) + 1);
  }

  if (aggregations.size > 0) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const upsertSql = `
        INSERT INTO analytics_hourly (short_code, hour, click_count)
        VALUES ($1, $2, $3)
        ON CONFLICT (short_code, hour)
        DO UPDATE SET click_count = analytics_hourly.click_count + EXCLUDED.click_count;
      `;

      for (const [key, count] of aggregations.entries()) {
        const [shortCode, hourIso] = key.split(':::');
        await client.query(upsertSql, [shortCode, hourIso, count]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Database transaction failed during analytics upsert:', err);
      throw err;
    } finally {
      client.release();
    }
  }

  // Acknowledge processed messages in Redis
  if (messageIds.length > 0) {
    await redis.xack(config.redisStreamName, config.consumerGroup, ...messageIds);
  }

  console.log(`Processed and ACKed batch of ${messageIds.length} event(s). Aggregated into ${aggregations.size} hourly bucket(s).`);
}

async function initConsumerGroup() {
  try {
    // Create stream and group if it doesn't already exist
    await redis.xgroup('CREATE', config.redisStreamName, config.consumerGroup, '0', 'MKSTREAM');
    console.log(`Consumer group '${config.consumerGroup}' created on stream '${config.redisStreamName}'.`);
  } catch (err) {
    if (err.message && err.message.includes('BUSYGROUP')) {
      console.log(`Consumer group '${config.consumerGroup}' already exists.`);
    } else {
      console.error('Error creating consumer group:', err);
    }
  }
}

async function startWorker() {
  console.log(`Starting Analytics Worker (${config.consumerName})...`);

  // Ensure DB and Redis are ready
  let connected = false;
  while (!connected && isRunning) {
    try {
      await db.query('SELECT 1');
      await redis.ping();
      connected = true;
      isHealthy = true;
      console.log('Worker connected to PostgreSQL and Redis successfully.');
    } catch (err) {
      console.log('Waiting for PostgreSQL and Redis to be ready...', err.message);
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  await initConsumerGroup();

  // First, check for and process any pending messages from a previous crash/restart
  try {
    const pendingRes = await redis.xreadgroup(
      'GROUP', config.consumerGroup, config.consumerName,
      'COUNT', config.batchSize,
      'STREAMS', config.redisStreamName,
      '0'
    );
    if (pendingRes && pendingRes.length > 0) {
      const [, pendingMessages] = pendingRes[0];
      if (pendingMessages && pendingMessages.length > 0) {
        console.log(`Found ${pendingMessages.length} pending messages to recover.`);
        await processBatch(pendingMessages);
      }
    }
  } catch (err) {
    console.warn('Notice while checking pending messages:', err.message);
  }

  // Main consumption loop
  while (isRunning) {
    try {
      const response = await redis.xreadgroup(
        'GROUP', config.consumerGroup, config.consumerName,
        'BLOCK', config.blockTimeMs,
        'COUNT', config.batchSize,
        'STREAMS', config.redisStreamName,
        '>'
      );

      if (response && response.length > 0) {
        const [, messages] = response[0];
        if (messages && messages.length > 0) {
          await processBatch(messages);
        }
      }
    } catch (err) {
      if (!isRunning) break;
      console.error('Error consuming from Redis Stream:', err.message);
      if (err.message && err.message.includes('NOGROUP')) {
        console.log('Recreating consumer group after stream loss / flush...');
        await initConsumerGroup();
      }
      // Wait briefly before retrying to prevent busy looping on connection errors
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log('Analytics Worker loop terminated.');
}

startWorker();

const shutdown = async () => {
  console.log('Shutting down Analytics Worker...');
  isRunning = false;
  healthServer.close();
  try {
    await redis.quit();
    await db.pool.end();
    console.log('Worker resources closed.');
    process.exit(0);
  } catch (e) {
    console.error('Error during worker shutdown:', e);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
