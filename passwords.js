const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

function hashLegacyPassword(password, saltSuffix) {
  return crypto.createHash('sha256').update(password + saltSuffix).digest('hex');
}

async function verifyPassword(password, storedHash) {
  if (storedHash.startsWith('scrypt$')) {
    const [, saltHex, keyHex, extra] = storedHash.split('$');
    if (extra !== undefined ||
        !/^[a-f0-9]{32}$/i.test(saltHex || '') ||
        !/^[a-f0-9]{128}$/i.test(keyHex || '')) {
      return false;
    }

    const expectedKey = Buffer.from(keyHex, 'hex');
    const actualKey = await scrypt(password, Buffer.from(saltHex, 'hex'), expectedKey.length);
    return actualKey.length === expectedKey.length && crypto.timingSafeEqual(actualKey, expectedKey);
  }

  if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
    return false;
  }

  const expectedHash = Buffer.from(storedHash, 'hex');
  return ['foodiehub-admin-salt', 'foodiehub-admin'].some((saltSuffix) => {
    const actualHash = Buffer.from(hashLegacyPassword(password, saltSuffix), 'hex');
    return crypto.timingSafeEqual(actualHash, expectedHash);
  });
}

function passwordNeedsRehash(storedHash) {
  return !storedHash.startsWith('scrypt$');
}

function isDefaultAdminPasswordHash(storedHash) {
  return [
    hashLegacyPassword('admin123', 'foodiehub-admin-salt'),
    hashLegacyPassword('admin123', 'foodiehub-admin')
  ].includes(storedHash);
}

module.exports = { hashPassword, verifyPassword, passwordNeedsRehash, isDefaultAdminPasswordHash };
