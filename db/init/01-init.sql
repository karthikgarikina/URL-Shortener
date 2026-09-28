-- Database initialization script for URL Shortener

CREATE TABLE IF NOT EXISTS urls (
    id SERIAL PRIMARY KEY,
    short_code VARCHAR(16) NOT NULL UNIQUE,
    original_url TEXT NOT NULL,
    strategy VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS analytics_hourly (
    id SERIAL PRIMARY KEY,
    short_code VARCHAR(16) NOT NULL,
    hour TIMESTAMPTZ NOT NULL,
    click_count INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_short_code_hour UNIQUE (short_code, hour)
);

-- Indexes for optimal lookup performance
CREATE INDEX IF NOT EXISTS idx_urls_short_code ON urls(short_code);
CREATE INDEX IF NOT EXISTS idx_urls_expires_at ON urls(expires_at);
CREATE INDEX IF NOT EXISTS idx_analytics_short_code ON analytics_hourly(short_code);
CREATE INDEX IF NOT EXISTS idx_analytics_short_code_hour ON analytics_hourly(short_code, hour);
