'use strict';

const { openDatabase, runMigrations } = require('./database');
const { createApp } = require('./app');

/**
 * Starts the application: opens the database, runs every module's migrations,
 * creates each module's services and builds the Express app.
 *
 * A module definition looks like:
 *   {
 *     name: 'User',
 *     migrations: [{ id, up(db) }],
 *     createServices(context) { return { userService, ... } },   // merged into context
 *     register(app, context) { app.use('/api/...', router) },
 *     onServerStart(context) { ... },   // optional; called by server.js only, not by CLI scripts
 *   }
 *
 * @param options.config   result of loadConfig()
 * @param options.modules  module definitions to load
 * @param options.db       optional existing database (tests pass an in-memory one)
 * @param options.logger   optional logger (defaults to console)
 */
function bootstrap({ config, modules, db, logger = console }) {
    const database = db || openDatabase(config.dbPath);

    runMigrations(database, modules.flatMap((module) => module.migrations || []));

    const context = { config, db: database, logger };
    for (const module of modules) {
        if (typeof module.createServices === 'function') {
            Object.assign(context, module.createServices(context));
        }
    }

    const app = createApp(context, modules);
    return { app, db: database, context };
}

module.exports = { bootstrap };
