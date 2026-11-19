<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseBreadcrumb from '@/components/shared/BaseBreadcrumb.vue';
import UiParentCard from '@/components/shared/UiParentCard.vue';
import { getErrorMessage } from '@/utils/api';
import {
  fetchStrategyBacktests,
  formatBarTime,
  formatDateTime,
  formatNumber,
  formatPct,
  pnlColor,
  statusColor,
  type BacktestSummary,
  type Strategy
} from '@/services/trade';

const route = useRoute('/(main)/backtesting/results/[strategyId]');
const router = useRouter();
const strategyId = computed(() => Number(route.params.strategyId));

const strategy = ref<Strategy | null>(null);
const backtests = ref<BacktestSummary[]>([]);
const symbols = ref<string[]>([]);
const timeframes = ref<string[]>([]);
const loading = ref(true);
const error = ref('');

// Filters are kept in the URL (?symbol=EURUSD&timeframe=H4) so a filtered list can be shared or reloaded.
const symbol = ref<string | null>(typeof route.query.symbol === 'string' ? route.query.symbol : null);
const timeframe = ref<string | null>(typeof route.query.timeframe === 'string' ? route.query.timeframe : null);

const breadcrumbs = computed(() => [
  { title: 'Backtesting', disabled: false, href: '#' },
  { title: 'Results', disabled: false, href: '/backtesting/results' },
  { title: strategy.value?.name ?? '...', disabled: true, href: '#' }
]);

const headers = [
  { title: '#', key: 'id' },
  { title: 'Chart', key: 'chart.name' },
  { title: 'Timeframe', key: 'chart.timeframe' },
  { title: 'Status', key: 'status' },
  { title: 'Period', key: 'period', sortable: false },
  { title: 'Trades', key: 'tradeCount', align: 'end' as const },
  { title: 'Profit %', key: 'profitPct', align: 'end' as const },
  { title: 'Max DD %', key: 'maxDrawdownPct', align: 'end' as const },
  { title: 'Win rate', key: 'percentProfitable', align: 'end' as const },
  { title: 'Profit factor', key: 'profitFactor', align: 'end' as const },
  { title: 'Run at', key: 'startedAt' }
];

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = await fetchStrategyBacktests(strategyId.value, {
      symbol: symbol.value ?? undefined,
      timeframe: timeframe.value ?? undefined
    });
    strategy.value = data.strategy;
    backtests.value = data.backtests;
    symbols.value = data.filterOptions.symbols;
    timeframes.value = data.filterOptions.timeframes;
  } catch (err) {
    error.value = getErrorMessage(err, 'Could not load backtests.');
  } finally {
    loading.value = false;
  }
}

watch([symbol, timeframe], () => {
  const query: Record<string, string> = {};
  if (symbol.value) query.symbol = symbol.value;
  if (timeframe.value) query.timeframe = timeframe.value;
  router.replace({ query });
  load();
});

function open(_event: unknown, { item }: { item: BacktestSummary }) {
  router.push(`/backtesting/backtests/${item.id}`);
}

onMounted(load);
</script>

<template>
  <BaseBreadcrumb :title="strategy?.name ?? 'Backtests'" :breadcrumbs="breadcrumbs" />
  <v-row>
    <v-col cols="12">
      <UiParentCard title="Backtests">
        <template #action>
          <v-btn variant="text" to="/backtesting/results" class="mr-2">All strategies</v-btn>
          <v-btn color="secondary" variant="flat" to="/backtesting/run">Run backtest</v-btn>
        </template>

        <p v-if="strategy?.description" class="text-medium-emphasis mb-4">{{ strategy.description }}</p>

        <v-row class="mb-2">
          <v-col cols="12" sm="6" md="3">
            <v-select v-model="symbol" :items="symbols" label="Chart (symbol)" clearable hide-details density="compact" />
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-select v-model="timeframe" :items="timeframes" label="Timeframe" clearable hide-details density="compact" />
          </v-col>
        </v-row>

        <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

        <v-data-table
          :headers="headers"
          :items="backtests"
          :loading="loading"
          item-value="id"
          hover
          class="cursor-pointer"
          no-data-text="No backtests for this strategy yet."
          @click:row="open"
        >
          <template #[`item.status`]="{ item }">
            <v-chip :color="statusColor(item.status)" variant="tonal" size="small" :title="item.error ?? ''">{{ item.status }}</v-chip>
          </template>
          <template #[`item.period`]="{ item }">
            <span class="text-no-wrap">{{ formatBarTime(item.firstBarTime) }} → {{ formatBarTime(item.lastBarTime) }}</span>
          </template>
          <template #[`item.tradeCount`]="{ item }">{{ item.tradeCount ?? '-' }}</template>
          <template #[`item.profitPct`]="{ item }">
            <span :class="pnlColor(item.profitPct)">{{ formatPct(item.profitPct) }}</span>
          </template>
          <template #[`item.maxDrawdownPct`]="{ item }">{{ formatPct(item.maxDrawdownPct) }}</template>
          <template #[`item.percentProfitable`]="{ item }">{{ formatPct(item.percentProfitable, 1) }}</template>
          <template #[`item.profitFactor`]="{ item }">{{ formatNumber(item.profitFactor) }}</template>
          <template #[`item.startedAt`]="{ item }">
            <span class="text-no-wrap">{{ formatDateTime(item.startedAt) }}</span>
          </template>
        </v-data-table>
      </UiParentCard>
    </v-col>
  </v-row>
</template>
