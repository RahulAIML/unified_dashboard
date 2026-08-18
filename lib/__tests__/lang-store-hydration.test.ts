/**
 * Regression coverage for the landing-page hydration mismatch (React #418).
 *
 * The store used to seed `lang` straight from localStorage. The server renders
 * with the 'es' default, so a user with rp-lang="en" got Spanish server HTML and
 * an English first client render -- a text hydration mismatch on every page
 * load, observed live in production on the landing page. React responds by
 * discarding the server markup and re-rendering client-side, which loses the SSR
 * benefit and can flash the wrong language.
 *
 * The contract now: initial state ALWAYS matches the server, and the stored
 * preference is adopted afterwards via hydrateFromStorage().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

async function fresh() {
  vi.resetModules()
  return import('../lang-store')
}

beforeEach(() => {
  localStorage.clear()
})

describe('useLangStore — hydration safety', () => {
  it('starts at the server locale even when localStorage says otherwise', async () => {
    localStorage.setItem('rp-lang', 'en')
    const { useLangStore } = await fresh()

    // This is the whole point: first client render must match server HTML.
    expect(useLangStore.getState().lang).toBe('es')
    expect(useLangStore.getState().hydrated).toBe(false)
  })

  it('adopts the stored preference once hydrateFromStorage runs', async () => {
    localStorage.setItem('rp-lang', 'en')
    const { useLangStore } = await fresh()

    useLangStore.getState().hydrateFromStorage()

    expect(useLangStore.getState().lang).toBe('en')
    expect(useLangStore.getState().hydrated).toBe(true)
  })

  it('stays on the default when nothing is stored', async () => {
    const { useLangStore } = await fresh()
    useLangStore.getState().hydrateFromStorage()

    expect(useLangStore.getState().lang).toBe('es')
    expect(useLangStore.getState().hydrated).toBe(true)
  })

  it('ignores a corrupt stored value rather than rendering an unknown locale', async () => {
    localStorage.setItem('rp-lang', 'klingon')
    const { useLangStore } = await fresh()
    useLangStore.getState().hydrateFromStorage()

    expect(useLangStore.getState().lang).toBe('es')
  })

  it('does not clobber a deliberate change made before hydration runs', async () => {
    localStorage.setItem('rp-lang', 'es')
    const { useLangStore } = await fresh()

    useLangStore.getState().setLang('en')   // user toggled early
    useLangStore.getState().hydrateFromStorage()

    // setLang persisted 'en', so hydration must agree rather than revert to 'es'.
    expect(useLangStore.getState().lang).toBe('en')
  })

  it('hydrates only once', async () => {
    localStorage.setItem('rp-lang', 'en')
    const { useLangStore } = await fresh()

    useLangStore.getState().hydrateFromStorage()
    useLangStore.getState().setLang('es')
    useLangStore.getState().hydrateFromStorage() // must be a no-op now

    expect(useLangStore.getState().lang).toBe('es')
  })

  it('toggle still persists the choice', async () => {
    const { useLangStore } = await fresh()

    useLangStore.getState().toggle()

    expect(useLangStore.getState().lang).toBe('en')
    expect(localStorage.getItem('rp-lang')).toBe('en')
  })
})
