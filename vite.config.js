import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/textile/',
  build: {
    rollupOptions: {
      input: ['index.html', 'readme/index.html'],
    },
  },
  plugins: [react()],
})
