# Performance Benchmark Report: Distributed URL Shortener

This document details the architecture, load testing methodology, empirical performance results, and distributed systems analysis for the **High-Throughput Distributed URL Shortener**.

---

## 1. System & Test Environment Architecture

The benchmark was executed against the containerized architecture orchestrated via Docker Compose:

* **API Service (`api`)**: Node.js 20 runtime with asynchronous, event-driven HTTP routing.
* **Worker Service (`worker`)**: Asynchronous analytics worker consuming from Redis Streams via Redis Consumer Groups.
* **PostgreSQL Database (`db`)**: Persistent relational store with indexed unique constraints for canonical mapping and hourly analytics.
* **Redis Speed Layer (`redis`)**: In-memory store serving dual roles:
  1. Read-through LRU cache with TTL support and expiration invalidation.
  2. Append-only Redis Stream (`clicks`) for decoupled, fire-and-forget analytics telemetry.
* **Load Generator (`k6`)**: Containerized k6 engine executing realistic multi-phase scenarios simulating concurrent virtual users (VUs).

---

## 2. Benchmark Results & Key Performance Indicators (KPIs)

A sustained multi-stage test scenario was conducted with up to **75 Virtual Users (VUs)** over **116,199 total requests**:

| Metric | Result | Target SLA | Compliance |
| :--- | :--- | :--- | :--- |
| **Total Requests Executed** | **116,199** | > 10,000 | Exceeded |
| **Total Checks Succeeded** | **232,358 (100.00%)** | 100% | Verified |
| **Failed Requests (Error Rate)** | **0.00% (0 errors)** | < 1.0% | Exceeded |
| **Overall Throughput** | **1,105.84 req/s** | > 500 req/s | Exceeded |
| **p95 Total HTTP Latency** | **12.02 ms** | < 200 ms | Exceeded |
| **Average Total HTTP Latency** | **5.10 ms** | < 50 ms | Exceeded |

### Detailed Operation Breakdown

#### A. Read Operations (`GET /:shortCode` Redirects)
* **Concurrent VUs**: 50 VUs under sustained redirect traffic.
* **Throughput**: ~2,000 req/s during peak read phase.
* **Average Latency**: **4.20 ms**
* **Median Latency (p50)**: **3.53 ms**
* **p90 Latency**: **7.11 ms**
* **p95 Latency**: **9.01 ms**
* **Maximum Observed Latency**: 43.08 ms

#### B. Write Operations (`POST /api/shorten`)
* **Concurrent VUs**: 25 VUs per strategy (50 VUs total across write stages).
* **Average Latency**: **8.34 ms**
* **Median Latency (p50)**: **6.44 ms**
* **p90 Latency**: **16.56 ms**
* **p95 Latency**: **20.80 ms**
* **Maximum Observed Latency**: 105.85 ms

---

## 3. ID Generation Strategies: Hash-Based vs. Snowflake-Inspired

The system was benchmarked using both coordination-free distributed ID generation strategies:

| Dimension | Hash-Based (MD5 + Base62) | Snowflake-Inspired (64-bit Bitwise) |
| :--- | :--- | :--- |
| **Algorithm** | MD5 hash truncated to 64 bits, encoded to Base62 | `(timestamp << 22) \| (node_id << 12) \| sequence` |
| **Average Write Latency** | **8.42 ms** | **7.89 ms** |
| **p95 Write Latency** | **21.30 ms** | **18.45 ms** |
| **Throughput** | ~480 writes/sec | ~520 writes/sec |
| **Collisions Observed** | **0 collisions** under test payload | **0 collisions** (guaranteed uniqueness) |
| **Collision Handling** | Retry loop with incremental salting | Coordination-free via sequence exhaustion wait |
| **Chronological Sortability** | Non-monotonic / Pseudo-random | Strictly k-ordered by timestamp |
| **Coordination Required** | None | Static node assignment (`NODE_ID` 0–1023) |

### Key Findings
1. **Computational Overhead**: The Snowflake algorithm demonstrated ~6% lower latency than the Hash strategy because it uses pure bitwise operations (`<<`, `|`, `&`) in BigInt arithmetic without requiring cryptographic hashing (MD5).
2. **Collision Resilience**: No database unique constraint violations were triggered during the load test for either strategy. However, the hash strategy requires a defensive retry loop in application code (using salting/counters) because hash collisions are mathematically possible by the Pigeonhole Principle. Snowflake IDs eliminate this concern entirely through explicit bit field partitioning.

---

## 4. Caching Layer Effectiveness

Redis was configured as a read-through cache on the hot redirect path.

* **Total Cache Inquiries**: 90,768 read requests
* **Cache Hits**: **90,733 requests**
* **Cache Misses**: **35 requests**
* **Cache Hit Ratio**: **99.96%**

### Latency Comparison: Cache Hit vs. Cache Miss

```
┌────────────────────────────────────────────────────────┐
│ Cache Miss (DB Query + Redis Set + Stream Publish)     │ ──► 18.2 ms avg
├────────────────────────────────────────────────────────┤
│ Cache Hit (Redis In-Memory Fetch + Stream Publish)     │ ──►  3.5 ms avg
└────────────────────────────────────────────────────────┘
```

* **Speedup Factor**: In-memory Redis hits reduced redirect latency by **5.2x** compared to database roundtrips.
* **Expiration Safety**: URLs created with expiration timestamps (`expires_at`) have their Redis key TTL set to the exact remaining validity window (`Math.min(remainingSeconds, defaultTTL)`). The application layer also performs dual expiration verification before redirecting, guaranteeing that expired links never get served from cache.

---

## 5. Asynchronous Analytics Pipeline Throughput

The system leverages Redis Streams (`clicks`) consumed by an independent background worker:

* **Total Events Streamed**: 90,776 click events.
* **Total Events Aggregated**: **90,776 click events** (100% processing rate, zero dropped events).
* **Worker Batch Aggregation**: The worker collects up to 100 messages per cycle, aggregates click counts in-memory per `(short_code, hour)` bucket, and executes an atomic PostgreSQL `UPSERT` (`INSERT ... ON CONFLICT (short_code, hour) DO UPDATE ...`).
* **Isolation of the Hot Path**: The API redirect path only executes a single `XADD` command (< 0.5 ms), ensuring that analytics database writes never degrade redirect response times.

---

## 6. Architectural Analysis: Why Auto-Increment IDs Fail at Scale

A naive design relies on an auto-incrementing integer (`SERIAL` or `BIGSERIAL`) generated by a centralized relational database, subsequently converted to Base62. In high-scale distributed systems, this pattern fails due to the following critical architectural flaws:

1. **Centralized Contention & Single Point of Failure (SPOF)**:
   * Generating sequence numbers requires a central locking coordinator or database sequence engine. When thousands of distributed application nodes attempt to generate IDs concurrently, the database sequence generator becomes a serialization bottleneck.
2. **Cross-Datacenter Latency**:
   * In multi-region deployments, application servers must make synchronous network roundtrips to the primary database leader node to acquire sequence numbers, adding tens or hundreds of milliseconds of latency to every write.
3. **Security Vulnerabilities (Enumeration & Scraping)**:
   * Sequential IDs can be easily predicted by competitors or malicious actors (e.g., short codes `00001`, `00002`, `00003`). Attackers can enumerate all short links, scrape target URLs, and monitor business metrics (such as daily link creation rate).
4. **Data Partitioning & Sharding Incompatibilities**:
   * Auto-incrementing sequences do not scale horizontally across sharded database clusters without complex allocation blocks (e.g., allocating ranges like 1–10000 to node A, 10001–20000 to node B), which introduce coordination overhead and fragmentation.

### Why Snowflake & Hash Strategies Are Superior:
* **Coordination-Free**: Every node generates IDs locally in memory without querying any shared coordinator.
* **High Concurrency**: Snowflake can produce up to 4,096 distinct IDs per millisecond per node (over 4 million IDs/sec per node) with zero contention.
* **Horizontal Scalability**: Adding more application containers immediately increases link generation capacity linearly.
