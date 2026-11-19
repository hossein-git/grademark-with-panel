'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateNewUser, validateLogin } = require('../user.validation');

function validationErrors(fn) {
    try {
        fn();
    } catch (err) {
        assert.equal(err.status, 400);
        assert.equal(err.message, 'Validation failed');
        return err.details;
    }
    assert.fail('expected a validation error');
}

describe('User/validation', () => {
    describe('validateNewUser', () => {
        it('trims the name, normalizes the email and defaults the role to "user"', () => {
            const value = validateNewUser({ name: '  Jane Doe ', email: '  Jane@Example.COM ', password: 'longenough' });
            assert.deepEqual(value, { name: 'Jane Doe', email: 'jane@example.com', password: 'longenough', role: 'user' });
        });

        it('never trims or changes the password', () => {
            assert.equal(validateNewUser({ name: 'a', email: 'a@b.co', password: '  spaced  ' }).password, '  spaced  ');
        });

        it('reports every invalid field at once', () => {
            const errors = validationErrors(() => validateNewUser({ name: ' ', email: 'nope', password: 'short', role: 'root' }));
            assert.deepEqual(Object.keys(errors).sort(), ['email', 'name', 'password', 'role']);
        });

        it('treats missing or non-object input as missing fields', () => {
            for (const input of [undefined, null, 'string', {}]) {
                const errors = validationErrors(() => validateNewUser(input));
                assert.deepEqual(Object.keys(errors).sort(), ['email', 'name', 'password']);
            }
        });

        it('enforces length limits', () => {
            const base = { name: 'Jane', email: 'jane@example.com', password: 'longenough' };
            assert.ok(validationErrors(() => validateNewUser({ ...base, name: 'x'.repeat(101) })).name);
            assert.ok(validationErrors(() => validateNewUser({ ...base, password: 'x'.repeat(7) })).password);
            assert.ok(validationErrors(() => validateNewUser({ ...base, password: 'x'.repeat(129) })).password);
            assert.ok(validationErrors(() => validateNewUser({ ...base, email: `${'x'.repeat(250)}@a.co` })).email);
            assert.doesNotThrow(() => validateNewUser({ ...base, password: 'x'.repeat(8) }));
            assert.doesNotThrow(() => validateNewUser({ ...base, password: 'x'.repeat(128) }));
        });

        it('accepts the admin role', () => {
            assert.equal(validateNewUser({ name: 'A', email: 'a@b.co', password: 'longenough', role: 'admin' }).role, 'admin');
        });
    });

    describe('validateLogin', () => {
        it('normalizes the email and defaults remember to false', () => {
            assert.deepEqual(validateLogin({ email: ' Jane@Example.com', password: 'pw' }), {
                email: 'jane@example.com',
                password: 'pw',
                remember: false,
            });
            assert.equal(validateLogin({ email: 'a@b.co', password: 'pw', remember: true }).remember, true);
        });

        it('does not apply password strength rules (those are only checked when a user is created)', () => {
            assert.doesNotThrow(() => validateLogin({ email: 'a@b.co', password: 'x' }));
        });

        it('requires email and password as strings', () => {
            const errors = validationErrors(() => validateLogin({ email: 42, password: ['x'] }));
            assert.deepEqual(Object.keys(errors).sort(), ['email', 'password']);
            assert.deepEqual(Object.keys(validationErrors(() => validateLogin(undefined))).sort(), ['email', 'password']);
        });

        it('rejects huge passwords and a non-boolean remember flag', () => {
            const errors = validationErrors(() => validateLogin({ email: 'a@b.co', password: 'x'.repeat(1025), remember: 'yes' }));
            assert.deepEqual(Object.keys(errors).sort(), ['password', 'remember']);
        });
    });
});
