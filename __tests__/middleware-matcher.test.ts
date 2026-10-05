/**
 * Regression: middleware.ts's matcher only excluded _next/static,
 * _next/image, and favicon.ico -- every OTHER file under public/ (logo.jpg,
 * *.svg, etc.) is served at the URL root with no distinguishing prefix, so
 * it was subject to the exact same auth gate as a real page. Requesting
 * /logo.jpg while logged out didn't 404 or serve the image -- it 302'd to
 * /auth/login (confirmed live: fetching /logo.jpg unauthenticated returned
 * status 200, content-type text/html -- the login page's own HTML, not the
 * image), so a logged-out visitor's <img> tag rendered nothing. That broke
 * the logo on the login page itself, the one page every logged-out visitor
 * by definition sees.
 *
 * Next's matcher is a path-matching convention (a regex-ish glob compiled by
 * next-router), not a literal JS RegExp, but the pattern here only uses
 * plain regex syntax (negative lookahead, alternation, char classes) that
 * JS's own RegExp engine parses identically -- enough to pin the intended
 * set of paths without needing the Next build pipeline.
 */
import { describe, it, expect } from 'vitest'
import { config as middlewareConfig } from '../middleware'

function matcherRegex(): RegExp {
  const pattern = middlewareConfig.matcher[0]
  return new RegExp(`^${pattern}$`)
}

describe('middleware.ts matcher — static assets are excluded from the auth gate', () => {
  const re = () => matcherRegex()

  it('excludes every real static asset under public/', () => {
    for (const path of ['/logo.jpg', '/logo_rolplay.png', '/file.svg', '/globe.svg', '/next.svg', '/vercel.svg', '/window.svg', '/favicon.ico']) {
      expect(re().test(path)).toBe(false)
    }
  })

  it('excludes common static file extensions generally, not just the current public/ roster', () => {
    for (const path of ['/anything.css', '/bundle.js', '/font.woff2', '/font.ttf', '/map.map', '/photo.jpeg', '/anim.webp', '/icon.gif']) {
      expect(re().test(path)).toBe(false)
    }
  })

  it('still excludes the pre-existing Next internals', () => {
    expect(re().test('/_next/static/chunks/main.js')).toBe(false)
    expect(re().test('/_next/image')).toBe(false)
  })

  it('still includes every real page and API route, so the auth gate keeps applying to them', () => {
    for (const path of ['/', '/auth/login', '/kpis', '/settings', '/d/apotex', '/api/dashboard-view/apotex', '/api/auth/me']) {
      expect(re().test(path)).toBe(true)
    }
  })

  it('does not accidentally exclude a page route that merely CONTAINS an asset-like substring', () => {
    // e.g. a slug such as /d/my-logo-jpg-report must still be gated -- only
    // a real trailing extension should be excluded, not any match anywhere.
    expect(re().test('/d/my-logo-jpg-report')).toBe(true)
  })
})
