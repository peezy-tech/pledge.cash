Paginated queries are [queries](https://docs.convex.dev/functions/query-functions) that return a list of results in incremental pages.

This can be used to build components with "Load More" buttons or "infinite scroll" UIs where more results are loaded as the user scrolls.

**Example:**[Paginated Messaging App](https://github.com/get-convex/convex-demos/tree/main/pagination)

Using pagination in Convex is as simple as:

1. Writing a paginated query function that calls[`.paginate(paginationOpts)`](https://docs.convex.dev/api/interfaces/server.OrderedQuery#paginate).
2. Using the [`usePaginatedQuery`](https://docs.convex.dev/api/modules/react#usepaginatedquery) React hook.

Like other Convex queries, paginated queries are completely reactive.

## Writing paginated query functions

Convex uses cursor-based pagination. This means that paginated queries return a string called a [`Cursor`](https://docs.convex.dev/api/modules/server#cursor) that represents the point in the results that the current page ended. To load more results, you simply call the query function again, passing in the cursor.

To build this in Convex, define a query function that:

1. Takes in a single arguments object with a `paginationOpts` property of type [`PaginationOptions`](https://docs.convex.dev/api/interfaces/server.PaginationOptions).
	- `PaginationOptions` is an object with `numItems` and `cursor` fields.
	- Use `paginationOptsValidator` exported from `"convex/server"` to [validate](https://docs.convex.dev/functions/validation) this argument
	- The arguments object may include properties as well.
2. Calls[`.paginate(paginationOpts)`](https://docs.convex.dev/api/interfaces/server.OrderedQuery#paginate) on a [database query](https://docs.convex.dev/database/reading-data/), passing in the `PaginationOptions` and returning its result.
	- The returned `page` in the [`PaginationResult`](https://docs.convex.dev/api/interfaces/server.PaginationResult) is an array of documents. You may [`map`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map) or [`filter`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/filter) it before returning it.
```ts
convex/messages.tsimport { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const foo = await ctx.db
      .query("messages")
      .order("desc")
      .paginate(args.paginationOpts);
    return foo;
  },
});
```

### Additional arguments

You can define paginated query functions that take arguments in addition to `paginationOpts`:

```ts
convex/messages.tsexport const listWithExtraArg = query({
  args: { paginationOpts: paginationOptsValidator, author: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .filter((q) => q.eq(q.field("author"), args.author))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
```

### Transforming results

You can apply arbitrary [transformations](https://docs.convex.dev/database/reading-data/#more-complex-queries) to the `page` property of the object returned by `paginate`, which contains the array of documents:

```ts
convex/messages.tsexport const listWithTransformation = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("messages")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...results,
      page: results.page.map((message) => ({
        author: message.author.slice(0, 1),
        body: message.body.toUpperCase(),
      })),
    };
  },
});
```

## Paginating within React Components

To paginate within a React component, use the [`usePaginatedQuery`](https://docs.convex.dev/api/modules/react#usepaginatedquery) hook. This hook gives you a simple interface for rendering the current items and requesting more. Internally, this hook manages the continuation cursors.

The arguments to this hook are:

- The name of the paginated query function.
- The arguments object to pass to the query function, excluding the `paginationOpts` (that's injected by the hook).
- An options object with the `initialNumItems` to load on the first page.

The hook returns an object with:

- `results`: An array of the currently loaded results.
- `isLoading` - Whether the hook is currently loading results.
- `status`: The status of the pagination. The possible statuses are:
	- `"LoadingFirstPage"`: The hook is loading the first page of results.
	- `"CanLoadMore"`: This query may have more items to fetch. Call `loadMore` to fetch another page.
	- `"LoadingMore"`: We're currently loading another page of results.
	- `"Exhausted"`: We've paginated to the end of the list.
- `loadMore(n)`: A callback to fetch more results. This will only fetch more results if the status is `"CanLoadMore"`.
```tsx
src/App.tsximport { usePaginatedQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export function App() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.list,
    {},
    { initialNumItems: 5 },
  );
  return (
    <div>
      {results?.map(({ _id, body }) => <div key={_id}>{body}</div>)}
      <button onClick={() => loadMore(5)} disabled={status !== "CanLoadMore"}>
        Load More
      </button>
    </div>
  );
}
```

You can also pass additional arguments in the arguments object if your function expects them:

```tsx
src/App.tsximport { usePaginatedQuery } from "convex/react";
import { api } from "../convex/_generated/api";

export function App() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.listWithExtraArg,
    { author: "Alex" },
    { initialNumItems: 5 },
  );
  return (
    <div>
      {results?.map(({ _id, body }) => <div key={_id}>{body}</div>)}
      <button onClick={() => loadMore(5)} disabled={status !== "CanLoadMore"}>
        Load More
      </button>
    </div>
  );
}
```

### Reactivity

Like any other Convex query functions, paginated queries are **completely reactive**. Your React components will automatically rerender if items in your paginated list are added, removed or changed.

One consequence of this is that **page sizes in Convex may change!** If you request a page of 10 items and then one item is removed, this page may "shrink" to only have 9 items. Similarly if new items are added, a page may "grow" beyond its initial size.

## Paginating manually

If you're paginating outside of React, you can manually call your paginated function multiple times to collect the items:

```ts
download.tsimport { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

require("dotenv").config();

const client = new ConvexHttpClient(process.env.VITE_CONVEX_URL!);

/**
 * Logs an array containing all messages from the paginated query "listMessages"
 * by combining pages of results into a single array.
 */
async function getAllMessages() {
  let continueCursor = null;
  let isDone = false;
  let page;

  const results = [];

  while (!isDone) {
    ({ continueCursor, isDone, page } = await client.query(api.messages.list, {
      paginationOpts: { numItems: 5, cursor: continueCursor },
    }));
    console.log("got", page.length);
    results.push(...page);
  }

  console.log(results);
}

getAllMessages();
```