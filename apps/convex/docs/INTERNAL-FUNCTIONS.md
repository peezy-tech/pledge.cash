Internal functions can only be called by other [functions](https://docs.convex.dev/functions) and cannot be called directly from a [Convex client](https://docs.convex.dev/client/react).

By default your Convex functions are public and accessible to clients. Public functions may be called by malicious users in ways that cause surprising results. Internal functions help you mitigate this risk. We recommend using internal functions any time you're writing logic that should not be called from a client.

While internal functions help mitigate risk by reducing the public surface area of your application, you can still validate internal invariants using [argument validation](https://docs.convex.dev/functions/validation) and/or [authentication](https://docs.convex.dev/auth/functions-auth).

## Use cases for internal functions

Leverage internal functions by:

- Calling them from [actions](https://docs.convex.dev/functions/actions#action-context) via `runQuery` and `runMutation`
- Calling them from [HTTP actions](https://docs.convex.dev/functions/http-actions) via `runQuery`,`runMutation`, and `runAction`
- [Scheduling](https://docs.convex.dev/scheduling/scheduled-functions) them from other functions to run in the future
- Scheduling them to run periodically from [cron jobs](https://docs.convex.dev/scheduling/cron-jobs)
- Running them using the [Dashboard](https://docs.convex.dev/dashboard/deployments/functions#running-functions)
- Running them from the [CLI](https://docs.convex.dev/cli#run-convex-functions)

## Defining internal functions

An internal function is defined using `internalQuery`, `internalMutation`, or `internalAction`. For example:

```ts
convex/plans.tsimport { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const markPlanAsProfessional = internalMutation({
  args: { planId: v.id("plans") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.planId, { planType: "professional" });
  },
});
```

If you need to pass complicated objects to internal functions you might prefer to not use argument validation. Note though that if you're using `internalQuery` or `internalMutation` it's a better idea to pass around document IDs instead of documents, to ensure the query or mutation is working with the up-to-date state of the database.

## Calling internal functions

Internal functions can be called from actions and scheduled from actions and mutation using the [`internal`](https://docs.convex.dev/generated-api/api#internal) object.

For example, consider this public `upgrade` action that calls the internal `plans.markPlanAsProfessional` mutation we defined above:

```ts
convex/changes.tsimport { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const upgrade = action({
  args: {
    planId: v.id("plans"),
  },
  handler: async (ctx, args) => {
    // Call out to payment provider (e.g. Stripe) to charge customer
    const response = await fetch("https://...");
    if (response.ok) {
      // Mark the plan as "professional" in the Convex DB
      await ctx.runMutation(internal.plans.markPlanAsProfessional, {
        planId: args.planId,
      });
    }
  },
});
```

In this example a user should not be able to directly call `internal.plans.markPlanAsProfessional` without going through the `upgrade` action — if they did, then they would get a free upgrade.

You can define public and internal functions in the same file.