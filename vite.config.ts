import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // Read PORT from .env (all variables, not just VITE_*) so the proxy follows the API server.
  const env = loadEnv(mode, import.meta.dirname, '')
  const apiPort = env.PORT || '3001'
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src/client'),
        '@shared': path.resolve(import.meta.dirname, 'src/shared'),
      },
    },
    server: {
      port: 5173,
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
  }
})
