export function isUnmodifiedPrimaryClick(event) {
  return event.button === 0
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey;
}

export function normalizeBasePath(basePath) {
  if (!basePath || basePath === "/") return "";
  return `/${basePath.replace(/^\/+|\/+$/g, "")}`;
}

export function docsHref(basePath, urlPath) {
  const base = normalizeBasePath(basePath);
  const path = !urlPath || urlPath === "/"
    ? "/"
    : `/${urlPath.replace(/^\/+|\/+$/g, "")}`;
  return `${base}${path}` || "/";
}
