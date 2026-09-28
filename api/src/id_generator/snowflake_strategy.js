const { encode } = require('./base62');

// Epoch: January 1, 2024 00:00:00 UTC (1704067200000 ms)
const CUSTOM_EPOCH = 1704067200000n;

const NODE_ID_BITS = 10n;
const SEQUENCE_BITS = 12n;

const MAX_NODE_ID = (1n << NODE_ID_BITS) - 1n; // 1023
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n; // 4095

const NODE_ID_SHIFT = SEQUENCE_BITS; // 12
const TIMESTAMP_SHIFT = SEQUENCE_BITS + NODE_ID_BITS; // 22

class SnowflakeGenerator {
  constructor(nodeId = 1) {
    const parsedNodeId = BigInt(nodeId);
    if (parsedNodeId < 0n || parsedNodeId > MAX_NODE_ID) {
      throw new Error(`Node ID must be between 0 and ${MAX_NODE_ID}`);
    }
    this.nodeId = parsedNodeId;
    this.sequence = 0n;
    this.lastTimestamp = -1n;
  }

  getCurrentTimestamp() {
    return BigInt(Date.now());
  }

  waitNextMillis(lastTimestamp) {
    let timestamp = this.getCurrentTimestamp();
    while (timestamp <= lastTimestamp) {
      timestamp = this.getCurrentTimestamp();
    }
    return timestamp;
  }

  nextId() {
    let timestamp = this.getCurrentTimestamp();

    if (timestamp < this.lastTimestamp) {
      const offset = this.lastTimestamp - timestamp;
      if (offset <= 5000n) {
        // Clock moved backwards slightly, wait it out
        timestamp = this.waitNextMillis(this.lastTimestamp);
      } else {
        throw new Error(`Clock moved backwards by ${offset}ms! Refusing to generate ID.`);
      }
    }

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        // Sequence exhausted for this millisecond, wait for next millisecond
        timestamp = this.waitNextMillis(this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    const timeDiff = timestamp - CUSTOM_EPOCH;
    const snowflakeId = (timeDiff << TIMESTAMP_SHIFT) | (this.nodeId << NODE_ID_SHIFT) | this.sequence;

    return encode(snowflakeId);
  }
}

module.exports = {
  SnowflakeGenerator,
  CUSTOM_EPOCH
};
