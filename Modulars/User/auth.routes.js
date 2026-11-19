'use strict';

const express = require('express');
const { validateLogin } = require('./user.validation');

/**
 * Routes mounted at /api/auth:
 *   POST /login   { email, password, remember? } -> 200 { token, expiresAt, user }
 *   GET  /me      (Bearer token)                 -> 200 { user }
 *   POST /logout  (Bearer token)                 -> 204
 */
function createAuthRouter({ authService, requireAuth }) {
    const router = express.Router();

    // Auth responses contain tokens and user data, so they must never be cached.
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

    router.post('/login', async (req, res) => {
        const credentials = validateLogin(req.body);
        const result = await authService.login(credentials);
        res.json(result);
    });

    router.get('/me', requireAuth, (req, res) => {
        res.json({ user: req.auth.user });
    });

    router.post('/logout', requireAuth, (req, res) => {
        authService.logout(req.auth.token);
        res.status(204).end();
    });

    return router;
}

module.exports = { createAuthRouter };
