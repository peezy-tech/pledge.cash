import { parse } from "acorn";

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error);
}

export function assertValidJavaScriptModule(source, label = "JavaScript module") {
  try {
    parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch (error) {
    throw new Error(`${label} is invalid:\n${errorDetail(error)}`, { cause: error });
  }
}
