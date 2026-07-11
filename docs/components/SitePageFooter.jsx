import React from "react";

function runtimeBasePath(currentPageId) {
  if (typeof window === "undefined") return "";
  const pathname = window.location.pathname.replace(/\/+$/, "");
  if (currentPageId === "index") return pathname;
  const routeId = currentPageId.replace(/\/index$/, "");
  const suffix = `/${routeId}`;
  return pathname.endsWith(suffix) ? pathname.slice(0, -suffix.length) : "";
}

function pageHref(basePath, page) {
  const path = page.urlPath ?? `/${page.id}`;
  const normalizedPath = path === "/" ? "/" : `/${path.replace(/^\/+|\/+$/g, "")}`;
  return `${basePath}${normalizedPath}` || "/";
}

function PageLink({ align, basePath, direction, mobile, onNavigate, page }) {
  return (
    <a
      href={pageHref(basePath, page)}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(page.id);
      }}
      style={{
        alignItems: align,
        background: "var(--sf)",
        border: "1px solid var(--bd)",
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        gridColumn: mobile ? "1" : undefined,
        minHeight: 78,
        padding: "15px 18px",
        textDecoration: "none",
      }}
    >
      <span style={{ color: "var(--txM)", fontFamily: "var(--font-code)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>
        {direction === "Previous" ? "← " : ""}{direction}{direction === "Next" ? " →" : ""}
      </span>
      <span style={{ color: "var(--tx)", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, textAlign: align === "flex-end" ? "right" : "left" }}>
        {page.title}
      </span>
    </a>
  );
}

export default function SitePageFooter({
  currentPageId,
  editUrl,
  lastUpdated,
  mobile,
  next,
  onNavigate,
  prev,
}) {
  const basePath = runtimeBasePath(currentPageId);
  const previousPage = currentPageId === "index" || prev?.id === currentPageId ? null : prev;
  const nextPage = next?.id === "index" || next?.id === currentPageId ? null : next;

  return (
    <footer style={{ marginTop: 36 }}>
      {(editUrl || lastUpdated) && (
        <div style={{ alignItems: mobile ? "flex-start" : "center", display: "flex", flexDirection: mobile ? "column" : "row", gap: 8, justifyContent: "space-between", marginBottom: 18 }}>
          {editUrl ? (
            <a href={editUrl} rel="noopener noreferrer" style={{ color: "var(--txM)", fontFamily: "var(--font-body)", fontSize: 12, textDecoration: "none" }} target="_blank">
              Edit this page on GitHub ↗
            </a>
          ) : <span />}
          {lastUpdated && (
            <time dateTime={lastUpdated} style={{ color: "var(--txM)", fontFamily: "var(--font-body)", fontSize: 12 }}>
              Updated {new Date(lastUpdated).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </time>
          )}
        </div>
      )}

      {(previousPage || nextPage) && (
        <nav
          aria-label="Adjacent documentation pages"
          style={{
            borderTop: "1px solid var(--bd)",
            display: "grid",
            gap: 12,
            gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
            paddingBottom: 24,
            paddingTop: 24,
          }}
        >
          {previousPage ? (
            <PageLink align="flex-start" basePath={basePath} direction="Previous" mobile={mobile} onNavigate={onNavigate} page={previousPage} />
          ) : !mobile ? <span /> : null}
          {nextPage && (
            <PageLink align="flex-end" basePath={basePath} direction="Next" mobile={mobile} onNavigate={onNavigate} page={nextPage} />
          )}
        </nav>
      )}
    </footer>
  );
}
