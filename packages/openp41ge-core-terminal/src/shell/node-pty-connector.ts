/**
 * NodePtyConnector — ShellConnector that spawns a real PTY via node-pty.
 *
 * This connector works in **Node.js or Electron renderer** contexts where
 * the `node-pty` native module is available and accessible (e.g. Electron
 * with `nodeIntegration: true` or via a preload script that exposes it).
 *
 * For testing or custom setups, node-pty can be injected explicitly
 * via the `nodePty` option.
 *
 * Usage (Node.js / Electron with nodeIntegration):
 *   const connector = new NodePtyConnector();
 *   connector.onOutput((data) => terminal.write(data));
 *   connector.spawn();
 *
 * Usage with explicit node-pty injection (for testing / preload):
 *   import nodePty from "node-pty";
 *   const connector = new NodePtyConnector({ nodePty });
 *   connector.spawn();
 */

import type { ShellConnector } from "./shell-connector";

export interface NodePtyConnectorOptions {
  /** Shell executable path (default: $SHELL or /bin/bash). */
  shell?: string;
  /** Shell arguments. */
  args?: string[];
  /** Environment variables (default: process.env with TERM=xterm-256color). */
  env?: Record<string, string | undefined>;
  /** Initial terminal columns (default: 80). */
  cols?: number;
  /** Initial terminal rows (default: 24). */
  rows?: number;
  /** Current working directory (default: process.cwd() or $HOME). */
  cwd?: string;
  /** Name for the terminal (default: "xterm-256color"). */
  name?: string;
  /**
   * The node-pty module to use. If not provided, the connector will
   * attempt to load it via `require("node-pty")` at spawn time.
   * Provide this for testing or when node-pty is exposed via preload.
   */
  nodePty?: { spawn: Function };
}

/** Resolve process.env, returning {} in environments without `process`. */
function resolveProcessEnv(): Record<string, string | undefined> {
  if (typeof process !== "undefined") return process.env;
  return {};
}

/** Resolve a fallback shell path using process.env.SHELL. */
function resolveDefaultShell(): string {
  if (typeof process !== "undefined" && process.env.SHELL) return process.env.SHELL;
  return "/bin/bash";
}

/** Resolve a default cwd (HOME or cwd), or undefined in non-Node environments. */
function resolveDefaultCwd(): string | undefined {
  if (typeof process !== "undefined") return process.env.HOME ?? process.cwd?.();
  return undefined;
}

/** Minimal interface for a node-pty terminal instance. */
interface PtyInstance {
  _exited?: boolean;
  cols: number;
  rows: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (d: { exitCode: number | null }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export class NodePtyConnector implements ShellConnector {
  private _pty: PtyInstance | null = null;
  private _options: NodePtyConnectorOptions;
  private _outputListeners: Set<(data: string) => void> = new Set();
  private _exitListeners: Set<(code: number | null) => void> = new Set();
  private _nodePtyModule: { spawn: Function } | null = null;
  private _resolvedShell: string;
  private _resolvedEnv: Record<string, string | undefined>;
  private _resolvedCwd: string | undefined;

  constructor(options: NodePtyConnectorOptions = {}) {
    this._options = options;
    if (options.nodePty) {
      this._nodePtyModule = options.nodePty;
    }

    // Collapse all process-dependent defaults here so that spawn()
    // has no untestable branches (typeof-process checks).
    this._resolvedShell = options.shell ?? resolveDefaultShell();
    this._resolvedEnv = {
      ...resolveProcessEnv(),
      TERM: "xterm-256color",
      ...options.env,
    };
    this._resolvedCwd = options.cwd ?? resolveDefaultCwd();
  }

  /** The current number of columns. */
  get cols(): number {
    return this._pty?.cols ?? this._options.cols ?? 80;
  }

  /** The current number of rows. */
  get rows(): number {
    return this._pty?.rows ?? this._options.rows ?? 24;
  }

  /** Whether a shell process is currently running. */
  get running(): boolean {
    return this._pty !== null && !this._pty._exited;
  }

  spawn(): void {
    if (this._pty) return; // already spawned

    const pty = this._getNodePty();

    this._pty = pty.spawn(this._resolvedShell, this._options.args ?? [], {
      name: this._options.name ?? "xterm-256color",
      cols: this._options.cols ?? 80,
      rows: this._options.rows ?? 24,
      cwd: this._resolvedCwd,
      env: this._resolvedEnv as { [key: string]: string },
    });

    this._pty!.onData((data: string) => {
      for (const fn of this._outputListeners) fn(data);
    });

    this._pty!.onExit(({ exitCode }: { exitCode: number | null }) => {
      this._pty = null;
      for (const fn of this._exitListeners) fn(exitCode);
    });
  }

  write(data: string): void {
    if (this._pty) {
      this._pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this._pty) {
      this._pty.resize(cols, rows);
    }
  }

  kill(): void {
    if (this._pty) {
      try {
        this._pty.kill();
      } catch {
        // May already be dead
      }
      this._pty = null;
    }
    this._outputListeners.clear();
    this._exitListeners.clear();
  }

  onOutput(callback: (data: string) => void): () => void {
    this._outputListeners.add(callback);
    return () => {
      this._outputListeners.delete(callback);
    };
  }

  onExit(callback: (code: number | null) => void): () => void {
    this._exitListeners.add(callback);
    return () => {
      this._exitListeners.delete(callback);
    };
  }

  private _getNodePty(): { spawn: Function } {
    if (this._nodePtyModule) return this._nodePtyModule;
    throw new Error(
      "NodePtyConnector: node-pty is not available. " +
        "Either install the native module, or pass it explicitly " +
        "via the `nodePty` option for injection.",
    );
  }
}
