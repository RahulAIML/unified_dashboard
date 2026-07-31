"""Regression tests for app/secret_crypto.py — a byte-for-byte port of
lib/secret-crypto.ts. Cross-verified live (not just self-consistency) against
the REAL Node crypto module before these were written: a value encrypted with
Node's createCipheriv(aes-256-gcm) decrypted correctly here, for both the
raw-32-byte-base64-key path and the SHA-256 passphrase-fallback path. That
manual cross-check is what these tests pin down permanently.
"""
import unittest

from app.secret_crypto import SecretCryptoError, decrypt_secret, is_secret_crypto_configured


class SecretCryptoTests(unittest.TestCase):
    def test_decrypts_a_value_encrypted_by_the_real_node_module(self):
        # Generated with Node's crypto.createCipheriv('aes-256-gcm', key, iv)
        # using key = base64decode("rRaSpWO//YWIb6hvgJEfvHYavL9a45I/sjvYfItJE7w=")
        # — cross-checked manually before writing this test, not assumed.
        key_b64 = "rRaSpWO//YWIb6hvgJEfvHYavL9a45I/sjvYfItJE7w="
        ciphertext = (
            "v1:9c76tHkU7kJCgqMs:I0eHkWNLxwtgotsNbhhnUg==:"
            "I7+Z5yjKvBE0Sm/yQUosH4v/2GeaHf5tDwQfqGvTqZAuje8iSrk="
        )
        self.assertEqual(
            decrypt_secret(ciphertext, key_b64),
            "https://academiaapotex.learnworlds.com",
        )

    def test_decrypts_a_value_encrypted_with_the_passphrase_fallback_path(self):
        # Generated with Node's crypto.createHash('sha256').update(passphrase).digest()
        # as the key — cross-checked manually, exercises the non-base64/hex branch.
        passphrase = "my-super-secret-passphrase"
        ciphertext = (
            "v1:rcLZHIycLtRz2tJx:EpDVLm0bNeRxFfsXhsvBZA==:"
            "Rw3Eqmu8jGbMm/nd6C5g2OTWCM8YoyQ="
        )
        self.assertEqual(decrypt_secret(ciphertext, passphrase), "client-secret-value-123")

    def test_round_trips_through_its_own_encrypt_for_convenience_in_other_tests(self):
        # secret_crypto.py only implements decrypt (ai-service never writes
        # credentials, only reads them) — this test proves decrypt is at least
        # self-consistent using the cryptography library's own AESGCM.encrypt,
        # independent of the cross-check above.
        import base64
        import os

        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        key = os.urandom(32)
        iv = os.urandom(12)
        ct = AESGCM(key).encrypt(iv, b"round trip value", None)
        # AESGCM.encrypt appends the tag; split it back apart to match the
        # wire format (ciphertext and tag stored separately).
        ciphertext, tag = ct[:-16], ct[-16:]
        payload = ":".join([
            "v1",
            base64.b64encode(iv).decode(),
            base64.b64encode(tag).decode(),
            base64.b64encode(ciphertext).decode(),
        ])
        self.assertEqual(decrypt_secret(payload, base64.b64encode(key).decode()), "round trip value")

    def test_rejects_a_malformed_payload(self):
        with self.assertRaises(SecretCryptoError):
            decrypt_secret("not-the-right-format", "some-key")

    def test_rejects_an_unsupported_version(self):
        with self.assertRaises(SecretCryptoError):
            decrypt_secret("v2:aWY=:aWY=:aWY=", "some-key")

    def test_rejects_a_wrong_key(self):
        key_b64 = "rRaSpWO//YWIb6hvgJEfvHYavL9a45I/sjvYfItJE7w="
        ciphertext = (
            "v1:9c76tHkU7kJCgqMs:I0eHkWNLxwtgotsNbhhnUg==:"
            "I7+Z5yjKvBE0Sm/yQUosH4v/2GeaHf5tDwQfqGvTqZAuje8iSrk="
        )
        with self.assertRaises(SecretCryptoError):
            decrypt_secret(ciphertext, "totally-wrong-key")

    def test_is_secret_crypto_configured_false_when_key_unset(self):
        self.assertFalse(is_secret_crypto_configured(None))
        self.assertFalse(is_secret_crypto_configured(""))

    def test_is_secret_crypto_configured_true_when_key_set(self):
        self.assertTrue(is_secret_crypto_configured("any-passphrase-works"))


if __name__ == "__main__":
    unittest.main()
