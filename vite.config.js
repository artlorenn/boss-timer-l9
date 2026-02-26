import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:   resolve(__dirname, 'index.html'),
        relic:  resolve(__dirname, 'relic.html'),
        potion: resolve(__dirname, 'potion.html'),
      }
    }
  }
})
