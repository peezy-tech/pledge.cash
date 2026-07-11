import React from "react";

export default function SiteToc({ activeHeadingId, headings }) {
  return (
    <aside
      data-testid="toc-sidebar"
      style={{ alignSelf: "flex-start", flexShrink: 0, padding: "40px 16px 40px 0", position: "sticky", top: 0, width: 200 }}
    >
      <div style={{ color: "var(--txM)", fontFamily: "var(--font-code)", fontSize: 10, fontWeight: 600, letterSpacing: ".1em", marginBottom: 12, textTransform: "uppercase" }}>
        On this page
      </div>
      <nav aria-label="Table of contents" style={{ borderLeft: "1px solid var(--bd)" }}>
        {headings.map((heading) => {
          const active = activeHeadingId === heading.id;
          return (
            <a
              aria-current={active ? "location" : undefined}
              data-testid={`toc-link-${heading.id}`}
              href={`#${heading.id}`}
              key={heading.id}
              style={{
                borderLeft: active ? "2px solid var(--ac)" : "2px solid transparent",
                color: active ? "var(--ac)" : "var(--txM)",
                display: "block",
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                lineHeight: 1.4,
                marginLeft: -1,
                padding: `4px 12px 4px ${(12 + (heading.depth - 2) * 12).toString()}px`,
                textDecoration: "none",
              }}
            >
              {heading.text}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
