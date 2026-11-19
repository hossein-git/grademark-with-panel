<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getErrorMessage } from '@/utils/api';
import {
  MONTE_CARLO_LIMITS,
  fetchMonteCarlo,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPct,
  pnlColor,
  startMonteCarlo,
  statusColor,
  type BacktestDetail,
  type HistogramBin,
  type MetricStats,
  type MonteCarlo
} from '@/services/trade';

const props = defineProps<{ backtest: BacktestDetail }>();
// Tells the page about every change, so the tab chip stays current and the panel starts from the
// latest state when it is shown again.
const emit = defineEmits<{ change: [simulation: MonteCarlo] }>();

const POLL_INTERVAL_MS = 1000;

const simulation = ref<MonteCarlo | null>(props.backtest.monteCarlo);
const form = ref();
const numIterations = ref<number>(1000);
const numSamples = ref<number>(Math.min(props.backtest.tradeCount || 1, MONTE_CARLO_LIMITS.maxSamples));
const randomSeed = ref<number | null>(null);
const submitting = ref(false);
const submitError = ref('');
let pollTimer: ReturnType<typeof setTimeout> | null = null;

watch(simulation, (value) => {
  if (value) emit('change', value);
});

// A simulation can be started when the backtest has trades and there is no simulation yet
// (or only a failed one). A completed simulation cannot be run again.
const canSimulate = computed(() => props.backtest.status === 'completed' && (props.backtest.tradeCount ?? 0) > 0);
const showForm = computed(() => canSimulate.value && (!simulation.value || simulation.value.status === 'failed'));
const result = computed(() => (simulation.value?.status === 'completed' ? simulation.value.result : null));

const intRule = (label: string, min: number, max: number) => (v: unknown) => {
  if (v === null || v === undefined || v === '') return `${label} is required`;
  const n = Number(v);
  return (Number.isInteger(n) && n >= min && n <= max) || `${label} must be a whole number from ${min} to ${max.toLocaleString()}`;
};
const seedRule = (v: unknown) => v === null || v === undefined || v === '' || intRule('Seed', 0, MONTE_CARLO_LIMITS.maxSeed)(v);
const totalRule = () =>
  Number(numIterations.value) * Number(numSamples.value) <= MONTE_CARLO_LIMITS.maxTotalTrades ||
  `Iterations × trades per iteration must be at most ${MONTE_CARLO_LIMITS.maxTotalTrades.toLocaleString()}`;

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function poll() {
  try {
    simulation.value = await fetchMonteCarlo(props.backtest.id);
    if (simulation.value.status === 'running') {
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  } catch (error) {
    submitError.value = getErrorMessage(error, 'Lost track of the simulation. Reload the page to check its status.');
  }
}

async function run() {
  submitError.value = '';
  const { valid } = await form.value.validate();
  if (!valid) return;

  submitting.value = true;
  try {
    simulation.value = await startMonteCarlo(props.backtest.id, {
      numIterations: Number(numIterations.value),
      numSamples: Number(numSamples.value),
      ...(randomSeed.value === null || (randomSeed.value as unknown) === '' ? {} : { randomSeed: Number(randomSeed.value) })
    });
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  } catch (error) {
    submitError.value = getErrorMessage(error, 'Could not start the simulation.');
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  if (simulation.value?.status === 'running') poll();
});
onBeforeUnmount(stopPolling);

// ----- Results -----

const headline = computed(() => {
  const r = result.value;
  if (!r) return [];
  const m = r.metrics;
  return [
    {
      label: 'Probability of profit',
      value: formatPct(r.probabilityOfProfit, 1),
      color: '',
      hint: 'Share of simulated sequences that ended above the starting capital'
    },
    {
      label: 'Median final capital',
      value: formatNumber(m.finalCapital.p50),
      color: pnlColor((m.finalCapital.p50 ?? 0) - r.startingCapital),
      hint: '50th percentile'
    },
    {
      label: 'Profit % (5th–95th)',
      value: `${formatPct(m.profitPct.p5)} … ${formatPct(m.profitPct.p95)}`,
      color: '',
      hint: '90% of sequences ended in this range'
    },
    {
      label: 'Median max drawdown',
      value: formatPct(m.maxDrawdownPct.p50),
      color: pnlColor(m.maxDrawdownPct.p50),
      hint: '50th percentile'
    },
    {
      label: 'Bad-case max drawdown',
      value: formatPct(m.maxDrawdownPct.p5),
      color: pnlColor(m.maxDrawdownPct.p5),
      hint: '5th percentile: only 5% of sequences had a deeper drawdown'
    }
  ];
});

const STAT_COLUMNS: { key: Exclude<keyof MetricStats, 'count'>; title: string }[] = [
  { key: 'mean', title: 'Mean' },
  { key: 'stdDev', title: 'Std dev' },
  { key: 'min', title: 'Min' },
  { key: 'p5', title: '5%' },
  { key: 'p25', title: '25%' },
  { key: 'p50', title: 'Median' },
  { key: 'p75', title: '75%' },
  { key: 'p95', title: '95%' },
  { key: 'max', title: 'Max' }
];

const statRows = computed(() => {
  const m = result.value?.metrics;
  if (!m) return [];
  return [
    { label: 'Final capital', stats: m.finalCapital, format: (v: number | null) => formatNumber(v) },
    { label: 'Profit %', stats: m.profitPct, format: (v: number | null) => formatPct(v) },
    { label: 'Max drawdown %', stats: m.maxDrawdownPct, format: (v: number | null) => formatPct(v) },
    { label: 'Win rate', stats: m.percentProfitable, format: (v: number | null) => formatPct(v, 1) },
    { label: 'Expectancy (R)', stats: m.expectancy, format: (v: number | null) => formatNumber(v, 3) }
  ];
});

const bandsSeries = computed(() => {
  const r = result.value;
  if (!r) return [];
  const { steps } = r.equityBands;
  const line = (name: string, values: number[]) => ({ name, data: steps.map((step, i) => [step, values[i]]) });
  const series = [
    line('95th percentile', r.equityBands.p95),
    line('75th percentile', r.equityBands.p75),
    line('Median', r.equityBands.p50),
    line('25th percentile', r.equityBands.p25),
    line('5th percentile', r.equityBands.p5)
  ];
  // Overlay the actual backtest when each simulated sequence has as many trades as the backtest.
  const actual = props.backtest.equityCurve;
  if (r.numSamples === props.backtest.tradeCount && actual.length === r.numSamples + 1) {
    series.push({ name: 'Backtest', data: actual.map((p, i) => [i, p.value ?? 0]) });
  }
  return series;
});

const bandsOptions = computed(() => ({
  chart: {
    fontFamily: 'inherit',
    foreColor: '#a1aab2',
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: { enabled: false }
  },
  colors: ['#90caf9', '#42a5f5', '#5e35b1', '#42a5f5', '#90caf9', '#ff9800'],
  stroke: { width: [1.5, 1.5, 3, 1.5, 1.5, 2], dashArray: [4, 0, 0, 0, 4, 0], curve: 'straight' },
  dataLabels: { enabled: false },
  legend: { position: 'bottom' },
  xaxis: { type: 'numeric', title: { text: 'Trade #' }, labels: { formatter: (v: number) => String(Math.round(v)) } },
  yaxis: { labels: { formatter: (v: number) => formatNumber(v) } },
  tooltip: { shared: true, x: { formatter: (v: number) => `After trade ${Math.round(v)}` } },
  grid: { borderColor: '#eef2f6' }
}));

function histogramChart(bins: HistogramBin[], color: string) {
  return {
    series: [{ name: 'Sequences', data: bins.map((b) => b.count) }],
    options: {
      chart: { fontFamily: 'inherit', foreColor: '#a1aab2', toolbar: { show: false }, animations: { enabled: false } },
      colors: [color],
      plotOptions: { bar: { columnWidth: '95%' } },
      dataLabels: { enabled: false },
      xaxis: {
        categories: bins.map((b) => `${formatNumber(b.from, 1)} … ${formatNumber(b.to, 1)}%`),
        labels: { rotate: -45, hideOverlappingLabels: true }
      },
      grid: { borderColor: '#eef2f6' }
    }
  };
}

const profitHistogram = computed(() => histogramChart(result.value?.histograms.profitPct ?? [], '#5e35b1'));
const drawdownHistogram = computed(() => histogramChart(result.value?.histograms.maxDrawdownPct ?? [], '#f44336'));
</script>

<template>
  <div>
    <v-alert v-if="backtest.status !== 'completed'" type="info" variant="tonal">
      A Monte Carlo simulation can be run once the backtest has completed.
    </v-alert>
    <v-alert v-else-if="!backtest.tradeCount" type="info" variant="tonal"
      >This backtest has no trades, so there is nothing to simulate.</v-alert
    >

    <!-- Start form: only when there is no simulation yet, or the last one failed -->
    <v-card v-if="showForm" variant="flat" class="mb-6">
      <v-card-item>
        <v-card-title>Run a Monte Carlo simulation</v-card-title>
        <v-card-subtitle class="text-wrap">
          Builds many random trade sequences by drawing this backtest's {{ backtest.tradeCount }} trades with replacement, to show the range
          of outcomes the strategy could have had. Each backtest can be simulated once.
        </v-card-subtitle>
      </v-card-item>
      <v-card-text>
        <v-alert v-if="simulation?.status === 'failed'" type="error" variant="tonal" density="compact" class="mb-4">
          The last simulation failed: {{ simulation.error }}
        </v-alert>
        <v-form ref="form" @submit.prevent="run">
          <v-row>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="numIterations"
                type="number"
                label="Iterations"
                hint="Number of simulated trade sequences"
                persistent-hint
                :rules="[intRule('Iterations', 1, MONTE_CARLO_LIMITS.maxIterations), totalRule]"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="numSamples"
                type="number"
                label="Trades per iteration"
                hint="Defaults to the number of trades in the backtest"
                persistent-hint
                :rules="[intRule('Trades per iteration', 1, MONTE_CARLO_LIMITS.maxSamples), totalRule]"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="randomSeed"
                type="number"
                label="Random seed (optional)"
                hint="Leave empty for a random seed. The seed used is saved, so results can be reproduced."
                persistent-hint
                clearable
                :rules="[seedRule]"
              />
            </v-col>
          </v-row>
          <v-alert v-if="submitError" type="error" variant="tonal" density="compact" class="mt-4">{{ submitError }}</v-alert>
          <v-btn type="submit" color="secondary" variant="flat" class="mt-4" :loading="submitting">Run simulation</v-btn>
        </v-form>
      </v-card-text>
    </v-card>

    <!-- Running -->
    <v-card v-if="simulation?.status === 'running'" variant="flat" class="pa-6">
      <div class="d-flex align-center mb-3">
        <h4>Simulation running…</h4>
        <v-spacer />
        <v-chip :color="statusColor('running')" variant="tonal" size="small">running</v-chip>
      </div>
      <p class="text-medium-emphasis mb-4">
        {{ simulation.numIterations.toLocaleString() }} iterations × {{ simulation.numSamples.toLocaleString() }} trades (seed
        {{ simulation.randomSeed }}). You can leave this page; the result is saved when it finishes.
      </p>
      <v-progress-linear indeterminate color="secondary" />
      <v-alert v-if="submitError" type="error" variant="tonal" density="compact" class="mt-4">{{ submitError }}</v-alert>
    </v-card>

    <!-- Results -->
    <template v-if="simulation && result">
      <v-card variant="flat" class="mb-6">
        <v-card-item>
          <div class="d-flex align-center flex-wrap ga-2">
            <v-card-title class="pa-0">Monte Carlo simulation</v-card-title>
            <v-chip :color="statusColor('completed')" variant="tonal" size="small">completed</v-chip>
            <v-spacer />
            <span class="text-body-small text-medium-emphasis">
              {{ result.numIterations.toLocaleString() }} iterations × {{ result.numSamples.toLocaleString() }} trades · seed
              {{ result.randomSeed }} · from {{ result.populationSize }} trades · {{ formatDuration(simulation.durationMs) }} ·
              {{ formatDateTime(simulation.finishedAt) }}<template v-if="simulation.user"> · by {{ simulation.user.name }}</template>
            </span>
          </div>
        </v-card-item>
      </v-card>

      <v-row>
        <v-col v-for="item in headline" :key="item.label" cols="12" sm="6" md="4" xl>
          <v-card variant="flat" class="pa-4 h-100" :title="item.hint">
            <div class="text-body-small text-medium-emphasis">{{ item.label }}</div>
            <h3 class="mt-1" :class="item.color">{{ item.value }}</h3>
            <div class="text-body-small text-medium-emphasis mt-1">{{ item.hint }}</div>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-card variant="flat">
            <v-card-item>
              <v-card-title>Equity range by trade</v-card-title>
              <v-card-subtitle>Percentiles of the simulated equity after each trade</v-card-subtitle>
            </v-card-item>
            <v-card-text>
              <apexchart type="line" height="360" :options="bandsOptions" :series="bandsSeries" />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" lg="6">
          <v-card variant="flat">
            <v-card-item><v-card-title>Distribution of profit %</v-card-title></v-card-item>
            <v-card-text>
              <apexchart type="bar" height="300" :options="profitHistogram.options" :series="profitHistogram.series" />
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" lg="6">
          <v-card variant="flat">
            <v-card-item><v-card-title>Distribution of max drawdown %</v-card-title></v-card-item>
            <v-card-text>
              <apexchart type="bar" height="300" :options="drawdownHistogram.options" :series="drawdownHistogram.series" />
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12">
          <v-card variant="flat">
            <v-card-item><v-card-title>Statistics across iterations</v-card-title></v-card-item>
            <v-card-text>
              <v-table density="compact">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th v-for="col in STAT_COLUMNS" :key="col.key" class="text-right">{{ col.title }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in statRows" :key="row.label">
                    <td class="text-no-wrap">{{ row.label }}</td>
                    <td v-for="col in STAT_COLUMNS" :key="col.key" class="text-right text-no-wrap">
                      {{ row.format(row.stats[col.key]) }}
                    </td>
                  </tr>
                </tbody>
              </v-table>
              <p v-if="result.metrics.expectancy.count === 0" class="text-body-small text-medium-emphasis mt-2">
                Expectancy needs a stop loss (R-multiples), so it is empty for this strategy.
              </p>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </template>
  </div>
</template>
