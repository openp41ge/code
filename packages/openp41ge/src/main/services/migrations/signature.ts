/**
 * signature.ts — checking a downloaded migrations file against its ed25519
 * signature (base64, in the release's `migrations.json.sig`). The public key
 * ships in the app; the private half signs files in the release pipeline.
 */

import crypto from "crypto";

/** Whether `signature` signs exactly `data` with the key `publicKeyPem`. */
export function verifySignature(data: Buffer, signature: string, publicKeyPem: string): boolean {
  try {
    const sig = Buffer.from(signature.trim(), "base64");
    if (sig.length !== 64) return false; // an ed25519 signature
    return crypto.verify(null, data, crypto.createPublicKey(publicKeyPem), sig);
  } catch {
    return false;
  }
}
