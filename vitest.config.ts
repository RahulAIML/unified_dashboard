import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Git worktrees under .claude/worktrees/ are physically nested directories
    // on disk — without this exclude, vitest's default glob picks up sibling
    // worktrees' (possibly stale/in-progress) test files as if they were this
    // checkout's own, producing false failures unrelated to this codebase.
    // 'dashboard/' is a git submodule containing a full nested checkout of this
    // same repo at an older commit (self-referential — vestigial from earlier
    // tooling). Its tests run against its own older, version-skewed code and
    // are not relevant to this checkout, which is what actually gets deployed.
    // 'dashboard/**' is anchored to the repo ROOT on purpose. The previous
    // pattern was '**/dashboard/**', which also matched
    // app/api/dashboard/__tests__/ and silently excluded 26 real API tests --
    // they had never run, so the suite total looked healthy while the API layer
    // was effectively untested. Keep this anchored; do not re-add the '**/'.
    // 'e2e/**' is Playwright's own test suite (playwright.config.ts), not
    // vitest's -- it uses test.describe()/test() from @playwright/test, which
    // throws when invoked outside Playwright's runner.
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**', 'dashboard/**', 'e2e/**'],
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
