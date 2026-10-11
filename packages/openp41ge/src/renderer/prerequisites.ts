/**
 * prerequisites.ts — the prerequisites window's renderer entry. Shown instead
 * of the app when something it needs (e.g. Git) is missing; renders the list
 * from the main process and re-checks on request. Self-contained: it does not
 * use the app's bootstrap pipeline.
 */

import "../styles/themes.css";
import { renderPrerequisites, type PrerequisiteRow } from "./prerequisites-view";

interface PrerequisitesBridge {
  get(): Promise<PrerequisiteRow[]>;
  recheck(): Promise<PrerequisiteRow[]>;
  openHelp(id: string): void;
  quit(): void;
}

const api = (
  window as unknown as { openp41ge?: { platform?: string; prerequisites?: PrerequisitesBridge } }
).openp41ge;
const bridge = api?.prerequisites;
const mac = api?.platform === "darwin";
const root = document.getElementById("root");
if (!root) throw new Error("prerequisites: #root not found");
if (!bridge) throw new Error("prerequisites: preload bridge missing");

const actions = {
  recheck: () => void bridge.recheck().then(show),
  quit: () => bridge.quit(),
  openHelp: (id: string) => bridge.openHelp(id),
};

function show(list: PrerequisiteRow[]): void {
  renderPrerequisites(root!, list, actions, { mac });
}

void bridge.get().then(show);
