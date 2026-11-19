<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import BaseBreadcrumb from '@/components/shared/BaseBreadcrumb.vue';
import UiParentCard from '@/components/shared/UiParentCard.vue';
import { getErrorMessage } from '@/utils/api';
import { fetchStrategies, formatDateTime, type Strategy } from '@/services/trade';

const router = useRouter();
const breadcrumbs = shallowRef([
  { title: 'Backtesting', disabled: false, href: '#' },
  { title: 'Results', disabled: true, href: '#' }
]);

const strategies = ref<Strategy[]>([]);
const loading = ref(true);
const error = ref('');

const headers = [
  { title: 'Strategy', key: 'name' },
  { title: 'Backtests', key: 'backtestCount', align: 'end' as const },
  { title: 'Completed', key: 'completedCount', align: 'end' as const },
  { title: 'Last run', key: 'lastRunAt' },
  { title: 'Status', key: 'status', sortable: false }
];

async function load() {
  loading.value = true;
  error.value = '';
  try {
    strategies.value = await fetchStrategies();
  } catch (err) {
    error.value = getErrorMessage(err, 'Could not load strategies.');
  } finally {
    loading.value = false;
  }
}

function open(_event: unknown, { item }: { item: Strategy }) {
  router.push(`/backtesting/results/${item.id}`);
}

onMounted(load);
</script>

<template>
  <BaseBreadcrumb title="Backtest Results" :breadcrumbs="breadcrumbs" />
  <v-row>
    <v-col cols="12">
      <UiParentCard title="Strategies">
        <template #action>
          <v-btn color="secondary" variant="flat" to="/backtesting/run">Run backtest</v-btn>
        </template>

        <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

        <v-data-table
          :headers="headers"
          :items="strategies"
          :loading="loading"
          item-value="id"
          hover
          class="cursor-pointer"
          no-data-text="No strategies yet. Add a strategy file to Modulars/Trade/Strategies."
          @click:row="open"
        >
          <template #[`item.name`]="{ item }">
            <div class="py-2">
              <div class="font-weight-medium">{{ item.name }}</div>
              <div v-if="item.description" class="text-body-small text-medium-emphasis">{{ item.description }}</div>
            </div>
          </template>
          <template #[`item.lastRunAt`]="{ item }">{{ formatDateTime(item.lastRunAt) }}</template>
          <template #[`item.status`]="{ item }">
            <v-chip v-if="!item.isAvailable" color="error" variant="tonal" size="small" :title="item.loadError ?? ''">Unavailable</v-chip>
            <v-chip v-else-if="!item.isActive" color="warning" variant="tonal" size="small">Inactive</v-chip>
            <v-chip v-else color="success" variant="tonal" size="small">Active</v-chip>
          </template>
        </v-data-table>
      </UiParentCard>
    </v-col>
  </v-row>
</template>
