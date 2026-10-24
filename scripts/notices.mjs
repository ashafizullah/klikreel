// Writes THIRD_PARTY_NOTICES.md: the license of every package bundled into the
// app's frontend (the app shows it under Settings → Open-source licenses).
// Run with `bun run notices` after changing dependencies.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Packages whose npm release has no license file: the terms from their source headers. */
const MISSING = {
  gsap: `Copyright 2008-2026, GreenSock. All rights reserved.
Subject to the terms at https://gsap.com/standard-license.`,
};

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function licenseText(dir, name) {
  const files = readdirSync(dir);
  // Dual-licensed packages (MIT OR Apache-2.0) are used under MIT.
  const file = files.find((f) => /^licen[cs]e-mit/i.test(f)) ?? files.find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  if (file) return readFileSync(join(dir, file), "utf8").trim();
  if (MISSING[name]) return MISSING[name];
  // Tauri's plugins ship only an SPDX file; their MIT text is the Tauri project's.
  if (name.startsWith("@tauri-apps/")) return licenseText(join(root, "node_modules/@tauri-apps/api"), "@tauri-apps/api");
  throw new Error(`No license text for ${name}`);
}

const parts = Object.keys(pkg.dependencies)
  .sort()
  .map((name) => {
    const dir = join(root, "node_modules", name);
    if (!existsSync(dir)) throw new Error(`${name} is not installed`);
    const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return `## ${name} ${meta.version} (${meta.license})\n\n\`\`\`\n${licenseText(dir, name)}\n\`\`\``;
  });

writeFileSync(
  join(root, "THIRD_PARTY_NOTICES.md"),
  `# Third-party notices\n\nKlikReel includes the following third-party software.\n\n${parts.join("\n\n")}\n`,
);
console.log(`THIRD_PARTY_NOTICES.md: ${parts.length} packages`);
