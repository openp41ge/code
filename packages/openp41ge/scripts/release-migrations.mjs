#!/usr/bin/env node
/**
 * release-migrations.mjs — the release pipeline's data-migrations step.
 *
 * Merges every instruction set in `--dir` (the repo's `migrations/`) whose
 * `release` is `--version` into one `migrations.json` (`{ release, sets }`,
 * sets in id order) and signs it with the ed25519 private key in the
 * `MIGRATIONS_SIGNING_KEY` environment variable, writing `migrations.json`
 * and `migrations.json.sig` (base64) to `--out`. The app downloads and
 * verifies these (see src/main/services/migrations/release-migrations.ts).
 *
 * A release without sets gets no file. Without the key it fails: a release
 * never carries unsigned migrations. Plain Node, no build step.
 *
 *   node release-migrations.mjs --version 0.1.0-alpha.1 --dir migrations --out release-assets
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (!value) fail(`--${name} is required`);
  return value;
}

function fail(message) {
  console.error(`release-migrations: ${message}`);
  process.exit(1);
}

const version = arg("version").replace(/^v/, "");
const dir = arg("dir");
const out = arg("out");

const sets = [];
for (const name of fs
  .readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .sort()) {
  let set;
  try {
    set = JSON.parse(fs.readFileSync(path.join(dir, name), "utf-8"));
  } catch (err) {
    fail(`${name}: ${err.message}`);
  }
  for (const key of ["id", "description", "release"]) {
    if (typeof set[key] !== "string" || !set[key]) fail(`${name}: ${key} is required`);
  }
  if (!Array.isArray(set.steps)) fail(`${name}: steps must be a list`);
  if (`${set.id}.json` !== name) fail(`${name}: the file must be named ${set.id}.json`);
  if (set.release.replace(/^v/, "") === version) sets.push(set);
}

if (sets.length === 0) {
  console.log(`release-migrations: no data migrations for ${version}`);
  process.exit(0);
}

const key = process.env.MIGRATIONS_SIGNING_KEY;
if (!key) fail("MIGRATIONS_SIGNING_KEY is not set; refusing to publish unsigned migrations");

sets.sort((a, b) => a.id.localeCompare(b.id));
const text = JSON.stringify({ release: version, sets });
let signature;
try {
  signature = crypto.sign(null, Buffer.from(text, "utf-8"), crypto.createPrivateKey(key));
} catch (err) {
  fail(`signing failed: ${err.message}`);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "migrations.json"), text);
fs.writeFileSync(path.join(out, "migrations.json.sig"), signature.toString("base64"));
console.log(
  `release-migrations: ${sets.length} set(s) for ${version}: ${sets.map((s) => s.id).join(", ")}`,
);
