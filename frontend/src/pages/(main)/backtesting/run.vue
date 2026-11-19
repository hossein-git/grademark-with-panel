<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import BaseBreadcrumb from '@/components/shared/BaseBreadcrumb.vue';
import UiParentCard from '@/components/shared/UiParentCard.vue';
import { getErrorMessage } from '@/utils/api';
import {
  fetchBacktest,
  fetchCharts,
  fetchStrategies,
  formatDuration,
  formatNumber,
  formatPct,
  pnlColor,
  startBacktest,
  statusColor,
  type BacktestSummary,
  type Chart,
  type Strategy
} from '@/services/trade';

const breadcrumbs = shallowRef([
  { title: 'Backtesting', disabled: false, href: '#' },
  { title: 'Run Backtest', disabled: true, href: '#' }
]);

const POLL_INTERVAL_MS = 1000;

const strategies = ref<Strategy[]>([]);
const charts = ref<Chart[]>([]);
const loading = ref(true);
const loadError = ref('');

const form = ref();
const strategyId = ref<number | null>(null);
const chartId = ref<number | null>(null);
const startingCapital = ref<number>(10000);
const submitting = ref(false);
const submitError = ref('');

const current = ref<BacktestSummary | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// Only active strategies/charts whose files are present can be run.
const runnableStrategies = computed(() => strategies.value.filter((s) => s.isActive && s.isAvailable));
const runnableCharts = computed(() => charts.value.filter((c) => c.isActive && c.isAvailable));
const unavailableStrategies = computed(() => strategies.value.filter((s) => !s.isAvailable));
const selectedStrategy = computed(() => strategies.value.find((s) => s.id === strategyId.value) ?? null);
const isRunning = computed(() => current.value?.status === 'running');

const chartItems = computed(() =>
  runnableCharts.value.map((c) => ({ title: c.name, value: c.id, props: { subtitle: `${c.symbol} · ${c.timeframe}` } }))
);

const required = (label: string) => (v: unknown) => (v !== null && v !== undefined && v !== '') || `${label} is required`;
const capitalRules = [required('Starting capital'), (v: number) => Number(v) > 0 || 'Starting capital must be greater than 0'];

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    [strategies.value, charts.value] = await Promise.all([fetchStrategies(), fetchCharts()]);
  } catch (error) {
    loadError.value = getErrorMessage(error, 'Could not load strategies and charts.');
  } finally {
    loading.value = false;
  }
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function poll(id: number) {
  try {
    const backtest = await fetchBacktest(id);
    current.value = backtest;
    if (backtest.status === 'running') {
      pollTimer = setTimeout(() => poll(id), POLL_INTERVAL_MS);
    }
  } catch (error) {
    submitError.value = getErrorMessage(error, 'Lost track of the backtest. Check the Results page.');
  }
}

async function run() {
  submitError.value = '';
  const { valid } = await form.value.validate();
  if (!valid || strategyId.value === null || chartId.value === null) return;

  stopPolling();
  submitting.value = true;
  try {
    current.value = await startBacktest({
      strategyId: strategyId.value,
      chartId: chartId.value,
      startingCapital: Number(startingCapital.value)
    });
    pollTimer = setTimeout(() => poll(current.value!.id), POLL_INTERVAL_MS);
  } catch (error) {
    submitError.value = getErrorMessage(error, 'Could not start the backtest.');
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
onBeforeUnmount(stopPolling);
</script>

<template>
  <BaseBreadcrumb title="Run Backtest" :breadcrumbs="breadcrumbs" />
  <v-row>
    <v-col cols="12" lg="6">
      <UiParentCard title="New backtest">
        <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">
          {{ loadError }}
          <template #append>
            <v-btn variant="text" size="small" @click="load">Retry</v-btn>
          </template>
        </v-alert>

        <v-form ref="form" @submit.prevent="run">
          <v-select
            v-model="strategyId"
            :items="runnableStrategies"
            item-title="name"
            item-value="id"
            label="Strategy"
            :loading="loading"
            :rules="[required('Strategy')]"
            :no-data-text="loading ? 'Loading...' : 'No active strategies'"
            class="mb-4"
            hide-details="auto"
          />
          <p v-if="selectedStrategy?.description" class="text-body-small text-medium-emphasis mt-n2 mb-4">
            {{ selectedStrategy.description }}
          </p>

          <v-select
            v-model="chartId"
            :items="chartItems"
            label="Chart"
            :loading="loading"
            :rules="[required('Chart')]"
            :no-data-text="loading ? 'Loading...' : 'No active charts. Add <SYMBOL>_<TIMEFRAME>.csv files to the Charts folder.'"
            class="mb-4"
            hide-details="auto"
          />

          <v-text-field
            v-model.number="startingCapital"
            type="number"
            min="0"
            label="Starting capital"
            :rules="capitalRules"
            class="mb-4"
            hide-details="auto"
          />

          <v-alert v-if="submitError" type="error" variant="tonal" density="compact" class="mb-4">{{ submitError }}</v-alert>

          <v-btn type="submit" color="secondary" variant="flat" size="large" block :loading="submitting || isRunning" :disabled="loading">
            Run backtest
          </v-btn>
        </v-form>

        <v-alert v-if="unavailableStrategies.length" type="warning" variant="tonal" density="compact" class="mt-6">
          Some strategies cannot be run:
          <ul class="ml-4 mt-1">
            <li v-for="s in unavailableStrategies" :key="s.id">
              <strong>{{ s.fileName }}</strong
              >: {{ s.loadError }}
            </li>
          </ul>
        </v-alert>
      </UiParentCard>
    </v-col>

    <v-col cols="12" lg="6">
      <UiParentCard title="Result">
        <div v-if="!current" class="text-medium-emphasis">Choose a strategy and a chart, then run the backtest.</div>

        <template v-else>
          <div class="d-flex align-center mb-4">
            <div>
              <h4>{{ current.strategy.name }}</h4>
              <span class="text-body-small text-medium-emphasis">{{ current.chart.name }} · #{{ current.id }}</span>
            </div>
            <v-spacer />
            <v-chip :color="statusColor(current.status)" variant="tonal" size="small">{{ current.status }}</v-chip>
          </div>

          <v-progress-linear v-if="current.status === 'running'" indeterminate color="secondary" class="mb-4" />

          <v-alert v-if="current.status === 'failed'" type="error" variant="tonal">{{ current.error }}</v-alert>

          <template v-if="current.status === 'completed'">
            <v-table density="compact" class="mb-4">
              <tbody>
                <tr>
                  <td>Trades</td>
                  <td class="text-right">{{ current.tradeCount }}</td>
                </tr>
                <tr>
                  <td>Profit</td>
                  <td class="text-right" :class="pnlColor(current.profit)">
                    {{ formatNumber(current.profit) }} ({{ formatPct(current.profitPct) }})
                  </td>
                </tr>
                <tr>
                  <td>Final capital</td>
                  <td class="text-right">{{ formatNumber(current.finalCapital) }}</td>
                </tr>
                <tr>
                  <td>Max drawdown</td>
                  <td class="text-right">{{ formatPct(current.maxDrawdownPct) }}</td>
                </tr>
                <tr>
                  <td>Win rate</td>
                  <td class="text-right">{{ formatPct(current.percentProfitable) }}</td>
                </tr>
                <tr>
                  <td>Duration</td>
                  <td class="text-right">{{ formatDuration(current.durationMs) }}</td>
                </tr>
              </tbody>
            </v-table>
            <v-btn color="primary" variant="flat" :to="`/backtesting/backtests/${current.id}`">View details</v-btn>
          </template>
        </template>
      </UiParentCard>
    </v-col>
  </v-row>
</template>
