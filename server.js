'use strict';

const { loadConfig } = require('./Modulars/Base/config');
const { bootstrap } = require('./Modulars/Base/bootstrap');
const modules = require('./Modulars');

const config = loadConfig();
const { app, db, context } = bootstrap({ config, modules });

for (const module of modules) {
    if (typeof module.onServerStart === 'function') {
        module.onServerStart(context);
    }
}

const server = app.listen(config.port, config.host, () => {
    console.log(`API listening on http://${config.host}:${server.address().port} (db: ${config.dbPath})`);
});

function shutdown(signal) {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
        db.close();
        process.exit(0);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
