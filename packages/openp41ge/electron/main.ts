/**
 * Openp41ge main process entry point.
 *
 * All startup logic has moved into Openp41geApplication (openp41ge-application.ts).
 * This file exists only to instantiate and start the application.
 */

import { setConsoleTransportEnabled } from "openp41ge-core-logger";
import { Openp41geApplication } from "./openp41ge-application.js";
import { initSentry } from "./sentry.js";

// Non-fatal logs must only reach the log system (log bus → viewer → disk),
// never the console. The logger's console transport is installed on import;
// the flag is read at emit time, so disabling here suppresses console replay
// for all subsequent main-process logs. Fatal errors bypass the logger
// entirely (they are handled in openp41ge-application and go to console via
// console.error + the fatal error window).
setConsoleTransportEnabled(false);

// Initialize Sentry before the app starts (and thus before Electron is
// ready): the SDK must register its `sentry-ipc` scheme & IPC handlers early.
initSentry();

const app = new Openp41geApplication();
// Expose for the test framework to query lifecycle readiness via
// electronApplication.evaluate(() => openp41geApp.lifecycle.ready).
(globalThis as any).openp41geApp = app;
app.start();
