import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes
} from "node:crypto";

import type { Hex } from "viem";

const ALGORITHM: CipherGCMTypes = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type EncryptedJournalPayload = {
  readonly ciphertext: string;
  readonly iv: string;
  readonly authTag: string;
};

function keyBytes(key: Hex): Buffer {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Journal encryption key must contain exactly 32 bytes");
  }
  return Buffer.from(key.slice(2), "hex");
}

export function encryptJournalPayload(
  plaintext: string,
  key: Hex,
  associatedData: string
): EncryptedJournalPayload {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBytes(key), iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptJournalPayload(
  encrypted: EncryptedJournalPayload,
  key: Hex,
  associatedData: string
): string {
  const iv = Buffer.from(encrypted.iv, "base64");
  const authTag = Buffer.from(encrypted.authTag, "base64");
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("Encrypted journal payload has invalid AES-GCM parameters");
  }

  const decipher = createDecipheriv(ALGORITHM, keyBytes(key), iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}
