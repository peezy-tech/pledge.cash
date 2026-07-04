/** @type {import('@tomehq/core').TomeConfig} */
export default {
  name: "pledge.cash",
  basePath: process.env.PLEDGE_CASH_DOCS_BASE_PATH ?? "/docs",
  theme: {
    preset: "editorial",
    mode: "auto",
    accent: "#84cc16",
  },
  navigation: [
    { group: "Start", pages: ["index"] },
    {
      group: "Personas",
      pages: [
        "personas/founders",
        "personas/buyers-holders",
        "personas/advisors-contractors",
      ],
    },
    {
      group: "Concepts",
      pages: [
        "concepts/boardrooms",
        "concepts/token-grants",
        "concepts/sales-liquidity",
        "concepts/wind-down",
        "concepts/protocol-and-service-layer",
      ],
    },
    {
      group: "Walkthroughs",
      pages: [
        "walkthroughs/launch-boardroom",
        "walkthroughs/receive-settle-grant",
        "walkthroughs/buy-from-sale-or-curve",
      ],
    },
    {
      group: "Flows",
      pages: [
        "flows/launch-boardroom",
        "flows/buy-or-hold",
        "flows/receive-grant",
      ],
    },
    {
      group: "Reference",
      pages: [
        "reference/glossary",
        "reference/deployments",
      ],
    },
  ],
  topNav: [
    { label: "App", href: process.env.PLEDGE_CASH_APP_HREF ?? "/" },
    { label: "GitHub", href: "https://github.com/peezy-tech/pledge.cash" },
  ],
};
