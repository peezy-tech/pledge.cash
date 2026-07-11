import { spawnSync } from "node:child_process";

function errorDetail(error) {
  return error instanceof Error ? error.message : String(error);
}

export function assertValidJavaScriptModule(source, label = "JavaScript module") {
  if (typeof Bun !== "undefined" && typeof Bun.Transpiler === "function") {
    try {
      new Bun.Transpiler({ loader: "js" }).transformSync(source);
      return;
    } catch (error) {
      throw new Error(`${label} is invalid:\n${errorDetail(error)}`, { cause: error });
    }
  }

  const syntaxCheck = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    encoding: "utf8",
    input: source,
  });
  if (syntaxCheck.status !== 0) {
    const detail = syntaxCheck.error?.message || syntaxCheck.stderr?.trim() || "unknown error";
    throw new Error(`${label} is invalid:\n${detail}`, { cause: syntaxCheck.error });
  }
}
