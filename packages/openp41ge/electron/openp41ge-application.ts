/**
 * Openp41geApplication — the Electron main process as a class.
 *
 * Encapsulates all startup logic in a single class with explicit ordering
 * instead of module-level side effects. This makes the startup sequence
 * deterministic, testable, and SOLID-compliant.
 */

import { app, BrowserWindow, ipcMain, Menu, Notification, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "openp41ge-core-logger";
import { chromeSwitches } from "./chrome-switches.js";
import { installConsoleErrorForwarder } from "./console-error-forwarder.js";
import { addSentryBreadcrumb } from "../src/main/services/sentry.js";

// ─── Service imports ─────────────────────────────────────────────────────
import {
  OperationDispatcher,
  DragGhostManager,
  TabNameGenerator,
  NodeGitService,
  ElectronFileSystem,
  FileWorkspaceSessionStore,
  LogFileStore,
} from "../src/main/index.js";
import { closeTabsShowing } from "../src/main/services/close-tabs-showing.js";
import {
  applyMigration,
  writeDataVersion,
  readSetsFromFolder,
} from "../src/main/services/migrations/pending-migrations.js";
import { planStartupMigrations } from "../src/main/services/migrations/startup-migrations.js";
import {
  fetchReleaseMigrations,
  httpText,
} from "../src/main/services/migrations/release-migrations.js";
import { MIGRATIONS_PUBLIC_KEY } from "../src/main/services/migrations/public-key.js";
import { REQUIRED_MIGRATIONS } from "../src/main/services/migrations/required-migrations.js";
import { openMigrationWindow } from "./migration-window.js";
import {
  readWorkspaceFiles,
  scanWorkspaceFiles,
  workspaceReposDir,
  repoNameOfPath,
  WorkspaceRepositories,
} from "../src/main/services/workspace-repositories.js";
import {
  workspaceOfFile,
  workspaceOfSender,
  type WorkspaceGitResolver,
} from "./workspace-of-sender.js";
import { WorkspaceRegistry } from "../src/main/services/workspace-registry.js";
import { ConfigService, updateChannelForVersion } from "../src/main/services/config-service.js";
import { AutoUpdaterService } from "./auto-updater-service.js";
import { ReleasesFeed, releasesFeedDeps } from "./releases-feed.js";
import { resolveAppDataDir } from "../src/main/services/app-data-dir.js";
import { StorageMove, legacyAppDataDirName } from "../src/main/services/storage-rename.js";
import { parseWorkspaceLaunchArg } from "../src/main/services/workspace-launch-arg.js";
import { ReposWatcher } from "./repos-watcher.js";
import { WorkspaceManifestChanges } from "../src/main/services/workspace-manifest-changes.js";
import { ExtensionHostManager } from "../src/main/services/extension-host-manager.js";
import { ExtensionConfigService } from "../src/main/services/extension-config-service.js";
import { callerWorkspace } from "../src/main/services/caller-workspace.js";
import {
  migrateWorkspaceFileData,
  serializeWorkspaceFile,
  withWorktree,
} from "../src/layout/workspace-file.js";
import type { CallerWorkspace, CommandRequest, GitRequest } from "openp41ge-sdk";

import {
  registerExtensionSchemePrivileges,
  installExtensionProtocolHandler,
} from "../src/main/services/extension-protocol.js";

// ─── Windows ─────────────────────────────────────────────────────────────
import {
  openp41geWindows,
  openp41geWindowMeta,
  setDispatcher,
  setRegistry,
  setTabNames,
  createOpenp41geWindow,
  promptQuit,
  openNewWindow,
  openLogs,
  openSidebarTab,
  setOpenWorkspaceWindowHandler,
  setAppQuitting,
  setAppDataDir,
  focusWorkspaceWindow,
  broadcastToWorkspace,
  dispatcherForEvent,
  workspacePathForSender,
  windowIdForSender,
  windowIdOf,
  rebindWindow,
} from "./window-manager.js";
import { planWorkspaceSwitch } from "./workspace-switch.js";

// ─── IPC handler registrations ──────────────────────────────────────────
import { registerDispatchHandlers } from "./ipc-handlers/dispatch-handler.js";
import { registerFileHandlers } from "./ipc-handlers/file-handlers.js";
import { registerDialogHandlers } from "./ipc-handlers/dialog-handlers.js";
import { registerWindowHandlers } from "./ipc-handlers/window-handlers.js";
import { registerWindowManagerHandlers } from "./ipc-handlers/window-manager-handlers.js";
import { registerDragHandlers } from "./ipc-handlers/drag-handlers.js";
import { broadcastCommandRun, registerCommandHandlers } from "./ipc-handlers/command-handlers.js";
import { CommandService, type CommandScope } from "../src/main/services/command-service.js";
import { NodeCommandProcess } from "../src/main/services/command-process.js";
import { FileCommandRunStore } from "../src/main/services/command-run-store.js";
import { registerWorkspaceHandlers } from "./ipc-handlers/workspace-handlers.js";
import { registerConfigHandlers } from "./ipc-handlers/config-handlers.js";
import { registerExtensionConfigHandlers } from "./ipc-handlers/extension-config-handlers.js";
import { registerLogHandlers } from "./ipc-handlers/log-handlers.js";
import { registerUpdaterHandlers } from "./ipc-handlers/updater-handlers.js";
import { registerReleasesHandlers } from "./ipc-handlers/releases-handlers.js";
import { registerExtensionHandlers } from "./ipc-handlers/extension-handlers.js";
import { registerPaletteHandlers } from "./ipc-handlers/palette-handlers.js";
import {
  FilePaletteHistoryStore,
  PALETTE_HISTORY_FILE,
} from "../src/main/services/palette-history-store.js";
import { WorkspaceFileIndex } from "../src/main/services/workspace-file-index.js";
import { GitFileLister } from "../src/main/services/git-file-lister.js";
import { registerCleanupHandlers } from "./ipc-handlers/cleanup-handlers.js";
import { runExtensionGit, type ExtensionGitScope } from "../src/main/services/extension-git.js";
import { registerDataMigrationsHandlers } from "./ipc-handlers/data-migrations-handlers.js";
import { RepositoryCleanup } from "../src/main/services/repository-cleanup.js";
import { CleanupScheduler } from "../src/main/services/cleanup-scheduler.js";

// ─── Lifecycle manager ──────────────────────────────────────────────────
import { LifecycleManager, registerLifecycleHandlers } from "./lifecycle-manager.js";
import { registerConfirmHandlers } from "./confirm-dialog-manager.js";
import { focusPrerequisitesWindow, openPrerequisitesWindow } from "./prerequisites-window.js";
import { allMet, prerequisitesFor } from "../src/main/services/prerequisites.js";
import {
  applyGitStatus,
  nodeGitProbe,
  resolveGit,
  type GitStatus,
} from "../src/main/services/git-binary.js";
import { registerFatalHandlers, showFatalErrorWindow } from "./fatal-error-manager.js";

// ─── Path helpers ────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** How long repository changes are collected before windows are told. */
const REPOSITORY_CHANGE_MS = 300;

/** Quiet time after a workspace file is written before windows are told. */
const WORKSPACE_FILE_SETTLE_MS = 150;

/** The repository cleanup's first run, after startup settles. */
const CLEANUP_STARTUP_DELAY_MS = 15_000;
/** Quiet time after a workspace file changes before the cleanup runs. */
const CLEANUP_SETTLE_MS = 10_000;
/** Where a workspace keeps its scoped-terminal runs (in its data folder). */
const COMMAND_RUNS_FILE = "command-runs.json";

const cleanupLog = createLogger("openp41ge", "repository-cleanup");
const switchLog = createLogger("openp41ge", "workspace-switch");

export class Openp41geApplication {
  // ── Public ────────────────────────────────────────────────────────────
  readonly lifecycle = new LifecycleManager();

  // ── Private service instances ─────────────────────────────────────────
  private configService!: ConfigService;
  private extensionConfig!: ExtensionConfigService;
  private autoUpdater!: AutoUpdaterService;
  /** Which releases exist (the Releases tab), checked in the background. */
  private releasesFeed!: ReleasesFeed;
  /** Avoid re-notifying about the same version during a session. */
  private _notifiedUpdateVersion: string | null = null;
  private dispatcher!: OperationDispatcher;
  private registry!: WorkspaceRegistry;
  private dragGhost!: DragGhostManager;
  private tabNames!: TabNameGenerator;
  /** The startup git check (see git-binary.ts). */
  private gitStatus: GitStatus | null = null;
  /** False while the prerequisites window stands in for the app. */
  private prerequisitesMet = true;
  private fileSystem!: ElectronFileSystem;
  /** Each workspace's git services. */
  private repositories!: WorkspaceRepositories;
  /** Deletes what no workspace uses; lists what holds work (Cleanup tab). */
  private cleanup!: RepositoryCleanup;
  private cleanupScheduler!: CleanupScheduler;
  private workspacesWatcher: fs.FSWatcher | null = null;
  private workspaceManifests: WorkspaceManifestChanges | null = null;
  private workspaceSessionStore!: FileWorkspaceSessionStore;
  private logStore!: LogFileStore;
  private openp41geDir!: string;
  private extensionManager!: ExtensionHostManager;
  /** The scoped terminal's engine: the binaries extensions define, run. */
  private commands!: CommandService;
  /** Each workspace's data folder, by id (where its command runs are kept). */
  private readonly workspaceDataDirs = new Map<string, string>();
  /** The open palette's files (every window's workspaces). */
  private readonly fileIndex = new WorkspaceFileIndex(new GitFileLister());
  /** Watch each repositories folder in use, so the Explorer auto-updates on
   *  external changes. */
  private readonly reposWatchers = new Map<string, ReposWatcher>();

  /** The old shared repositories folder, from before each workspace had its
   *  own: the `2026-10-10-repositories-per-workspace` data migration moves
   *  clones out of it (and removes it once empty); the cleanup scans what is
   *  left in it. */
  private get sharedReposDir(): string {
    return path.join(this.openp41geDir, "repositories");
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────

  /**
   * Start the application in a deterministic order:
   *   1. Error handlers (EPIPE, unhandled rejections)
   *   2. Paths and Chrome flags
   *   3. Config service
   *   4. All services
   *   5. Wire cross-service dependencies
   *   6. Register IPC handlers
   *   7. Wait for Electron ready
   *   8. Create window + menu
   *   9. Register app event handlers
   */
  async start(): Promise<void> {
    this._registerErrorHandlers();
    // Find the git everything in this process will run (and put it first on
    // PATH). Started now, awaited before extension backends load.
    const gitReady = this._initGit();
    this._initPaths();
    this._initChromeFlags();
    this._initConfig();
    // Register the extension asset scheme as privileged. Must precede
    // `app.whenReady()` resolving (the data migration may wait for it).
    registerExtensionSchemePrivileges();
    // Bring the data up to this version's layout before anything reads it.
    await this._migrateData();
    this._initServices();
    this._maybeLoadState();
    this._wireServices();
    this._registerIpcHandlers();
    this._registerContextMenuHandler();

    this.gitStatus = await gitReady;

    // Boot the extension host (installed + workspace extensions). Fire-and-forget:
    // the host isolates per-extension failures, and the renderer pulls the active
    // set at bootstrap, so a slow extension must never block window creation.
    void this.extensionManager.init();

    // Wait for Electron to be ready, then create the UI
    await app.whenReady();
    this.lifecycle.notifyElectronReady();

    // Serve installed-extension assets to the renderer over the `openp41ge-ext://`
    // custom protocol. Roots are read per-request so host reloads are picked up.
    // (The shared runtime — lit, the SDK, the UI toolkit — is the app's own
    // `extension-runtime/` modules, routed there by the import map.)
    installExtensionProtocolHandler(() => this.extensionManager.extensionAssetRoots());

    // Kick off the startup update check (no-op in dev; channel from config).
    void this.autoUpdater.start();
    // The Releases tab's list: cached, checked now when stale, then every 6h.
    this.releasesFeed.start();

    this._openFirstWindow();
    this._setupMenu();
    this._registerAppEvents();
    // The app's windows and its own window-all-closed handler exist now.
    app.removeListener("window-all-closed", this._keepRunning);
    this._startCleanup();
  }

  /**
   * Run the repository cleanup after startup and after workspace changes, and
   * tell every window when a workspace file's manifest changes
   * (`workspace-files:changed`, `{ path }`).
   */
  private _startCleanup(): void {
    if (this._migrationReport) {
      const { level, message } = this._migrationReport;
      createLogger("openp41ge", "data-migrations")[level](message);
      this._migrationReport = null;
    }
    this.cleanupScheduler.start();
    const dir = path.join(this.openp41geDir, "workspaces");
    try {
      fs.mkdirSync(dir, { recursive: true });
      const manifests = new WorkspaceManifestChanges(
        (file) => {
          try {
            return fs.readFileSync(file, "utf-8");
          } catch {
            return null;
          }
        },
        (file) => {
          for (const [, bw] of openp41geWindows) {
            try {
              bw.webContents.send("workspace-files:changed", { path: file });
            } catch {
              // window may be closing
            }
          }
        },
        WORKSPACE_FILE_SETTLE_MS,
      );
      manifests.prime(
        fs
          .readdirSync(dir)
          .filter((n) => n.endsWith(".openp41ge-workspace"))
          .map((n) => path.join(dir, n)),
      );
      this.workspaceManifests = manifests;
      this.workspacesWatcher = fs.watch(dir, (_event, filename) => {
        this.cleanupScheduler.workspacesChanged();
        const name = filename?.toString();
        if (name?.endsWith(".openp41ge-workspace")) manifests.touched(path.join(dir, name));
      });
    } catch (err) {
      cleanupLog.warn("cannot watch the workspaces folder; cleanup runs at startup only:", err);
    }
  }

  // ── Step 1: Error handlers ────────────────────────────────────────────

  private _registerErrorHandlers(): void {
    // The raw console.error, captured before the interceptor below is installed
    // so fatal errors print directly to the console (not re-forwarded).
    const rawConsoleError = console.error;
    const isEpipe = (err: unknown): boolean => {
      if (!err || typeof err !== "object") return false;
      const e = err as { code?: string; message?: string };
      return e.code === "EPIPE" || (typeof e.message === "string" && e.message.includes("EPIPE"));
    };

    // Forward errors to all renderer windows so they appear in the DOM overlay
    const forwardError = (message: string, source?: string, stack?: string) => {
      const payload = JSON.stringify({ message, source, stack });
      for (const [, bw] of openp41geWindows) {
        if (bw.isDestroyed() || bw.webContents.isDestroyed()) continue;
        try {
          bw.webContents.send("openp41ge:error", payload);
        } catch {
          /* window might be closing */
        }
      }
    };

    // ── Fatal (unrecoverable) errors ────────────────────────────────────
    // These are system-level and outside the logging system: they are NOT
    // written to the log bus / log viewer / disk, and NOT forwarded to the
    // renderer error overlay. The user is shown the fatal error window, which
    // waits for acknowledgment before the app exits. The message is the one
    // thing allowed to reach the console (console.error).
    const handleFatal = (label: string, message: string, stack: string) => {
      // Use the raw console.error (not the interceptor below) so the fatal
      // message goes straight to the console instead of being re-forwarded to
      // the renderer overlay / Sentry breadcrumb.
      rawConsoleError(`[FATAL] ${label}: ${message}\n${stack}`);
      showFatalErrorWindow({
        message,
        stack: stack || undefined,
        timestamp: Date.now(),
      });
    };

    process.on("uncaughtException", (err) => {
      if (isEpipe(err)) return;
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? (err.stack ?? "") : "";
      handleFatal("Uncaught Exception", message, stack);
    });
    process.on("unhandledRejection", (reason) => {
      if (isEpipe(reason)) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      const stack = reason instanceof Error ? (reason.stack ?? "") : "";
      handleFatal("Unhandled Rejection", message, stack);
    });

    // Also intercept console.error in main process.
    installConsoleErrorForwarder(console, {
      forward: (message) => forwardError(message, "main-process"),
      breadcrumb: (message) =>
        addSentryBreadcrumb({ category: "console", level: "warning", message }),
    });
  }

  // ── Step 2: Paths and Chrome flags ────────────────────────────────────

  private _initPaths(): void {
    // Single source of truth for the app-data root (dev vs release folder).
    // Data from before the rename to "openp41ge code" moves there first (not
    // with an `OPENP41GE_DIR` override).
    const dir = resolveAppDataDir(app.isPackaged);
    this.openp41geDir = process.env.OPENP41GE_DIR
      ? dir
      : new StorageMove().moveDataDir(
          path.join(os.homedir(), legacyAppDataDirName(app.isPackaged)),
          dir,
        );
    setAppDataDir(this.openp41geDir);
  }

  private _initChromeFlags(): void {
    // The app's name and Chromium's folders are set earlier, in
    // `initChromiumStorage` (main.ts), before Sentry starts.
    for (const [name, value] of chromeSwitches(app.isPackaged)) {
      app.commandLine.appendSwitch(name, value);
    }
  }

  // ── Step 3: Config ────────────────────────────────────────────────────

  private _initConfig(): void {
    // A prerelease build (e.g. v0.1.0-alpha.10) defaults to its own update
    // track; a stable build defaults to "latest". This keeps the startup
    // update check on the prerelease atom-feed walk instead of the stable
    // `releases/latest` endpoint, which returns 406 when the repo has only
    // prereleases (no non-prerelease "latest" exists).
    this.configService = new ConfigService(
      this.openp41geDir,
      updateChannelForVersion(app.getVersion()),
    );
    this.configService.init();
    // Auto-update reads the persisted `updateChannel` and drives electron-updater.
    this.autoUpdater = new AutoUpdaterService(this.configService);
    this.autoUpdater.onStatus((status) => {
      const payload = JSON.stringify(status);
      for (const [, bw] of openp41geWindows) {
        try {
          bw.webContents.send("updater:status", payload);
        } catch {
          // window might be closing
        }
      }
      // Proactively tell the user a newer version exists (the startup check
      // resolves it). This only informs — it never stages or downloads; the
      // user still opens the Releases tab and clicks Download. Notify at most
      // once per version per session.
      if (
        status.state === "update-available" &&
        status.version &&
        status.version !== this._notifiedUpdateVersion
      ) {
        this._notifiedUpdateVersion = status.version;
        this._notifyUpdateAvailable(status.version);
      }
    });
    this.releasesFeed = new ReleasesFeed(releasesFeedDeps(this.openp41geDir));
    this.releasesFeed.onChange((snapshot) => {
      const payload = JSON.stringify(snapshot);
      for (const [, bw] of openp41geWindows) {
        try {
          bw.webContents.send("releases:changed", payload);
        } catch {
          // window might be closing
        }
      }
    });
  }

  /** Show an OS notification that a new version is available. No-op if the
   *  platform doesn't support notifications, or in an unpackaged build. */
  private _notifyUpdateAvailable(version: string): void {
    try {
      if (typeof Notification === "undefined" || !Notification.isSupported()) return;
      const current = this.autoUpdater.getCurrentVersion();
      const body =
        `Version ${version} is available` +
        (current ? ` (you have ${current}).` : ".") +
        " Open the Releases tab to download and update.";
      new Notification({ title: "Update available", body }).show();
    } catch (err) {
      const log = createLogger("openp41ge", "main-process");
      log.error("update notification failed:", err);
    }
  }

  // ── Git ───────────────────────────────────────────────────────────────

  /** Resolve and apply the git this process uses (never throws). */
  private async _initGit(): Promise<GitStatus> {
    const log = createLogger("openp41ge", "git");
    let status: GitStatus;
    try {
      status = await resolveGit(nodeGitProbe());
    } catch (err) {
      status = { ok: false, problem: `Git could not be checked: ${String(err)}` };
    }
    applyGitStatus(status);
    if (status.ok) log.info(`using git ${status.version} at ${status.path}`);
    else log.warn(`git is not usable: ${status.problem}`);
    return status;
  }

  /** The prerequisites from the startup checks. */
  private _prerequisites() {
    return prerequisitesFor(this.gitStatus ?? { ok: false, problem: "Git could not be checked." });
  }

  /**
   * Open the app's first window — or, when something it needs is missing,
   * the prerequisites window instead; the app starts once it is all met.
   */
  private _openFirstWindow(): void {
    const results = this._prerequisites();
    if (allMet(results)) {
      this._createInitialWindow();
      return;
    }
    this.prerequisitesMet = false;
    openPrerequisitesWindow({
      initial: results,
      check: async () => {
        this.gitStatus = await this._initGit();
        return this._prerequisites();
      },
      onMet: () => {
        this.prerequisitesMet = true;
        this._setupMenu();
        this._createInitialWindow();
      },
    });
  }

  // ── Step 4: Services ──────────────────────────────────────────────────

  /**
   * Bring the data folder up to this version's layout — before any saved
   * layout loads (migrations/README.md). Release builds download the
   * signed sets of every release since the data was last migrated; dev
   * builds read the repo's `migrations/` folder. The migration window shows
   * only when sets are pending, or a required one could not be downloaded.
   */
  private async _migrateData(): Promise<void> {
    const root = this.openp41geDir;
    const version = app.getVersion();
    const plan = () =>
      planStartupMigrations({
        root,
        version,
        packaged: app.isPackaged,
        localSets: () => readSetsFromFolder(path.resolve(__dirname, "../../../../migrations")),
        download: (from, to) =>
          fetchReleaseMigrations({
            from,
            to,
            publicKey: MIGRATIONS_PUBLIC_KEY,
            fetchText: httpText,
          }),
        required: REQUIRED_MIGRATIONS,
      });
    // Never rejects; anything but none / deferred keeps the app closed until
    // the migration window says so (including a failed check, and data from
    // a newer version).
    const first = await plan();
    if (first.kind === "none") return;
    if (first.kind === "deferred") {
      this._migrationReport = {
        level: "warn",
        message:
          "data migrations could not be downloaded; none is required yet, retrying next start",
      };
      return;
    }
    await app.whenReady();
    // Closing the migration window must not quit the app (Electron's
    // default when the last window closes); the app's own handler comes later.
    app.on("window-all-closed", this._keepRunning);
    await new Promise<void>((resolve) =>
      openMigrationWindow({
        initial: first,
        replan: plan,
        apply: (set) => applyMigration(root, set),
        onDone: (outcome) => {
          if (outcome === "ran") {
            // Every downloaded set ran: the data is at this version now.
            if (app.isPackaged) writeDataVersion(root, version);
            this._migrationReport = {
              level: "info",
              message: `data migrations applied (journal: ${path.join(root, "migrations", "journal.json")})`,
            };
          }
          resolve();
        },
      }),
    );
  }

  /** The git scope of the window that sent `event`: its workspace's
   *  repositories folder and the repos its workspace file lists. */
  private _gitScopeFor(event: { sender: Electron.WebContents }): ExtensionGitScope | null {
    const file = workspacePathForSender(event);
    const workspace = file ? workspaceOfFile(file, this.openp41geDir) : null;
    if (!file || !workspace) return null;
    const listed = readWorkspaceFiles(path.dirname(file), this.openp41geDir).find(
      (w) => w.file === file,
    );
    return {
      reposDir: this.repositories.of(workspace).reposDir,
      repoNames: listed?.repoNames ?? [],
    };
  }

  /** The workspace of the window that sent `event`, for an extension
   *  backend's `ctx.workspace`; undefined for a window without one. */
  private _callerWorkspaceFor(event: {
    sender: Electron.WebContents;
  }): CallerWorkspace | undefined {
    const file = workspacePathForSender(event);
    const workspace = file ? workspaceOfFile(file, this.openp41geDir) : null;
    if (!file || !workspace) return undefined;
    const git = () => this.repositories.of(workspace).git;
    return callerWorkspace({
      workspace,
      repoNames: () =>
        readWorkspaceFiles(path.dirname(file), this.openp41geDir).find((w) => w.file === file)
          ?.repoNames ?? [],
      isCloned: async (repoName) => (await git().getRepo(repoName)) !== null,
      listWorktrees: (repoName) => git().listWorktrees(repoName),
      checkoutWorktree: (repoName, branch) => git().checkoutWorktree(repoName, branch),
      // Recorded as the explorer records one; the manifest watcher tells the
      // windows, which merge it into their open workspace.
      recordWorktree: (repoName, branch) => {
        const data = migrateWorkspaceFileData(JSON.parse(fs.readFileSync(file, "utf-8")));
        const next = withWorktree(data, repoName, branch);
        if (next) fs.writeFileSync(file, serializeWorkspaceFile(next), "utf-8");
      },
    });
  }

  /** Holds the app open while the migration window closes before the app's
   *  first window exists (Electron quits when its last window closes). */
  private readonly _keepRunning = (): void => undefined;

  /** What the startup migration did; logged once logging reaches the log file
   *  (the migration runs before it does). */
  private _migrationReport: { level: "info" | "warn"; message: string } | null = null;

  private _initServices(): void {
    this.dispatcher = new OperationDispatcher();
    this.dragGhost = new DragGhostManager(BrowserWindow);
    this.tabNames = new TabNameGenerator();
    this.fileSystem = new ElectronFileSystem();
    this.repositories = new WorkspaceRepositories({
      fileSystem: this.fileSystem,
      // Each workspace's clones live in its own data folder.
      reposDirOf: workspaceReposDir,
      listWorkspaces: () =>
        readWorkspaceFiles(path.join(this.openp41geDir, "workspaces"), this.openp41geDir),
      // Watch a repositories folder once a workspace uses it, so the explorer
      // reflects external file changes (deletes/creates outside the app) and
      // repository state (uncommitted / unpushed) follows edits, commits and
      // pushes made anywhere.
      onReposDir: (dir) => {
        const watcher = new ReposWatcher(
          dir,
          (changedPath) => {
            this._broadcastTreeChanged(changedPath);
            this.fileIndex.invalidate(changedPath);
            this._repositoryChanged(dir, changedPath);
          },
          (changedPath) => this._repositoryChanged(dir, changedPath),
        );
        this.reposWatchers.set(dir, watcher);
        watcher.start();
      },
    });
    this.cleanup = new RepositoryCleanup({
      appDataDir: this.openp41geDir,
      reposDirs: () => [this.sharedReposDir],
      workspaces: () =>
        scanWorkspaceFiles(path.join(this.openp41geDir, "workspaces"), this.openp41geDir),
      reposDirOf: workspaceReposDir,
      work: async (dir, repoName) => {
        const git = new NodeGitService(dir);
        const state = await git.repositoryState(repoName);
        return { ...state, stashed: await git.hasStash(repoName) };
      },
      isCloning: (dir, repoName) => this.repositories.isCloning(dir, repoName),
    });
    this.cleanup.onChange(() => {
      for (const [, bw] of openp41geWindows) {
        try {
          bw.webContents.send("cleanup:changed");
        } catch {
          // window might be closing
        }
      }
    });
    // Shortly after startup, and once workspace files settle after a change.
    this.cleanupScheduler = new CleanupScheduler(
      () => {
        this.cleanup.run().catch((err) => cleanupLog.warn("cleanup run failed:", err));
      },
      { startupDelayMs: CLEANUP_STARTUP_DELAY_MS, settleMs: CLEANUP_SETTLE_MS },
    );
    this.workspaceSessionStore = new FileWorkspaceSessionStore();
    this.registry = new WorkspaceRegistry({
      broadcast: (workspacePath, serialized) => broadcastToWorkspace(workspacePath, serialized),
      save: (workspacePath, ws) => {
        if (workspacePath) this.workspaceSessionStore.save(workspacePath, ws);
      },
    });
    this.logStore = new LogFileStore(this.openp41geDir);
    this.extensionConfig = new ExtensionConfigService(this.configService);
    this.extensionManager = new ExtensionHostManager({
      installDir: path.join(this.openp41geDir, "extensions"),
      // The official extensions: a packaged app ships them in its resources
      // (electron-builder `extraResources`); in dev they are the repo's
      // `packages/` sources. Scanned last, so an installed copy of one wins.
      extraDiscoveryDirs: [
        app.isPackaged
          ? path.join(process.resourcesPath, "extensions")
          : path.resolve(__dirname, "../../../"),
      ],
      onStateChange: (active) => this._broadcastExtensionState(active),
      onPublish: (topic, payload) => this._broadcastExtensionEvent(topic, payload),
      config: this.extensionConfig,
    });
    this.commands = new CommandService({
      binaries: () => this.extensionManager.commandBinaries(),
      chosen: () =>
        (this.configService.get("commandBinaries") as Record<string, string> | undefined) ?? {},
      isOfficial: (id) => this.extensionManager.isOfficial(id),
      limits: () => {
        const t = (this.configService.get("terminal") ?? {}) as {
          timeoutSeconds?: number;
          maxOutputKb?: number;
          agentMaxOutputKb?: number;
        };
        return {
          timeoutMs: (t.timeoutSeconds ?? 60) * 1000,
          maxOutputBytes: (t.maxOutputKb ?? 256) * 1024,
          agentMaxOutputBytes: (t.agentMaxOutputKb ?? 32) * 1024,
        };
      },
      process: new NodeCommandProcess(),
      store: new FileCommandRunStore((id) =>
        path.join(
          this.workspaceDataDirs.get(id) ??
            path.join(this.openp41geDir, ".config", "workspaces", id),
          COMMAND_RUNS_FILE,
        ),
      ),
      onRun: (workspaceId, run) => broadcastCommandRun(run, this._windowsOfWorkspace(workspaceId)),
    });
  }

  /** The open windows showing the workspace `workspaceId`. */
  private _windowsOfWorkspace(workspaceId: string): Electron.BrowserWindow[] {
    return [...openp41geWindows].flatMap(([id, bw]) => {
      const file = openp41geWindowMeta.get(id)?.workspacePath;
      const workspace = file ? workspaceOfFile(file, this.openp41geDir) : null;
      return workspace?.id === workspaceId ? [bw] : [];
    });
  }

  /** The workspace of the window that sent `event`, for the scoped
   *  terminal: its id, and its worktrees' folders. */
  private _commandScopeFor(event: { sender: Electron.WebContents }): CommandScope | null {
    const caller = this._callerWorkspaceFor(event);
    const file = workspacePathForSender(event);
    const workspace = file ? workspaceOfFile(file, this.openp41geDir) : null;
    if (!caller || !workspace) return null;
    this.workspaceDataDirs.set(workspace.id, workspace.dataDir);
    return {
      workspaceId: workspace.id,
      worktreePath: async (repo, worktree) =>
        (await caller.roots()).find((r) => r.repoName === repo && r.branch === worktree)?.path ??
        null,
    };
  }

  /** Pending `workspace:repository-changed` sends, per repositories folder + repo. */
  private readonly repositoryChanges = new Map<string, NodeJS.Timeout>();

  /**
   * Something changed in a repository of `reposDir`: tell the windows whose
   * workspace uses that folder which repository (collected for a moment, so
   * a build or a commit sends once).
   */
  private _repositoryChanged(reposDir: string, changedPath: string): void {
    const repoName = repoNameOfPath(reposDir, changedPath);
    if (!repoName) return;
    const key = `${reposDir}\n${repoName}`;
    if (this.repositoryChanges.has(key)) return;
    this.repositoryChanges.set(
      key,
      setTimeout(() => {
        this.repositoryChanges.delete(key);
        for (const [id, bw] of openp41geWindows) {
          const file = openp41geWindowMeta.get(id)?.workspacePath;
          const workspace = file ? workspaceOfFile(file, this.openp41geDir) : null;
          if (!workspace || this.repositories.of(workspace).reposDir !== reposDir) continue;
          try {
            bw.webContents.send("workspace:repository-changed", repoName);
          } catch {
            // window might be closing
          }
        }
      }, REPOSITORY_CHANGE_MS),
    );
  }

  /** Broadcast a filesystem change under the repositories dir to every window. */
  private _broadcastTreeChanged(changedPath: string): void {
    const payload = { path: changedPath };
    for (const [, bw] of openp41geWindows) {
      try {
        bw.webContents.send("file:tree-changed", payload);
      } catch {
        // window might be closing
      }
    }
  }

  /** Broadcast a backend topic push to every window's renderer. */
  private _broadcastExtensionEvent(topic: string, payload: unknown): void {
    for (const [, bw] of openp41geWindows) {
      try {
        bw.webContents.send("extension:event", { topic, payload });
      } catch {
        // window might be closing
      }
    }
  }

  /** Broadcast the active-extension set to every window (component feeding). */
  private _broadcastExtensionState(active: unknown): void {
    const payload = JSON.stringify(active);
    for (const [, bw] of openp41geWindows) {
      try {
        bw.webContents.send("extension:state", payload);
      } catch {
        // window might be closing
      }
    }
  }

  // ── Step 5: Wire cross-service dependencies ───────────────────────────

  private _wireServices(): void {
    // The default dispatcher holds the windows with no workspace open: their
    // state goes to them only, and is never saved (it has no file; their tabs
    // live in memory). Each workspace's dispatcher (the registry's) saves its
    // layout to that workspace's file.
    this.dispatcher.setBroadcast((serialized: string) => broadcastToWorkspace(null, serialized));

    setDispatcher(this.dispatcher);
    setRegistry(this.registry);
    setTabNames(this.tabNames);

    // A workspace's windows are opened with its binding. Bind
    // the store to that path so mutations save to its file, and restore the
    // workspace's saved session (windows/grids/sidebars) when it has one.
    setOpenWorkspaceWindowHandler((workspacePath, source) => {
      this._openWorkspaceSession(workspacePath, source);
    });
  }

  // ── Step 5b: Load saved state ───────────────────────────────────────

  /**
   * Load saved workspace state at startup, but ONLY when a workspace was
   * explicitly provided as a launch argument (future CLI seam — see
   * parseWorkspaceLaunchArg). A normal launch starts fresh: the dispatcher
   * keeps its default createWorkspace("ws1") so a previous session's tabs
   * are not reinstated without context (e.g. sidebar tabs with no active
   * workspace).
   */
  private _maybeLoadState(): void {
    const workspaceArg = parseWorkspaceLaunchArg(process.argv);
    if (!workspaceArg) return;
    // Restore the layout session from the workspace's own file.
    const restored = this.workspaceSessionStore.load(workspaceArg);
    if (restored) {
      this.workspaceSessionStore.setCurrentWorkspacePath(workspaceArg);
      void this.extensionManager.setWorkspacePath(workspaceArg);
      this.registry.getOrCreate(workspaceArg).setWorkspace(restored);
    }
  }

  // ── Step 6: IPC handlers ──────────────────────────────────────────────

  private _registerIpcHandlers(): void {
    // The window's top-bar workspace picker: replace the workspace it shows.
    ipcMain.handle("window:switch-workspace", (event, workspacePath: unknown) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || (workspacePath !== null && typeof workspacePath !== "string")) return false;
      return this._switchWorkspace(win, workspacePath || null);
    });
    registerDispatchHandlers(dispatcherForEvent);
    registerFileHandlers(this.fileSystem, dispatcherForEvent);
    registerWindowHandlers(dispatcherForEvent, this.tabNames);
    registerWindowManagerHandlers();
    registerDragHandlers(this.dragGhost);
    // Git calls act on the repositories of the sender's workspace (or of the
    // workspace file a call names).
    const gitFor: WorkspaceGitResolver = (event, workspaceFile) => {
      const workspace = workspaceFile
        ? workspaceOfFile(workspaceFile, this.openp41geDir)
        : workspaceOfSender(event, this.openp41geDir);
      return workspace ? this.repositories.of(workspace) : null;
    };
    registerWorkspaceHandlers(
      gitFor,
      dispatcherForEvent,
      async (event, repoName, workspaceFile) => {
        const workspace = workspaceFile
          ? workspaceOfFile(workspaceFile, this.openp41geDir)
          : workspaceOfSender(event, this.openp41geDir);
        if (!workspace)
          return { ok: false, error: "Repositories belong to a workspace; this window has none." };
        return this.repositories.deleteRepository(workspace, repoName);
      },
      // Close the deleted repo's / worktree's tabs in that workspace, if open.
      (event, target, workspaceFile) => {
        const file = workspaceFile ?? workspacePathForSender(event);
        const dispatcher = file ? this.registry.get(file) : null;
        if (dispatcher) closeTabsShowing(dispatcher, target);
      },
    );
    registerConfigHandlers(this.configService);
    registerExtensionConfigHandlers(this.extensionConfig);
    registerLogHandlers(this.logStore);
    registerUpdaterHandlers(this.autoUpdater);
    registerReleasesHandlers(this.releasesFeed);
    // An extension backend's git (ctx.git) runs in the calling window's
    // workspace: its repositories folder, and only the repos it lists. Its
    // ctx.workspace is that workspace (worktrees, a data folder).
    const callerFor = (event: { sender: Electron.WebContents }) => ({
      git: (request: GitRequest) => runExtensionGit(this._gitScopeFor(event), request),
      commands: {
        binaries: async () => this.commands.binaries(),
        run: (request: CommandRequest, extensionId: string) =>
          this.commands.run(this._commandScopeFor(event), request, extensionId),
      },
      workspace: this._callerWorkspaceFor(event),
      windowId: windowIdForSender(event) ?? undefined,
    });
    registerExtensionHandlers(this.extensionManager, callerFor);
    // The scoped terminal: lines typed at a terminal's prompt, its runs.
    registerCommandHandlers(this.commands, (event) => this._commandScopeFor(event));
    // The open palette (Cmd+N): providers run as the calling window, as
    // dispatches do; what it remembers is shared by every window.
    registerPaletteHandlers({
      manager: this.extensionManager,
      callerFor,
      history: new FilePaletteHistoryStore(
        path.join(this.openp41geDir, ".config", PALETTE_HISTORY_FILE),
      ),
      files: this.fileIndex,
    });
    registerCleanupHandlers(this.cleanup, (folder) => shell.showItemInFolder(folder));
    registerDataMigrationsHandlers(this.openp41geDir);
    registerLifecycleHandlers(this.lifecycle);
    registerConfirmHandlers();
    registerFatalHandlers((code) => {
      // User acknowledged (or closed) the fatal window — the app must exit
      // (crash). Fatal is outside logging, so nothing is persisted here.
      app.exit(code);
    });
    registerDialogHandlers(this.openp41geDir);
  }

  private _registerContextMenuHandler(): void {
    ipcMain.handle(
      "native:showContextMenu",
      async (_event, items: Array<{ label: string; id: string }>) => {
        const webContents = _event.sender;

        let resolved = false;
        const template = items.map((item) => ({
          label: item.label,
          click: () => {
            resolved = true;
            webContents.send("native:contextMenuAction", item.id);
          },
        }));
        const menu = Menu.buildFromTemplate(template);
        menu.popup({
          window: BrowserWindow.fromWebContents(webContents) ?? undefined,
          callback: () => {
            if (!resolved) {
              webContents.send("native:contextMenuAction", "");
            }
          },
        });
      },
    );
  }

  // ── Step 7-8: Window + Menu (after app.whenReady) ─────────────────────

  /**
   * Open a workspace: load its session (windows/grids/sidebars) into the
   * dispatcher and create a bound window for each restored window. Falls back
   * to a single fresh window when the file has no session.
   */
  private _openWorkspaceSession(workspacePath: string, source?: BrowserWindow): void {
    this.workspaceSessionStore.setCurrentWorkspacePath(workspacePath);
    void this.extensionManager.setWorkspacePath(workspacePath);
    // If a window of this workspace is already open, focus it rather than
    // re-creating every window in the file. Unconditional re-creation produced
    // duplicate BrowserWindows (same id, map overwrite) and left stale windows
    // in the file desynced from the live set — e.g. a window id shared across
    // two workspace files, or a window in the file with no live BrowserWindow.
    if (focusWorkspaceWindow(workspacePath)) {
      return;
    }
    // Each workspace path owns its dispatcher, so several different workspaces
    // can be open simultaneously with independent state.
    const dispatcher = this.registry.getOrCreate(workspacePath);
    const restored = this.workspaceSessionStore.load(workspacePath);
    if (restored && restored.windows.length > 0) {
      dispatcher.setWorkspace(restored);
      dispatcher.broadcast();
      for (const win of restored.windows) {
        createOpenp41geWindow(win.id, false, undefined, undefined, undefined, {
          workspacePath,
        });
      }
    } else {
      // A fresh window bound to the path.
      dispatcher.apply("newWindow", []);
      const ws = dispatcher.getWorkspace();
      const newWin = ws.windows[ws.windows.length - 1];
      if (newWin) {
        dispatcher.broadcast();
        createOpenp41geWindow(newWin.id, false, source, undefined, undefined, {
          workspacePath,
        });
      }
    }
  }

  /**
   * Replace the workspace `win` shows with `newPath` (null: none). Its old
   * state drops the window (a workspace's last window keeps its layout in the
   * file, as closing it would); it becomes a window of the new workspace's
   * state (a closed workspace's saved window, else a fresh one) and reloads.
   */
  private _switchWorkspace(win: BrowserWindow, newPath: string | null): boolean {
    const windowId = windowIdOf(win);
    const meta = windowId ? openp41geWindowMeta.get(windowId) : undefined;
    if (!windowId || !meta) return false;
    const oldPath = meta.workspacePath ?? null;
    const live = [...openp41geWindows].filter(([, bw]) => !bw.isDestroyed()).map(([id]) => id);
    const liveOf = (p: string | null): string[] =>
      live.filter((id) => {
        const m = openp41geWindowMeta.get(id);
        return !!m && (m.workspacePath ?? null) === p;
      });
    const newOpen = newPath !== null && liveOf(newPath).length > 0;
    const restored = newPath !== null && !newOpen ? this.workspaceSessionStore.load(newPath) : null;
    const plan = planWorkspaceSwitch({
      windowId,
      oldPath,
      newPath,
      liveWindowIds: live,
      otherLiveWindowsOfOld: liveOf(oldPath).filter((id) => id !== windowId).length,
      liveWindowsOfNew: newPath === null ? 0 : liveOf(newPath).length,
      savedWindowIdsOfNew: restored?.windows.map((w) => w.id) ?? [],
    });
    if (!plan) return false;

    const oldDispatcher = oldPath ? this.registry.get(oldPath) : this.dispatcher;
    if (oldDispatcher) {
      if (plan.old === "keep") {
        oldDispatcher.persist();
      } else if (oldDispatcher.getWorkspace().windows.some((w) => w.id === windowId)) {
        oldDispatcher.apply("closeWindow", [windowId]);
        oldDispatcher.broadcast();
      }
    }

    const dispatcher = newPath ? this.registry.getOrCreate(newPath) : this.dispatcher;
    if (restored) dispatcher.setWorkspace(restored);
    let newId: string;
    if (plan.window.kind === "saved") {
      newId = plan.window.id;
    } else {
      dispatcher.apply("newWindow", []);
      const ws = dispatcher.getWorkspace();
      newId = ws.windows[ws.windows.length - 1]?.id ?? "";
      if (!newId) return false;
    }
    this.workspaceSessionStore.setCurrentWorkspacePath(newPath);
    void this.extensionManager.setWorkspacePath(newPath);
    rebindWindow(win, newId, { workspacePath: newPath });
    dispatcher.broadcast();
    switchLog.info("switched", { from: oldPath, to: newPath, window: newId, plan });
    return true;
  }

  private _createInitialWindow(): void {
    const workspaceArg = parseWorkspaceLaunchArg(process.argv);
    if (workspaceArg) {
      this._openWorkspaceSession(workspaceArg);
    } else {
      // No workspace argument — start in a window with no workspace open (the
      // title bar's picker opens one).
      openNewWindow();
    }
  }

  private _setupMenu(): void {
    // While the prerequisites window stands in for the app, nothing may open
    // app windows: just the app menu (About / Quit) and Edit (copy a path).
    if (!this.prerequisitesMet) {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
          },
          { role: "editMenu" },
        ]),
      );
      return;
    }
    // The menu varies with the focused window: one with no workspace has no
    // workspace to add a window to.
    const focusedHasWorkspace = this._focusedWorkspacePath() !== null;
    const template: Electron.MenuItemConstructorOptions[] = [
      // Application menu — this is the macOS app menu labelled app.name
      // (without it, Electron shows a default "Electron" app menu). Settings
      // lives here (Cmd+,) instead of the in-window bottom bar.
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          // Settings and Logs open as tabs in the focused window.
          {
            label: "Settings",
            accelerator: "CmdOrCtrl+,",
            click: () =>
              openSidebarTab("settings", "Settings", BrowserWindow.getFocusedWindow() ?? undefined),
          },
          {
            label: "Logs",
            accelerator: "CmdOrCtrl+Shift+L",
            click: () => openLogs(BrowserWindow.getFocusedWindow() ?? undefined),
          },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          {
            label: "Quit",
            accelerator: "CmdOrCtrl+Q",
            click: () => promptQuit(BrowserWindow.getFocusedWindow() ?? undefined),
          },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Zoom In",
            accelerator: "CmdOrCtrl++",
            click: () => BrowserWindow.getFocusedWindow()?.webContents.send("zoom:in"),
          },
          {
            label: "Zoom Out",
            accelerator: "CmdOrCtrl+-",
            click: () => BrowserWindow.getFocusedWindow()?.webContents.send("zoom:out"),
          },
          {
            label: "Reset Zoom",
            accelerator: "CmdOrCtrl+0",
            click: () => BrowserWindow.getFocusedWindow()?.webContents.send("zoom:reset"),
          },
        ],
      },
    ];

    // Window menu — includes dev items (Reload, Devtools) only in dev mode.
    // "New Window" (no workspace) and "Add Workspace Window" (another window
    // of the focused window's workspace; omitted when it has none) are pinned
    // at the TOP of this menu with a separator below them.
    template.push({
      label: "Window",
      submenu: [
        // A window with no workspace open: settings, releases, logs…
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => this._newWindow(),
        },
        ...(!focusedHasWorkspace
          ? []
          : [
              {
                label: "Add Workspace Window",
                click: () => this._addWorkspaceWindow(),
              },
              { type: "separator" as const },
            ]),
        ...(!app.isPackaged
          ? [
              {
                label: "Reload",
                accelerator: "CmdOrCtrl+R",
                click: () => {
                  BrowserWindow.getFocusedWindow()?.webContents.reload();
                },
              },
              {
                label: "Devtools",
                accelerator: "Alt+CmdOrCtrl+I",
                click: () => {
                  BrowserWindow.getFocusedWindow()?.webContents.openDevTools({ mode: "detach" });
                },
              },
              { type: "separator" as const },
            ]
          : []),
        { role: "minimize" as const },
        { role: "close" as const },
      ],
    });

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }

  /** The workspace the focused window shows (null: none, or no window focused). */
  private _focusedWorkspacePath(): string | null {
    const bw = BrowserWindow.getFocusedWindow();
    if (!bw || bw.isDestroyed()) return null;
    for (const [id, win] of openp41geWindows) {
      if (win === bw) return openp41geWindowMeta.get(id)?.workspacePath ?? null;
    }
    return null;
  }

  /** Window menu > New Window — a window with no workspace open (its tabs live
   *  in memory, in the default dispatcher). */
  private _newWindow(): void {
    openNewWindow(BrowserWindow.getFocusedWindow() ?? undefined);
  }

  /** Window menu > Add Workspace Window — bind a new window to the focused workspace. */
  private _addWorkspaceWindow(): void {
    const src = BrowserWindow.getFocusedWindow() ?? undefined;
    // Bind the new window to the focused window's workspace binding
    // (fresh central grid — another window of the same workspace).
    let workspacePath: string | null = null;
    if (src) {
      for (const [id, bw] of openp41geWindows) {
        if (bw === src) {
          workspacePath = openp41geWindowMeta.get(id)?.workspacePath ?? null;
          break;
        }
      }
    }
    this.workspaceSessionStore.setCurrentWorkspacePath(workspacePath);
    void this.extensionManager.setWorkspacePath(workspacePath);
    if (workspacePath) {
      const dispatcher = this.registry.getOrCreate(workspacePath);
      dispatcher.apply("newWindow", []);
      const ws = dispatcher.getWorkspace();
      const newWin = ws.windows[ws.windows.length - 1];
      if (newWin) {
        dispatcher.broadcast();
        createOpenp41geWindow(newWin.id, false, src, undefined, undefined, {
          workspacePath,
        });
      }
    } else {
      this._newWindow();
    }
  }

  // ── Step 9: App events ────────────────────────────────────────────────

  private _registerAppEvents(): void {
    // Preserve a workspace's open windows across a full app quit so reopening the
    // workspace restores them (see setAppQuitting). Persist the layout (with all
    // live windows) so closing every window at once saves the full multi-window
    // state for the skeleton to render on relaunch.
    app.on("before-quit", () => {
      setAppQuitting(true);
      // Persist every open workspace (each dispatcher saves to its own file),
      // preserving the full multi-window state.
      this.registry.persistAll();
      // Extensions' cleanups (their synchronous part finishes before exit).
      void this.extensionManager.shutdown();
      for (const watcher of this.reposWatchers.values()) watcher.stop();
      this.cleanupScheduler.stop();
      this.releasesFeed.stop();
      this.workspacesWatcher?.close();
      this.workspaceManifests?.stop();
    });

    app.on("window-all-closed", () => {
      // macOS: keep the app resident in the dock when the last window closes,
      // so clicking the dock icon (the 'activate' handler) opens a window. On
      // other platforms, exit when the last window closes.
      if (process.platform !== "darwin") {
        app.quit();
      }
    });

    // Rebuild the application menu when the focused window changes so it
    // reflects the focused window (one with no workspace omits "Add
    // Workspace Window").
    app.on("browser-window-focus", () => this._setupMenu());
    app.on("browser-window-blur", () => this._setupMenu());

    app.on("activate", () => {
      if (!this.prerequisitesMet) {
        focusPrerequisitesWindow();
        return;
      }
      if (openp41geWindows.size > 0) return;
      const workspaceArg = parseWorkspaceLaunchArg(process.argv);
      if (workspaceArg) {
        this._openWorkspaceSession(workspaceArg);
      } else {
        openNewWindow();
      }
    });
  }
}
