<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseBreadcrumb from '@/components/shared/BaseBreadcrumb.vue';
import UiParentCard from '@/components/shared/UiParentCard.vue';
import MonteCarloPanel from '@/components/backtesting/MonteCarloPanel.vue';
import { getErrorMessage } from '@/utils/api';
import {
  fetchBacktest,
  formatBarTime,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPct,
  pnlColor,
  statusColor,
  type BacktestDetail,
  type MonteCarlo
} from '@/services/trade';

const route = useRoute('/(main)/backtesting/backtests/[id]');
const router = useRouter();
const backtestId = computed(() => Number(route.params.id));

// The open tab is kept in the URL (?tab=monte-carlo) so a reload or a shared link opens the same tab.
const tab = computed({
  get: () => (route.query.tab === 'monte-carlo' ? 'monte-carlo' : 'overview'),
  set: (value: string) => router.replace({ query: value === 'overview' ? {} : { tab: value } })
});

const backtest = ref<BacktestDetail | null>(null);
const loading = ref(true);
const error = ref('');
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const breadcrumbs = computed(() => [
  { title: 'Backtesting', disabled: false, href: '#' },
  { title: 'Results', disabled: false, href: '/backtesting/results' },
  {
    title: backtest.value?.strategy.name ?? '...',
    disabled: !backtest.value,
    href: backtest.value ? `/backtesting/results/${backtest.value.strategy.id}` : '#'
  },
  { title: `#${backtestId.value}`, disabled: true, href: '#' }
]);

async function load() {
  try {
    backtest.value = await fetchBacktest(backtestId.value);
    error.value = '';
    if (backtest.value.status === 'running') {
      pollTimer = setTimeout(load, 1000);
    }
  } catch (err) {
    error.value = getErrorMessage(err, 'Could not load the backtest.');
  } finally {
    loading.value = false;
  }
}

function onMonteCarloChange(simulation: MonteCarlo) {
  if (backtest.value) backtest.value.monteCarlo = simulation;
}

onMounted(load);
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
});

const periodText = computed(() => {
  const b = backtest.value;
  if (!b) return '';
  return `${formatBarTime(b.firstBarTime)} → ${formatBarTime(b.lastBarTime)} (${b.barCount ?? '-'} bars)`;
});

const metrics = computed(() => {
  const b = backtest.value;
  if (!b) return [];
  return [
    { label: 'Profit', value: `${formatNumber(b.profit)} (${formatPct(b.profitPct)})`, color: pnlColor(b.profit) },
    { label: 'Final capital', value: formatNumber(b.finalCapital), color: '' },
    { label: 'Trades', value: String(b.tradeCount ?? '-'), color: '' },
    { label: 'Win rate', value: formatPct(b.percentProfitable, 1), color: '' },
    { label: 'Max drawdown', value: formatPct(b.maxDrawdownPct), color: pnlColor(b.maxDrawdownPct) },
    { label: 'Profit factor', value: formatNumber(b.profitFactor), color: '' },
    { label: 'Expectancy (R)', value: formatNumber(b.expectancy, 3), color: pnlColor(b.expectancy) }
  ];
});

// Labels for the engine's IAnalysis fields (the engine spells "expectency" this way).
const ANALYSIS_LABELS: Record<string, string> = {
  startingCapital: 'Starting capital',
  finalCapital: 'Final capital',
  profit: 'Profit',
  profitPct: 'Profit %',
  growth: 'Growth',
  totalTrades: 'Total trades',
  barCount: 'Bars in positions',
  maxDrawdown: 'Max drawdown',
  maxDrawdownPct: 'Max drawdown %',
  maxRiskPct: 'Max risk %',
  expectency: 'Expectancy (R)',
  rmultipleStdDev: 'R-multiple std dev',
  systemQuality: 'System quality (SQN)',
  profitFactor: 'Profit factor',
  proportionProfitable: 'Proportion profitable',
  percentProfitable: 'Percent profitable',
  returnOnAccount: 'Return on account',
  averageProfitPerTrade: 'Average profit per trade',
  numWinningTrades: 'Winning trades',
  numLosingTrades: 'Losing trades',
  averageWinningTrade: 'Average winning trade',
  averageLosingTrade: 'Average losing trade',
  expectedValue: 'Expected value'
};

const analysisRows = computed(() =>
  Object.entries(backtest.value?.analysis ?? {}).map(([key, value]) => ({
    label: ANALYSIS_LABELS[key] ?? key,
    value: Number.isInteger(value) ? String(value) : formatNumber(value, 4)
  }))
);

const baseChartOptions = {
  chart: { fontFamily: 'inherit', foreColor: '#a1aab2', toolbar: { show: false }, zoom: { enabled: false } },
  dataLabels: { enabled: false },
  stroke: { curve: 'straight', width: 2 },
  xaxis: { type: 'datetime', labels: { datetimeUTC: true } },
  tooltip: { x: { format: 'yyyy-MM-dd HH:mm' } },
  grid: { borderColor: '#eef2f6' }
};

const equityOptions = computed(() => ({
  ...baseChartOptions,
  colors: ['#5e35b1'],
  yaxis: { labels: { formatter: (v: number) => formatNumber(v) } }
}));
const drawdownOptions = computed(() => ({
  ...baseChartOptions,
  colors: ['#f44336'],
  yaxis: { labels: { formatter: (v: number) => formatNumber(v) } }
}));

const toSeries = (name: string, points: { time: string; value: number | null }[]) => [
  { name, data: points.map((p) => [new Date(p.time).getTime(), p.value]) }
];
const equitySeries = computed(() => toSeries('Equity', backtest.value?.equityCurve ?? []));
const drawdownSeries = computed(() => toSeries('Drawdown', backtest.value?.drawdown ?? []));

const tradeHeaders = [
  { title: '#', key: 'number' },
  { title: 'Direction', key: 'direction' },
  { title: 'Entry time', key: 'entryTime' },
  { title: 'Entry', key: 'entryPrice', align: 'end' as const },
  { title: 'Exit time', key: 'exitTime' },
  { title: 'Exit', key: 'exitPrice', align: 'end' as const },
  { title: 'Profit', key: 'profit', align: 'end' as const },
  { title: 'Profit %', key: 'profitPct', align: 'end' as const },
  { title: 'R', key: 'rmultiple', align: 'end' as const },
  { title: 'Bars', key: 'holdingPeriod', align: 'end' as const },
  { title: 'Exit reason', key: 'exitReason' }
];
</script>

<template>
  <BaseBreadcrumb :title="`Backtest #${backtestId}`" :breadcrumbs="breadcrumbs" />

  <v-progress-linear v-if="loading" indeterminate color="secondary" />
  <v-alert v-else-if="error && !backtest" type="error" variant="tonal">{{ error }}</v-alert>

  <template v-if="backtest">
    <v-row>
      <v-col cols="12">
        <UiParentCard :title="`${backtest.strategy.name} on ${backtest.chart.name}`">
          <template #action>
            <v-chip :color="statusColor(backtest.status)" variant="tonal">{{ backtest.status }}</v-chip>
          </template>

          <v-row>
            <v-col cols="12" md="6">
              <v-table density="compact">
                <tbody>
                  <tr>
                    <td class="text-medium-emphasis">Chart</td>
                    <td>{{ backtest.chart.name }} ({{ backtest.chart.symbol }}, {{ backtest.chart.timeframe }})</td>
                  </tr>
                  <tr>
                    <td class="text-medium-emphasis">Period</td>
                    <td>{{ periodText }}</td>
                  </tr>
                  <tr>
                    <td class="text-medium-emphasis">Starting capital</td>
                    <td>{{ formatNumber(backtest.startingCapital) }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-col>
            <v-col cols="12" md="6">
              <v-table density="compact">
                <tbody>
                  <tr>
                    <td class="text-medium-emphasis">Run at</td>
                    <td>{{ formatDateTime(backtest.startedAt) }}</td>
                  </tr>
                  <tr>
                    <td class="text-medium-emphasis">Duration</td>
                    <td>{{ formatDuration(backtest.durationMs) }}</td>
                  </tr>
                  <tr>
                    <td class="text-medium-emphasis">Run by</td>
                    <td>{{ backtest.user?.name ?? 'Command line' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </v-col>
          </v-row>

          <div v-if="backtest.parameters" class="mt-4">
            <span class="text-medium-emphasis mr-2">Parameters:</span>
            <v-chip v-for="(value, key) in backtest.parameters" :key="key" size="small" variant="outlined" class="mr-2 mb-1">
              {{ key }} = {{ value }}
            </v-chip>
          </div>

          <v-progress-linear v-if="backtest.status === 'running'" indeterminate color="secondary" class="mt-4" />
          <v-alert v-if="backtest.status === 'failed'" type="error" variant="tonal" class="mt-4">{{ backtest.error }}</v-alert>
        </UiParentCard>
      </v-col>
    </v-row>

    <v-tabs v-model="tab" color="secondary" class="mb-6">
      <v-tab value="overview">Overview</v-tab>
      <v-tab value="monte-carlo">
        Monte Carlo
        <v-chip v-if="backtest.monteCarlo" :color="statusColor(backtest.monteCarlo.status)" size="x-small" variant="tonal" class="ml-2">
          {{ backtest.monteCarlo.status }}
        </v-chip>
      </v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="monte-carlo">
        <MonteCarloPanel v-if="tab === 'monte-carlo'" :backtest="backtest" @change="onMonteCarloChange" />
      </v-window-item>

      <v-window-item value="overview">
        <template v-if="backtest.status === 'completed'">
          <v-row>
            <v-col v-for="metric in metrics" :key="metric.label" cols="6" sm="4" md="3" xl>
              <v-card variant="flat" class="pa-4 h-100">
                <div class="text-body-small text-medium-emphasis">{{ metric.label }}</div>
                <h3 class="mt-1" :class="metric.color">{{ metric.value }}</h3>
              </v-card>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12" lg="6">
              <UiParentCard title="Equity curve">
                <apexchart type="line" height="300" :options="equityOptions" :series="equitySeries" />
              </UiParentCard>
            </v-col>
            <v-col cols="12" lg="6">
              <UiParentCard title="Drawdown">
                <apexchart type="area" height="300" :options="drawdownOptions" :series="drawdownSeries" />
              </UiParentCard>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12">
              <UiParentCard :title="`Trades (${backtest.trades.length})`">
                <v-data-table
                  :headers="tradeHeaders"
                  :items="backtest.trades"
                  item-value="number"
                  density="compact"
                  no-data-text="No trades."
                >
                  <template #[`item.entryTime`]="{ item }">
                    <span class="text-no-wrap">{{ formatBarTime(item.entryTime) }}</span>
                  </template>
                  <template #[`item.exitTime`]="{ item }">
                    <span class="text-no-wrap">{{ formatBarTime(item.exitTime) }}</span>
                  </template>
                  <template #[`item.entryPrice`]="{ item }">{{ formatNumber(item.entryPrice, 5) }}</template>
                  <template #[`item.exitPrice`]="{ item }">{{ formatNumber(item.exitPrice, 5) }}</template>
                  <template #[`item.profit`]="{ item }">
                    <span :class="pnlColor(item.profit)">{{ formatNumber(item.profit, 5) }}</span>
                  </template>
                  <template #[`item.profitPct`]="{ item }">
                    <span :class="pnlColor(item.profitPct)">{{ formatPct(item.profitPct) }}</span>
                  </template>
                  <template #[`item.rmultiple`]="{ item }">{{ formatNumber(item.rmultiple) }}</template>
                </v-data-table>
              </UiParentCard>
            </v-col>
          </v-row>

          <v-row>
            <v-col cols="12">
              <UiParentCard title="Full analysis">
                <v-row>
                  <v-col v-for="row in analysisRows" :key="row.label" cols="12" sm="6" md="4" lg="3" class="py-1">
                    <span class="text-medium-emphasis">{{ row.label }}:</span> {{ row.value }}
                  </v-col>
                </v-row>
              </UiParentCard>
            </v-col>
          </v-row>
        </template>
      </v-window-item>
    </v-window>
  </template>
</template>
