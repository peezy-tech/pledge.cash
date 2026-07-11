export function normalizeDocsBasePath(value, variableName = "base path") {
  if (typeof value !== "string") throw new Error(`Invalid ${variableName}: ${String(value)}`);
  if (value === "" || value === "/") return "";
  if (!value.startsWith("/") || value.endsWith("/") || value.startsWith("//")) {
    throw new Error(`Invalid ${variableName}: ${value}`);
  }

  const segments = value.slice(1).split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || !/^[A-Za-z0-9._~-]+$/.test(segment))) {
    throw new Error(`Invalid ${variableName}: ${value}`);
  }
  return value;
}
