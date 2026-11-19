'use strict';

const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function readInt(env, name, fallback, { min = 1 } = {}) {
    const raw = env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
        throw new Error(`Invalid value for ${name}: "${raw}" (expected an integer >= ${min}).`);
    }
    return value;
}

/**
 * Builds the application config from environment variables.
 * Takes `env` as a parameter so tests can pass their own values.
 */
function loadConfig(env = process.env) {
    return {
        env: env.NODE_ENV || 'development',
        host: env.HOST || '127.0.0.1',
        port: readInt(env, 'PORT', 3000, { min: 0 }),
        dbPath: env.DB_PATH
            ? path.resolve(PROJECT_ROOT, env.DB_PATH)
            : path.join(PROJECT_ROOT, 'database', 'app.sqlite'),
        trade: {
            // Chart CSV files, named <SYMBOL>_<TIMEFRAME>.csv (e.g. EURUSD_H4.csv).
            chartsDir: env.CHARTS_DIR ? path.resolve(PROJECT_ROOT, env.CHARTS_DIR) : path.join(PROJECT_ROOT, 'Charts'),
            // Strategy files, one strategy per .js file.
            strategiesDir: env.STRATEGIES_DIR
                ? path.resolve(PROJECT_ROOT, env.STRATEGIES_DIR)
                : path.join(PROJECT_ROOT, 'Modulars', 'Trade', 'Strategies'),
            // A backtest or Monte Carlo simulation still running after this long is stopped and marked as failed.
            backtestTimeoutSeconds: readInt(env, 'BACKTEST_TIMEOUT_SECONDS', 600),
            // Backtests + Monte Carlo simulations that can run at the same time (each one uses a worker thread).
            maxConcurrentBacktests: readInt(env, 'BACKTEST_MAX_CONCURRENT', 2),
        },
        auth: {
            // Lifetime of a normal login session.
            sessionTtlHours: readInt(env, 'SESSION_TTL_HOURS', 12),
            // Lifetime of a session created with "Remember me" checked.
            rememberTtlDays: readInt(env, 'SESSION_REMEMBER_TTL_DAYS', 30),
        },
    };
}

module.exports = { loadConfig, PROJECT_ROOT };
