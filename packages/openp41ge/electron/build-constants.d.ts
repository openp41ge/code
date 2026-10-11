/**
 * Build-time constants injected by esbuild `--define` in the release build
 * (`project.json` build target) from the `APP_VERSION` / `APP_CHANNEL` env
 * vars. They are NOT injected in the dev build (tsc only), so consumer code
 * must guard with `typeof` before dereferencing them.
 */
declare const __OPENP41GE_VERSION__: string | undefined;
declare const __OPENP41GE_CHANNEL__: string | undefined;
