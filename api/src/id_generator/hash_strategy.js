const crypto = require('crypto');
const { encode } = require('./base62');

/**
 * Generates a short code from a URL using MD5 hashing and Base62 encoding.
 * @param {string} url - Original URL
 * @param {string} [salt=''] - Optional salt to resolve collisions
 * @returns {string} Short code (up to 11 chars, fits in VARCHAR(16))
 */
function generateHashId(url, salt = '') {
  const hash = crypto.createHash('md5').update(url + (salt ? `:${salt}` : '')).digest();
  // Take first 8 bytes (64 bits) as an unsigned big-endian 64-bit integer
  const num = hash.readBigUInt64BE(0);
  return encode(num);
}

module.exports = {
  generateHashId
};
