import React, { useEffect, useState } from "react";

function isGroup(entry) {
  return Boolean(entry && "section" in entry);
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === "/") return "";
  return `/${basePath.replace(/^\/+|\/+$/g, "")}`;
}

function docsHref(basePath, urlPath) {
  const base = normalizeBasePath(basePath);
  const path = !urlPath || urlPath === "/"
    ? "/"
    : `/${urlPath.replace(/^\/+|\/+$/g, "")}`;
  return `${base}${path}` || "/";
}

function groupContainsPage(group, currentPageId) {
  return group.pages.some((entry) => (
    isGroup(entry) ? groupContainsPage(entry, currentPageId) : entry.id === currentPageId
  ));
}

function Chevron({ expanded }) {
  return (
    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="14">
      <path d={expanded ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="16">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" width="18">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function SiteSidebar({
  config,
  currentPageId,
  mobile,
  navigation,
  onNavigate,
  sbOpen,
  setSbOpen,
}) {
  const [expanded, setExpanded] = useState(() => (
    navigation.filter((section) => groupContainsPage(section, currentPageId)).map((section) => section.section)
  ));

  useEffect(() => {
    const active = navigation.filter((section) => groupContainsPage(section, currentPageId)).map((section) => section.section);
    setExpanded((current) => [...new Set([...current, ...active])]);
  }, [currentPageId, navigation]);

  useEffect(() => {
    if (!mobile || !sbOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSbOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobile, sbOpen, setSbOpen]);

  const navigate = (event, page) => {
    event.preventDefault();
    onNavigate(page.id);
    if (mobile) setSbOpen(false);
  };

  const openSearch = () => {
    if (mobile) setSbOpen(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }));
  };

  const renderEntries = (entries, depth = 0) => entries.map((entry) => {
    if (isGroup(entry)) {
      const isExpanded = expanded.includes(entry.section);
      return (
        <div key={entry.section} style={{ marginTop: 4 }}>
          <button
            aria-expanded={isExpanded}
            onClick={() => setExpanded((current) => (
              isExpanded ? current.filter((section) => section !== entry.section) : [...current, entry.section]
            ))}
            style={{
              alignItems: "center",
              background: "none",
              border: 0,
              color: "var(--txM)",
              cursor: "pointer",
              display: "flex",
              fontFamily: "var(--font-code)",
              fontSize: 10,
              fontWeight: 600,
              gap: 6,
              letterSpacing: ".08em",
              padding: "7px 10px",
              textTransform: "uppercase",
              width: "100%",
            }}
            type="button"
          >
            <Chevron expanded={isExpanded} />
            {entry.section}
          </button>
          {isExpanded && <div>{renderEntries(entry.pages, depth + 1)}</div>}
        </div>
      );
    }

    const active = currentPageId === entry.id;
    return (
      <a
        aria-current={active ? "page" : undefined}
        href={docsHref(config.basePath, entry.urlPath)}
        key={entry.id}
        onClick={(event) => navigate(event, entry)}
        style={{
          borderLeft: active ? "2px solid var(--ac)" : "2px solid transparent",
          color: active ? "var(--ac)" : "var(--tx2)",
          display: "block",
          fontFamily: "var(--font-body)",
          fontSize: 13,
          fontWeight: active ? 600 : 400,
          lineHeight: 1.35,
          marginLeft: depth * 8,
          padding: "7px 12px",
          textDecoration: "none",
        }}
      >
        {entry.title}
      </a>
    );
  });

  const appLink = config.topNav?.find((link) => link.label.toLowerCase() === "app");

  return (
    <aside
      aria-label="Documentation"
      style={{
        background: "var(--sbBg)",
        borderRight: "1px solid var(--bd)",
        bottom: mobile ? 0 : undefined,
        display: "flex",
        flexDirection: "column",
        left: mobile ? 0 : undefined,
        minWidth: sbOpen ? 270 : 0,
        overflow: "hidden",
        position: mobile ? "fixed" : "relative",
        top: mobile ? 0 : undefined,
        transition: "width .2s, min-width .2s",
        visibility: sbOpen ? "visible" : "hidden",
        width: sbOpen ? 270 : 0,
        zIndex: mobile ? 201 : undefined,
      }}
    >
      <a
        href={docsHref(config.basePath, "/")}
        onClick={(event) => navigate(event, { id: "index" })}
        style={{
          alignItems: "baseline",
          borderBottom: "1px solid var(--bd)",
          color: "inherit",
          display: "flex",
          flexShrink: 0,
          gap: 6,
          padding: mobile ? "17px 56px 17px 20px" : "17px 20px",
          textDecoration: "none",
        }}
      >
        <span style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontStyle: "italic", fontWeight: 700, whiteSpace: "nowrap" }}>
          {config.name}
        </span>
        <span aria-hidden="true" style={{ background: "var(--ac)", borderRadius: "50%", height: 5, width: 5 }} />
      </a>

      {mobile && sbOpen && (
        <button
          aria-label="Close documentation navigation"
          onClick={() => setSbOpen(false)}
          style={{
            alignItems: "center",
            background: "none",
            border: 0,
            color: "var(--txM)",
            cursor: "pointer",
            display: "inline-flex",
            justifyContent: "center",
            minHeight: 40,
            minWidth: 40,
            padding: 8,
            position: "absolute",
            right: 7,
            top: 7,
          }}
          type="button"
        >
          <CloseIcon />
        </button>
      )}

      <div style={{ padding: "12px 14px 8px" }}>
        <button
          onClick={openSearch}
          style={{
            alignItems: "center",
            background: "var(--cdBg)",
            border: "1px solid var(--bd)",
            color: "var(--txM)",
            cursor: "pointer",
            display: "flex",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            gap: 8,
            padding: "8px 10px",
            width: "100%",
          }}
          type="button"
        >
          <SearchIcon />
          <span>Search documentation</span>
        </button>
      </div>

      <nav aria-label="Documentation pages" style={{ flex: 1, overflow: "auto", padding: "0 10px 18px" }}>
        {navigation.map((section) => {
          const isExpanded = expanded.includes(section.section);
          return (
            <div key={section.section} style={{ marginBottom: 4 }}>
              <button
                aria-expanded={isExpanded}
                onClick={() => setExpanded((current) => (
                  isExpanded ? current.filter((name) => name !== section.section) : [...current, section.section]
                ))}
                style={{
                  alignItems: "center",
                  background: "none",
                  border: 0,
                  color: "var(--txM)",
                  cursor: "pointer",
                  display: "flex",
                  fontFamily: "var(--font-code)",
                  fontSize: 10,
                  fontWeight: 600,
                  gap: 6,
                  letterSpacing: ".1em",
                  padding: "8px 10px",
                  textTransform: "uppercase",
                  width: "100%",
                }}
                type="button"
              >
                <Chevron expanded={isExpanded} />
                {section.section}
              </button>
              {isExpanded && <div>{renderEntries(section.pages, 0)}</div>}
            </div>
          );
        })}
      </nav>

      {appLink && (
        <a
          href={appLink.href}
          style={{
            borderTop: "1px solid var(--bd)",
            color: "var(--tx2)",
            fontFamily: "var(--font-body)",
            fontSize: 12,
            fontWeight: 600,
            padding: "13px 16px",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          Open the app <span aria-hidden="true">↗</span>
        </a>
      )}
    </aside>
  );
}
