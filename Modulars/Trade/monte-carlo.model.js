'use strict';

const SELECT = `
    SELECT m.*, u.name AS user_name
    FROM monte_carlo_simulations m
    LEFT JOIN users u ON u.id = m.user_id
`;

/** Data access for the `monte_carlo_simulations` table. */
class MonteCarloModel {
    constructor(db) {
        this.db = db;
        this.statements = {
            findByBacktestId: db.prepare(`${SELECT} WHERE m.backtest_id = ?`),
            insert: db.prepare(`
                INSERT INTO monte_carlo_simulations
                    (backtest_id, user_id, status, num_iterations, num_samples, random_seed, starting_capital, started_at)
                VALUES (@backtestId, @userId, 'running', @numIterations, @numSamples, @randomSeed, @startingCapital, @startedAt)
            `),
            restartFailed: db.prepare(`
                UPDATE monte_carlo_simulations SET
                    user_id = @userId, status = 'running', error = NULL, num_iterations = @numIterations,
                    num_samples = @numSamples, random_seed = @randomSeed, starting_capital = @startingCapital,
                    result_json = NULL, started_at = @startedAt, finished_at = NULL, duration_ms = NULL
                WHERE backtest_id = @backtestId AND status = 'failed'
            `),
            complete: db.prepare(`
                UPDATE monte_carlo_simulations
                SET status = 'completed', result_json = @resultJson, finished_at = @finishedAt, duration_ms = @durationMs
                WHERE backtest_id = @backtestId AND status = 'running'
            `),
            fail: db.prepare(`
                UPDATE monte_carlo_simulations
                SET status = 'failed', error = @error, finished_at = @finishedAt, duration_ms = @durationMs
                WHERE backtest_id = @backtestId AND status = 'running'
            `),
            failAllRunning: db.prepare(`
                UPDATE monte_carlo_simulations SET status = 'failed', error = @error, finished_at = @finishedAt
                WHERE status = 'running'
            `),
        };
    }

    findByBacktestId(backtestId) {
        return this.statements.findByBacktestId.get(backtestId) || null;
    }

    /**
     * Creates a 'running' simulation for the backtest, or restarts a failed one.
     * Returns false if the backtest already has a running or completed simulation.
     */
    createOrRestart({ backtestId, userId = null, numIterations, numSamples, randomSeed, startingCapital, startedAt = new Date() }) {
        const params = { backtestId, userId, numIterations, numSamples, randomSeed, startingCapital, startedAt: startedAt.toISOString() };
        return this.db.transaction(() => {
            if (this.statements.restartFailed.run(params).changes > 0) return true;
            try {
                this.statements.insert.run(params);
                return true;
            } catch (err) {
                // UNIQUE(backtest_id): a running or completed simulation already exists.
                if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return false;
                throw err;
            }
        })();
    }

    complete(backtestId, result, finishedAt, durationMs) {
        this.statements.complete.run({ backtestId, resultJson: JSON.stringify(result), finishedAt: finishedAt.toISOString(), durationMs });
    }

    fail(backtestId, error, finishedAt, durationMs) {
        this.statements.fail.run({ backtestId, error, finishedAt: finishedAt.toISOString(), durationMs });
    }

    failAllRunning(error, now = new Date()) {
        return this.statements.failAllRunning.run({ error, finishedAt: now.toISOString() }).changes;
    }

    static toPublic(row) {
        if (!row) return null;
        return {
            id: row.id,
            backtestId: row.backtest_id,
            status: row.status,
            error: row.error,
            user: row.user_id ? { id: row.user_id, name: row.user_name } : null,
            numIterations: row.num_iterations,
            numSamples: row.num_samples,
            randomSeed: row.random_seed,
            startingCapital: row.starting_capital,
            result: row.result_json ? JSON.parse(row.result_json) : null,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            durationMs: row.duration_ms,
        };
    }
}

module.exports = { MonteCarloModel };
