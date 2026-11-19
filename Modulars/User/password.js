'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// OWASP-recommended scrypt settings (N=2^14, r=8, p=5, about 16 MiB per hash).
// The settings are stored in each hash, so they can be raised later without
// breaking existing passwords.
const DEFAULT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 5 });
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_N = 2 ** 20;

// Format: scrypt$N=16384,r=8,p=5$<salt base64>$<derived key base64>
const HASH_PATTERN = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function derive(password, salt, { N, r, p }, keyLength) {
    // scrypt needs about 128 * N * r bytes of memory; allow twice that.
    return scrypt(password.normalize('NFKC'), salt, keyLength, { N, r, p, maxmem: 256 * N * r });
}

/** Hashes a plain-text password with a random salt. */
async function hashPassword(password, params = DEFAULT_PARAMS) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new TypeError('Password must be a non-empty string');
    }
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, params, KEY_LENGTH);
    return `scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Checks a plain-text password against a stored hash using a constant-time
 * comparison. Returns false (never throws) for a wrong password or a malformed hash.
 */
async function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || typeof storedHash !== 'string') {
        return false;
    }
    const match = HASH_PATTERN.exec(storedHash);
    if (!match) {
        return false;
    }
    const [, n, r, p, saltB64, keyB64] = match;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (params.N > MAX_N || params.N < 2 || (params.N & (params.N - 1)) !== 0) {
        return false;
    }

    const expected = Buffer.from(keyB64, 'base64');
    if (expected.length === 0) {
        return false;
    }
    const actual = await derive(password, Buffer.from(saltB64, 'base64'), params, expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword, DEFAULT_PARAMS };
