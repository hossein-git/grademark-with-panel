'use strict';

// Same ISO-8601 UTC format as Date#toISOString(), so stored timestamps
// compare correctly as strings.
const NOW_ISO = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

module.exports = [
    {
        id: 'trade_001_create_strategies_and_charts',
        up(db) {
            db.exec(`
                -- One row per file in Modulars/Trade/Strategies. Rows are never deleted, so old
                -- backtests keep their strategy. is_active is set by the user; is_available is
                -- maintained by the catalog sync (file exists and loads correctly).
                CREATE TABLE strategies (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    key          TEXT    NOT NULL UNIQUE,
                    name         TEXT    NOT NULL,
                    description  TEXT,
                    file_name    TEXT    NOT NULL,
                    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
                    is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
                    load_error   TEXT,
                    created_at   TEXT    NOT NULL DEFAULT ${NOW_ISO},
                    updated_at   TEXT    NOT NULL DEFAULT ${NOW_ISO}
                );

                -- One row per <SYMBOL>_<TIMEFRAME>.csv file in the Charts directory.
                CREATE TABLE charts (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    name         TEXT    NOT NULL UNIQUE,
                    symbol       TEXT    NOT NULL,
                    timeframe    TEXT    NOT NULL,
                    file_name    TEXT    NOT NULL,
                    is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
                    is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
                    created_at   TEXT    NOT NULL DEFAULT ${NOW_ISO},
                    updated_at   TEXT    NOT NULL DEFAULT ${NOW_ISO}
                );
            `);
        },
    },
    {
        id: 'trade_002_create_backtests',
        up(db) {
            db.exec(`
                CREATE TABLE backtests (
                    id                INTEGER PRIMARY KEY AUTOINCREMENT,
                    strategy_id       INTEGER NOT NULL REFERENCES strategies (id) ON DELETE RESTRICT,
                    chart_id          INTEGER NOT NULL REFERENCES charts (id) ON DELETE RESTRICT,
                    user_id           INTEGER REFERENCES users (id) ON DELETE SET NULL,
                    status            TEXT    NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
                    error             TEXT,
                    starting_capital  REAL    NOT NULL,
                    parameters_json   TEXT,
                    bar_count         INTEGER,
                    first_bar_time    TEXT,
                    last_bar_time     TEXT,
                    -- Headline metrics, stored as columns so lists can show and sort them.
                    trade_count       INTEGER,
                    final_capital     REAL,
                    profit            REAL,
                    profit_pct        REAL,
                    max_drawdown_pct  REAL,
                    percent_profitable REAL,
                    profit_factor     REAL,
                    expectancy        REAL,
                    -- Full details.
                    analysis_json     TEXT,
                    equity_curve_json TEXT,
                    drawdown_json     TEXT,
                    started_at        TEXT    NOT NULL,
                    finished_at       TEXT,
                    duration_ms       INTEGER,
                    created_at        TEXT    NOT NULL DEFAULT ${NOW_ISO}
                );
                CREATE INDEX idx_backtests_strategy_id ON backtests (strategy_id, id);
                CREATE INDEX idx_backtests_chart_id ON backtests (chart_id);

                CREATE TABLE backtest_trades (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    backtest_id    INTEGER NOT NULL REFERENCES backtests (id) ON DELETE CASCADE,
                    trade_number   INTEGER NOT NULL,
                    direction      TEXT    NOT NULL,
                    entry_time     TEXT    NOT NULL,
                    entry_price    REAL    NOT NULL,
                    exit_time      TEXT    NOT NULL,
                    exit_price     REAL    NOT NULL,
                    profit         REAL,
                    profit_pct     REAL,
                    growth         REAL,
                    risk_pct       REAL,
                    rmultiple      REAL,
                    holding_period INTEGER,
                    exit_reason    TEXT,
                    stop_price     REAL,
                    profit_target  REAL,
                    UNIQUE (backtest_id, trade_number)
                );
            `);
        },
    },
    {
        id: 'trade_003_create_monte_carlo_simulations',
        up(db) {
            db.exec(`
                -- At most one simulation per backtest (UNIQUE). A failed simulation can be re-run
                -- (its row is reused); a running or completed one cannot.
                CREATE TABLE monte_carlo_simulations (
                    id               INTEGER PRIMARY KEY AUTOINCREMENT,
                    backtest_id      INTEGER NOT NULL UNIQUE REFERENCES backtests (id) ON DELETE CASCADE,
                    user_id          INTEGER REFERENCES users (id) ON DELETE SET NULL,
                    status           TEXT    NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
                    error            TEXT,
                    num_iterations   INTEGER NOT NULL,
                    num_samples      INTEGER NOT NULL,
                    random_seed      INTEGER NOT NULL,
                    starting_capital REAL    NOT NULL,
                    result_json      TEXT,
                    started_at       TEXT    NOT NULL,
                    finished_at      TEXT,
                    duration_ms      INTEGER,
                    created_at       TEXT    NOT NULL DEFAULT ${NOW_ISO}
                );
            `);
        },
    },
];
