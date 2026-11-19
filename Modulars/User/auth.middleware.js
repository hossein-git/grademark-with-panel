'use strict';

const { HttpError } = require('../Base/errors');

/** Returns the token from an `Authorization: Bearer <token>` header, or null. */
function extractBearerToken(header) {
    if (typeof header !== 'string') {
        return null;
    }
    const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
    return match ? match[1] : null;
}

/**
 * Creates Express middleware that allows a request only if it has a valid session token.
 * On success it sets `req.auth = { user, session, token }`.
 *
 * Other modules get it from the app context to protect their own routes:
 *   app.use('/api/backtests', context.requireAuth, router);
 */
function createRequireAuth(authService) {
    return function requireAuth(req, res, next) {
        const token = extractBearerToken(req.get('authorization'));
        if (!token) {
            return next(HttpError.unauthorized('Authentication required'));
        }
        const result = authService.authenticate(token);
        if (!result) {
            return next(HttpError.unauthorized('Invalid or expired session'));
        }
        req.auth = { ...result, token };
        return next();
    };
}

module.exports = { createRequireAuth, extractBearerToken };
