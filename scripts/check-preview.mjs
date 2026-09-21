import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const config = require("../next.config.js");
const phases = require("next/constants");
const dev = await config(phases.PHASE_DEVELOPMENT_SERVER);
const build = await config(phases.PHASE_PRODUCTION_BUILD);
const start = await config(phases.PHASE_PRODUCTION_SERVER);

assert.notEqual(dev.distDir, build.distDir, "Dev and build must not share output");
assert.equal(build.distDir, start.distDir, "Build and start must share output");

const base = new URL(process.env.PREVIEW_URL || "http://localhost:3002");
const routes = ["/", "/login", "/clients", "/batch/batch-2026-004", "/margin-calls"];
let checked = 0;

for (const route of routes) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
  const html = await response.text();
  const assets = [...new Set(
    [...html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)]
      .map((match) => match[1].replaceAll("&amp;", "&"))
      .filter((path) => /\.(?:js|css)(?:\?|$)/.test(path)),
  )];
  assert(assets.some((path) => /\.js(?:\?|$)/.test(path)), `${route}: no scripts`);
  assert(assets.some((path) => /\.css(?:\?|$)/.test(path)), `${route}: no stylesheet`);
  for (const path of assets) {
    const url = new URL(path, base);
    assert.equal(url.origin, base.origin, "Only inspect local preview assets");
    const asset = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const type = asset.headers.get("content-type") || "";
    await asset.arrayBuffer();
    assert.equal(asset.status, 200, `${route}: ${path} HTTP ${asset.status}`);
    assert(
      url.pathname.endsWith(".css") ? type.includes("text/css") : /javascript/.test(type),
      `${path}: unexpected content type ${type}`,
    );
    checked++;
  }
  process.stdout.write(`PASS ${route}: ${assets.length} assets\n`);
}
process.stdout.write(`PASS isolated output directories; ${routes.length} pages, ${checked} asset responses\n`);
