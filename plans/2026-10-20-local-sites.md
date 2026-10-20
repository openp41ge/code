2026-10-20

# Local sites: static sites served on trusted local domains

Status: draft, under discussion

## Goal

Folders in a workspace's repositories that are static websites are served
locally at `https://<name>.<workspace domain>` with a certificate the browser
trusts, with nothing for the user to install or edit by hand.

Two halves, split along the platform / extension line (AGENTS.md §2.1):

- **The platform** owns local name resolution and certificates. Both are
  privileged (root, the keychain) and shared: one resolver, one CA, one set
  of names, which no extension should own alone. Extensions register names
  with it through the SDK.
- **The extension** (`openp41ge-extension-sites`) owns the sites: which
  folders are sites, the HTTP(S) server that serves them, and the UI.

macOS first; Windows and Linux come later, behind the same interfaces.

## Names

- A workspace gets a **domain**, set in the platform's Settings (e.g.
  `acme.test`). It is a new field of the workspace manifest. Unique across
  workspaces; `.test` by default (reserved by RFC 6761). `.local` (mDNS) and
  real public suffixes are refused.
- Names under it follow the workspace's structure:
  - a repository: `<repo>.acme.test`
  - a worktree: `<branch>.<repo>.acme.test`
  - an extension's own label under either: `docs.<repo>.acme.test`,
    `docs.<branch>.<repo>.acme.test`
- Branch and repo names become DNS labels: lower case, `/` and other
  characters become `-`, at most 63 characters (cut with a short hash).
  The platform does this, so every extension names things the same way.
- A name resolves to `127.0.0.1` / `::1` only while it is registered, and
  only while the app runs.

## Platform: the local domain service

### Resolution (DNS)

- A small DNS server in the main process, UDP + TCP on `127.0.0.1` on a high
  port (default 53535, set in `config.json`). It answers A / AAAA for
  registered names, NXDOMAIN for other names under a workspace domain, and
  nothing else (it is not a recursive resolver).
- macOS sends a domain's queries to it through `/etc/resolver/<domain>`
  (`nameserver 127.0.0.1` / `port 53535`). Writing that file needs root:
  one admin prompt (`osascript … with administrator privileges`) when a
  workspace domain is set, one to remove it when it is cleared. No hosts
  file edits.
- Resolver files the platform writes carry a marker comment, and only marked
  files are ever changed or removed.
- Behind an interface (`LocalResolverSetup`): a macOS implementation, an
  in-memory one for tests. Windows (NRPT) and Linux (systemd-resolved) later.

### Certificates

- A local CA, created once: key and certificate in the app data dir (key
  `0600`, never leaves the main process). Built with `@peculiar/x509`
  (WebCrypto), with no openssl or mkcert needed.
- Trusting it is an explicit step in Settings ("Trust local certificates"):
  `security add-trusted-cert -r trustRoot` into the user's login keychain
  (macOS asks for the password). Settings shows whether it is trusted, and can
  remove the trust and the CA.
- Leaf certificates are issued on request for registered names only, short
  lived (e.g. 30 days), renewed automatically, cached in the app data dir.
- Behind interfaces (`CertificateAuthority`, `TrustStore`), with in-memory
  test implementations.

### SDK: `ctx.domains` (backend)

A contract addition in `openp41ge-sdk` (`domains.ts`). The shapes below are a
proposal to confirm, not settled names:

```ts
interface HandlerDomains {
  /** The workspace's domain, or null when none is set. */
  domain(): Promise<string | null>;
  /** Registers a name (repo / worktree / label), resolved while held. */
  register(request: {
    repo?: string;
    worktree?: string; // a branch; needs repo
    label?: string;
  }): Promise<{ ok: true; host: string; release(): void } | { ok: false; error: string }>;
  /** A certificate and key for a host this extension registered. */
  certificate(host: string): Promise<{ cert: string; key: string }>;
}
```

- A host belongs to the extension that registered it. A second claim is
  refused with a clear error (no override, as there is nothing to choose
  between).
- Registrations are released when the extension deactivates, and when its
  workspace's domain changes (the extension is told: a `domains/changed`
  event).

## Extension: `openp41ge-extension-sites`

### Sites

- A site is a folder in a repository: `{ id, repo, folder, label?,
worktrees: "all" | string[], spa?: boolean }`. `folder` is relative to the
  worktree root, so one entry serves the same folder in every worktree, each
  at its own name. Sites are kept per workspace, in the extension's data dir
  in the workspace (`sites.json`).
- Each served worktree gets `[label.]<branch>.<repo>.<domain>`. The repo's
  default branch also gets `[label.]<repo>.<domain>`.

### Server

- One HTTPS server for all sites, routed by SNI (certificate) and `Host`
  (site + worktree → folder), plus HTTP that redirects to HTTPS.
- Ports: 443 / 80 by default (macOS lets a user process bind them). If either
  is taken, it falls back to configured ports, and the URLs show the port.
- Serving: `index.html` for a folder; no path outside the folder (resolved
  with `realpath`, so symlinks out are refused too); MIME types; `ETag` /
  `Last-Modified` with `no-cache`, so an edit shows on reload; a 404 page;
  SPA fallback to `index.html` when the site asks for it; directory listings
  off by default (config).
- Sites start when the workspace opens, and stop on removal and on quit.

### UI

- A sidebar tab, **Sites**: each site with its worktrees' URLs, a status pill
  (serving / folder missing / port taken / domain not set / CA not trusted,
  each linking to what fixes it), open in browser, copy URL, remove.
- Add a site by dropping a folder (`openp41ge/file-path`) on the tab (a drop
  target), or with Add, which picks a folder in a worktree.
- Config (`registerConfigSchema`): ports, directory listings, SPA default.
- Later: live reload (watch + an injected script), a palette search provider
  for "Open <site>".

## Phases

Each phase is test-first in code-tests, ends with typecheck / lint / knip /
format / all tests clean, and is checked in the dev app.

1. **Names**: the label rules, the workspace `domain` field (manifest,
   migration, Settings) and the name registry. Pure, unit-tested.
2. **DNS**: the server (packet parse / answer, unit-tested against recorded
   queries), `LocalResolverSetup` for macOS, and the Settings prompt.
   Checked with `dscacheutil -q host -a name …` and `curl`.
3. **Certificates**: the CA, leaf issuing and renewal, keychain trust, and
   Settings. Checked with `curl` without `-k` and in Safari / Chrome.
4. **SDK**: `ctx.domains`, the ownership rules, release on deactivate, and
   `domains/changed`. Update AGENTS.md §2.9.
5. **Extension**: the site store, the static server (path safety tests
   first), SNI / Host routing, ports and fallback.
6. **Extension UI**: the Sites tab, drop to add, statuses, config schema.
   Bundled with the app as an official extension.

## Open questions

1. **Who binds 443?** As drafted, the sites extension does, so only one
   extension can serve on clean URLs. The alternative is a platform-owned
   front door: the platform listens on 443 / 80 and forwards by host to
   whichever extension registered the name, on its own port. That's more
   platform, but it fits "the platform owns what is shared" as DNS does.
2. **Certificates in the platform?** Drafted there with DNS (one CA, one
   trust prompt for every extension). Confirm.
3. **The `ctx.domains` names and shapes** above, the workspace `domain`
   field, and the extension id `openp41ge-extension-sites`.
4. **Firefox** uses its own certificate store unless it is set to trust the
   OS's. Is it in scope for v1?
5. **Other devices** (a phone on the LAN) are out of scope: names resolve
   and servers listen on loopback only.
