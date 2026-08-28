import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readProjectFile = (path) => readFile(new URL(path, `file://${projectRoot}`));

const docs = JSON.parse(await readProjectFile("docs.json"));
assert.equal(
  docs.colors.primary,
  "#0e7f85",
  "The light-theme primary color must meet text contrast requirements",
);
assert.equal(
  docs.colors.light,
  "#43c9cb",
  "Dark mode must retain Mermail cyan",
);
const documentationTab = docs.navigation.tabs.find(
  ({ tab }) => tab === "Documentation",
);
const resources = documentationTab?.groups.find(
  ({ group }) => group === "Resources",
);

assert.ok(resources, "Documentation must include a Resources group");

const supportIndex = resources.pages.indexOf("resources/support");
assert.notEqual(supportIndex, -1, "Resources must include Support");
assert.equal(
  resources.pages[supportIndex + 1],
  "resources/brand-guideline",
  "Brand guideline must appear immediately after Support",
);

const page = await readProjectFile("resources/brand-guideline.mdx").then((file) =>
  file.toString("utf8"),
);

for (const expected of [
  'title: "Brand guideline"',
  'description: "',
  'icon: "palette"',
  "## Logo assets",
  "## Logo use",
  "## Color palette",
  "## Typography",
  "## Accessibility",
  "/images/brand/mermail-mark.svg",
  "/images/brand/mermail-mark.png",
  "/images/brand/mermail-logo-black.svg",
]) {
  assert.ok(page.includes(expected), `Brand guideline must include ${expected}`);
}

const assets = [
  ["images/brand/mermail-mark.svg", "<svg"],
  ["images/brand/mermail-logo-black.svg", "<svg"],
];

for (const [path, signature] of assets) {
  const asset = await readProjectFile(path);
  assert.ok(asset.byteLength > 0, `${path} must not be empty`);
  assert.ok(asset.toString("utf8").includes(signature), `${path} must be SVG`);
}

const png = await readProjectFile("images/brand/mermail-mark.png");
assert.ok(png.byteLength > 0, "PNG mark must not be empty");
assert.deepEqual(
  [...png.subarray(0, 8)],
  [137, 80, 78, 71, 13, 10, 26, 10],
  "PNG mark must have a valid PNG signature",
);

console.log("Brand guideline contract passed.");
