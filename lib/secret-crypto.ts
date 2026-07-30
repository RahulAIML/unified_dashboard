/**
 * lib/secret-crypto.ts — envelope encryption for per-tenant secrets.
 *
 * WHY THIS SHAPE. Render's secret manager is environment variables, so storing
 * each tenant's credentials there would require adding vars and redeploying per
 * customer — the exact constraint that makes self-service onboarding impossible
 * and that hid Apotex's LMS tab (see docs/ARCHITECTURE_AUDIT.md, A1).
 *
 * So Render holds exactly ONE secret — the master key below — and per-tenant
 * ciphertext lives in Postgres, writable at runtime by the onboarding wizard.
 * Adding a tenant becomes a database insert, not a deploy.
 *
 * AES-256-GCM: authenticated, so tampering with stored ciphertext fails to
 * decrypt rather than silently yielding wrong plaintext. A random 12-byte IV per
 * encryption means identical inputs produce different ciphertext, so an attacker
 * with read access to the table cannot tell which tenants share a credential.
 *
 * THREAT MODEL — what this does and does not protect:
 *   Protects: database dumps, over-broad backups, read-only SQL access, logs
 *             that capture rows. The dominant realistic leak paths.
 *   Does NOT protect: an attacker with the running process's environment, since
 *             the key is there by necessity. Defending that needs a KMS that
 *             never releases key material; the interface here is deliberately
 *             narrow so swapping to KMS later touches only this file.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
/** Bump when the wire format changes so old rows stay readable. */
const VERSION = 'v1'

export class SecretCryptoError extends Error {}

/**
 * Resolve the master key.
 *
 * Accepts either 32 raw bytes as base64/hex, or a passphrase which is hashed to
 * 32 bytes. The hash path exists because operators paste passphrases into
 * dashboards in practice; refusing them tends to produce a weaker workaround
 * (key committed to the repo) rather than a stronger key.
 */
function masterKey(): Buffer {
  const raw = process.env.SECRET_ENCRYPTION_KEY
  if (!raw || !raw.trim()) {
    throw new SecretCryptoError(
      'SECRET_ENCRYPTION_KEY is not set. Generate one with ' +
      '`openssl rand -base64 32` and set it in the Render environment.',
    )
  }
  const trimmed = raw.trim()

  for (const enc of ['base64', 'hex'] as const) {
    try {
      const buf = Buffer.from(trimmed, enc)
      if (buf.length === 32) return buf
    } catch {
      /* try next encoding */
    }
  }
  // Passphrase fallback — deterministic, so existing ciphertext stays readable.
  return createHash('sha256').update(trimmed, 'utf8').digest()
}

/** True when a usable master key is configured. Never throws. */
export function isSecretCryptoConfigured(): boolean {
  try {
    masterKey()
    return true
  } catch {
    return false
  }
}

/**
 * Encrypt a UTF-8 secret.
 *
 * Wire format: `v1:<base64(iv)>:<base64(tag)>:<base64(ciphertext)>` — the
 * version prefix makes an algorithm migration possible without guessing at
 * stored rows.
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new SecretCryptoError('Can only encrypt a string')
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join(':')
}

/**
 * Decrypt a value produced by `encryptSecret`.
 *
 * Throws on tampering, a wrong key, or a malformed payload — never returns a
 * partial or best-effort result, because a silently wrong credential would be
 * far harder to diagnose than a hard failure.
 */
export function decryptSecret(payload: string): string {
  if (!payload || typeof payload !== 'string') {
    throw new SecretCryptoError('Nothing to decrypt')
  }
  const parts = payload.split(':')
  if (parts.length !== 4) {
    throw new SecretCryptoError('Malformed ciphertext: expected 4 sections')
  }
  const [version, ivB64, tagB64, dataB64] = parts
  if (version !== VERSION) {
    throw new SecretCryptoError(`Unsupported ciphertext version '${version}'`)
  }

  const iv = Buffer.from(ivB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  if (iv.length !== IV_BYTES) throw new SecretCryptoError('Bad IV length')
  if (tag.length !== TAG_BYTES) throw new SecretCryptoError('Bad auth tag length')

  try {
    const decipher = createDecipheriv(ALGO, masterKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch (err) {
    // Deliberately generic: distinguishing "wrong key" from "tampered" would
    // help an attacker probe the key, and neither is recoverable here.
    throw new SecretCryptoError(
      `Decryption failed — wrong SECRET_ENCRYPTION_KEY or corrupted value (${(err as Error).message})`,
    )
  }
}

/** True if the string looks like our envelope format (not proof it decrypts). */
export function looksEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`)
}

/**
 * Redact for logs. Never log a secret, encrypted or not — ciphertext identifies
 * which tenants share a credential even when it cannot be read.
 */
export function redact(value: string | null | undefined): string {
  if (!value) return '(unset)'
  return `(${value.length} chars, ${looksEncrypted(value) ? 'encrypted' : 'PLAINTEXT'})`
}
