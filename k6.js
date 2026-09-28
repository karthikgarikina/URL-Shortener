import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Metrics
export const cacheHitRate = new Rate('cache_hit_rate');
export const cacheMissRate = new Rate('cache_miss_rate');
export const writeDuration = new Trend('write_duration');
export const readDuration = new Trend('read_duration');
export const collisionsDetected = new Counter('collisions_detected');

export const options = {
  scenarios: {
    // 1. Write Benchmark (Hash Strategy)
    write_hash: {
      executor: 'constant-vus',
      vus: 25,
      duration: '30s',
      exec: 'testWriteHash'
    },
    // 2. Write Benchmark (Snowflake Strategy)
    write_snowflake: {
      executor: 'constant-vus',
      vus: 25,
      duration: '30s',
      startTime: '30s',
      exec: 'testWriteSnowflake'
    },
    // 3. High-Throughput Read Benchmark (Cache Performance)
    read_redirect: {
      executor: 'constant-vus',
      vus: 50,
      duration: '45s',
      startTime: '60s',
      exec: 'testReadRedirect'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<200'] // 95% of requests under 200ms
  }
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:3000';

// Pool of short codes populated during warmup/write
let shortCodes = [];

export function setup() {
  const sampleCodes = [];
  for (let i = 0; i < 20; i++) {
    const payload = JSON.stringify({
      url: `https://example.com/seed-item-${i}-${Date.now()}`,
      strategy: i % 2 === 0 ? 'hash' : 'snowflake'
    });
    const res = http.post(`${BASE_URL}/api/shorten`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    if (res.status === 201) {
      try {
        const body = JSON.parse(res.body);
        if (body.short_code) {
          sampleCodes.push(body.short_code);
        } else if (body.short_url) {
          sampleCodes.push(body.short_url.split('/').pop());
        }
      } catch (e) {}
    }
  }
  return { codes: sampleCodes };
}

export function testWriteHash() {
  const url = `https://example.com/resource/${Math.random().toString(36).substring(7)}/${Date.now()}`;
  const payload = JSON.stringify({ url, strategy: 'hash' });

  const res = http.post(`${BASE_URL}/api/shorten`, payload, {
    headers: { 'Content-Type': 'application/json' }
  });

  writeDuration.add(res.timings.duration);
  const ok = check(res, {
    'write hash status is 201': (r) => r.status === 201,
    'has short_url': (r) => {
      try {
        return !!JSON.parse(r.body).short_url;
      } catch (e) {
        return false;
      }
    }
  });

  if (!ok && res.status === 500) {
    collisionsDetected.add(1);
  }

  sleep(0.05);
}

export function testWriteSnowflake() {
  const url = `https://example.com/snowflake/${Math.random().toString(36).substring(7)}/${Date.now()}`;
  const payload = JSON.stringify({ url, strategy: 'snowflake' });

  const res = http.post(`${BASE_URL}/api/shorten`, payload, {
    headers: { 'Content-Type': 'application/json' }
  });

  writeDuration.add(res.timings.duration);
  check(res, {
    'write snowflake status is 201': (r) => r.status === 201,
    'has short_url': (r) => {
      try {
        return !!JSON.parse(r.body).short_url;
      } catch (e) {
        return false;
      }
    }
  });

  sleep(0.05);
}

export function testReadRedirect(data) {
  const codes = data.codes && data.codes.length > 0 ? data.codes : ['testcode'];
  const code = codes[Math.floor(Math.random() * codes.length)];

  // Set redirects to 0 to inspect redirect response and custom headers
  const res = http.get(`${BASE_URL}/${code}`, {
    redirects: 0
  });

  readDuration.add(res.timings.duration);

  const isRedirect = check(res, {
    'status is 302': (r) => r.status === 302,
    'has location header': (r) => !!r.headers['Location']
  });

  const cacheStatus = res.headers['X-Cache-Status'] || res.headers['x-cache-status'];
  if (cacheStatus === 'HIT') {
    cacheHitRate.add(1);
    cacheMissRate.add(0);
  } else if (cacheStatus === 'MISS') {
    cacheHitRate.add(0);
    cacheMissRate.add(1);
  }

  sleep(0.02);
}
