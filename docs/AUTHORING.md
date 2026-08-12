# Public docs authoring standard

The public docs are a task-oriented companion to the shipped product. They are not a roadmap, a marketing site, or a substitute for contract-level reference.

## Truth rules

1. Verify every app instruction against the current route and visible control before publishing it.
2. Label behavior as **available**, **pending**, or **unavailable**. Never describe a planned or blocked action as executable.
3. Separate three kinds of truth:
   - contract state and authority,
   - app interpretation and completeness,
   - optional hosted-service context.
4. Treat `Unknown`, incomplete history, failed reads, and stale refreshes as incomplete information—not zero.
5. Describe the exact transaction the user is authorizing, including approvals, payment recipient, replacement, and recovery behavior when relevant.
6. Do not imply equity, employment, dividends, legal membership, or offchain governance rights from token ownership.
7. Do not invent fallback tools, wallet connectors, fields, charts, or safety guarantees that the product does not expose.

## Page shape

Task guides should answer, in order:

1. What outcome does this guide produce?
2. What must be true before starting?
3. Where does the user go in the app?
4. What facts should the user verify?
5. What will the wallet request?
6. How is success proven from current state?
7. What should the user do when a read, simulation, transaction, or refresh fails?
8. What is the next relevant guide or concept?

Concept and reference pages should define their scope, identify the contract or product source of truth, and link to a guide that uses the concept.

## Links and deployed base paths

The same docs build is served at `/docs` on `pledge.cash` and `/pledge-cash/docs` on HQ. Use relative links between docs pages. From a grouped docs page, app destinations use two parent segments, for example `../../explore`; from the docs home, use one, for example `../explore`.

Resolve links against the page's published URL, not the Markdown file's directory. A route backed by an `index.md` file is
published without a trailing slash: links from `/developers` therefore use `developers/boardroom`, not `boardroom`.
`docs:check` models this browser behavior.

Every internal docs link must resolve to a page in `docs/pages`, every app handoff must resolve to a known product route, and every public page must appear exactly once in `docs/tome.config.js`.

## Definition of done

Run:

```sh
bun run docs:check
bun run docs:build
bun run format:check
```

The production build fails if canonical metadata, anchor ids, machine artifacts, Pagefind page counts, redirects, or base-aware resources are incomplete. PR CI builds both supported base paths. Then verify the generated site in a real browser. Check search, breadcrumbs, page titles and metadata, app handoffs, desktop navigation, a fresh 320 px viewport, horizontal overflow, and console or page errors.
