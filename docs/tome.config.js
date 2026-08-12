import { fileURLToPath } from "node:url";

import { normalizeDocsBasePath } from "./base-path.js";

const basePath = normalizeDocsBasePath(
  process.env.PLEDGE_CASH_DOCS_BASE_PATH ?? "/docs",
  "PLEDGE_CASH_DOCS_BASE_PATH",
);

/** @type {import('@tomehq/core').TomeConfig} */
export default {
  name: "pledge.cash",
  basePath,
  branding: {
    powered: false,
  },
  overrides: {
    Header: fileURLToPath(new URL("./components/SiteHeader.jsx", import.meta.url)),
    PageFooter: fileURLToPath(new URL("./components/SitePageFooter.jsx", import.meta.url)),
    Sidebar: fileURLToPath(new URL("./components/SiteSidebar.jsx", import.meta.url)),
    Toc: fileURLToPath(new URL("./components/SiteToc.jsx", import.meta.url)),
  },
  theme: {
    preset: "editorial",
    mode: "auto",
  },
  navigation: [
    {
      group: "Start",
      pages: [
        "index",
        "start/what-is-pledge-cash",
        "start/choose-your-path",
        "start/use-safely",
        "start/networks-and-limitations",
      ],
    },
    {
      group: "Using The App",
      pages: [
        "using/explore",
        "using/project-workspace",
        "using/portfolio",
        "using/grant-details",
        "using/studio",
        "using/transactions-and-wallet",
        "using/tools-and-alerts",
      ],
    },
    {
      group: "Guides",
      pages: [
        "guides/evaluate-and-join",
        "guides/receive-and-settle-grant",
        "guides/create-and-operate-project",
        "guides/wind-down-and-redeem",
      ],
    },
    {
      group: "Understand",
      pages: [
        "understand/boardrooms-and-project-tokens",
        "understand/grants-and-vesting",
        "understand/distributions-and-liquidity",
        "understand/treasury-escrows-and-redemptions",
        "understand/provenance-and-hosted-context",
      ],
    },
    {
      group: "Reference",
      pages: [
        "reference/networks-and-deployments",
        "reference/canonical-identity",
        "reference/troubleshooting",
        "reference/glossary",
      ],
    },
    {
      group: "Developers",
      pages: [
        "developers/index",
        "developers/boardroom",
        "developers/grants",
        "developers/amm-and-liquidity",
        "developers/deployment-and-local-scenarios",
      ],
    },
  ],
  topNav: [
    { label: "App", href: process.env.PLEDGE_CASH_APP_HREF ?? "/" },
    { label: "GitHub", href: "https://github.com/peezy-tech/pledge.cash" },
  ],
};
