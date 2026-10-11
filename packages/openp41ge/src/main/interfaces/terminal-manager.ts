/**
 * Terminal process management.
 *
 * Spawns and manages shell processes for terminal panes.
 * Each pane gets one shell process identified by paneId.
 */

export interface TerminalOutput {
  paneId: string;
  data: string;
}

export interface TerminalExitInfo {
  paneId: string;
  code: number | null;
}

export interface ITerminalManager {
  /** Spawn a shell for a given pane ID. No-op if already running. */
  spawn(paneId: string): void;

  /** Write data to the terminal's stdin. */
  write(paneId: string, data: string): void;

  /** Send resize signal to the terminal. */
  resize(paneId: string, cols: number, rows: number): void;

  /** Kill the terminal for a given pane ID. */
  kill(paneId: string): void;

  /** Kill terminal associated with a pane (from workspace cleanup). */
  killByPaneId(paneId: string): void;

  /** Register a callback for terminal output events. */
  onData(callback: (output: TerminalOutput) => void): () => void;

  /** Register a callback for terminal exit events. */
  onExit(callback: (info: TerminalExitInfo) => void): () => void;

  /** Clean up all terminals and listeners. */
  dispose(): void;
}
