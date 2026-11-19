'use strict';

const express = require('express');
const { HttpError } = require('./errors');

/**
 * Builds the Express app. Each module is an object with a `register(app, context)` function
 * that mounts its routes, so Base does not need to know about specific modules.
 *
 * @param context  shared services: { config, db, logger, ...module services }
 * @param modules  module definitions (see Modulars/index.js)
 */
function createApp(context, modules = []) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 'loopback');

    app.use(express.json({ limit: '10kb' }));

    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    for (const module of modules) {
        if (typeof module.register === 'function') {
            module.register(app, context);
        }
    }

    // Unknown API routes return JSON instead of Express's default HTML page.
    app.use('/api', (req, res, next) => {
        next(HttpError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
    });

    app.use(createErrorHandler(context.logger || console));

    return app;
}

function createErrorHandler(logger) {
    // Express identifies error handlers by their 4 arguments, so `next` must stay.
    // eslint-disable-next-line no-unused-vars
    return function errorHandler(err, req, res, next) {
        if (err instanceof HttpError) {
            const body = { error: err.message };
            if (err.details !== undefined) {
                body.details = err.details;
            }
            return res.status(err.status).json(body);
        }

        // Errors from body-parser (malformed JSON, payload too large, ...).
        if (err && err.type && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
            const message = err.type === 'entity.parse.failed' ? 'Malformed JSON body' : err.message;
            return res.status(err.status).json({ error: message });
        }

        logger.error('[unhandled error]', err);
        return res.status(500).json({ error: 'Internal server error' });
    };
}

module.exports = { createApp };
