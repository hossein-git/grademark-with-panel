'use strict';

const { timeframeMinutes } = require('./chart.files');

const SUMMARY_COLUMNS = `
    b.id, b.strategy_id, b.chart_id, b.user_id, b.status, b.error, b.starting_capital, b.parameters_json,
    b.bar_count, b.first_bar_time, b.last_bar_time, b.trade_count, b.final_capital, b.profit, b.profit_pct,
    b.max_drawdown_pct, b.percent_profitable, b.profit_factor, b.expectancy,
    b.started_at, b.finished_at, b.duration_ms,
    s.key AS strategy_key, s.name AS strategy_name,
    c.name AS chart_name, c.symbol AS chart_symbol, c.timeframe AS chart_timeframe,
    u.name AS user_name
`;
const FROM_JOINS = `
    FROM backtests b
    JOIN strategies s ON s.id = b.strategy_id
    JOIN charts c ON c.id = b.chart_id
    LEFT JOIN users u ON u.id = b.user_id
`;

const parseJson = (text) => (text == null ? null : JSON.parse(text));

/** Data access for the `backtests` and `backtest_trades` tables. */
class BacktestModel {
    constructor(db) {
        this.db = db;
        this.statements = {
            insert: db.prepare(`
                INSERT INTO backtests (strategy_id, chart_id, user_id, status, starting_capital, started_at)
                VALUES (@strategyId, @chartId, @userId, 'running', @startingCapital, @startedAt)
            `),
            complete: db.prepare(`
                UPDATE backtests SET
                    status = 'completed', parameters_json = @parametersJson, bar_count = @barCount,
                    first_bar_time = @firstBarTime, last_bar_time = @lastBarTime, trade_count = @tradeCount,
                    final_capital = @finalCapital, profit = @profit, profit_pct = @profitPct,
                    max_drawdown_pct = @maxDrawdownPct, percent_profitable = @percentProfitable,
                    profit_factor = @profitFactor, expectancy = @expectancy,
                    analysis_json = @analysisJson, equity_curve_json = @equityCurveJson, drawdown_json = @drawdownJson,
                    finished_at = @finishedAt, duration_ms = @durationMs
                WHERE id = @id AND status = 'running'
            `),
            fail: db.prepare(`
                UPDATE backtests SET status = 'failed', error = @error, finished_at = @finishedAt, duration_ms = @durationMs
                WHERE id = @id AND status = 'running'
            `),
            failAllRunning: db.prepare(`
                UPDATE backtests SET status = 'failed', error = @error, finished_at = @finishedAt
                WHERE status = 'running'
            `),
            insertTrade: db.prepare(`
                INSERT INTO backtest_trades (
                    backtest_id, trade_number, direction, entry_time, entry_price, exit_time, exit_price,
                    profit, profit_pct, growth, risk_pct, rmultiple, holding_period, exit_reason, stop_price, profit_target
                ) VALUES (
                    @backtestId, @tradeNumber, @direction, @entryTime, @entryPrice, @exitTime, @exitPrice,
                    @profit, @profitPct, @growth, @riskPct, @rmultiple, @holdingPeriod, @exitReason, @stopPrice, @profitTarget
                )
            `),
            findById: db.prepare(`
                SELECT ${SUMMARY_COLUMNS}, b.analysis_json, b.equity_curve_json, b.drawdown_json
                ${FROM_JOINS} WHERE b.id = ?
            `),
            listTrades: db.prepare('SELECT * FROM backtest_trades WHERE backtest_id = ? ORDER BY trade_number'),
            filterOptions: db.prepare(`
                SELECT DISTINCT c.symbol, c.timeframe FROM backtests b JOIN charts c ON c.id = b.chart_id
                WHERE b.strategy_id = ?
            `),
        };
    }

    /** Creates a backtest in the 'running' state and returns its id. */
    createRunning({ strategyId, chartId, userId = null, startingCapital, startedAt = new Date() }) {
        return Number(this.statements.insert.run({
            strategyId,
            chartId,
            userId,
            startingCapital,
            startedAt: startedAt.toISOString(),
        }).lastInsertRowid);
    }

    /** Stores the runner result and its trades in one transaction. Does nothing if the backtest is no longer running. */
    complete(id, result, finishedAt, durationMs) {
        const { analysis } = result;
        this.db.transaction(() => {
            const changes = this.statements.complete.run({
                id,
                parametersJson: result.parameters === null ? null : JSON.stringify(result.parameters),
                barCount: result.barCount,
                firstBarTime: result.firstBarTime,
                lastBarTime: result.lastBarTime,
                tradeCount: result.trades.length,
                finalCapital: analysis.finalCapital,
                profit: analysis.profit,
                profitPct: analysis.profitPct,
                maxDrawdownPct: analysis.maxDrawdownPct,
                percentProfitable: analysis.percentProfitable,
                profitFactor: analysis.profitFactor,
                expectancy: analysis.expectency, // (sic) the engine's IAnalysis field name
                analysisJson: JSON.stringify(analysis),
                equityCurveJson: JSON.stringify(result.equityCurve),
                drawdownJson: JSON.stringify(result.drawdown),
                finishedAt: finishedAt.toISOString(),
                durationMs,
            }).changes;
            if (changes === 0) return;
            result.trades.forEach((trade, index) => {
                this.statements.insertTrade.run({ backtestId: id, tradeNumber: index + 1, ...trade });
            });
        })();
    }

    fail(id, error, finishedAt, durationMs) {
        this.statements.fail.run({ id, error, finishedAt: finishedAt.toISOString(), durationMs });
    }

    /** Marks every 'running' backtest as failed. Used at server start, since any run in progress was lost. */
    failAllRunning(error, now = new Date()) {
        return this.statements.failAllRunning.run({ error, finishedAt: now.toISOString() }).changes;
    }

    findById(id) {
        return this.statements.findById.get(id) || null;
    }

    listTrades(backtestId) {
        return this.statements.listTrades.all(backtestId);
    }

    /**
     * Backtests of one strategy, newest first.
     * @param filters.symbol     only charts with this symbol (e.g. EURUSD)
     * @param filters.timeframe  only charts with this timeframe (e.g. H4)
     */
    listForStrategy(strategyId, { symbol, timeframe } = {}) {
        const where = ['b.strategy_id = @strategyId'];
        if (symbol) where.push('c.symbol = @symbol');
        if (timeframe) where.push('c.timeframe = @timeframe');
        return this.db
            .prepare(`SELECT ${SUMMARY_COLUMNS} ${FROM_JOINS} WHERE ${where.join(' AND ')} ORDER BY b.id DESC`)
            .all({ strategyId, symbol, timeframe });
    }

    /** Symbols and timeframes that appear in a strategy's backtests, used for the filter dropdowns. */
    filterOptions(strategyId) {
        const rows = this.statements.filterOptions.all(strategyId);
        return {
            symbols: [...new Set(rows.map((r) => r.symbol))].sort(),
            timeframes: [...new Set(rows.map((r) => r.timeframe))].sort((a, b) => timeframeMinutes(a) - timeframeMinutes(b)),
        };
    }

    static toSummary(row) {
        if (!row) return null;
        return {
            id: row.id,
            status: row.status,
            error: row.error,
            strategy: { id: row.strategy_id, key: row.strategy_key, name: row.strategy_name },
            chart: { id: row.chart_id, name: row.chart_name, symbol: row.chart_symbol, timeframe: row.chart_timeframe },
            user: row.user_id ? { id: row.user_id, name: row.user_name } : null,
            startingCapital: row.starting_capital,
            parameters: parseJson(row.parameters_json),
            barCount: row.bar_count,
            firstBarTime: row.first_bar_time,
            lastBarTime: row.last_bar_time,
            tradeCount: row.trade_count,
            finalCapital: row.final_capital,
            profit: row.profit,
            profitPct: row.profit_pct,
            maxDrawdownPct: row.max_drawdown_pct,
            percentProfitable: row.percent_profitable,
            profitFactor: row.profit_factor,
            expectancy: row.expectancy,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            durationMs: row.duration_ms,
        };
    }

    static toDetail(row, tradeRows) {
        if (!row) return null;
        return {
            ...BacktestModel.toSummary(row),
            analysis: parseJson(row.analysis_json),
            equityCurve: parseJson(row.equity_curve_json) || [],
            drawdown: parseJson(row.drawdown_json) || [],
            trades: tradeRows.map((t) => ({
                number: t.trade_number,
                direction: t.direction,
                entryTime: t.entry_time,
                entryPrice: t.entry_price,
                exitTime: t.exit_time,
                exitPrice: t.exit_price,
                profit: t.profit,
                profitPct: t.profit_pct,
                growth: t.growth,
                riskPct: t.risk_pct,
                rmultiple: t.rmultiple,
                holdingPeriod: t.holding_period,
                exitReason: t.exit_reason,
                stopPrice: t.stop_price,
                profitTarget: t.profit_target,
            })),
        };
    }
}

module.exports = { BacktestModel };
