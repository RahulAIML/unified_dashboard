"""Python port of lib/secret-crypto.ts — envelope encryption for per-tenant
secrets, so this service can decrypt the SAME tenant_credentials rows the
Next.js app writes (same Postgres auth DB, same SECRET_ENCRYPTION_KEY).

Wire format is IDENTICAL to the TypeScript version, byte for byte:
    v1:<base64(iv)>:<base64(tag)>:<base64(ciphertext)>
AES-256-GCM, 12-byte IV, 16-byte tag. Must stay in lockstep with
lib/secret-crypto.ts — a divergence here would mean this service silently
fails to decrypt credentials the Next.js app can read fine, or vice versa.
"""
from __future__ import annotations

import base64
import binascii
import hashlib

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION = "v1"
_IV_BYTES = 12
_TAG_BYTES = 16


class SecretCryptoError(Exception):
    pass


def _master_key(raw: str | None) -> bytes:
    """Mirrors masterKey() in lib/secret-crypto.ts: 32 raw bytes as base64/hex,
    or a passphrase hashed to 32 bytes via SHA-256."""
    if not raw or not raw.strip():
        raise SecretCryptoError(
            "SECRET_ENCRYPTION_KEY is not set. Generate one with "
            "`openssl rand -base64 32` and set it in the Render environment."
        )
    trimmed = raw.strip()

    try:
        buf = base64.b64decode(trimmed, validate=True)
        if len(buf) == 32:
            return buf
    except (binascii.Error, ValueError):
        pass

    try:
        buf = bytes.fromhex(trimmed)
        if len(buf) == 32:
            return buf
    except ValueError:
        pass

    return hashlib.sha256(trimmed.encode("utf-8")).digest()


def is_secret_crypto_configured(raw: str | None) -> bool:
    try:
        _master_key(raw)
        return True
    except SecretCryptoError:
        return False


def decrypt_secret(payload: str, master_key_raw: str | None) -> str:
    """Decrypt a value produced by encryptSecret() in lib/secret-crypto.ts.
    Raises on tampering, a wrong key, or a malformed payload — never returns a
    partial/best-effort result, matching the TS version's failure philosophy."""
    if not payload or not isinstance(payload, str):
        raise SecretCryptoError("Nothing to decrypt")
    parts = payload.split(":")
    if len(parts) != 4:
        raise SecretCryptoError("Malformed ciphertext: expected 4 sections")
    version, iv_b64, tag_b64, data_b64 = parts
    if version != _VERSION:
        raise SecretCryptoError(f"Unsupported ciphertext version '{version}'")

    iv = base64.b64decode(iv_b64)
    tag = base64.b64decode(tag_b64)
    if len(iv) != _IV_BYTES:
        raise SecretCryptoError("Bad IV length")
    if len(tag) != _TAG_BYTES:
        raise SecretCryptoError("Bad auth tag length")

    key = _master_key(master_key_raw)
    ciphertext = base64.b64decode(data_b64)
    try:
        # cryptography's AESGCM expects ciphertext with the tag appended —
        # Node's createDecipheriv/setAuthTag keeps them separate, so we
        # concatenate here to match the same underlying GCM construction.
        plaintext = AESGCM(key).decrypt(iv, ciphertext + tag, None)
        return plaintext.decode("utf-8")
    except Exception as exc:  # noqa: BLE001 - deliberately generic, matches TS
        raise SecretCryptoError(
            f"Decryption failed — wrong SECRET_ENCRYPTION_KEY or corrupted value ({exc})"
        ) from exc
