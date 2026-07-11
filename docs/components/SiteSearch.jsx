import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { docsHref, isUnmodifiedPrimaryClick, normalizeBasePath } from "./navigation.js";

function excerptText(value) {
  const container = document.createElement("div");
  container.innerHTML = value ?? "";
  return container.textContent
    ?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/(^|\s)#{1,6}\s*/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
}

function withoutDuplicateTitle(value, title) {
  if (!value || !title) return value;
  let excerpt = value;
  while (excerpt.toLocaleLowerCase().startsWith(title.toLocaleLowerCase())) {
    const next = excerpt.slice(title.length).replace(/^[\s:;,.\-–—]+/, "").trim();
    if (!next || next === excerpt) break;
    excerpt = next;
  }
  return excerpt;
}

function resultId(value) {
  return (value ?? "")
    .split(/[?#]/, 1)[0]
    .replace(/^\/+/, "")
    .replace(/\/index\.html$/, "")
    .replace(/\.html$/, "")
    .replace(/\/$/, "") || "index";
}

function fallbackResults(pages, query) {
  const needle = query.trim().toLocaleLowerCase();
  return pages
    .filter((page) => `${page.title} ${page.description ?? ""}`.toLocaleLowerCase().includes(needle))
    .slice(0, 8)
    .map((page) => ({ ...page, excerpt: page.description ?? "" }));
}

export default function SiteSearch({ basePath, mobile, onClose, onNavigate, pages, returnFocus }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [resultQuery, setResultQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [status, setStatus] = useState("Type to search all documentation");
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const requestGenerationRef = useRef(0);
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const activeResults = resultQuery === query.trim() ? results : [];
  const activeOptionId = activeResults[selected] ? `docs-search-result-${selected.toString()}` : undefined;

  useEffect(() => {
    const root = document.getElementById("tome-root");
    const previousOverflow = document.body.style.overflow;
    const previousInert = root?.inert ?? false;
    const previousAriaHidden = root?.getAttribute("aria-hidden");

    if (root) {
      root.inert = true;
      root.setAttribute("aria-hidden", "true");
    }
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => inputRef.current?.focus());

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      if (root) {
        root.inert = previousInert;
        if (previousAriaHidden === null) root.removeAttribute("aria-hidden");
        else root.setAttribute("aria-hidden", previousAriaHidden);
      }
      requestAnimationFrame(() => {
        const fallback = document.querySelector('header button[aria-label="Search documentation"]');
        const target = returnFocus?.isConnected ? returnFocus : fallback;
        target?.focus();
      });
    };
  }, [onClose, returnFocus]);

  useEffect(() => {
    const trimmed = query.trim();
    const requestGeneration = requestGenerationRef.current;
    if (!trimmed) {
      setResults([]);
      setResultQuery("");
      setSelected(0);
      setStatus("Type to search all documentation");
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (cancelled || requestGeneration !== requestGenerationRef.current) return;
      setStatus("Searching documentation");
      try {
        const base = normalizeBasePath(basePath);
        const pagefindUrl = new URL("_pagefind/pagefind.js", `${window.location.origin}${base || ""}/`).href;
        const pagefind = await import(/* @vite-ignore */ pagefindUrl);
        const search = await pagefind.search(trimmed);
        const items = [];
        const seen = new Set();
        for (const result of search.results.slice(0, 8)) {
          const data = await result.data();
          const id = resultId(data.url);
          const page = pageById.get(id);
          if (!page || seen.has(id)) continue;
          seen.add(id);
          const excerpt = withoutDuplicateTitle(excerptText(data.excerpt), page.title);
          items.push({ ...page, excerpt: excerpt || page.description || "" });
        }
        if (!cancelled && requestGeneration === requestGenerationRef.current) {
          setResults(items);
          setResultQuery(trimmed);
          setSelected(0);
          setStatus(items.length === 1 ? "1 result" : `${items.length.toString()} results`);
        }
      } catch {
        const items = fallbackResults(pages, trimmed);
        if (!cancelled && requestGeneration === requestGenerationRef.current) {
          setResults(items);
          setResultQuery(trimmed);
          setSelected(0);
          setStatus(items.length === 1 ? "1 title match" : `${items.length.toString()} title matches`);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [basePath, pageById, pages, query]);

  const closeFromBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  const keepFocusInside = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll(
      'a[href]:not([tabindex="-1"]), button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const moveSelection = (event) => {
    if (event.key === "ArrowDown" && activeResults.length > 0) {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, activeResults.length - 1));
    } else if (event.key === "ArrowUp" && activeResults.length > 0) {
      event.preventDefault();
      setSelected((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && activeResults[selected]) {
      event.preventDefault();
      onNavigate(activeResults[selected].id);
      onClose();
    }
  };

  const chooseResult = (event, page) => {
    if (!isUnmodifiedPrimaryClick(event) || resultQuery !== query.trim()) return;
    event.preventDefault();
    onNavigate(page.id);
    onClose();
  };

  return createPortal(
    <div
      onMouseDown={closeFromBackdrop}
      style={{
        alignItems: mobile ? "stretch" : "flex-start",
        backdropFilter: "blur(6px)",
        background: "rgba(0, 0, 0, .58)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        paddingTop: mobile ? 0 : "10vh",
        position: "fixed",
        zIndex: 1000,
      }}
    >
      <section
        aria-labelledby="docs-search-title"
        aria-modal="true"
        onKeyDown={keepFocusInside}
        ref={dialogRef}
        role="dialog"
        style={{
          background: "var(--sf)",
          border: mobile ? 0 : "1px solid var(--bd)",
          boxShadow: mobile ? "none" : "0 24px 80px rgba(0, 0, 0, .4)",
          color: "var(--tx)",
          display: "flex",
          flexDirection: "column",
          height: mobile ? "100%" : "auto",
          maxHeight: mobile ? "100%" : "76vh",
          maxWidth: mobile ? "100%" : 560,
          overflow: "hidden",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", borderBottom: "1px solid var(--bd)", display: "flex", gap: 10, padding: "14px 16px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="docs-search-title" style={{ fontFamily: "var(--font-code)", fontSize: 10, fontWeight: 600, letterSpacing: ".1em", marginBottom: 6, textTransform: "uppercase" }}>
              Search documentation
            </div>
            <input
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              aria-controls="docs-search-results"
              aria-expanded={activeResults.length > 0}
              aria-label="Search documentation"
              onChange={(event) => {
                const value = event.target.value;
                requestGenerationRef.current += 1;
                setQuery(value);
                setResults([]);
                setResultQuery("");
                setSelected(0);
                setStatus(value.trim() ? "Searching documentation" : "Type to search all documentation");
              }}
              onKeyDown={moveSelection}
              placeholder="Search concepts, tasks, or contract behavior"
              ref={inputRef}
              role="combobox"
              style={{ background: "none", border: 0, color: "var(--tx)", fontFamily: "var(--font-body)", fontSize: 16, outline: 0, width: "100%" }}
              type="search"
              value={query}
            />
          </div>
          <button
            aria-label="Close search"
            onClick={onClose}
            style={{ alignItems: "center", background: "none", border: "1px solid var(--bd)", color: "var(--tx)", cursor: "pointer", display: "inline-flex", fontSize: 22, height: 40, justifyContent: "center", width: 40 }}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div aria-live="polite" style={{ color: "var(--txM)", fontFamily: "var(--font-code)", fontSize: 10, padding: "8px 16px 0" }}>
          {status}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px" }}>
          <div aria-label="Search results" id="docs-search-results" role="listbox">
            {activeResults.map((page, index) => (
              <a
                aria-selected={index === selected}
                href={docsHref(basePath, page.urlPath)}
                id={`docs-search-result-${index.toString()}`}
                key={page.id}
                onClick={(event) => chooseResult(event, page)}
                onMouseEnter={() => setSelected(index)}
                role="option"
                style={{
                  background: index === selected ? "var(--acD)" : "transparent",
                  color: "var(--tx)",
                  display: "block",
                  padding: "11px 12px",
                  textDecoration: "none",
                }}
                tabIndex={-1}
              >
                <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{page.title}</span>
                {page.excerpt && <span style={{ color: "var(--txM)", display: "block", fontSize: 12, lineHeight: 1.4 }}>{page.excerpt}</span>}
              </a>
            ))}
          </div>
          {query.trim() && status !== "Searching documentation" && activeResults.length === 0 && (
            <p style={{ color: "var(--txM)", fontSize: 14, padding: "28px 12px", textAlign: "center" }}>No results found.</p>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
