'use strict';

const crypto = require('node:crypto');
const { HttpError } = require('../Base/errors');
const { UserModel } = require('./user.model');
const { hashPassword, verifyPassword } = require('./password');

const HOUR_MS = 60 * 60 * 1000;
const INVALID_CREDENTIALS = 'Invalid email or password';

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

class AuthService {
    /**
     * @param deps.userModel     UserModel
     * @param deps.sessionModel  SessionModel
     * @param deps.authConfig    { sessionTtlHours, rememberTtlDays }
     * @param deps.now           clock function; tests replace it to check expiry
     */
    constructor({ userModel, sessionModel, authConfig, now = () => new Date() }) {
        this.userModel = userModel;
        this.sessionModel = sessionModel;
        this.authConfig = authConfig;
        this.now = now;
        this.dummyHashPromise = null;
    }

    /**
     * Checks the credentials and creates a new session.
     * Every failure returns the same message, so callers cannot tell whether an email is registered.
     * @returns { token, expiresAt, user }
     */
    async login({ email, password, remember = false }) {
        const user = this.userModel.findByEmail(email);

        if (!user) {
            // Run a hash check anyway so an unknown email takes about as long as a wrong password.
            await verifyPassword(password, await this.getDummyHash());
            throw HttpError.unauthorized(INVALID_CREDENTIALS);
        }

        const passwordOk = await verifyPassword(password, user.password_hash);
        if (!passwordOk || user.is_active !== 1) {
            throw HttpError.unauthorized(INVALID_CREDENTIALS);
        }

        const now = this.now();
        const ttlMs = remember
            ? this.authConfig.rememberTtlDays * 24 * HOUR_MS
            : this.authConfig.sessionTtlHours * HOUR_MS;
        const expiresAt = new Date(now.getTime() + ttlMs);
        const token = crypto.randomBytes(32).toString('base64url');

        this.sessionModel.deleteExpiredForUser(user.id, now);
        this.sessionModel.create({ userId: user.id, tokenHash: hashToken(token), expiresAt, createdAt: now });
        this.userModel.updateLastLogin(user.id, now);

        return {
            token,
            expiresAt: expiresAt.toISOString(),
            user: UserModel.toPublic(this.userModel.findById(user.id)),
        };
    }

    /**
     * Finds the user for a session token.
     * @returns { user, session } when the session is valid and the user is active, otherwise null
     */
    authenticate(token) {
        if (typeof token !== 'string' || token.length === 0) {
            return null;
        }
        const session = this.sessionModel.findActiveByTokenHash(hashToken(token), this.now());
        if (!session) {
            return null;
        }
        const user = this.userModel.findById(session.user_id);
        if (!user || user.is_active !== 1) {
            return null;
        }
        return {
            user: UserModel.toPublic(user),
            session: { id: session.id, expiresAt: session.expires_at },
        };
    }

    /** Deletes the session for this token. Returns true if a session was removed. */
    logout(token) {
        if (typeof token !== 'string' || token.length === 0) {
            return false;
        }
        return this.sessionModel.deleteByTokenHash(hashToken(token)) > 0;
    }

    getDummyHash() {
        if (!this.dummyHashPromise) {
            this.dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
        }
        return this.dummyHashPromise;
    }
}

module.exports = { AuthService, hashToken };
