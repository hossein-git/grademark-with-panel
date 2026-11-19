<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { SettingsIcon, LogoutIcon, UserIcon } from 'vue-tabler-icons';
import { useAuthStore } from '@/stores/auth';
import { LOGIN_PATH } from '@/router';

const swt1 = ref(true);
const swt2 = ref(false);

const auth = useAuthStore();
const router = useRouter();

async function logout() {
  await auth.logout();
  await router.push(LOGIN_PATH);
}
</script>

<template>
  <!-- ---------------------------------------------- -->
  <!-- profile DD -->
  <!-- ---------------------------------------------- -->
  <div class="pt-4">
    <div class="px-4">
      <h4 class="mb-n1">
        Good Morning, <span class="font-weight-regular">{{ auth.user?.name }}</span>
      </h4>
      <span class="text-body-small text-medium-emphasis text-capitalize">{{ auth.user?.role }}</span>

      <v-text-field persistent-placeholder placeholder="Search" class="my-3" hide-details>
        <template v-slot:prepend-inner>
          <SearchIcon stroke-width="1.5" size="20" class="text-lightText SearchIcon" />
        </template>
      </v-text-field>
    </div>

    <v-divider class="mx-4" />
    <perfect-scrollbar style="height: calc(100vh - 300px); max-height: 515px">
      <div class="px-4 pb-4">
        <div class="bg-lightprimary rounded-md px-5 py-3 my-3">
          <div class="d-flex align-center justify-space-between">
            <h5>Start DND Mode</h5>
            <div>
              <v-switch v-model="swt1" color="primary" hide-details></v-switch>
            </div>
          </div>
          <div class="d-flex align-center justify-space-between">
            <h5>Allow Notifications</h5>
            <div>
              <v-switch v-model="swt2" color="primary" hide-details></v-switch>
            </div>
          </div>
        </div>

        <v-divider></v-divider>

        <v-list class="mt-3">
          <v-list-item color="secondary" rounded="md">
            <template v-slot:prepend>
              <SettingsIcon size="20" class="mr-2" />
            </template>

            <v-list-item-title class="text-body-small"> Account Settings</v-list-item-title>
          </v-list-item>

          <v-list-item color="secondary" rounded="md">
            <template v-slot:prepend>
              <UserIcon size="20" class="mr-2" />
            </template>

            <v-list-item-title class="text-body-small"> Social Profile</v-list-item-title>

            <template v-slot:append>
              <v-chip color="warning" text="02" variant="flat" size="small" />
            </template>
          </v-list-item>

          <v-list-item color="secondary" rounded="md" @click="logout">
            <template v-slot:prepend>
              <LogoutIcon size="20" class="mr-2" />
            </template>

            <v-list-item-title class="text-body-small"> Logout</v-list-item-title>
          </v-list-item>
        </v-list>
      </div>
    </perfect-scrollbar>
  </div>
</template>
