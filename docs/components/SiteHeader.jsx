import React, { useLayoutEffect } from "react";

function isGroup(entry) {
  return Boolean(entry && "section" in entry);
}

function flatten(entries) {
  const pages = [];
  for (const entry of entries) {
    if (isGroup(entry)) pages.push(...flatten(entry.pages));
    else pages.push(entry);
  }
  return pages;
}

function allPages(navigation) {
  return flatten(navigation.flatMap((section) => section.pages));
}

function firstPage(entry) {
  return isGroup(entry) ? flatten(entry.pages)[0] : entry;
}

function breadcrumbTrail(navigation, currentPageId) {
  function search(entries, trail) {
    for (const entry of entries) {
      if (isGroup(entry)) {
        const page = firstPage(entry);
        const found = search(entry.pages, [
          ...trail,
          { label: entry.section, page },
        ]);
        if (found) return found;
      } else if (entry.id === currentPageId) {
        return [...trail, { label: entry.title, page: null }];
      }
    }
    return null;
  }

  for (const section of navigation) {
    const found = search(section.pages, [
      { label: section.section, page: firstPage(section) },
    ]);
    if (found) return found;
  }
  return [];
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

function updateRenderedBreadcrumbs(basePath) {
  const base = normalizeBasePath(basePath);
  if (!base) return;

  for (const anchor of document.querySelectorAll('[data-testid="breadcrumbs"] a')) {
    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith(`${base}/`) || href === base) continue;
    if (href.startsWith("/") && !href.startsWith("//")) {
      anchor.setAttribute("href", `${base}${href}`);
    }
  }
}

function Icon({ children, size = 18 }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

function MenuIcon({ open }) {
  return open ? (
    <Icon><path d="M18 6 6 18M6 6l12 12" /></Icon>
  ) : (
    <Icon><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
  );
}

function SearchIcon() {
  return <Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></Icon>;
}

function ThemeIcon({ dark }) {
  return dark ? (
    <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></Icon>
  ) : (
    <Icon><path d="M20.4 15.5A8.5 8.5 0 0 1 8.5 3.6 8.5 8.5 0 1 0 20.4 15.5Z" /></Icon>
  );
}

function HeaderButton({ label, onClick, children }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      style={{
        alignItems: "center",
        background: "none",
        border: 0,
        color: "var(--txM)",
        cursor: "pointer",
        display: "inline-flex",
        flexShrink: 0,
        justifyContent: "center",
        minHeight: 36,
        minWidth: 36,
        padding: 8,
      }}
      type="button"
    >
      {children}
    </button>
  );
}

export default function SiteHeader({
  basePath = "",
  config,
  currentPageId,
  isDark,
  mobile,
  navigation,
  onNavigate,
  onSearchOpen,
  sbOpen,
  setDark,
  setSbOpen,
}) {
  const pages = allPages(navigation);
  const currentPage = pages.find((page) => page.id === currentPageId);
  const breadcrumbs = breadcrumbTrail(navigation, currentPageId);
  const appLink = config.topNav?.find((link) => link.label.toLowerCase() === "app");
  const extraLinks = config.topNav?.filter((link) => link !== appLink) ?? [];

  useLayoutEffect(() => {
    const siteName = config.name || "pledge.cash";
    document.title = currentPage?.title
      ? `${currentPage.title} | ${siteName}`
      : `${siteName} docs`;
    updateRenderedBreadcrumbs(basePath);
  }, [basePath, config.name, currentPage?.title, currentPageId]);

  const navigate = (event, page) => {
    event.preventDefault();
    onNavigate(page.id);
  };

  return (
    <header
      style={{
        alignItems: "center",
        backdropFilter: "blur(12px)",
        background: "var(--hdBg)",
        borderBottom: "1px solid var(--bd)",
        display: "flex",
        gap: mobile ? 4 : 12,
        maxWidth: "100vw",
        minHeight: mobile ? 52 : 48,
        overflow: "hidden",
        padding: mobile ? "6px 8px" : "6px 16px",
        position: "relative",
        zIndex: 200,
      }}
    >
      <HeaderButton
        label={sbOpen ? "Close documentation navigation" : "Open documentation navigation"}
        onClick={() => setSbOpen(!sbOpen)}
      >
        <MenuIcon open={sbOpen} />
      </HeaderButton>

      {mobile ? (
        <span
          style={{
            color: "var(--ac)",
            flex: 1,
            fontFamily: "var(--font-code)",
            fontSize: 12,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentPage?.title ?? "Documentation"}
        </span>
      ) : (
        <nav
          aria-label="Current documentation location"
          style={{
            alignItems: "center",
            color: "var(--txM)",
            display: "flex",
            flex: 1,
            fontFamily: "var(--font-code)",
            fontSize: 11,
            gap: 8,
            letterSpacing: ".03em",
            minWidth: 0,
          }}
        >
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={`${crumb.label}-${index.toString()}`}>
              {index > 0 && <span aria-hidden="true">/</span>}
              {crumb.page ? (
                <a
                  href={docsHref(basePath, crumb.page.urlPath)}
                  onClick={(event) => navigate(event, crumb.page)}
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  {crumb.label}
                </a>
              ) : (
                <span
                  aria-current="page"
                  style={{ color: "var(--ac)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      {appLink && (
        <a
          data-testid="app-handoff"
          href={appLink.href}
          style={{
            alignItems: "center",
            border: mobile ? "1px solid var(--bd)" : 0,
            color: mobile ? "var(--tx)" : "var(--txM)",
            display: "inline-flex",
            flexShrink: 0,
            fontFamily: "var(--font-body)",
            fontSize: 12,
            fontWeight: 600,
            minHeight: mobile ? 34 : "auto",
            padding: mobile ? "6px 9px" : "4px",
            textDecoration: "none",
          }}
        >
          App<span aria-hidden="true" style={{ marginLeft: 4 }}>↗</span>
        </a>
      )}

      {!mobile && extraLinks.map((link) => (
        <a
          href={link.href}
          key={link.label}
          rel="noopener noreferrer"
          style={{ color: "var(--txM)", fontFamily: "var(--font-body)", fontSize: 12, textDecoration: "none" }}
          target="_blank"
        >
          {link.label}
        </a>
      ))}

      <HeaderButton label="Search documentation" onClick={onSearchOpen}>
        <SearchIcon />
      </HeaderButton>

      {config.theme?.mode === "auto" && (
        <HeaderButton
          label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setDark((dark) => !dark)}
        >
          <ThemeIcon dark={isDark} />
        </HeaderButton>
      )}
    </header>
  );
}
