/**
 * ShellConnector — abstraction for driving a shell process.
 *
 * Implementations bridge xterm.js I/O to whatever backs the shell:
 *   - IpcShellConnector talks to the Electron main process via window.openp41ge.terminal
 *   - Future: NodePtyConnector uses node-pty directly
 *   - Future: WebSocketConnector talks to a remote PTY server
 */

export interface ShellConnector {
  /** Start the shell process. */
  spawn(): void;

  /** Send user input to the shell's stdin. */
  write(data: string): void;

  /** Tell the shell the terminal dimensions changed. */
  resize(cols: number, rows: number): void;

  /** Kill the shell process. */
  kill(): void;

  /** Subscribe to shell output. Returns an unsubscribe function. */
  onOutput(callback: (data: string) => void): () => void;

  /** Subscribe to shell exit. Returns an unsubscribe function. */
  onExit(callback: (code: number | null) => void): () => void;
}
