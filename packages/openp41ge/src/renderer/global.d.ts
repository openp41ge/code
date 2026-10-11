import type { ActiveExtensionSummary, RepositoryState } from "openp41ge-sdk";
import type { ExtensionConfigBridge } from "./services/extension-configs";

/** Something the repository cleanup kept because it holds work (main
 *  process `CleanupItem`). */
interface CleanupItem {
  readonly kind: "repository" | "workspace";
  readonly path: string;
  readonly name: string;
  readonly repositories: ReadonlyArray<RepositoryState & { readonly stashed: boolean }>;
}

export {};

/** Tabs the Window Manager window can show. */
type WindowManagerTabId = "workspaces" | "settings" | "welcome" | "releases" | "cleanup";

declare global {
  interface Window {
    openp41ge: {
      platform: string;
      isDev: () => boolean;
      /** Absolute app-data root (~/.openp41ge or ~/.openp41ge-dev). */
      dataDir: () => string;
      /** Show a native context menu. Returns the id of the clicked item, or null if dismissed. */
      showContextMenu: (items: Array<{ label: string; id: string }>) => Promise<string | null>;
      window: {
        minimize: () => void;
        maximize: () => void;
        maximizeAnimated: () => void;
        startDrag: () => void;
        dragMove: (x: number, y: number) => void;
        endDrag: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
        openDevTools: () => void;
      };
      windowManager: {
        open: () => void;
        openLogsWindow: () => void;
        openWindowSummaries: () => Promise<Array<{ windowId: string; windowType: "workspace" | "manager" | "logs"; workspacePath: string | null }>>;
        openWorkspaceWindow: (workspacePath: string) => void;
        focusWorkspaceWindow: (workspacePath: string) => Promise<boolean>;
        onOpenWindowsChanged: (callback: () => void) => () => void;
        onActivateTab: (callback: (tab: WindowManagerTabId) => void) => () => void;
        /** Move a management tab from one manager window to another / reorder. */
        moveTab: (sourceWinId: string, targetWinId: string, tabId: string, dropIndex: number) => void;
        /** Open a new management window containing `tab` (drag-out) and remove
         *  it from `sourceWinId`. */
        openWithTab: (
          sourceWinId: string,
          tabId: string,
          dropScreenX?: number,
          dropScreenY?: number,
        ) => void;
        /** Fired on a target window when a tab moves onto it. */
        onReceiveTab: (
          callback: (payload: { tabId: string; index: number }) => void,
        ) => () => void;
        /** Fired on a source window when its tab was moved away. */
        onRemoveTab: (callback: (payload: { tabId: string }) => void) => () => void;
        /** The manager grid's saved tabs (`<app-data>/manager-grid.json`), or null. */
        loadGrid: () => Promise<unknown>;
        /** Save the manager grid's tabs. */
        saveGrid: (grid: unknown) => Promise<void>;
      };
      workspace: {
        getState: () => Promise<string>;
        dispatch: (fn: string, ...args: unknown[]) => void;
        onStateUpdate: (callback: (stateJson: string) => void) => () => void;
        getWindowId: () => string | null;
        getWindowType: () => "workspace" | "manager" | "logs";
        getWorkspacePath: () => string | null;
        getLaunchTab: () => WindowManagerTabId | null;
        waitForInit: () => Promise<void>;
        detachPane: (windowId: string, paneId: string, bounds?: { x: number; y: number; width: number; height: number }) => void;
        detachTab: (
          windowId: string,
          tabId: string,
          bounds?: { x: number; y: number; width: number; height: number },
          dropScreenX?: number,
          dropScreenY?: number,
        ) => void;
        cmdNewWindow: () => void;
        cmdNewPage: () => void;
        cmdNewTab: () => void;
        cmdCloseTab: () => void;
        cmdNewColumn: () => void;
        confirmRemoveTab: (windowId: string, tabId: string) => Promise<boolean>;
        reset: () => void;
        onReset: (callback: () => void) => () => void;
      };
      confirm: {
        show: (options: {
          message: string;
          title?: string;
          detail?: string;
          confirmLabel?: string;
          cancelLabel?: string;
          confirmStyle?: string;
          checkboxLabel?: string;
          checkboxDetail?: string;
        }) => Promise<{ confirmed: boolean; checked: boolean }>;
        onOptions: (callback: (optionsJson: string) => void) => () => void;
        respond: (payload: { confirmId: string; confirmed: boolean; checked: boolean }) => void;
        fitSize: (payload: { confirmId: string; height: number }) => void;
        onMaskShow: (callback: () => void) => () => void;
        onMaskHide: (callback: () => void) => () => void;
      };
      fatal: {
        onError: (callback: (payloadJson: string) => void) => () => void;
        acknowledge: () => void;
      };
      drag: {
        start: (label: string, screenX: number, screenY: number, emoji?: string, tabId?: string, winId?: string, worksetId?: string, tabWidth?: number, tabHeight?: number, offsetX?: number, offsetY?: number, dragType?: string, filePath?: string, captureRect?: { x: number; y: number; width: number; height: number }, inset?: number, openTabData?: { appType?: string; tabConfig?: Record<string, unknown> }, payloadData?: import("openp41ge-sdk-uikit").PayloadDragData) => void;
        move: (screenX: number, screenY: number) => void;
        setOpacity: (opacity: number) => void;
        end: () => void;
        activate: () => void;
        prepareBitmap: (rect: { x: number; y: number; width: number; height: number }) => void;
        ghostForward: (screenX: number, screenY: number) => void;
        check: (screenX: number, screenY: number, dragData?: string) => Promise<{ target: Record<string, unknown> | null; windowId: string } | null>;
        getActive: () => Promise<{
          sourceWinId: string;
          label: string;
          dragData:
            | { tabId: string; winId: string; worksetId: string; type: "tab"; title?: string }
            | { type: "open-tab"; appType: string; title?: string; tabConfig?: Record<string, unknown> }
            | { type: "manager-tab"; tabId: string; winId: string; title?: string }
            | import("openp41ge-sdk-uikit").PayloadDragData;
        } | null>;
        endSession: () => void;
        onEndSession: (callback: () => void) => () => void;
        ghostShow: (targetWinId: string, screenX: number, screenY: number, label: string) => void;
        ghostHide: (targetWinId: string) => void;
        onGhostShow: (callback: (data: { screenX: number; screenY: number; label: string }) => void) => void;
        onGhostHide: (callback: () => void) => void;
        onDragState: (callback: (state: { active: boolean; type: string | null }) => void) => void;
      };

      terminal: {
        spawn: (paneId: string) => void;
        write: (paneId: string, data: string) => void;
        resize: (paneId: string, cols: number, rows: number) => void;
        kill: (paneId: string) => void;
        onData: (paneId: string, callback: (data: string) => void) => () => void;
        onExit: (paneId: string, callback: (code: number | null) => void) => () => void;
      };

      workspaceController: {
        clone: (url: string, workspaceFile?: string) => {
          promise: Promise<{
            success: boolean;
            path?: string;
            error?: string;
            transcript?: { command: string; output: string };
          }>;
          onProgress: (fn: (progress: { percent: number; message: string }) => void) => () => void;
          destroy: () => void;
        };
        listRepos: () => Promise<Array<{ path: string; name: string; url: string }>>;
        getRepo: (name: string) => Promise<{ path: string; name: string; url: string } | null>;
        listWorktrees: (repoName: string) => Promise<Array<{ branch: string; path: string; exists: boolean }>>;
        checkoutWorktree: (repoName: string, branch: string) => Promise<{ branch: string; path: string; exists: boolean }>;
        deleteWorktree: (repoName: string, branch: string) => Promise<void>;
        removeWorktree: (
          repoName: string,
          branch: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        fetch: (repoName: string) => Promise<void>;
        /** Pull latest changes for a branch and update its worktree. */
        pullBranch: (repoName: string, branch: string) => Promise<void>;
        listBranches: (repoName: string) => Promise<string[]>;
        getDefaultBranch: (repoName: string) => Promise<string | null>;
        /** A repository's local branches: uncommitted files and unpushed commits. */
        repositoryState: (
          repoName: string,
          workspaceFile?: string,
        ) => Promise<import("openp41ge-sdk").RepositoryState>;
        /** Delete a clone and its worktrees (the caller has asked the user). */
        deleteRepository: (
          repoName: string,
          workspaceFile?: string,
        ) => Promise<{ ok: boolean; error?: string }>;
        /** Something changed in one of this workspace's repositories; returns unsubscribe. */
        onRepositoryChanged: (callback: (repoName: string) => void) => () => void;
        /** A workspace file's manifest changed on disk (whoever wrote it); returns unsubscribe. */
        onWorkspaceFileChanged: (callback: (change: { path: string }) => void) => () => void;
      };

      dialog: {
        /** Open native file picker for .openp41ge-workspace files. Returns { filePath, data } or null. */
        openWorkspaceFile: () => Promise<{ filePath: string; data: import("../../layout/types").WorkspaceFileData } | null>;

        /** Open native save dialog for .openp41ge-workspace files. Returns path or null. */
        saveWorkspaceFile: (data: import("../../layout/types").WorkspaceFileData, defaultPath?: string) => Promise<string | null>;

        /** Open native folder picker. Returns path or null. */
        pickFolder: () => Promise<string | null>;

        /** Read a .openp41ge-workspace file at a known path (no dialog). */
        readWorkspaceFile: (filePath: string) => Promise<{ filePath: string; data: import("../../layout/types").WorkspaceFileData } | null>;

        /** Write a .openp41ge-workspace file to a known path (no dialog). */
        writeWorkspaceFile: (filePath: string, data: import("../../layout/types").WorkspaceFileData) => Promise<boolean>;

        /** Ensure a directory exists. */
        ensureDir: (dirPath: string) => Promise<boolean>;

        /** Reveal a file/folder in the native file manager (Finder). */
        revealInFinder: (filePath: string) => Promise<boolean>;

        /** List all .openp41ge-workspace files in <dataDir>/workspaces/. */
        listWorkspaces: () => Promise<Array<{ filePath: string; data: import("../../layout/types").WorkspaceFileData }>>;

        /** Delete a workspace file; optionally also remove its data dir when deleteData is true. */
        deleteWorkspaceFile: (filePath: string, deleteData?: boolean) => Promise<boolean>;
      };

      /** Extension host (main-process capabilities). */
      extension: {
        /** Active extensions (id, version, renderer entry). */
        getActive: () => Promise<ActiveExtensionSummary[]>;
        /** Route a component/command event to an extension main handler. */
        dispatch: (commandId: string, payload?: Record<string, unknown>) => Promise<unknown>;
        /** Subscribe to active-extension changes. Returns unsubscribe. */
        onState: (callback: (active: ActiveExtensionSummary[]) => void) => () => void;
        /** Subscribe to backend topic pushes (`{ topic, payload }`). Returns unsubscribe. */
        onEvent: (callback: (evt: { topic: string; payload: unknown }) => void) => () => void;
        /** Extension config (`extension-config:*` IPC). */
        config: ExtensionConfigBridge;
      };

      lifecycle: {
        /** Notify the main process that the renderer's first render completed. */
        notifyReady: () => void;
        /** Subscribe to main-process error reports forwarded for display. */
        onError: (callback: (error: { message: string; source?: string; stack?: string }) => void) => () => void;
      };

      file: {
        readdir: (dirPath: string) => Promise<FileEntry[]>;
        /** Read a directory and its subdirectory listings down to `depth`. */
        readTree: (dirPath: string, depth: number) => Promise<DirSnapshot>;
        /** Subscribe to filesystem changes under the repositories dir. Returns unsubscribe. */
        onTreeChanged: (callback: (data: { path: string }) => void) => () => void;
        stat: (filePath: string) => Promise<FileEntry | null>;
        readRange: (filePath: string, offset: number, length: number) => Promise<{ data: string; totalSize: number }>;
        readChunked: (filePath: string) => {
          promise: Promise<{ data: string; totalSize: number }>;
          onProgress: (fn: (progress: { loaded: number; total: number; chunk: string }) => void) => () => void;
          destroy: () => void;
        };
        search: (query: string, rootPaths: string[]) => Promise<FileSearchResult[]>;
        searchContentsStream: (
          query: string,
          rootPaths: string[],
          options?: { regex?: boolean; caseSensitive?: boolean },
        ) => {
          promise: Promise<{ total: number; cancelled?: boolean }>;
          onChunk: (
            fn: (payload:
              | { type: "chunk"; searchId?: string; entries: ContentMatchIndexEntry[] }
              | { type: "done"; searchId?: string; total: number }) => void,
          ) => () => void;
          destroy: () => void;
        };
        contentMatchesForFile: (
          filePath: string,
          query: string,
          options?: { regex?: boolean; caseSensitive?: boolean },
        ) => Promise<{ matches: FileContentMatch[]; truncated?: boolean }>;
        getScope: () => Promise<string[]>;
        addScope: (dirPath: string) => Promise<boolean>;
        removeScope: (dirPath: string) => Promise<boolean>;
        pickFolder: () => Promise<string | null>;
        listRecent: (rootPaths: string[]) => Promise<{ path: string; name: string; dir: string }[]>;
        gitBranch: (dirPath: string) => Promise<string | null>;
        writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>;
        mkdir: (dirPath: string) => Promise<{ success: boolean; path: string }>;
      };

      /** Persistent log bus → main process (files under <dataDir>/logs). */
      logs: {
        /** Forward a batch of captured log entries to disk. */
        append: (entries: Array<Record<string, unknown>>) => void;
        /** Session debug toggle → also lower the main process capture level. */
        setDebug: (enabled: boolean) => void;
        /** Query persisted log history. Returns [] when none. */
        query: (filter?: LogQueryFilter) => Promise<PersistedLogEntryShape[]>;
        /** Get the logs directory path. */
        getPath: () => Promise<{
          logsDir: string;
          /** Which log features the main process supports (absent on stale mains). */
          capabilities?: { readBackward?: boolean };
        }>;
        /** List log files (name, size, mtime). */
        listFiles: () => Promise<Array<{ name: string; sizeBytes: number; mtimeMs: number }>>;
        /** Read log entries backward from the bottom of the newest daily file. */
        readBackward: (
          cursor: LogBackCursorShape | null,
          limit?: number,
        ) => Promise<LogBackPageShape>;
      };

      onZoomIn: (callback: () => void) => () => void;
      onZoomOut: (callback: () => void) => () => void;
      onZoomReset: (callback: () => void) => () => void;

      config: {
        get: (key?: string) => Promise<any>;
        set: (key: string, value: any) => Promise<void>;
        getAll: () => Promise<Record<string, any>>;
        getDefaults: () => Promise<Record<string, any>>;
        getOverrides: () => Promise<Record<string, any>>;
        /** Subscribe to config changes made in ANY window. Returns unsubscribe. */
        onChanged: (callback: (change: { key: string; value: any }) => void) => () => void;
      };

      /** Auto-update status + control (backed by the main-process AutoUpdaterService). */
      updater: {
        /** Current auto-update status snapshot. */
        getStatus: () => Promise<UpdaterStatus>;
        /** The installed app version (e.g. "0.1.0"). */
        getCurrentVersion: () => Promise<string>;
        /** Trigger an update check now. */
        check: () => Promise<UpdaterStatus>;
        /** Stage (download) the update the last check resolved. Resolves when done. */
        download: () => Promise<UpdaterStatus>;
        /** Download-and-install the staged update, then restart. */
        quitAndInstall: () => Promise<void>;
        /** Subscribe to auto-update status changes. Returns unsubscribe. */
        onStatus: (callback: (status: UpdaterStatus) => void) => () => void;
      };

      /** Welcome intro dismissal — backed by a marker file in the app-data dir. */
      welcome: {
        isDismissed: () => Promise<boolean>;
        setDismissed: (dismissed: boolean) => Promise<boolean>;
      };

      /** What the data migrations did (manager window's Migrations tab). */
      dataMigrations: {
        status: () => Promise<{
          appVersion: string;
          dataVersion?: string;
          applied: ReadonlyArray<{ id: string; description?: string; at: string; done: string[] }>;
          failed?: { id: string; at: string; error: string };
        }>;
      };

      /** The repository cleanup (manager window's Cleanup tab). */
      cleanup: {
        list: () => Promise<CleanupItem[]>;
        run: () => Promise<CleanupItem[]>;
        delete: (folder: string) => Promise<{ ok: boolean; error?: string }>;
        reveal: (folder: string) => Promise<boolean>;
        onChanged: (callback: () => void) => () => void;
      };

    };

    // @deprecated — no longer consumed by FileEditorController. The file path is now
    // passed through tab.config.filePath via restore() before mount().
    __pendingFilePath?: string | null;
    // @deprecated — no longer consumed. Kept for migration compat.
    __pendingFileName?: string;

    __openp41geReady?: boolean;
  }

  interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: number;
  }

  /** A directory listing expanded to a fixed depth (see \`file:readTree\`). */
  interface DirSnapshot {
    path: string;
    entries: FileEntry[];
    children: DirSnapshot[];
  }

  interface FileSearchResult {
    path: string;
    name: string;
    dir: string;
  }

  /** One content match instance inside a file. */
  interface FileContentMatch {
    lineNumber: number;
    column: number;
    startIndex: number;
    endIndex: number;
    lineText: string;
  }

  /**
   * A file with content matches, as reported by the streaming search walk:
   * enough to render the row, its badge and its ancestor chain, without the
   * match lines (fetched per file via `contentMatchesForFile`).
   */
  interface ContentMatchIndexEntry {
    path: string;
    name: string;
    dir: string;
    count: number;
    /** True when the file has more matches than the per-file cap. */
    truncated?: boolean;
  }

  /** Auto-update status reported by the main process (channel from Settings). */
  type UpdaterStatus =
    | { state: "idle"; channel: string }
    | { state: "checking"; channel: string }
    | { state: "update-available"; version: string }
    | { state: "update-not-available"; version: string }
    | { state: "downloading"; version: string; progress: number; bytesPerSecond: number; transferred: number; total: number }
    | { state: "update-downloaded"; version: string }
    | { state: "error"; message: string };

  /** Filters for window.openp41ge.logs.query(). */
  interface LogQueryFilter {
    source?: string | string[];
    minLevel?: number;
    maxLevel?: number;
    since?: number;
    before?: number;
    limit?: number;
    search?: string;
    process?: "main" | "renderer";
    winId?: string;
  }

  /** A persisted log entry returned by window.openp41ge.logs.query(). */
  interface PersistedLogEntryShape {
    timestamp: number;
    level: number;
    levelLabel: string;
    system: string;
    source: string;
    message: string;
    data?: Record<string, unknown>;
    process: "main" | "renderer";
    winId?: string;
  }

  /** Backward-paging cursor for window.openp41ge.logs.readBackward(). */
  interface LogBackCursorShape {
    fileIndex: number;
    lineCount: number;
  }

  interface LogBackPageShape {
    entries: PersistedLogEntryShape[];
    hasOlder: boolean;
    cursor: LogBackCursorShape | null;
    /** When hasOlder is false, an older day available only after explicit
     * confirmation (the viewer renders a "Load yesterday's logs" row). */
    nextDay?: { cursor: LogBackCursorShape; label: string } | null;
    /** Monotonic longest rendered line (chars); anchors the viewer's stable
     * horizontal content width. */
    maxLineChars?: number;
  }
}
