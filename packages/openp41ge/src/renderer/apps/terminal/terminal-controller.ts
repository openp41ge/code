/**
 * TerminalController — the `terminal` grid tab: <openp41ge-terminal-view> for
 * the tab's binary and worktree (`{ binary, repo, worktree, runId? }`).
 */

import type { TabController } from "../../controllers/types";
import "../../components/openp41ge-terminal-view";
import { terminalTabKey } from "./target";

type TerminalView = HTMLElement & {
  binary: string;
  repo: string;
  worktree: string;
  runId: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export class TerminalController implements TabController {
  readonly tabId: string;
  readonly appType = "terminal";
  private _container: HTMLElement | null = null;
  private _state = { binary: "", repo: "", worktree: "", runId: "" };

  constructor(tabId: string) {
    this.tabId = tabId;
  }

  mount(container: HTMLElement): void {
    this._container = container;
    const el = document.createElement("openp41ge-terminal-view") as TerminalView;
    Object.assign(el, this._state);
    container.appendChild(el);
  }

  unmount(): void {
    if (this._container) this._container.innerHTML = "";
    this._container = null;
  }

  setVisible(_visible: boolean): void {}

  snapshot(): Record<string, unknown> {
    const { binary, repo, worktree } = this._state;
    return { binary, repo, worktree, path: terminalTabKey(this._state) };
  }

  restore(state: Record<string, unknown>): void {
    this._state = {
      binary: str(state.binary),
      repo: str(state.repo),
      worktree: str(state.worktree),
      runId: str(state.runId),
    };
  }
}
