#!/usr/bin/env node
/**
 * Production-bundle guard.
 *
 * Shipping the shim in a release bundle would wrap an app's storage calls in
 * production: the worst possible failure mode for this project. Every shim
 * carries the __RNSI_SHIM__ marker; this script scans release artifacts and
 * fails when it finds one.
 *
 * Usage:
 *   node scripts/check-release-bundle.mjs <bundle.js-or.hbc> [...more]
 *
 * Generate a playground release bundle to verify:
 *   cd apps/playground && npx expo export --platform android
 *   node ../../scripts/check-release-bundle.mjs dist/_expo/static/js/android/*.{js,hbc}
 */
import { readFileSync } from "node:fs";

const MARKER = "__RNSI_SHIM__";
const bundles = process.argv.slice(2);

if (bundles.length === 0) {
  console.error("usage: check-release-bundle.mjs <bundle.js-or.hbc> [...more]");
  process.exit(2);
}

let failed = false;
for (const bundlePath of bundles) {
  const content = readFileSync(bundlePath, "utf8");
  if (content.includes(MARKER)) {
    console.error(`✗ ${bundlePath}: found ${MARKER}; instrumentation leaked into the release bundle`);
    failed = true;
  } else {
    console.log(`✓ ${bundlePath}: clean (${(content.length / 1024).toFixed(0)} KB scanned)`);
  }
}

process.exit(failed ? 1 : 0);
