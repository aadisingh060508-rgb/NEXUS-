import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Note: /ws and /api proxy to localhost:3001 have been removed.
    // The admin dashboard talks to the remote employee agent via Supabase Realtime,
    // not a local WebSocket proxy. Only add this proxy back if running the
    // employee-agent on the SAME machine as the admin dashboard.
  },
})

