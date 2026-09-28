const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = BigInt(BASE62_ALPHABET.length);

/**
 * Encodes a non-negative BigInt or number into a Base62 string.
 * @param {bigint|number} num
 * @returns {string}
 */
function encode(num) {
  let n = BigInt(num);
  if (n === 0n) {
    return BASE62_ALPHABET[0];
  }
  let result = '';
  while (n > 0n) {
    const remainder = Number(n % BASE);
    result = BASE62_ALPHABET[remainder] + result;
    n = n / BASE;
  }
  return result;
}

module.exports = {
  encode,
  BASE62_ALPHABET
};
