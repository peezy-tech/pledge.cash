Actions can call third party services to do things such as processing a payment with [Stripe](https://stripe.com/). They can be run in Convex's JavaScript environment or in Node.js. They can interact with the database indirectly by calling [queries](https://docs.convex.dev/functions/query-functions) and [mutations](https://docs.convex.dev/functions/mutation-functions).

**Example:**[GIPHY Action](https://github.com/get-convex/convex-demos/tree/main/giphy-action)

## Action names

Actions follow the same naming rules as queries, see [Query names](https://docs.convex.dev/functions/query-functions#query-names).

## The action constructor

To declare an action in Convex you use the action constructor function. Pass it an object with a `handler` function, which performs the action:

```ts
convex/myFunctions.tsimport { action } from "./_generated/server";

export const doSomething = action({
  handler: () => {
    // implementation goes here

    // optionally return a value
    return "success";
  },
});
```

Unlike a query, an action can but does not have to return a value.

### Action arguments and responses

Action arguments and responses follow the same rules as [mutations](https://docs.convex.dev/functions/mutation-functions#mutation-arguments):

```ts
convex/myFunctions.tsimport { action } from "./_generated/server";
import { v } from "convex/values";

export const doSomething = action({
  args: { a: v.number(), b: v.number() },
  handler: (_, args) => {
    // do something with \`args.a\` and \`args.b\`

    // optionally return a value
    return "success";
  },
});
```

The first argument to the handler function is reserved for the action context.

### Action context

The `action` constructor enables interacting with the database, and other Convex features by passing an [ActionCtx](https://docs.convex.dev/api/interfaces/server.GenericActionCtx) object to the handler function as the first argument:

```ts
convex/myFunctions.tsimport { action } from "./_generated/server";
import { v } from "convex/values";

export const doSomething = action({
  args: { a: v.number(), b: v.number() },
  handler: (ctx, args) => {
    // do something with \`ctx\`
  },
});
```

Which part of that action context is used depends on what your action needs to do:

- To read data from the database use the `runQuery` field, and call a query that performs the read:
	```ts
	convex/myFunctions.tsimport { action, internalQuery } from "./_generated/server";
	import { internal } from "./_generated/api";
	import { v } from "convex/values";
	export const doSomething = action({
	  args: { a: v.number() },
	  handler: async (ctx, args) => {
	    const data = await ctx.runQuery(internal.myFunctions.readData, {
	      a: args.a,
	    });
	    // do something with \`data\`
	  },
	});
	export const readData = internalQuery({
	  args: { a: v.number() },
	  handler: async (ctx, args) => {
	    // read from \`ctx.db\` here
	  },
	});
	```
	Here `readData` is an [internal query](https://docs.convex.dev/functions/internal-functions) because we don't want to expose it to the client directly. Actions, mutations and queries can be defined in the same file.
- To write data to the database use the `runMutation` field, and call a mutation that performs the write:
	```ts
	convex/myFunctions.tsimport { v } from "convex/values";
	import { action } from "./_generated/server";
	import { internal } from "./_generated/api";
	export const doSomething = action({
	  args: { a: v.number() },
	  handler: async (ctx, args) => {
	    const data = await ctx.runMutation(internal.myMutations.writeData, {
	      a: args.a,
	    });
	    // do something else, optionally use \`data\`
	  },
	});
	```
	Use an [internal mutation](https://docs.convex.dev/functions/internal-functions) when you want to prevent users from calling the mutation directly.
	As with queries, it's often convenient to define actions and mutations in the same file.
- To generate upload URLs for storing files use the `storage` field. Read on about [File Storage](https://docs.convex.dev/file-storage).
- To check user authentication use the `auth` field. Auth is propagated automatically when calling queries and mutations from the action. Read on about [Authentication](https://docs.convex.dev/auth).
- To schedule functions to run in the future, use the `scheduler` field. Read on about [Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions).
- To search a vector index, use the `vectorSearch` field. Read on about [Vector Search](https://docs.convex.dev/search/vector-search).

### Dealing with circular type inference

## Choosing the runtime ("use node")

Actions can run in Convex's custom JavaScript environment or in Node.js.

By default, actions run in Convex's environment. This environment supports `fetch`, so actions that simply want to call a third-party API using `fetch` can be run in this environment:

```ts
convex/myFunctions.tsimport { action } from "./_generated/server";

export const doSomething = action({
  args: {},
  handler: async () => {
    const data = await fetch("https://api.thirdpartyservice.com");
    // do something with data
  },
});
```

Actions running in Convex's environment are faster compared to Node.js, since they don't require extra time to start up before running your action (cold starts). They can also be defined in the same file as other Convex functions. Like queries and mutations they can import NPM packages, but not all are supported.

Actions needing unsupported NPM packages or Node.js APIs can be configured to run in Node.js by adding the `"use node"` directive at the top of the file. Note that other Convex functions cannot be defined in files with the `"use node";`directive.

```ts
convex/myAction.ts"use node";

import { action } from "./_generated/server";
import SomeNpmPackage from "some-npm-package";

export const doSomething = action({
  args: {},
  handler: () => {
    // do something with SomeNpmPackage
  },
});
```

Learn more about the two [Convex Runtimes](https://docs.convex.dev/functions/runtimes).

## Splitting up action code via helpers

Just like with [queries](https://docs.convex.dev/functions/query-functions#splitting-up-query-code-via-helpers) and [mutations](https://docs.convex.dev/functions/mutation-functions#splitting-up-mutation-code-via-helpers) you can define and call helper functions to split up the code in your actions or reuse logic across multiple Convex functions.

But note that the [ActionCtx](https://docs.convex.dev/api/interfaces/server.GenericActionCtx) only has the `auth` field in common with [QueryCtx](https://docs.convex.dev/generated-api/server#queryctx) and [MutationCtx](https://docs.convex.dev/generated-api/server#mutationctx).

## Calling actions from clients

To call an action from [React](https://docs.convex.dev/client/react) use the [`useAction`](https://docs.convex.dev/api/modules/react#useaction) hook along with the generated [`api`](https://docs.convex.dev/generated-api/api) object.

```tsx
src/myApp.tsximport { useAction } from "convex/react";
import { api } from "../convex/_generated/api";

export function MyApp() {
  const performMyAction = useAction(api.myFunctions.doSomething);
  const handleClick = () => {
    performMyAction({ a: 1 });
  };
  // pass \`handleClick\` to a button
  // ...
}
```

Unlike [mutations](https://docs.convex.dev/functions/mutation-functions#calling-mutations-from-clients), actions from a single client are parallelized. Each action will be executed as soon as it reaches the server (even if other actions and mutations from the same client are running). If your app relies on actions running after other actions or mutations, make sure to only trigger the action after the relevant previous function completes.

**Note:** In most cases calling an action directly from a client **is an anti-pattern**. Instead, have the client call a [mutation](https://docs.convex.dev/functions/mutation-functions) which captures the user intent by writing into the database and then [schedules](https://docs.convex.dev/scheduling/scheduled-functions) an action:

```ts
convex/myFunctions.tsimport { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, mutation } from "./_generated/server";

export const mutationThatSchedulesAction = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const taskId = await ctx.db.insert("tasks", { text });
    await ctx.scheduler.runAfter(0, internal.myFunctions.actionThatCallsAPI, {
      taskId,
      text,
    });
  },
});

export const actionThatCallsAPI = internalAction({
  args: { taskId: v.id("tasks"), text: v.string() },
  handler: (_, args): void => {
    // do something with \`taskId\` and \`text\`, like call an API
    // then run another mutation to store the result
  },
});
```

This way the mutation can enforce invariants, such as preventing the user from executing the same action twice.

## Limits

Actions time out after 10 minutes.[Node.js](https://docs.convex.dev/functions/runtimes#nodejs-runtime) and [Convex runtime](https://docs.convex.dev/functions/runtimes#default-convex-runtime) have 512MB and 64MB memory limit respectively. Please [contact us](https://docs.convex.dev/production/contact) if you have a use case that requires configuring higher limits.

Actions can do up to 1000 concurrent operations, such as executing queries, mutations or performing fetch requests.

For information on other limits, see [here](https://docs.convex.dev/production/state/limits).

Unlike queries and mutations, actions may have side-effects and therefore can't be automatically retried by Convex when errors occur. For example, say your action calls Stripe to send a customer invoice. If the HTTP request fails, Convex has no way of knowing if the invoice was already sent. Like in normal backend code, it is the responsibility of the caller to handle errors raised by actions and retry the action call if appropriate.

## Dangling promises

Make sure to await all promises created within an action. Async tasks still running when the function returns might or might not complete. In addition, since the Node.js execution environment might be reused between action calls, dangling promises might result in errors in subsequent action invocations.

## Best practices

### await ctx.runAction should only be used for crossing JS runtimes

**Why?**`await ctx.runAction` incurs to overhead of another Convex server function. It counts as an extra function call, it allocates its own system resources, and while you're awaiting this call the parent action call is frozen holding all it's resources. If you pile enough of these calls on top of each other, your app may slow down significantly.

**Fix:** The reason this api exists is to let you run code in the [Node.js environment](https://docs.convex.dev/functions/runtimes). If you want to call an action from another action that's in the same runtime, which is the normal case, the best way to do this is to pull the code you want to call into a TypeScript [helper function](https://docs.convex.dev/understanding/best-practices/#use-helper-functions-to-write-shared-code) and call the helper instead.

### Avoid await ctx.runMutation / await ctx.runQuery

```ts
// ❌
const foo = await ctx.runQuery(...)
const bar = await ctx.runQuery(...)

// ✅
const fooAndBar = await ctx.runQuery(...)
```

**Why?** Multiple runQuery / runMutations execute in separate transactions and aren’t guaranteed to be consistent with each other (e.g. foo and bar could read the same document and return two different results), while a single runQuery / runMutation will always be consistent. Additionally, you’re paying for multiple function calls when you don’t have to.

**Fix:** Make a new internal query / mutation that does both things. Refactoring the code for the two functions into helpers will make it easy to create a new internal function that does both things while still keeping around the original functions. Potentially try and refactor your action code to “batch” all the database access.

Caveats: Separate runQuery / runMutation calls are valid when intentionally trying to process more data than fits in a single transaction (e.g. running a migration, doing a live aggregate).