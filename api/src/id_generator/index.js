const config = require('../config');
const { generateHashId } = require('./hash_strategy');
const { SnowflakeGenerator } = require('./snowflake_strategy');

const snowflake = new SnowflakeGenerator(config.nodeId);

/**
 * Generate a short code using the requested strategy.
 * @param {string} url - Original URL
 * @param {'hash'|'snowflake'} strategy - Strategy name
 * @param {string|number} [salt=''] - Optional salt for hash strategy
 * @returns {string} Short code
 */
function generateShortCode(url, strategy = 'hash', salt = '') {
  if (strategy === 'snowflake') {
    return snowflake.nextId();
  }
  return generateHashId(url, salt);
}

module.exports = {
  generateShortCode,
  generateHashId,
  snowflake
};
