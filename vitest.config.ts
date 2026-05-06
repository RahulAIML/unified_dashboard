import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'lib/org-type.ts',
        'lib/bridge-banco-analytics.ts',
        'app/api/dashboard/**/*.ts',
        'app/api/auth/access-status/**/*.ts',
        'components/Sidebar.tsx',
        'components/DashboardContent.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
