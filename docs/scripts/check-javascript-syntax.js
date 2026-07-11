import { assertValidJavaScriptModule } from "./javascript-syntax.js";

assertValidJavaScriptModule("export const valid = true;", "Valid syntax fixture");

let rejectedInvalidFixture = false;
try {
  assertValidJavaScriptModule("export const = ;", "Invalid syntax fixture");
} catch (error) {
  rejectedInvalidFixture = error instanceof Error && error.message.startsWith("Invalid syntax fixture is invalid:");
}

if (!rejectedInvalidFixture) {
  throw new Error("JavaScript syntax validator accepted an invalid module fixture.");
}

console.log(`JavaScript syntax validator rejected invalid input under ${typeof Bun === "undefined" ? "Node" : "Bun"}.`);
