/**
 * public-key.ts — the ed25519 public key data migrations are signed with.
 *
 * The private half signs each release's `migrations.json` in the release
 * pipeline (GitHub Actions secret `MIGRATIONS_SIGNING_KEY`; backed up in the
 * maintainer's macOS Keychain as `openp41ge-migrations-signing-key`). A file
 * that this key does not verify is never run.
 */
export const MIGRATIONS_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+sCZFG2D+T9UiRD/NBN2CQvO8y0qy+NbC/7pDTf52lI=
-----END PUBLIC KEY-----
`;
