# High-Throughput Distributed URL Shortener

A production-grade, distributed URL shortener engineered for high throughput, sub-millisecond redirect latency, and fault tolerance. This system implements coordination-free distributed ID generation (Snowflake-inspired and MD5-based with Base62 encoding), a read-through Redis cache layer, and an event-driven asynchronous analytics pipeline powered by Redis Streams and PostgreSQL UPSERTs.

---

## Architecture Overview

```
                                  [ User / Browser ]
                                      │         ▲
                 1. Submit Long URL   │         │  H. 302 Found Redirect
                 2. POST /api/shorten │         │     (Location: Long URL)
                                      ▼         │
                              ┌──────────────────────┐
                              │     API Service      │
                              │     (Port 3000)      │
                              └──────────┬───────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │ B. Read Cache                  │ 3. ID Gen (Hash / Snowflake)   │ G. Publish Click Event
        │    (Check short_code)          │ 4. Insert (short_code, URL)    │    (Fire & Forget)
        ▼                                ▼                                ▼
┌──────────────┐                 ┌──────────────┐                 ┌──────────────┐
│ Redis Cache  │                 │  PostgreSQL  │                 │ Redis Stream │
│  (Port 6379) │                 │ (Port 5432)  │                 │  (`clicks`)  │
└──────────────┘                 └──────────────┘                 └───────┬──────┘
  │ C1: HIT (Return 302 + X-Cache-Status: HIT)                            │
  │ C2: MISS                                                              │ I. XREADGROUP
  │      D. Query DB for short_code                                       ▼
  │      E. Return Long URL                                       ┌──────────────┐
  │      F. Populate Cache (TTL)                                  │   Worker     │
  └───────────────────────────────────────────────────────────────┤ (Port 3001)  │
                                                                  └───────┬──────┘
                                                                          │ J. Batch UPSERT
                                                                          ▼
                                                                  ┌──────────────┐
                                                                  │ PostgreSQL   │
                                                                  │(analytics_   │
                                                                  │   hourly)    │
                                                                  └──────────────┘
```

### Core Components

1. **API Service (`api`)**: REST API and SPA frontend running on Node.js 20. Handles link creation, collision-resistant ID generation, read-through caching, 302 redirects, and analytics queries.
2. **PostgreSQL Database (`db`)**: The durable source of truth. Stores canonical URL mappings with unique constraints and aggregated hourly click statistics with composite unique constraints.
3. **Redis (`redis`)**: Serves dual roles:
   * **Speed Layer (Read-Through Cache)**: Eliminates database hits on the hot redirect path.
   * **Message Broker (Redis Streams)**: Provides durable, at-least-once message queues for decoupled click telemetry.
4. **Analytics Worker (`worker`)**: Independent background process utilizing Redis Consumer Groups (`clicks_group`). Consumes click batches, truncates timestamps to the hour, and aggregates click counts via PostgreSQL `UPSERT` queries.

---

## Getting Started & Setup

### Prerequisites
* [Docker](https://docs.docker.com/get-docker/) (v20+ recommended)
* [Docker Compose](https://docs.docker.com/compose/) (v2+ / `docker compose`)

### 1. Clone & Configure Environment
Create your `.env` configuration file from the provided `.env.example`:

```bash
cp .env.example .env
```

The default `.env` includes:
```env
# API Configuration
API_PORT=3000
BASE_URL=http://localhost:3000
NODE_ID=1

# Worker Configuration
WORKER_PORT=3001
CONSUMER_GROUP=clicks_group
BATCH_SIZE=100
BLOCK_TIME_MS=2000

# PostgreSQL Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=urlshortener
DATABASE_URL=postgres://postgres:postgres@db:5432/urlshortener

# Redis Configuration
REDIS_URL=redis://redis:6379
REDIS_STREAM_NAME=clicks
CACHE_TTL_SECONDS=86400
```

### 2. Build and Start Services
Start the entire multi-service stack with a single command:

```bash
docker compose up --build -d
```

### 3. Verify Container Health
Check that all 4 containers (`api`, `worker`, `db`, `redis`) start and transition to `(healthy)`:

```bash
docker compose ps
```

Expected output:
```
NAME                   IMAGE                  STATUS                    PORTS
url_shortener_api      url-shortener-api      Up (healthy)              0.0.0.0:3000->3000/tcp
url_shortener_db       postgres:16-alpine     Up (healthy)              0.0.0.0:5432->5432/tcp
url_shortener_redis    redis:7-alpine         Up (healthy)              0.0.0.0:6379->6379/tcp
url_shortener_worker   url-shortener-worker   Up (healthy)              0.0.0.0:3001->3001/tcp
```

---

## Interactive UI Access

* **URL Shortener UI**: Open [http://localhost:3000](http://localhost:3000) in your browser.
* **Analytics Dashboard**: Open `http://localhost:3000/analytics/<shortCode>` (a link is automatically generated upon creating any short URL).

---

## Step-by-Step Verification Guide for All Requirements

### Requirement 1: Docker Compose Orchestration & Healthchecks
* **Check**:
  ```bash
  docker compose ps
  ```
* **Expected**: All 4 services (`api`, `worker`, `db`, `redis`) are listed with `(healthy)`.

---

### Requirement 2: Database Schema & Seeding
Verify table structures and constraints automatically initialized by `db/init/01-init.sql`:

```bash
docker compose exec -T db psql -U postgres -d urlshortener -c "\d urls" -c "\d analytics_hourly"
```

* **Expected**:
  * `urls` has columns: `id`, `short_code` (UNIQUE), `original_url`, `strategy`, `created_at`, `expires_at`.
  * `analytics_hourly` has columns: `id`, `short_code`, `hour`, `click_count`, and constraint `uq_short_code_hour UNIQUE (short_code, hour)`.

---

### Requirement 3: Hash-Based Shortening (`POST /api/shorten`)
* **Request**:
  ```bash
  curl -i -X POST http://localhost:3000/api/shorten \
    -H "Content-Type: application/json" \
    -d '{"url": "https://www.google.com/search?q=distributed+systems", "strategy": "hash"}'
  ```
* **Expected**:
  * HTTP status: `201 Created`
  * JSON body containing `"short_url": "http://localhost:3000/<hash>"`
* **Database Check**:
  ```bash
  docker compose exec -T db psql -U postgres -d urlshortener -c "SELECT id, short_code, strategy FROM urls WHERE strategy = 'hash' ORDER BY id DESC LIMIT 1;"
  ```

---

### Requirement 4: Snowflake-Inspired Shortening (`POST /api/shorten`)
* **Request**:
  ```bash
  curl -i -X POST http://localhost:3000/api/shorten \
    -H "Content-Type: application/json" \
    -d '{"url": "https://en.wikipedia.org/wiki/Snowflake_ID", "strategy": "snowflake"}'
  ```
* **Expected**:
  * HTTP status: `201 Created`
  * JSON body containing `"short_url": "http://localhost:3000/<snowflake>"`
* **Database Check**:
  ```bash
  docker compose exec -T db psql -U postgres -d urlshortener -c "SELECT id, short_code, strategy FROM urls WHERE strategy = 'snowflake' ORDER BY id DESC LIMIT 1;"
  ```

---

### Requirement 5: Optional Expiration Date
* **Request**:
  ```bash
  curl -i -X POST http://localhost:3000/api/shorten \
    -H "Content-Type: application/json" \
    -d '{"url": "https://example.com/temporary-link", "strategy": "hash", "expires_at": "2030-01-01T00:00:00Z"}'
  ```
* **Expected**:
  * HTTP status: `201 Created`
  * Record in PostgreSQL `urls` table has `expires_at` set to `2030-01-01 00:00:00+00`.

---

### Requirement 6: Valid Short Code Redirection
* **Create URL**:
  ```bash
  # Example output short_code: hiG9qnOqRWr
  curl -X POST http://localhost:3000/api/shorten -H "Content-Type: application/json" -d '{"url": "https://example.com", "strategy": "hash"}'
  ```
* **Send GET request (no follow redirects)**:
  ```bash
  curl -i -s http://localhost:3000/<shortCode>
  ```
* **Expected**:
  * HTTP status: `302 Found`
  * Header: `Location: https://example.com`

---

### Requirement 7: Non-Existent Code Returns 404
* **Request**:
  ```bash
  curl -i -s http://localhost:3000/non-existent-code-123
  ```
* **Expected**:
  * HTTP status: `404 Not Found`
  * Response body: `{"error":"Short URL not found"}`

---

### Requirement 8: Expired Code Returns 404
* **Insert Expired Record**:
  ```bash
  docker compose exec -T db psql -U postgres -d urlshortener -c "INSERT INTO urls (short_code, original_url, strategy, created_at, expires_at) VALUES ('expiredTest', 'https://example.com', 'hash', NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day') ON CONFLICT DO NOTHING;"
  ```
* **Request**:
  ```bash
  curl -i -s http://localhost:3000/expiredTest
  ```
* **Expected**:
  * HTTP status: `404 Not Found`
  * Response body: `{"error":"URL has expired"}`

---

### Requirements 9 & 10: Cache Miss (First Request) & Cache Hit (Subsequent Requests)
1. **Flush Redis Cache**:
   ```bash
   docker compose exec -T redis redis-cli flushall
   ```
2. **Create New URL**:
   ```bash
   curl -X POST http://localhost:3000/api/shorten -H "Content-Type: application/json" -d '{"url": "https://developer.mozilla.org", "strategy": "snowflake"}'
   ```
3. **First GET Request (Cache Miss)**:
   ```bash
   curl -i -s http://localhost:3000/<shortCode>
   ```
   * **Header Check**: `X-Cache-Status: MISS`
4. **Second GET Request (Cache Hit)**:
   ```bash
   curl -i -s http://localhost:3000/<shortCode>
   ```
   * **Header Check**: `X-Cache-Status: HIT`

---

### Requirement 11: Redis Streams Click Event Publication
Verify that redirecting publishes to the `clicks` stream:

```bash
docker compose exec -T redis redis-cli xrevrange clicks + - COUNT 1
```

* **Expected**: Returns a stream message containing `short_code` and `timestamp` (ISO 8601).

---

### Requirement 12: Analytics Worker Processing & Database Aggregation
1. Create a short URL and redirect through it:
   ```bash
   curl -s http://localhost:3000/<shortCode>
   ```
2. Wait 3–5 seconds for the background worker to consume and aggregate the event.
3. Query `analytics_hourly`:
   ```bash
   docker compose exec -T db psql -U postgres -d urlshortener -c "SELECT short_code, hour, click_count FROM analytics_hourly WHERE short_code = '<shortCode>';"
   ```
   * **Expected**: A row exists with `click_count >= 1`.

---

### Requirement 13: Aggregated Analytics Endpoint (`GET /api/analytics/:shortCode`)
1. Create a short URL and trigger 3 redirects:
   ```bash
   curl -s http://localhost:3000/<shortCode>
   curl -s http://localhost:3000/<shortCode>
   curl -s http://localhost:3000/<shortCode>
   ```
2. Query the analytics API endpoint:
   ```bash
   curl -i -s http://localhost:3000/api/analytics/<shortCode>
   ```
3. **Expected**:
   * HTTP status: `200 OK`
   * JSON structure:
     ```json
     {
       "total_clicks": 3,
       "history": [
         {
           "hour": "2026-09-28T18:00:00Z",
           "clicks": 3
         }
       ]
     }
     ```

---

### Requirement 14: Frontend Shortening Form Contract
* Inspect the root page HTML:
  ```bash
  curl -s http://localhost:3000/ | grep data-testid
  ```
* **Required Elements**:
  * `<input data-testid="url-input">`
  * `<select data-testid="strategy-select">` (with options for `hash` and `snowflake`)
  * `<button data-testid="shorten-button">`
  * `<div data-testid="result-display">` (initially empty)

---

### Requirement 15: Frontend Analytics Chart Contract
* Inspect the analytics page:
  ```bash
  curl -s http://localhost:3000/analytics/<shortCode> | grep data-testid
  ```
* **Required Element**:
  * `<canvas data-testid="analytics-chart">` or `<div>` present in DOM.

---

### Requirement 16: Load Testing Scripts & Benchmark Report
* Both `k6.js` and `locustfile.py` load test scripts are available in the repository.
* `BENCHMARK.md` is generated at the root of the repository with full empirical metrics.

To execute the k6 load test suite inside Docker:
```bash
Get-Content k6.js | docker run --rm -i --network="url-shortener_default" -e TARGET_URL=http://api:3000 grafana/k6 run -
```

---

## Stopping the Services

To stop containers while preserving persistent database data:
```bash
docker compose down
```

To stop containers and wipe volumes:
```bash
docker compose down -v
```
