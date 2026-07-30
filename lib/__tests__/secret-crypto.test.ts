import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  encryptSecret,
  decryptSecret,
  isSecretCryptoConfigured,
  looksEncrypted,
  redact,
  SecretCryptoError,
} from '../secret-crypto'

const KEY_B64 = Buffer.alloc(32, 7).toString('base64')
const original = process.env.SECRET_ENCRYPTION_KEY

beforeEach(() => { process.env.SECRET_ENCRYPTION_KEY = KEY_B64 })
afterEach(() => {
  if (original === undefined) delete process.env.SECRET_ENCRYPTION_KEY
  else process.env.SECRET_ENCRYPTION_KEY = original
})

describe('round trip', () => {
  it('decrypts back to the original', () => {
    const secret = 'lw_client_secret_9f8a7b6c'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('handles unicode and long values', () => {
    const s = 'año–π 🔐 ' + 'x'.repeat(5000)
    expect(decryptSecret(encryptSecret(s))).toBe(s)
  })

  it('handles the empty string without treating it as absent', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('')
  })

  it('produces different ciphertext for identical input', () => {
    // Random IV per call — otherwise the table would reveal which tenants
    // share a credential.
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })
})

describe('integrity', () => {
  it('refuses tampered ciphertext rather than returning wrong plaintext', () => {
    const [v, iv, tag, data] = encryptSecret('real-value').split(':')
    const flipped = Buffer.from(data, 'base64')
    flipped[0] ^= 0xff
    const tampered = [v, iv, tag, flipped.toString('base64')].join(':')

    expect(() => decryptSecret(tampered)).toThrow(SecretCryptoError)
  })

  it('refuses a wrong key', () => {
    const ct = encryptSecret('value')
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')

    expect(() => decryptSecret(ct)).toThrow(SecretCryptoError)
  })

  it('rejects malformed payloads', () => {
    for (const bad of ['', 'garbage', 'v1:only:three', 'v9:a:b:c']) {
      expect(() => decryptSecret(bad)).toThrow(SecretCryptoError)
    }
  })
})

describe('key handling', () => {
  it('throws an actionable error when the key is missing', () => {
    delete process.env.SECRET_ENCRYPTION_KEY
    // The message must tell an operator how to fix it, not just fail.
    expect(() => encryptSecret('x')).toThrow(/SECRET_ENCRYPTION_KEY is not set/)
    expect(() => encryptSecret('x')).toThrow(/openssl rand -base64 32/)
  })

  it('accepts hex, base64, or a passphrase', () => {
    for (const key of [
      Buffer.alloc(32, 3).toString('hex'),
      Buffer.alloc(32, 3).toString('base64'),
      'a-long-operator-passphrase',
    ]) {
      process.env.SECRET_ENCRYPTION_KEY = key
      expect(decryptSecret(encryptSecret('v'))).toBe('v')
    }
  })

  it('derives a passphrase deterministically so stored rows stay readable', () => {
    process.env.SECRET_ENCRYPTION_KEY = 'stable-passphrase'
    const ct = encryptSecret('persisted')
    // Simulate a restart: same passphrase must still decrypt.
    process.env.SECRET_ENCRYPTION_KEY = 'stable-passphrase'
    expect(decryptSecret(ct)).toBe('persisted')
  })

  it('reports configuration status without throwing', () => {
    expect(isSecretCryptoConfigured()).toBe(true)
    delete process.env.SECRET_ENCRYPTION_KEY
    expect(isSecretCryptoConfigured()).toBe(false)
  })
})

describe('logging safety', () => {
  it('never includes the value in redact output', () => {
    const secret = 'super-secret-token'
    const out = redact(secret)
    expect(out).not.toContain(secret)
    expect(out).toContain('PLAINTEXT')
  })

  it('flags encrypted values as such', () => {
    expect(redact(encryptSecret('x'))).toContain('encrypted')
    expect(redact(null)).toBe('(unset)')
  })

  it('recognises the envelope format', () => {
    expect(looksEncrypted(encryptSecret('x'))).toBe(true)
    expect(looksEncrypted('plain')).toBe(false)
    expect(looksEncrypted(null)).toBe(false)
  })
})
