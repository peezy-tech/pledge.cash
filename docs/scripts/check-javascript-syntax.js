import { assertValidJavaScriptModule } from "./javascript-syntax.js";

assertValidJavaScriptModule("export const valid = async () => import.meta.url;", "Valid syntax fixture");

const invalidFixtures = [
  ["Malformed syntax fixture", "export const = ;"],
  ["Top-level return fixture", "return 1;"],
  ["Strict with-statement fixture", "with ({}) {}"],
  ["Strict delete fixture", "const value = 1; delete value;"],
];

for (const [label, source] of invalidFixtures) {
  let rejected = false;
  try {
    assertValidJavaScriptModule(source, label);
  } catch (error) {
    rejected = error instanceof Error && error.message.startsWith(`${label} is invalid:`);
  }
  if (!rejected) throw new Error(`JavaScript syntax validator accepted ${label.toLowerCase()}.`);
}

console.log(`JavaScript module validator rejected ${invalidFixtures.length.toString()} invalid fixtures under ${typeof Bun === "undefined" ? "Node" : "Bun"}.`);
