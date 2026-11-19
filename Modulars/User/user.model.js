'use strict';

/**
 * Data access for the `users` table.
 * Methods return raw rows, which include `password_hash`. Use `UserModel.toPublic()`
 * before sending a user to a client.
 */
class UserModel {
    constructor(db) {
        this.db = db;
        this.statements = {
            insert: db.prepare(`
                INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at)
                VALUES (@name, @email, @passwordHash, @role, @isActive, @now, @now)
            `),
            findById: db.prepare('SELECT * FROM users WHERE id = ?'),
            findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
            updateLastLogin: db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?'),
            setActive: db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?'),
        };
    }

    create({ name, email, passwordHash, role = 'user', isActive = true }, now = new Date()) {
        const result = this.statements.insert.run({
            name,
            email,
            passwordHash,
            role,
            isActive: isActive ? 1 : 0,
            now: now.toISOString(),
        });
        return this.findById(result.lastInsertRowid);
    }

    findById(id) {
        return this.statements.findById.get(id) || null;
    }

    /** Case-insensitive lookup (the column uses COLLATE NOCASE). */
    findByEmail(email) {
        return this.statements.findByEmail.get(email) || null;
    }

    updateLastLogin(id, at = new Date()) {
        this.statements.updateLastLogin.run(at.toISOString(), id);
    }

    /** Deactivated users cannot log in, and their existing sessions stop working. */
    setActive(id, isActive, now = new Date()) {
        this.statements.setActive.run(isActive ? 1 : 0, now.toISOString(), id);
    }

    /** The client-safe version of a user row (no password hash, camelCase keys). */
    static toPublic(row) {
        if (!row) {
            return null;
        }
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            isActive: row.is_active === 1,
            lastLoginAt: row.last_login_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

module.exports = { UserModel };
