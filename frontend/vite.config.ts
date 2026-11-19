import { fileURLToPath, URL } from 'url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import VueRouter from 'vue-router/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    VueRouter(),
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => ['v-list-recognize-title'].includes(tag)
        }
      }
    }),
    vuetify({
      styles: {
        configFile: "src/scss/settings.scss",
      },
      autoImport: true
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  css: {
    preprocessorOptions: {
      scss: {}
    }
  },
  server: {
    proxy: {
      // Forward API calls to the backend during development (see the root README).
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 1024 * 1024 // Set the limit to 1 MB
  },
  optimizeDeps: {
    exclude: ['vuetify'],
    entries: ['./src/**/*.vue']
  }
});
