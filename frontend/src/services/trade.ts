import { api } from '@/utils/api';

// ----- Types (match the backend's /api/trade responses) -----

export interface Strategy {
  id: number;
  key: string;
  name: string;
  description: string | null;
  fileName: string;
  isActive: boolean;
  isAvailable: boolean;
  loadError: string | null;
  backtestCount?: number;
  completedCount?: number;
  lastRunAt?: string | null;
}

export interface Chart {
  id: number;
  name: string;
  symbol: string;
  timeframe: string;
  fileName: string;
  isActive: boolean;
  isAvailable: boolean;
}

export type BacktestStatus = 'running' | 'completed' | 'failed';

export interface BacktestSummary {
  id: number;
  status: BacktestStatus;
  error: string | null;
  strategy: { id: number; key: string; name: string };
  chart: { id: number; name: string; symbol: string; timeframe: string };
  user: { id: number; name: string } | null;
  startingCapital: number;
  parameters: Record<string, unknown> | null;
  barCount: number | null;
  firstBarTime: string | null;
  lastBarTime: string | null;
  tradeCount: number | null;
  finalCapital: number | null;
  profit: number | null;
  profitPct: number | null;
  maxDrawdownPct: number | null;
  percentProfitable: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface BacktestTrade {
  number: number;
  direction: string;
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  profit: number | null;
  profitPct: number | null;
  growth: number | null;
  riskPct: number | null;
  rmultiple: number | null;
  holdingPeriod: number;
  exitReason: string;
  stopPrice: number | null;
  profitTarget: number | null;
}

export interface TimedValue {
  time: string;
  value: number | null;
}

export interface BacktestDetail extends BacktestSummary {
  analysis: Record<string, number | null> | null;
  equityCurve: TimedValue[];
  drawdown: TimedValue[];
  trades: BacktestTrade[];
  monteCarlo: MonteCarlo | null;
}

/** Summary statistics of one metric across all Monte Carlo iterations (null when there were no values). */
export interface MetricStats {
  count: number;
  mean: number | null;
  stdDev: number | null;
  min: number | null;
  p5: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  max: number | null;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface MonteCarloResult {
  populationSize: number;
  numIterations: number;
  numSamples: number;
  randomSeed: number;
  startingCapital: number;
  probabilityOfProfit: number;
  metrics: {
    finalCapital: MetricStats;
    profitPct: MetricStats;
    maxDrawdownPct: MetricStats;
    percentProfitable: MetricStats;
    expectancy: MetricStats;
  };
  /** Equity percentiles after each trade number in `steps` (0 = before the first trade). */
  equityBands: { steps: number[]; p5: number[]; p25: number[]; p50: number[]; p75: number[]; p95: number[] };
  histograms: { profitPct: HistogramBin[]; maxDrawdownPct: HistogramBin[] };
}

export interface MonteCarlo {
  id: number;
  backtestId: number;
  status: BacktestStatus;
  error: string | null;
  user: { id: number; name: string } | null;
  numIterations: number;
  numSamples: number;
  randomSeed: number;
  startingCapital: number;
  result: MonteCarloResult | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export const MONTE_CARLO_LIMITS = {
  maxIterations: 10000,
  maxSamples: 10000,
  maxTotalTrades: 10_000_000,
  maxSeed: 2 ** 31 - 1
} as const;

export interface BacktestFilters {
  symbol?: string;
  timeframe?: string;
}

// ----- API calls -----

export async function fetchStrategies() {
  const { data } = await api.get<{ strategies: Strategy[] }>('/trade/strategies');
  return data.strategies;
}

export async function fetchCharts() {
  const { data } = await api.get<{ charts: Chart[] }>('/trade/charts');
  return data.charts;
}

export async function fetchStrategyBacktests(strategyId: number, filters: BacktestFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.symbol) params.symbol = filters.symbol;
  if (filters.timeframe) params.timeframe = filters.timeframe;
  const { data } = await api.get<{
    strategy: Strategy;
    backtests: BacktestSummary[];
    filterOptions: { symbols: string[]; timeframes: string[] };
  }>(`/trade/strategies/${strategyId}/backtests`, { params });
  return data;
}

export async function startBacktest(input: { strategyId: number; chartId: number; startingCapital?: number }) {
  const { data } = await api.post<{ backtest: BacktestSummary }>('/trade/backtests', input);
  return data.backtest;
}

export async function fetchBacktest(id: number) {
  const { data } = await api.get<{ backtest: BacktestDetail }>(`/trade/backtests/${id}`);
  return data.backtest;
}

export async function startMonteCarlo(backtestId: number, input: { numIterations?: number; numSamples?: number; randomSeed?: number }) {
  const { data } = await api.post<{ monteCarlo: MonteCarlo }>(`/trade/backtests/${backtestId}/monte-carlo`, input);
  return data.monteCarlo;
}

export async function fetchMonteCarlo(backtestId: number) {
  const { data } = await api.get<{ monteCarlo: MonteCarlo }>(`/trade/backtests/${backtestId}/monte-carlo`);
  return data.monteCarlo;
}

// ----- Formatting helpers -----

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  const text = formatNumber(value, digits);
  return text === '-' ? text : `${text}%`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

/** Chart times are UTC, so they are shown in UTC to match the CSV files. */
export function formatBarTime(value: string | null | undefined): string {
  if (!value) return '-';
  const iso = new Date(value).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function statusColor(status: BacktestStatus): string {
  return { running: 'info', completed: 'success', failed: 'error' }[status];
}

/** Color for a profit/loss number. */
export function pnlColor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return '';
  return value > 0 ? 'text-success' : 'text-error';
}
