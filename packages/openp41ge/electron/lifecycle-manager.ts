/**
 * LifecycleManager — App lifecycle for tests.
 *
 * Tracks readiness (Electron app ready + renderer first render complete)
 * and provides IPC handlers for the test framework to query/reset/shutdown
 * the app deterministically — no polling, no timeout guessing.
 *
 * The test framework talks to this manager through:
 *   - Main process: electronApplication.evaluate(() => lifecycleManager.*)
 *   - Renderer:     page.evaluate(() => window.__openp41geReady)
 *
 * Future: this is where the "reset" command from the reload plan
 * (plans/2025-12-19-app-reload-command-for-tests.md) will live.
 */

import { ipcMain } from "electron";

export class LifecycleManager {
  private _electronReady = false;
  private _rendererReady = false;
  private _readyResolve: (() => void) | null = null;
  private _readyPromise = new Promise<void>((resolve) => {
    this._readyResolve = resolve;
  });

  // ── Callbacks (called by main.ts and the renderer IPC handler) ──

  /** Called after app.whenReady() resolves. */
  notifyElectronReady(): void {
    this._electronReady = true;
    this._checkReady();
  }

  /** Called by the renderer via IPC after its first Lit render cycle. */
  notifyRendererReady(): void {
    this._rendererReady = true;
    this._checkReady();
  }

  // ── Queries (called by the test framework via app.evaluate) ──

  /** True when both Electron and the renderer have initialised. */
  isReady(): boolean {
    return this._electronReady && this._rendererReady;
  }

  /** Promise that resolves when the app is fully ready. */
  get ready(): Promise<void> {
    return this._readyPromise;
  }

  // ── Reset (future: used by the reload plan for fast reset) ──

  /** Reset internal state so the test framework can wait for the next ready signal. */
  reset(): void {
    this._rendererReady = false;
    this._readyPromise = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });
  }

  // ── Internals ──

  private _checkReady(): void {
    if (this._electronReady && this._rendererReady && this._readyResolve) {
      this._readyResolve();
      this._readyResolve = null;
    }
  }
}

// Singleton — created once when the module loads.
// The Openp41geApplication class creates an instance and exposes it as
// openp41geApp.lifecycle for test framework access.
// ── IPC handler registration ──────────────────────────────────────────────
// Called from Openp41geApplication._registerIpcHandlers().

export function registerLifecycleHandlers(lm: LifecycleManager): void {
  // Renderer signals that its first render cycle completed
  ipcMain.on("lifecycle:renderer-ready", () => {
    lm.notifyRendererReady();
  });
}
