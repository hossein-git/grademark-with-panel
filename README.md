# Grademark with Panel

An algo trading backtester with an admin panel, built on top of [Grademark](https://github.com/grademark/grademark). Load your chart data, define strategies, run backtests, and view results through a web dashboard.

## Tech Stack

- **Backtesting engine**: [Grademark](https://github.com/grademark/grademark) + [Data-Forge](http://data-forge-js.com/)
- **Backend**: Node.js + Express + SQLite
- **Frontend**: Vue 3 + Vuetify

## Features

- Run backtests from the admin panel or command line
- Support for multiple symbols and timeframes
- Define custom strategies with entry/exit rules
- Built-in indicators (SMA, EMA, etc.) via Data-Forge Indicators
- Intrabar stop loss, profit target, and trailing stop loss
- Conditional entry at a price level
- Equity curve and drawdown visualization
- Results dashboard with filtering and sorting
- Batch backtest across all symbols at once

## Data Format

Your CSV data needs the following columns, sorted in forward chronological order (oldest first):

```typescript
interface IBar {
    time: Date;
    open: number;
    high: number;
    low: number;
    close: number;
}
```

## How It Works

### Import modules

```javascript
const dataForge = require('data-forge');
require('data-forge-fs');
require('data-forge-indicators');
const { backtest, analyze, computeEquityCurve, computeDrawdown } = require('grademark');
```

### Load your data

```javascript
let inputSeries = dataForge.readFileSync("EURUSD_H1.csv")
    .parseCSV({ separator: '\t' })
    .parseDates("<DATE>", "YYYY.MM.DD")
    .parseFloats(["<OPEN>", "<HIGH>", "<LOW>", "<CLOSE>"])
    .renameSeries({
        "<DATE>": "time",
        "<OPEN>": "open",
        "<HIGH>": "high",
        "<LOW>": "low",
        "<CLOSE>": "close",
    });
```

### Add indicators

```javascript
const movingAverage = inputSeries
    .deflate(bar => bar.close)
    .sma(30);

inputSeries = inputSeries
    .withSeries("sma", movingAverage)
    .skip(30);
```

### Create a strategy

```javascript
const strategy = {
    entryRule: (enterPosition, args) => {
        if (args.bar.close < args.bar.sma) {
            enterPosition({ direction: "long" });
        }
    },

    exitRule: (exitPosition, args) => {
        if (args.bar.close > args.bar.sma) {
            exitPosition();
        }
    },

    stopLoss: args => {
        return args.entryPrice * (5/100);
    },
};
```

### Run a backtest

```javascript
const trades = backtest(strategy, inputSeries);
console.log("Made " + trades.length + " trades!");

const startingCapital = 10000;
const analysis = analyze(startingCapital, trades);
console.log(analysis);
```

### Visualize results

```javascript
computeEquityCurve(trades)
    .plot()
    .renderImage("output/my-equity-curve.png");

computeDrawdown(trades)
    .plot()
    .renderImage("output/my-drawdown.png");
```

## Project Structure

The project root is the backend (Express API + Grademark backtesting engine):

```
grademark-with-panel/
├── server.js           # API entry point (npm start)
├── SampleStrategy.js   # node SampleStrategy: run the sample strategy and save the result
├── Modulars/           # API modules (Base, User, Trade)
│   └── Trade/Strategies/   # strategy files, one per .js file
├── Charts/             # chart CSV files: <SYMBOL>_<TIMEFRAME>.csv
├── src/                # Grademark backtesting engine (TypeScript, built to build/)
└── frontend/           # Vue 3 + Vuetify admin dashboard
```

## Installation

```bash
npm install
```

## Backend & dashboard login

The admin dashboard needs a login. Visitors who are not logged in are redirected to the login page (`/authentication/login`), and after logging in they are taken back to the page they asked for.

### Run it

```bash
# 1. Backend, from the project root (Node >= 22.9)
npm install
cp .env.example .env            # optional, the defaults work
npm run user:create -- --name "Jane Doe" --email jane@example.com --password "choose-a-strong-one"
npm start                       # http://127.0.0.1:3000

# 2. Frontend (in another terminal)
cd frontend
npm install
npm run dev                     # Vite proxies /api to http://127.0.0.1:3000
```

There is no public sign-up. Create users with `npm run user:create` (the role defaults to `admin`). If you leave out `--password`, a random one is generated and printed once.

### Configuration (`.env` in the project root)

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Where the API listens |
| `DB_PATH` | `database/app.sqlite` | SQLite file (relative paths are resolved from the project root) |
| `SESSION_TTL_HOURS` | `12` | Session lifetime |
| `SESSION_REMEMBER_TTL_DAYS` | `30` | Session lifetime when "Remember me" is checked |
| `CHARTS_DIR` | `Charts` | Folder with chart CSV files |
| `STRATEGIES_DIR` | `Modulars/Trade/Strategies` | Folder with strategy files |
| `BACKTEST_TIMEOUT_SECONDS` | `600` | A backtest or Monte Carlo simulation running longer than this is stopped and marked failed |
| `BACKTEST_MAX_CONCURRENT` | `2` | Backtests and Monte Carlo simulations that can run at the same time, counted together (each uses a worker thread) |

Frontend: `VITE_API_URL` (default `/api`) sets the API base URL. `API_PROXY_TARGET` changes where the Vite dev server proxies `/api`.

### Auth API

| Method & path | Body / header | Response |
| --- | --- | --- |
| `POST /api/auth/login` | `{ email, password, remember? }` | `200 { token, expiresAt, user }`, `400` invalid input, `401` wrong credentials |
| `GET /api/auth/me` | `Authorization: Bearer <token>` | `200 { user }` or `401` |
| `POST /api/auth/logout` | `Authorization: Bearer <token>` | `204` (the session is revoked on the server) |

- Passwords are hashed with scrypt (random salt per password, constant-time comparison).
- Session tokens are random 256-bit values, and only their SHA-256 hash is stored in the database.
- Emails are case-insensitive.
- Deactivated users (`is_active = 0`) cannot log in, and their existing sessions stop working immediately.

### Backend structure

```
./                            # project root = backend
├── server.js                 # entry point
└── Modulars/
    ├── index.js              # list of enabled modules
    ├── Base/                 # shared by the whole project: config, SQLite + migrations, app factory, errors
    ├── User/                 # user model, password hashing, sessions, auth routes/middleware, create-user CLI
    └── Trade/                # strategies, charts, backtests, Monte Carlo (runners, worker, models, routes, run-backtest CLI)
        └── Strategies/       # strategy files
```

Each module exports `{ migrations, createServices(context), register(app, context), onServerStart?(context) }`. To protect a new module's routes, use the shared middleware: `app.use('/api/backtests', context.requireAuth, router)`.

### Tests

```bash
npm run test:backend          # API tests: node:test, in-memory SQLite, no extra dependencies (builds the engine first)
npm test                      # Grademark library tests (mocha)
```

## Backtesting

The admin panel has a **Backtesting** menu:

- **Run Backtest**: pick an active strategy and an active chart, set the starting capital and run. The backtest runs in the background and the page shows the result when it is done.
- **Results**: a list of strategies. Click one to see its backtests on the different charts. You can filter by chart (symbol) and timeframe, and click a backtest for the full details: metrics, equity curve, drawdown, every trade and the strategy parameters used.
- **Monte Carlo** tab on the backtest details page: run a Monte Carlo simulation of the backtest's trades (see below).

From the command line (the result is saved too and shows up in the panel):

```bash
npm run build                                   # compile the engine once (npm start does this for you)
node SampleStrategy                             # the sample strategy on Charts/EURUSD_D1.csv
node SampleStrategy GBPUSD_H4                   # ...on another chart
npm run backtest -- --strategy SampleStrategy --chart EURUSD_D1 --capital 10000
```

### Monte Carlo simulation

The simulation uses the engine's `monteCarlo()`: it builds many random trade sequences by drawing the backtest's trades with replacement, and analyzes each sequence from the same starting capital. The results show the range of outcomes the strategy could have had:
- probability of profit
- percentiles (5%-95%) of final capital, profit %, max drawdown %, win rate and expectancy
- equity percentile bands by trade number, with the real backtest overlaid
- histograms of profit % and max drawdown %

Settings: iterations (default 1000), trades per iteration (default: the backtest's trade count) and an optional random seed. If no seed is given, a random one is generated and saved, so a result can be reproduced. Limits: at most 10,000 iterations, 10,000 trades per iteration, and 10,000,000 in total.

Each backtest can have **one** simulation (enforced by a `UNIQUE` constraint in the database). Once it is running or completed it cannot be started again. Only a failed simulation can be re-run.

### Charts

Put chart CSV files in `Charts/`, named `<SYMBOL>_<TIMEFRAME>.csv` (e.g. `EURUSD_H4.csv`, `EURUSD_M15.csv`, `GBPUSD_D1.csv`). Timeframes use MetaTrader codes: `M1`-`M30`, `H1`-`H12`, `D1`, `W1`, `MN1`.
MetaTrader 5 exports work as they are (`<DATE>`, optional `<TIME>`, `<OPEN>`, `<HIGH>`, `<LOW>`, `<CLOSE>`, ...), and so do plain CSVs with `date`/`time`, `open`, `high`, `low`, `close` columns. Times are treated as UTC.
Files with other names are ignored, with a warning in the server log.

### Strategies

Each `.js` file in `Modulars/Trade/Strategies/` is a strategy, and its file name is its key. See `SampleStrategy.js`:

```javascript
module.exports = {
    name: 'My strategy',                 // shown in the panel (optional, defaults to the file name)
    description: 'What it does',         // optional
    strategy: {                          // a Grademark IStrategy
        parameters: { period: 30 },      // saved with every backtest
        prepIndicators: ({ inputSeries, parameters }) => inputSeries /* add indicator columns */,
        entryRule: (enterPosition, args) => { /* ... */ },
        exitRule: (exitPosition, args) => { /* ... */ },
        stopLoss: (args) => args.entryPrice * 0.02,
    },
};
```

New or changed files are picked up without a restart: the lists re-read the folders, and every backtest loads the strategy file fresh.

### Strategies and charts in the database

Strategies and charts are stored in the `strategies` and `charts` tables, and every backtest (`backtests`, with its `backtest_trades`) references one of each.

- **Active** (`is_active`) is your switch. Deactivated strategies and charts cannot be run, but their results stay visible.
- **Available** (`is_available`) is maintained automatically. A file that is deleted, or a strategy that fails to load, becomes unavailable and shows the reason on the Run page. Its rows and old results are kept.

There is no UI for activation yet. Use the API:

| Method & path | Body | Description |
| --- | --- | --- |
| `GET /api/trade/strategies` | | Strategies with backtest counts |
| `PATCH /api/trade/strategies/:id` | `{ isActive }` | Activate or deactivate a strategy |
| `GET /api/trade/charts` | | Charts |
| `PATCH /api/trade/charts/:id` | `{ isActive }` | Activate or deactivate a chart |
| `GET /api/trade/strategies/:id/backtests` | `?symbol=EURUSD&timeframe=H4` | Backtests of a strategy, plus filter options |
| `POST /api/trade/backtests` | `{ strategyId, chartId, startingCapital? }` | Start a backtest (`202`, runs in the background) |
| `GET /api/trade/backtests/:id` | | Full result: analysis, equity curve, drawdown, trades, `monteCarlo` (or `null`) |
| `POST /api/trade/backtests/:id/monte-carlo` | `{ numIterations?, numSamples?, randomSeed? }` | Start the simulation (`202`, runs in the background). `409` if the backtest already has one, is not completed or has no trades |
| `GET /api/trade/backtests/:id/monte-carlo` | | The simulation and its result; `404` if there is none |

All `/api/trade` endpoints need `Authorization: Bearer <token>`. If the server restarts while a backtest or simulation is running, it is marked failed ("Interrupted") at the next start.

## License

MIT
