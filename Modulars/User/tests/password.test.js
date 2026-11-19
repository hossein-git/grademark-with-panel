'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, DEFAULT_PARAMS } = require('../password');

// Cheap parameters keep the edge-case tests fast. The defaults are tested separately.
const FAST = { N: 1024, r: 8, p: 1 };

describe('User/password', () => {
    it('hashes with the default scrypt parameters and verifies the right password', async () => {
        const hash = await hashPassword('correct horse battery staple');
        assert.match(hash, new RegExp(`^scrypt\\$N=${DEFAULT_PARAMS.N},r=${DEFAULT_PARAMS.r},p=${DEFAULT_PARAMS.p}\\$`));
        assert.ok(!hash.includes('correct horse'), 'plain text must not appear in the hash');
        assert.equal(await verifyPassword('correct horse battery staple', hash), true);
        assert.equal(await verifyPassword('wrong password', hash), false);
    });

    it('uses a random salt, so the same password gives different hashes', async () => {
        const [a, b] = await Promise.all([hashPassword('same-password', FAST), hashPassword('same-password', FAST)]);
        assert.notEqual(a, b);
        assert.equal(await verifyPassword('same-password', a), true);
        assert.equal(await verifyPassword('same-password', b), true);
    });

    it('verifies using the parameters stored in the hash', async () => {
        const hash = await hashPassword('pw-with-old-params', FAST);
        assert.match(hash, /^scrypt\$N=1024,r=8,p=1\$/);
        assert.equal(await verifyPassword('pw-with-old-params', hash), true);
    });

    it('is case sensitive and treats Unicode-equivalent input the same', async () => {
        const hash = await hashPassword('Pässwörd', FAST);
        assert.equal(await verifyPassword('pässwörd', hash), false);
        // "ä" as one code point vs "a" + combining diaeresis.
        assert.equal(await verifyPassword('Pa\u0308sswo\u0308rd', hash), true);
    });

    it('returns false instead of throwing for malformed or unsafe hashes', async () => {
        for (const bad of [
            '',
            'plaintext',
            'bcrypt$whatever',
            'scrypt$N=1024,r=8,p=1$onlysalt',
            'scrypt$N=1000,r=8,p=1$c2FsdA==$a2V5', // N not a power of two
            'scrypt$N=4194304,r=8,p=1$c2FsdA==$a2V5', // N too large (DoS)
            null,
            undefined,
            42,
        ]) {
            assert.equal(await verifyPassword('anything', bad), false, `hash: ${String(bad)}`);
        }
        assert.equal(await verifyPassword(undefined, await hashPassword('x', FAST)), false);
    });

    it('refuses to hash empty or non-string passwords', async () => {
        await assert.rejects(hashPassword(''), TypeError);
        await assert.rejects(hashPassword(undefined), TypeError);
        await assert.rejects(hashPassword(12345678), TypeError);
    });
});
