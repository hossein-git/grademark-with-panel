'use strict';

/**
 * Data access for the `user_sessions` table. Only the SHA-256 hash of each
 * session token is stored, so a leaked database cannot be used to log in.
 */
class SessionModel {
    constructor(db) {
        this.db = db;
        this.statements = {
            insert: db.prepare(`
                INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at)
                VALUES (@userId, @tokenHash, @expiresAt, @createdAt)
            `),
            findActive: db.prepare('SELECT * FROM user_sessions WHERE token_hash = ? AND expires_at > ?'),
            deleteByTokenHash: db.prepare('DELETE FROM user_sessions WHERE token_hash = ?'),
            deleteExpiredForUser: db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND expires_at <= ?'),
        };
    }

    create({ userId, tokenHash, expiresAt, createdAt }) {
        this.statements.insert.run({
            userId,
            tokenHash,
            expiresAt: expiresAt.toISOString(),
            createdAt: createdAt.toISOString(),
        });
    }

    /** Returns the session for this token hash if it has not expired yet, otherwise null. */
    findActiveByTokenHash(tokenHash, now = new Date()) {
        return this.statements.findActive.get(tokenHash, now.toISOString()) || null;
    }

    deleteByTokenHash(tokenHash) {
        return this.statements.deleteByTokenHash.run(tokenHash).changes;
    }

    deleteExpiredForUser(userId, now = new Date()) {
        return this.statements.deleteExpiredForUser.run(userId, now.toISOString()).changes;
    }
}

module.exports = { SessionModel };
