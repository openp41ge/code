// App entry point
// Install the console silencer FIRST, before anything else (Sentry.init,
// renderer.start), so no renderer output reaches the browser console. All
// logging flows to the structured log bus / on-disk files instead.
import { installConsoleSilencer } from "./services/console-silencer";
installConsoleSilencer();

import * as Sentry from "@sentry/electron/renderer";
import { renderer } from "./app";

// Initialize Sentry in the renderer as early as possible. The DSN and
// environment are forwarded from the main process (which owns the real DSN),
// so no dsn is passed here. `@sentry/electron` routes renderer events to the
// main process for delivery (via IPC / the sentry-ipc protocol), and when the
// main has no DSN configured it stays disabled and this is a safe no-op.
// The release/environment are the build-time baked values so the renderer's
// own client is consistent with the main client (delivery still goes through
// main, but it removes any release mismatch).
Sentry.init({
  release: __OPENP41GE_VERSION__,
  environment: __OPENP41GE_CHANNEL__,
});

renderer.start();
