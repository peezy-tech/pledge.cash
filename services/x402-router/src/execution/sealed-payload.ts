import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { Hex } from "viem";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export function sealOperationPayload(
  key: Hex,
  payload: unknown,
  iv = randomBytes(IV_BYTES),
): string {
  const keyBytes = decodeKey(key);
  if (iv.byteLength !== IV_BYTES) {
    throw new Error(`Operation journal IV must be ${IV_BYTES} bytes.`);
  }
  const cipher = createCipheriv(ALGORITHM, keyBytes, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function openOperationPayload<T>(key: Hex, sealed: string): T {
  const [version, encodedIv, encodedTag, encodedCiphertext, trailing] =
    sealed.split(".");
  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedTag ||
    encodedCiphertext === undefined ||
    trailing !== undefined
  ) {
    throw new Error("Unsupported operation journal payload.");
  }
  const iv = Buffer.from(encodedIv, "base64url");
  const tag = Buffer.from(encodedTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== 16) {
    throw new Error("Malformed operation journal payload.");
  }
  const decipher = createDecipheriv(ALGORITHM, decodeKey(key), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function decodeKey(key: Hex): Buffer {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Operation journal key must be exactly 32 bytes.");
  }
  return Buffer.from(key.slice(2), "hex");
}
