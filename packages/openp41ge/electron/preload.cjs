const { contextBridge, ipcRenderer } = require("electron");

let _windowId = null;
let _isDev = false;
let _workspacePath = null;
let _dataDir = null;
let _launchLogs = null;
let _initResolve = null;
/** Promise that resolves once openp41ge:init IPC message is received. */
const _initPromise = new Promise((resolve) => {
  _initResolve = resolve;
});

// Listen for the init message from the main process
ipcRenderer.on("openp41ge:init", (_event, data) => {
  _windowId = data.windowId;
  _isDev = !!data.isDev;
  _workspacePath = data.workspacePath ?? null;
  _dataDir = data.dataDir ?? null;
  _launchLogs = data.launchLogs ?? null;
  // Store initial workspace state for the renderer to pick up
  _initialState = data.workspace;
  if (_initResolve) {
    _initResolve();
    _initResolve = null;
  }
});

let _initialState = null;

// ── Native context menu handler ────────────────────────────────────────

let _contextMenuResolve = null;
ipcRenderer.on("native:contextMenuAction", (_event, id) => {
  if (_contextMenuResolve) {
    _contextMenuResolve(id);
    _contextMenuResolve = null;
  }
});

contextBridge.exposeInMainWorld("openp41ge", {
  platform: process.platform,
  isDev: () => _isDev,
  /** Absolute app-data root (~/.openp41ge-code or ~/.openp41ge-code-dev). */
  dataDir: () => _dataDir,

  /** Show a native context menu. Returns the id of the clicked item, or null if dismissed. */
  showContextMenu: (items) => {
    return new Promise((resolve) => {
      _contextMenuResolve = resolve;
      ipcRenderer.invoke("native:showContextMenu", items).catch(() => {
        _contextMenuResolve = null;
        resolve(null);
      });
    });
  },

  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    /** Animated grow-to-fit used by the custom title-bar double-click. */
    maximizeAnimated: () => ipcRenderer.send("window:maximize-animated"),
    /** Custom titlebar drag: animate a real window move over IPC. */
    startDrag: () => ipcRenderer.send("window:start-drag"),
    dragMove: (x, y) => ipcRenderer.send("window:drag-move", x, y),
    endDrag: () => ipcRenderer.send("window:end-drag"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    getBounds: () => ipcRenderer.invoke("window:getBounds"),
    openDevTools: () => ipcRenderer.send("window:open-dev-tools"),
  },

  workspace: {
    /** Reset the renderer state to fresh-start condition (for tests). */
    reset: () => ipcRenderer.send("workspace:reset"),
    /** Register callback for when the main process confirms reset. */
    onReset: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("workspace:do-reset", handler);
      return () => ipcRenderer.removeListener("workspace:do-reset", handler);
    },
    /** Get the full workspace state (JSON string). */
    getState: () => {
      // Return initial state if available, otherwise request fresh
      if (_initialState) {
        const s = _initialState;
        _initialState = null;
        return Promise.resolve(s);
      }
      return ipcRenderer.invoke("openp41ge:get-state");
    },

    /** Dispatch an action to the main process. */
    dispatch: (fn, ...args) => {
      ipcRenderer.send("openp41ge:dispatch", JSON.stringify({ fn, args }));
    },

    /** Subscribe to workspace state changes. Returns unsubscribe function. */
    onStateUpdate: (callback) => {
      const handler = (_event, serialized) => callback(serialized);
      ipcRenderer.on("openp41ge:state-update", handler);
      return () => ipcRenderer.removeListener("openp41ge:state-update", handler);
    },

    /** Get this window's Openp41ge window ID. */
    getWindowId: () => _windowId,

    /** Get the `.openp41ge-workspace` path this window is bound to (or null). */
    getWorkspacePath: () => _workspacePath,

    /** Logs to open once loaded (`{ errorId? }`; a window opened for them), or null. */
    getLaunchLogs: () => _launchLogs,

    /**
     * Wait for the openp41ge:init IPC message (which sets windowId and initial state).
     * Returns once the init message has been received.
     *
     * Needed because did-finish-load (where init is sent) fires AFTER deferred
     * module scripts execute. The renderer bootstrap must await this before
     * resolving its window ID, otherwise ws.windows[0].id is used as fallback
     * and the wrong window data is rendered.
     */
    waitForInit: () => _initPromise,

    /** Request creation of a new child window with a detached pane. */
    detachPane: (windowId, paneId, bounds) => {
      ipcRenderer.send(
        "openp41ge:create-window",
        JSON.stringify({
          type: "pane",
          windowId,
          paneId,
          bounds,
        }),
      );
    },
    /** Move a grid tab to another window (a cross-window drop). Across
     *  workspaces only `workspaceFreeAppTypes` move; resolves "moved" or
     *  "refused". */
    moveTabToWindow: (move, workspaceFreeAppTypes) =>
      ipcRenderer.invoke("tab:move-to-window", move, workspaceFreeAppTypes),
    /** Request creation of a new child window with a detached tab. */
    detachTab: (windowId, tabId, bounds, dropScreenX, dropScreenY) => {
      ipcRenderer.send(
        "openp41ge:create-window",
        JSON.stringify({
          type: "tab",
          windowId,
          tabId,
          bounds,
          dropScreenX,
          dropScreenY,
        }),
      );
    },

    /** Cmd+N — create a new window */
    cmdNewWindow: () => ipcRenderer.send("openp41ge:new-window"),

    /** Cmd+T — create a new tab */
    cmdNewTab: () => ipcRenderer.send("openp41ge:new-tab"),

    /** Cmd+W — close the current tab */
    cmdCloseTab: () => ipcRenderer.send("openp41ge:close-tab"),

    /** Cmd+P — add a new pane (and column if needed) */
    cmdNewColumn: () => ipcRenderer.send("openp41ge:add-column"),

    /** Close a tab with confirmation if it has panes */
    confirmRemoveTab: (windowId, tabId) => {
      return ipcRenderer.invoke(
        "openp41ge:confirm-remove-tab",
        JSON.stringify({ windowId, tabId }),
      );
    },

    reset: () => ipcRenderer.send("workspace:reset"),
  },

  /** Native confirm dialog window bridge. */
  confirm: {
    /** Show a confirmation centred over the launching window. */
    show: (options) => {
      return ipcRenderer.invoke("confirm:show", options);
    },
    /** Receive the confirm options (confirm window). Returns unsubscribe. */
    onOptions: (callback) => {
      const handler = (_event, optionsJson) => callback(optionsJson);
      ipcRenderer.on("confirm:show-options", handler);
      return () => ipcRenderer.removeListener("confirm:show-options", handler);
    },
    /** Respond with the user's answer (confirm window). */
    respond: (payload) => {
      ipcRenderer.send("confirm:result", payload);
    },
    /** Report the confirm window's content height so it can be sized/centred. */
    fitSize: (payload) => {
      ipcRenderer.send("confirm:fitsize", payload);
    },
    /** Show the dim mask on the launching window. */
    onMaskShow: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("confirm:mask-show", handler);
      return () => ipcRenderer.removeListener("confirm:mask-show", handler);
    },
    /** Hide the dim mask on the launching window. */
    onMaskHide: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("confirm:mask-hide", handler);
      return () => ipcRenderer.removeListener("confirm:mask-hide", handler);
    },
  },

  /** Prerequisites window bridge (shown instead of the app when something it
   *  needs, e.g. Git, is missing). */
  prerequisites: {
    /** The prerequisites, each marked met or missing. */
    get: () => ipcRenderer.invoke("prerequisites:get"),
    /** Re-run the checks; the app starts once everything is met. */
    recheck: () => ipcRenderer.invoke("prerequisites:recheck"),
    /** Open the help page of a missing prerequisite (by id). */
    openHelp: (id) => ipcRenderer.send("prerequisites:open-help", id),
    /** Quit the app. */
    quit: () => ipcRenderer.send("prerequisites:quit"),
  },

  /** What the data migrations did (the Migrations tab). */
  dataMigrations: {
    /** The app's version, the data version, and the journal. */
    status: () => ipcRenderer.invoke("data-migrations:status"),
  },

  /** Migration window bridge (shown at startup while data updates run). */
  migrations: {
    /** The current state: the phase, and how many updates are done of how many. */
    get: () => ipcRenderer.invoke("migrations:get"),
    /** Every change to the state. Returns unsubscribe. */
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("migrations:state", handler);
      return () => ipcRenderer.removeListener("migrations:state", handler);
    },
    /** Download or check again (offline, a failed check). */
    retry: () => ipcRenderer.send("migrations:retry"),
    /** Quit the app. */
    quit: () => ipcRenderer.send("migrations:quit"),
    /** Open the app's releases on GitHub (after a failed update). */
    download: () => ipcRenderer.send("migrations:download"),
    /** Fit the window to the page's height (after each render). */
    resize: (height) => ipcRenderer.send("migrations:size", height),
  },

  /** Fatal error window bridge (main-process system-level fatal errors). */
  fatal: {
    /** Receive the fatal error payload (fatal window). Returns unsubscribe. */
    onError: (callback) => {
      const handler = (_event, payloadJson) => callback(payloadJson);
      ipcRenderer.on("fatal:show", handler);
      return () => ipcRenderer.removeListener("fatal:show", handler);
    },
    /** Acknowledge the fatal error (user clicked Quit / window closed). */
    acknowledge: () => {
      ipcRenderer.send("fatal:ack");
    },
  },

  windowManager: {
    /** Open logs (a Logs tab in this window's grid); with `{ errorId }`,
     *  open that error's log entry. */
    openLogs: (target) => {
      ipcRenderer.send("logs:open", target ?? null);
    },
    /** Replace the workspace this window shows (null: none). The window
     *  reloads as a window of that workspace; resolves false when nothing
     *  changed. */
    switchWorkspace: (workspacePath) =>
      ipcRenderer.invoke("window:switch-workspace", workspacePath),
    /** Fired when this window is asked to open logs in its grid (the error
     *  to reveal, or null). */
    onOpenLogsInWindow: (callback) => {
      const handler = (_event, errorId) => callback(errorId ?? null);
      ipcRenderer.on("logs:open-in-window", handler);
      return () => ipcRenderer.removeListener("logs:open-in-window", handler);
    },
    /** List currently open windows (id, workspace). */
    openWindowSummaries: () => {
      return ipcRenderer.invoke("window-manager:open-window-summaries");
    },
    /** Open a window of the workspace `workspacePath`. */
    openWorkspaceWindow: (workspacePath) => {
      ipcRenderer.send("window-manager:open-workspace-window", workspacePath);
    },
    /** Focus the first live window of `workspacePath` (if any). */
    focusWorkspaceWindow: (workspacePath) => {
      return ipcRenderer.invoke("window-manager:focus-workspace-window", workspacePath);
    },
  },

  drag: {
    start: (
      label,
      screenX,
      screenY,
      emoji,
      tabId,
      winId,
      worksetId,
      tabWidth,
      tabHeight,
      offsetX,
      offsetY,
      dragType,
      filePath,
      captureRect,
      inset,
      payloadData,
    ) => {
      ipcRenderer.send(
        "openp41ge:drag-start",
        JSON.stringify({
          label,
          screenX,
          screenY,
          emoji,
          tabId,
          winId,
          worksetId,
          tabWidth,
          tabHeight,
          offsetX,
          offsetY,
          dragType,
          filePath,
          captureRect,
          inset,
          payloadData,
        }),
      );
    },
    move: (screenX, screenY) => {
      ipcRenderer.send("openp41ge:drag-move", JSON.stringify({ screenX, screenY }));
    },
    /** Fade the ghost content (0–1) so the drop indicator under the cursor shows
     *  through while hovering a tab bar. Animates quickly. */
    setOpacity: (opacity) => {
      ipcRenderer.send("openp41ge:drag-opacity", opacity);
    },
    end: () => {
      ipcRenderer.send("openp41ge:drag-end");
    },
    /**
     * Called when the drag threshold is met (actual drag starts, not just mousedown).
     * Broadcasts drag-active state to other windows.
     */
    activate: () => {
      ipcRenderer.send("openp41ge:drag-activate");
    },
    /** Forward cursor position from source window to all others for ghost preview. */
    ghostForward: (screenX, screenY) => {
      ipcRenderer.send("openp41ge:drag-ghost-forward", JSON.stringify({ screenX, screenY }));
    },
    check: (screenX, screenY, dragData) => {
      return ipcRenderer.invoke(
        "openp41ge:drag-check",
        JSON.stringify({ screenX, screenY, dragData }),
      );
    },

    /** Query the main process for the current active drag session (cross-window). */
    getActive: () => {
      return ipcRenderer.invoke("openp41ge:drag-get-active");
    },

    /** End the current drag session and clean up the source window (cross-window). */
    endSession: () => {
      ipcRenderer.send("openp41ge:drag-end-session");
    },

    /** Register callback for when source window tells us to end the drag session. */
    onEndSession: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("openp41ge:drag-end-session", handler);
      return () => ipcRenderer.removeListener("openp41ge:drag-end-session", handler);
    },

    /** Send ghost preview data to another window for rendering. */
    ghostShow: (targetWinId, screenX, screenY, label) => {
      ipcRenderer.send(
        "openp41ge:drag-ghost-show",
        JSON.stringify({ targetWinId, screenX, screenY, label }),
      );
    },
    /** Hide ghost in another window. */
    ghostHide: (targetWinId) => {
      ipcRenderer.send("openp41ge:drag-ghost-hide", JSON.stringify({ targetWinId }));
    },
    /** Register callback for when another window sends us ghost data. */
    onGhostShow: (callback) => {
      const handler = (_event, data) => callback(JSON.parse(data));
      ipcRenderer.on("openp41ge:drag-ghost", handler);
    },
    /** Register callback for when another window hides its ghost. */
    onGhostHide: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("openp41ge:drag-ghost-hide", handler);
    },

    /**
     * Register callback for drag-state changes broadcast by the main process.
     * Called with { active } — plus the drag source type when a drag starts in
     * another window, so a target window can skip previewing (e.g. sidebar tabs
     * must not light up a central grid).
     */
    onDragState: (callback) => {
      const handler = (_event, data) => {
        try {
          const p = JSON.parse(data);
          callback({ active: !!p.active, type: typeof p.type === "string" ? p.type : null });
        } catch {
          callback({ active: !!data, type: null });
        }
      };
      ipcRenderer.on("openp41ge:drag-state", handler);
    },
  },

  terminal: {
    /** Spawn a shell for the given pane ID. */
    spawn: (paneId) => {
      ipcRenderer.send("terminal:spawn", paneId);
    },

    /** Write data to the shell's stdin. */
    write: (paneId, data) => {
      ipcRenderer.send("terminal:write", JSON.stringify({ paneId, data }));
    },

    /** Resize the terminal (cols, rows). */
    resize: (paneId, cols, rows) => {
      ipcRenderer.send("terminal:resize", JSON.stringify({ paneId, cols, rows }));
    },

    /** Kill the shell process for the given pane ID. */
    kill: (paneId) => {
      ipcRenderer.send("terminal:kill", paneId);
    },

    /** Subscribe to shell output for a specific pane. Returns unsubscribe. */
    onData: (paneId, callback) => {
      const handler = (_event, payload) => {
        const parsed = JSON.parse(payload);
        if (parsed.paneId === paneId) callback(parsed.data);
      };
      ipcRenderer.on("terminal:data", handler);
      return () => ipcRenderer.removeListener("terminal:data", handler);
    },

    /** Subscribe to shell exit for a specific pane. Returns unsubscribe. */
    onExit: (paneId, callback) => {
      const handler = (_event, payload) => {
        const parsed = JSON.parse(payload);
        if (parsed.paneId === paneId) callback(parsed.code);
      };
      ipcRenderer.on("terminal:exit", handler);
      return () => ipcRenderer.removeListener("terminal:exit", handler);
    },
  },

  workspaceController: {
    clone: (url, workspaceFile) => {
      const handlers = new Set();
      const cloneId = `c${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      // The progress channel is shared by every clone in flight: take only
      // this clone's.
      const progressHandler = (_event, data) => {
        if (data?.cloneId !== cloneId) return;
        const { cloneId: _id, ...progress } = data;
        for (const h of handlers) h(progress);
      };
      const destroy = () => {
        ipcRenderer.removeListener("workspace:clone-progress", progressHandler);
        handlers.clear();
      };
      ipcRenderer.on("workspace:clone-progress", progressHandler);
      // The progress listener lives as long as the clone (or until destroy).
      const promise = ipcRenderer.invoke("workspace:clone", url, workspaceFile, cloneId);
      promise.then(destroy, destroy);
      return {
        promise,
        onProgress: (fn) => {
          handlers.add(fn);
          return () => handlers.delete(fn);
        },
        destroy,
      };
    },
    listRepos: () => ipcRenderer.invoke("workspace:listRepos"),
    getRepo: (name) => ipcRenderer.invoke("workspace:getRepo", name),
    listWorktrees: (repoName) => ipcRenderer.invoke("workspace:listWorktrees", repoName),
    checkoutWorktree: (repoName, branch) =>
      ipcRenderer.invoke("workspace:checkoutWorktree", repoName, branch),
    deleteWorktree: (repoName, branch) =>
      ipcRenderer.invoke("workspace:deleteWorktree", repoName, branch),
    /** `git worktree remove`, never forced: { ok, error? } (git's refusal). */
    removeWorktree: (repoName, branch) =>
      ipcRenderer.invoke("workspace:removeWorktree", repoName, branch),
    fetch: (repoName) => ipcRenderer.invoke("workspace:fetch", repoName),
    pullBranch: (repoName, branch) => ipcRenderer.invoke("workspace:pullBranch", repoName, branch),
    listBranches: (repoName) => ipcRenderer.invoke("workspace:listBranches", repoName),
    getDefaultBranch: (repoName) => ipcRenderer.invoke("workspace:getDefaultBranch", repoName),
    /** A repository's local branches: uncommitted files and unpushed commits. */
    repositoryState: (repoName, workspaceFile) =>
      ipcRenderer.invoke("workspace:repositoryState", repoName, workspaceFile),
    /** Delete a clone and its worktrees (the caller has asked the user): { ok, error? }. */
    deleteRepository: (repoName, workspaceFile) =>
      ipcRenderer.invoke("workspace:deleteRepository", repoName, workspaceFile),
    /** Something changed in one of this workspace's repositories (files, refs).
     *  Calls back with its name. Returns unsubscribe. */
    /** A workspace file's manifest changed on disk (whoever wrote it). Calls
     *  back with `{ path }`. Returns unsubscribe. */
    onWorkspaceFileChanged: (callback) => {
      const handler = (_event, change) => callback(change);
      ipcRenderer.on("workspace-files:changed", handler);
      return () => ipcRenderer.removeListener("workspace-files:changed", handler);
    },
    onRepositoryChanged: (callback) => {
      const handler = (_event, repoName) => callback(repoName);
      ipcRenderer.on("workspace:repository-changed", handler);
      return () => ipcRenderer.removeListener("workspace:repository-changed", handler);
    },
  },

  file: {
    /** List entries in a directory. Returns FileEntry[]. */
    readdir: (dirPath) => ipcRenderer.invoke("file:readdir", dirPath),

    /**
     * List a directory and its subdirectory listings down to `depth` levels.
     * Returns a DirSnapshot so the next levels can be opened without a round trip.
     */
    readTree: (dirPath, depth) => ipcRenderer.invoke("file:readTree", dirPath, depth),

    /**
     * Subscribe to filesystem changes under the repositories dir reported by
     * the main process watcher. Returns unsubscribe. Payload: { path }.
     */
    onTreeChanged: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("file:tree-changed", handler);
      return () => ipcRenderer.removeListener("file:tree-changed", handler);
    },

    /** Stat a file or directory. Returns FileEntry | null. */
    stat: (filePath) => ipcRenderer.invoke("file:stat", filePath),

    /** Read a range of bytes from a file (for virtualized viewing). */
    readRange: (filePath, offset, length) =>
      ipcRenderer.invoke("file:readRange", filePath, offset, length),

    /**
     * Read a file in chunks, receiving progress events as each chunk arrives.
     * Returns an object with:
     *   promise  – resolves to { data, totalSize } when the full file is read
     *   onProgress – subscribe to { loaded, total, chunk } callbacks, returns unsubscribe
     *   destroy  – removes all listeners and cancels
     */
    readChunked: (filePath) => {
      const handlers = new Set();
      const progressHandler = (_event, data) => {
        for (const h of handlers) h(data);
      };
      ipcRenderer.on("file:chunkProgress", progressHandler);
      const promise = ipcRenderer.invoke("file:startChunkedRead", filePath);
      return {
        promise,
        onProgress: (fn) => {
          handlers.add(fn);
          return () => handlers.delete(fn);
        },
        destroy: () => {
          ipcRenderer.removeListener("file:chunkProgress", progressHandler);
          handlers.clear();
        },
      };
    },

    /** Write content to a file. Returns { success: boolean }. */
    writeFile: (filePath, content) => ipcRenderer.invoke("file:writeFile", filePath, content),

    /** Create a directory (recursively). Returns { success: boolean, path }. */
    mkdir: (dirPath) => ipcRenderer.invoke("file:mkdir", dirPath),

    /** Search for files matching a query within the given root paths. */
    search: (query, rootPaths) => ipcRenderer.invoke("file:search", query, rootPaths),

    /**
     * Match lines for a single file — the on-demand half of the streaming
     * search (the walk streams counts only).
     */
    contentMatchesForFile: (filePath, query, options) =>
      ipcRenderer.invoke("file:contentMatchesForFile", filePath, query, options),

    /**
     * Streaming CONTENT search INDEX. Returns an object with:
     *   promise  - resolves to { total, cancelled } when the walk is complete
     *   onChunk  - subscribe to { type: 'chunk', entries } / { type: 'done', total },
     *              returns unsubscribe fn. `entries` are batches of
     *              { path, name, dir, count } — match lines are fetched
     *              separately with contentMatchesForFile.
     *   destroy  - cancels the walk in the main process AND removes the listener.
     *              Call this to stop a superseded search (prevents partial
     *              keystrokes from piling up full un-cancellable walks).
     */
    searchContentsStream: (query, rootPaths, options) => {
      const handlers = new Set();
      const searchId = `s${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      let destroyed = false;
      // The chunk channel is shared by every in-flight search, so drop any
      // payload that belongs to a different (typically superseded) walk —
      // otherwise a stale search's results leak into the current one.
      const chunkHandler = (_event, payload) => {
        if (destroyed) return;
        if (payload && payload.searchId && payload.searchId !== searchId) return;
        for (const h of handlers) h(payload);
      };
      ipcRenderer.on("file:searchContentsChunk", chunkHandler);
      const invocation = ipcRenderer.invoke(
        "file:searchContentsStream",
        query,
        rootPaths,
        options,
        searchId,
      );
      // Always detach the listener once the walk ends, so rapid typing cannot
      // accumulate listeners on the shared channel.
      invocation
        .catch(() => undefined)
        .finally(() => ipcRenderer.removeListener("file:searchContentsChunk", chunkHandler));
      return {
        promise: invocation,
        onChunk: (fn) => {
          handlers.add(fn);
          return () => handlers.delete(fn);
        },
        // Stops delivery in the renderer immediately and asks the main process
        // to abandon the walk. Safe to call more than once.
        destroy: () => {
          if (destroyed) return;
          destroyed = true;
          ipcRenderer.send("file:cancelContentSearch", searchId);
          ipcRenderer.removeListener("file:searchContentsChunk", chunkHandler);
          handlers.clear();
        },
      };
    },

    /** Get current scoped folder paths. */
    getScope: () => ipcRenderer.invoke("file:getScope"),

    /** List recent files from scoped folders, sorted by preference then mtime. */
    listRecent: (rootPaths) => ipcRenderer.invoke("file:listRecent", rootPaths),

    /** Add a folder to workspace scope. Returns boolean success. */
    addScope: (dirPath) => ipcRenderer.invoke("file:addScope", dirPath),

    /** Remove a folder from workspace scope. Returns boolean success. */
    removeScope: (dirPath) => ipcRenderer.invoke("file:removeScope", dirPath),

    /** Open native folder picker. Returns path or null. */
    pickFolder: () => ipcRenderer.invoke("file:pickFolder"),
    gitBranch: (dirPath) => ipcRenderer.invoke("file:gitBranch", dirPath),
  },

  /** Listen for zoom IPC from main process (triggered by menu bar). */
  onZoomIn: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("zoom:in", handler);
    return () => ipcRenderer.removeListener("zoom:in", handler);
  },
  onZoomOut: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("zoom:out", handler);
    return () => ipcRenderer.removeListener("zoom:out", handler);
  },
  onZoomReset: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("zoom:reset", handler);
    return () => ipcRenderer.removeListener("zoom:reset", handler);
  },

  /** Persistent log bus → main process (files under <dataDir>/logs). */
  logs: {
    /** Forward a batch of captured log entries to disk. */
    append: (entries) => ipcRenderer.send("log:append", entries),
    /** Session debug toggle → also lower the main process capture level. */
    setDebug: (enabled) => ipcRenderer.send("log:set-debug", !!enabled),
    /** Query persisted log history. Returns [] when none. */
    query: (filter) => ipcRenderer.invoke("log:query", filter || {}),
    /** Get the logs directory path. */
    getPath: () => ipcRenderer.invoke("log:path"),
    /** List log files (name, size, mtime). */
    listFiles: () => ipcRenderer.invoke("log:files"),
    /** Read log entries backward from the bottom of the newest daily file. */
    readBackward: (cursor, limit) => ipcRenderer.invoke("log:read-backward", { cursor, limit }),
    /** The persisted entry with this errorId, or null. */
    findError: (errorId) => ipcRenderer.invoke("log:find-error", errorId),
  },

  lifecycle: {
    /** Notify the main process that the renderer's first render is complete. */
    notifyReady: () => ipcRenderer.send("lifecycle:renderer-ready"),

    /** Subscribe to main-process error reports forwarded for display. */
    onError: (callback) => {
      const handler = (_event, data) => {
        try {
          callback(JSON.parse(data));
        } catch {
          callback({ message: data });
        }
      };
      ipcRenderer.on("openp41ge:error", handler);
      return () => ipcRenderer.removeListener("openp41ge:error", handler);
    },
  },

  config: {
    get: (key) => ipcRenderer.invoke("config:get", key),
    set: (key, value) => ipcRenderer.invoke("config:set", key, value),
    getAll: () => ipcRenderer.invoke("config:get-all"),
    getDefaults: () => ipcRenderer.invoke("config:get-defaults"),
    getOverrides: () => ipcRenderer.invoke("config:get-overrides"),
    /** Subscribe to config changes made in ANY window. Returns unsubscribe. */
    onChanged: (callback) => {
      const handler = (_event, data) => {
        try {
          callback(JSON.parse(data));
        } catch {
          // ignore malformed payloads
        }
      };
      ipcRenderer.on("config:changed", handler);
      return () => ipcRenderer.removeListener("config:changed", handler);
    },
  },

  updater: {
    /** Query the current auto-update status. */
    getStatus: () => ipcRenderer.invoke("updater:get-status"),
    /** The installed app version (e.g. "0.1.0"). */
    getCurrentVersion: () => ipcRenderer.invoke("updater:get-current-version"),
    /** Trigger an update check now. Returns the status after the check. */
    check: () => ipcRenderer.invoke("updater:check"),
    /** Stage (download) the update the last check resolved. Resolves when done. */
    download: () => ipcRenderer.invoke("updater:download"),
    /** Install the staged update and restart (only valid when an update is downloaded). */
    quitAndInstall: () => ipcRenderer.invoke("updater:quit-and-install"),
    /** Subscribe to auto-update status changes. Returns unsubscribe. */
    onStatus: (callback) => {
      const handler = (_event, data) => callback(JSON.parse(data));
      ipcRenderer.on("updater:status", handler);
      return () => ipcRenderer.removeListener("updater:status", handler);
    },
  },

  /** Which releases exist (checked in the background; never downloads). */
  releases: {
    /** The list, when it was fetched, and whether a check is running. */
    get: () => ipcRenderer.invoke("releases:get"),
    /** Check now. Resolves with the list after the check. */
    refresh: () => ipcRenderer.invoke("releases:refresh"),
    /** Subscribe to list changes. Returns unsubscribe. */
    onChange: (callback) => {
      const handler = (_event, data) => callback(JSON.parse(data));
      ipcRenderer.on("releases:changed", handler);
      return () => ipcRenderer.removeListener("releases:changed", handler);
    },
  },

  /** The repository cleanup (the Cleanup tab): what it kept. */
  cleanup: {
    list: () => ipcRenderer.invoke("cleanup:list"),
    /** Run the cleanup now; resolves with what it kept. */
    run: () => ipcRenderer.invoke("cleanup:run"),
    /** Delete a listed item's folder (the caller has asked the user). */
    delete: (folder) => ipcRenderer.invoke("cleanup:delete", folder),
    /** Show a listed item's folder in Finder / the file manager. */
    reveal: (folder) => ipcRenderer.invoke("cleanup:reveal", folder),
    /** The list changed. Returns unsubscribe. */
    onChanged: (callback) => {
      const handler = () => callback();
      ipcRenderer.on("cleanup:changed", handler);
      return () => ipcRenderer.removeListener("cleanup:changed", handler);
    },
  },

  dialog: {
    /** Open native file picker for .openp41ge-workspace files. Returns { filePath, data } or null. */
    openWorkspaceFile: () => ipcRenderer.invoke("dialog:openWorkspaceFile"),

    /** Open native save dialog for .openp41ge-workspace files. Returns path or null. */
    saveWorkspaceFile: (data, defaultPath) =>
      ipcRenderer.invoke("dialog:saveWorkspaceFile", data, defaultPath),

    /** Open native folder picker. Returns path or null. */
    pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),

    /** Read a .openp41ge-workspace file at a known path (no dialog). Returns { filePath, data } or null. */
    readWorkspaceFile: (filePath) => ipcRenderer.invoke("dialog:readWorkspaceFile", filePath),

    /** Write a .openp41ge-workspace file to a known path (no dialog). Returns boolean success. */
    writeWorkspaceFile: (filePath, data) =>
      ipcRenderer.invoke("dialog:writeWorkspaceFile", filePath, data),

    /** Ensure a directory exists (create it recursively). Returns boolean success. */
    ensureDir: (dirPath) => ipcRenderer.invoke("dialog:ensureDir", dirPath),

    /** Reveal a file/folder in the native file manager (Finder). */
    revealInFinder: (filePath) => ipcRenderer.invoke("dialog:revealInFinder", filePath),

    /** List all .openp41ge-workspace files in <dataDir>/workspaces/. */
    listWorkspaces: () => ipcRenderer.invoke("dialog:listWorkspaces"),

    /** Delete a .openp41ge-workspace file. Optionally also remove its data dir when deleteData is true. */
    deleteWorkspaceFile: (filePath, deleteData) =>
      ipcRenderer.invoke("dialog:deleteWorkspaceFile", filePath, deleteData),
  },

  /** Extension host (main-process capabilities). */
  extension: {
    /** Active extensions (id, version, renderer entry). */
    getActive: () => ipcRenderer.invoke("extension:get-active"),
    /** Route a component/command event to an extension main handler. */
    dispatch: (commandId, payload) => ipcRenderer.invoke("extension:dispatch", commandId, payload),
    /** Subscribe to active-extension changes. Returns unsubscribe. */
    onState: (callback) => {
      const handler = (_event, data) => {
        try {
          callback(JSON.parse(data));
        } catch {
          callback(data);
        }
      };
      ipcRenderer.on("extension:state", handler);
      return () => ipcRenderer.removeListener("extension:state", handler);
    },
    /** Subscribe to backend topic pushes routed to subscribed renderer
     *  surfaces. `evt` is `{ topic, payload }`. Returns unsubscribe. */
    onEvent: (callback) => {
      const handler = (_event, evt) => callback(evt);
      ipcRenderer.on("extension:event", handler);
      return () => ipcRenderer.removeListener("extension:event", handler);
    },
    /** Extension config: schemas, merged values, the user's values. */
    config: {
      /** Register a renderer entry's config schema. */
      registerSchema: (id, schema) =>
        ipcRenderer.invoke("extension-config:register-schema", id, schema),
      /** The extension's merged config (defaults + the user's values). */
      get: (id) => ipcRenderer.invoke("extension-config:get", id),
      /** Schema, defaults and the user's values (null without a schema). */
      describe: (id) => ipcRenderer.invoke("extension-config:describe", id),
      /** Replace the user's values (rejects values that do not match the schema). */
      set: (id, overrides) => ipcRenderer.invoke("extension-config:set", id, overrides),
      /** Subscribe to `{ extensionId, config }` changes. Returns unsubscribe. */
      onChanged: (callback) => {
        const handler = (_event, change) => callback(change);
        ipcRenderer.on("extension-config:changed", handler);
        return () => ipcRenderer.removeListener("extension-config:changed", handler);
      },
    },
  },
});
