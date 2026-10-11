/**
 * migrations.ts — the migration window's renderer entry. Shown at startup
 * while the data updates this version needs run; renders their state from
 * the main process. Self-contained: it does not use the app's bootstrap
 * pipeline.
 */

import "../styles/themes.css";
import { renderMigrations, type MigrationsViewState } from "./migrations-view";

interface MigrationsBridge {
  get(): Promise<MigrationsViewState>;
  onState(callback: (state: MigrationsViewState) => void): () => void;
  retry(): void;
  quit(): void;
  showJournal(): void;
}

const api = (
  window as unknown as { openp41ge?: { platform?: string; migrations?: MigrationsBridge } }
).openp41ge;
const bridge = api?.migrations;
const mac = api?.platform === "darwin";
const root = document.getElementById("root");
if (!root) throw new Error("migrations: #root not found");
if (!bridge) throw new Error("migrations: preload bridge missing");

const actions = {
  retry: () => bridge.retry(),
  quit: () => bridge.quit(),
  showJournal: () => bridge.showJournal(),
};

function show(state: MigrationsViewState): void {
  renderMigrations(root!, state, actions, { mac });
}

bridge.onState(show);
void bridge.get().then(show);
