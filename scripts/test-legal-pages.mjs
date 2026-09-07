import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const readProjectFile = (path) =>
  readFile(new URL(path, `file://${projectRoot}`), "utf8");

const docs = JSON.parse(await readProjectFile("docs.json"));
const documentationTab = docs.navigation.tabs.find(
  ({ tab }) => tab === "Documentation",
);

assert.ok(documentationTab, "Documentation tab must exist");

const groupNames = documentationTab.groups.map(({ group }) => group);
const legalIndex = groupNames.indexOf("Legal");
const resourcesIndex = groupNames.indexOf("Resources");

assert.notEqual(legalIndex, -1, "Documentation must include a Legal group");
assert.notEqual(resourcesIndex, -1, "Documentation must include a Resources group");
assert.equal(
  legalIndex + 1,
  resourcesIndex,
  "Legal must appear immediately before Resources",
);

const legal = documentationTab.groups[legalIndex];
assert.deepEqual(
  legal.pages,
  ["legal/terms-of-service", "legal/privacy-policy"],
  "Legal pages must match the requested order",
);

const pageContracts = [
  {
    path: "legal/terms-of-service.mdx",
    sectionCount: 21,
    expected: [
      'title: "Terms of Service"',
      'description: "',
      'icon: "file-check"',
      "noindex: true",
      "**Last updated:** July 16, 2026",
      "**Contracting party:** Nudgen LLC",
      "## 1. Agreement to these Terms",
      "## 21. Contact information",
      "[Privacy Policy](/legal/privacy-policy)",
      "[controlling Terms of Service](https://mermail.app/terms)",
    ],
  },
  {
    path: "legal/privacy-policy.mdx",
    sectionCount: 19,
    expected: [
      'title: "Privacy Policy"',
      'description: "',
      'icon: "shield-check"',
      "noindex: true",
      "**Last updated:** July 16, 2026",
      "**Company:** Nudgen LLC",
      "## 1. Scope",
      "## 19. Contact us",
      "[Terms of Service](/legal/terms-of-service)",
      "[controlling Privacy Policy](https://mermail.app/privacy)",
    ],
  },
];

for (const { path, sectionCount, expected } of pageContracts) {
  const page = await readProjectFile(path);

  for (const value of expected) {
    assert.ok(page.includes(value), `${path} must include ${value}`);
  }

  assert.ok(
    !page.includes("Mermail LLC"),
    `${path} must use the current legal entity`,
  );
  assert.equal(
    page.match(/^## \d+\./gm)?.length,
    sectionCount,
    `${path} must include every policy section`,
  );
}

console.log("Legal pages contract passed.");
