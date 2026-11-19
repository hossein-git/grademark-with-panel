<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Google from '@/assets/images/auth/social-google.svg';
import { useAuthStore } from '@/stores/auth';
import { getPostLoginPath } from '@/router';
import { getErrorMessage } from '@/utils/api';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const loginForm = ref();
const email = ref('');
const password = ref('');
const checkbox = ref(false);
const show1 = ref(false);
const loading = ref(false);
const errorMessage = ref('');

// Only check that a password was entered. Strength rules belong to account creation,
// not to login.
const passwordRules = ref([(v: string) => !!v || 'Password is required']);
const emailRules = ref([(v: string) => !!v || 'E-mail is required', (v: string) => /.+@.+\..+/.test(v) || 'E-mail must be valid']);

async function submit() {
  if (loading.value) return;
  errorMessage.value = '';

  const { valid } = await loginForm.value.validate();
  if (!valid) return;

  loading.value = true;
  try {
    await auth.login(email.value.trim(), password.value, checkbox.value);
    await router.push(getPostLoginPath(route.query));
  } catch (error) {
    errorMessage.value = getErrorMessage(error, 'Login failed. Please try again.');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <v-btn block color="primary" variant="outlined" class="text-lightText googleBtn">
    <img :src="Google" alt="google" />
    <span class="ml-2">Sign in with Google</span></v-btn
  >
  <v-row>
    <v-col class="d-flex align-center">
      <v-divider class="custom-devider" />
      <v-btn variant="outlined" class="orbtn" rounded="md" size="small">OR</v-btn>
      <v-divider class="custom-devider" />
    </v-col>
  </v-row>
  <h5 class="text-center my-4 mb-8">Sign in with Email address</h5>
  <v-form ref="loginForm" @submit.prevent="submit" class="mt-7 loginForm">
    <v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mb-6" data-test="login-error">
      {{ errorMessage }}
    </v-alert>
    <v-text-field
      v-model="email"
      :rules="emailRules"
      label="Email Address"
      type="email"
      autocomplete="username"
      class="mt-4 mb-8"
      required
      hide-details="auto"
    ></v-text-field>
    <v-text-field
      v-model="password"
      :rules="passwordRules"
      label="Password"
      autocomplete="current-password"
      required
      hide-details="auto"
      :append-inner-icon="show1 ? '$eye' : '$eyeOff'"
      :type="show1 ? 'text' : 'password'"
      @click:append-inner="show1 = !show1"
    ></v-text-field>

    <div class="d-sm-flex align-center mt-2 mb-7 mb-sm-0">
      <v-checkbox v-model="checkbox" label="Remember me?" color="primary" class="ms-n2" hide-details></v-checkbox>
      <div class="ml-auto">
        <a href="javascript:void(0)" class="text-primary text-decoration-none">Forgot password?</a>
      </div>
    </div>
    <v-btn color="secondary" block class="mt-2" variant="flat" size="large" :loading="loading" :disabled="loading" type="submit">
      Sign In</v-btn
    >
  </v-form>
</template>
<style lang="scss">
.custom-devider {
  border-color: rgba(0, 0, 0, 0.08) !important;
}
.googleBtn {
  border-color: rgba(0, 0, 0, 0.08);
  margin: 30px 0 20px 0;
}
.outlinedInput .v-field {
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: none;
}
.orbtn {
  padding: 2px 40px;
  border-color: rgba(0, 0, 0, 0.08);
  margin: 20px 15px;
}
.loginForm {
  .v-text-field .v-field--active input {
    font-weight: 500;
  }
}
</style>
