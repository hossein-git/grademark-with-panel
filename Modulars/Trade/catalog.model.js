'use strict';

const { timeframeMinutes } = require('./chart.files');

/** Data access for the `strategies` and `charts` tables. */
class CatalogModel {
    constructor(db) {
        this.db = db;
        this.statements = {
            strategyByKey: db.prepare('SELECT * FROM strategies WHERE key = ?'),
            strategyById: db.prepare('SELECT * FROM strategies WHERE id = ?'),
            insertStrategy: db.prepare(`
                INSERT INTO strategies (key, name, description, file_name, is_available, load_error, created_at, updated_at)
                VALUES (@key, @name, @description, @fileName, @isAvailable, @loadError, @now, @now)
            `),
            updateStrategyFromFile: db.prepare(`
                UPDATE strategies
                SET name = @name, description = @description, file_name = @fileName,
                    is_available = @isAvailable, load_error = @loadError, updated_at = @now
                WHERE id = @id
            `),
            markStrategyMissing: db.prepare(`
                UPDATE strategies SET is_available = 0, load_error = 'File not found', updated_at = @now
                WHERE id = @id AND (is_available = 1 OR load_error IS NOT 'File not found')
            `),
            setStrategyActive: db.prepare('UPDATE strategies SET is_active = ?, updated_at = ? WHERE id = ?'),
            listStrategies: db.prepare(`
                SELECT s.*,
                       COUNT(b.id)                                        AS backtest_count,
                       SUM(CASE WHEN b.status = 'completed' THEN 1 END)   AS completed_count,
                       MAX(b.started_at)                                  AS last_run_at
                FROM strategies s
                LEFT JOIN backtests b ON b.strategy_id = s.id
                GROUP BY s.id
                ORDER BY s.name COLLATE NOCASE
            `),

            chartByName: db.prepare('SELECT * FROM charts WHERE name = ?'),
            chartById: db.prepare('SELECT * FROM charts WHERE id = ?'),
            insertChart: db.prepare(`
                INSERT INTO charts (name, symbol, timeframe, file_name, created_at, updated_at)
                VALUES (@name, @symbol, @timeframe, @fileName, @now, @now)
            `),
            updateChartFromFile: db.prepare(`
                UPDATE charts SET file_name = @fileName, is_available = 1, updated_at = @now
                WHERE id = @id AND (is_available = 0 OR file_name <> @fileName)
            `),
            markChartMissing: db.prepare('UPDATE charts SET is_available = 0, updated_at = @now WHERE id = @id AND is_available = 1'),
            setChartActive: db.prepare('UPDATE charts SET is_active = ?, updated_at = ? WHERE id = ?'),
            listCharts: db.prepare('SELECT * FROM charts'),
            allStrategyIds: db.prepare('SELECT id, key FROM strategies'),
            allChartIds: db.prepare('SELECT id, name FROM charts'),
        };
    }

    // ----- strategies -----

    /** Inserts or updates a strategy from its file. `info` = { key, name, description, fileName, isAvailable, loadError }. */
    upsertStrategy(info, now = new Date()) {
        const existing = this.statements.strategyByKey.get(info.key);
        const params = {
            ...info,
            isAvailable: info.isAvailable ? 1 : 0,
            loadError: info.loadError || null,
            now: now.toISOString(),
        };
        if (existing) {
            // A file that fails to load keeps its last good name/description.
            this.statements.updateStrategyFromFile.run({
                ...params,
                name: info.isAvailable ? info.name : existing.name,
                description: info.isAvailable ? info.description : existing.description,
                id: existing.id,
            });
            return existing.id;
        }
        return Number(this.statements.insertStrategy.run(params).lastInsertRowid);
    }

    /** Marks strategies whose key is not in `presentKeys` as unavailable. */
    markMissingStrategies(presentKeys, now = new Date()) {
        for (const row of this.statements.allStrategyIds.all()) {
            if (!presentKeys.has(row.key)) {
                this.statements.markStrategyMissing.run({ id: row.id, now: now.toISOString() });
            }
        }
    }

    findStrategyById(id) {
        return this.statements.strategyById.get(id) || null;
    }

    findStrategyByKey(key) {
        return this.statements.strategyByKey.get(key) || null;
    }

    listStrategies() {
        return this.statements.listStrategies.all();
    }

    setStrategyActive(id, isActive, now = new Date()) {
        return this.statements.setStrategyActive.run(isActive ? 1 : 0, now.toISOString(), id).changes > 0;
    }

    // ----- charts -----

    /** Inserts a chart or marks an existing one as available again. `info` = { name, symbol, timeframe, fileName }. */
    upsertChart(info, now = new Date()) {
        const existing = this.statements.chartByName.get(info.name);
        if (existing) {
            this.statements.updateChartFromFile.run({ id: existing.id, fileName: info.fileName, now: now.toISOString() });
            return existing.id;
        }
        return Number(this.statements.insertChart.run({ ...info, now: now.toISOString() }).lastInsertRowid);
    }

    markMissingCharts(presentNames, now = new Date()) {
        for (const row of this.statements.allChartIds.all()) {
            if (!presentNames.has(row.name)) {
                this.statements.markChartMissing.run({ id: row.id, now: now.toISOString() });
            }
        }
    }

    findChartById(id) {
        return this.statements.chartById.get(id) || null;
    }

    findChartByName(name) {
        return this.statements.chartByName.get(name) || null;
    }

    /** All charts, sorted by symbol and then timeframe from shortest to longest. */
    listCharts() {
        return this.statements
            .listCharts.all()
            .sort((a, b) => a.symbol.localeCompare(b.symbol) || timeframeMinutes(a.timeframe) - timeframeMinutes(b.timeframe));
    }

    setChartActive(id, isActive, now = new Date()) {
        return this.statements.setChartActive.run(isActive ? 1 : 0, now.toISOString(), id).changes > 0;
    }

    // ----- mapping to API objects -----

    static toPublicStrategy(row) {
        if (!row) return null;
        const result = {
            id: row.id,
            key: row.key,
            name: row.name,
            description: row.description,
            fileName: row.file_name,
            isActive: row.is_active === 1,
            isAvailable: row.is_available === 1,
            loadError: row.load_error,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
        if (row.backtest_count !== undefined) {
            result.backtestCount = row.backtest_count;
            result.completedCount = row.completed_count || 0;
            result.lastRunAt = row.last_run_at;
        }
        return result;
    }

    static toPublicChart(row) {
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            symbol: row.symbol,
            timeframe: row.timeframe,
            fileName: row.file_name,
            isActive: row.is_active === 1,
            isAvailable: row.is_available === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

module.exports = { CatalogModel };
