HTTP actions allow you to build an HTTP API right in Convex!

HTTP actions take in a [Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) and return a [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response) following the [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). HTTP actions can manipulate the request and response directly, and interact with data in Convex indirectly by running [queries](https://docs.convex.dev/functions/query-functions),[mutations](https://docs.convex.dev/functions/mutation-functions), and [actions](https://docs.convex.dev/functions/actions). HTTP actions might be used for receiving webhooks from external applications or defining a public HTTP API.

HTTP actions are exposed at `https://<your deployment name>.convex.site` (e.g.`https://happy-animal-123.convex.site`).

**Example:**[HTTP Actions](https://github.com/get-convex/convex-demos/tree/main/http)

## Defining HTTP actions

HTTP action handlers are defined using the [`httpAction`](https://docs.convex.dev/generated-api/server#httpaction) constructor, similar to the `action` constructor for normal actions:

```ts
convex/myHttpActions.tsimport { httpAction } from "./_generated/server";

export const doSomething = httpAction(async () => {
  // implementation will be here
  return new Response();
});
```

The first argument to the `handler` is an [`ActionCtx`](https://docs.convex.dev/api/interfaces/server.GenericActionCtx) object, which provides [`auth`](https://docs.convex.dev/api/interfaces/server.Auth),[`storage`](https://docs.convex.dev/api/interfaces/server.StorageActionWriter), and [`scheduler`](https://docs.convex.dev/api/interfaces/server.Scheduler), as well as `runQuery`,`runMutation`, `runAction`.

The second argument contains the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) data. HTTP actions do not support argument validation, as the parsing of arguments from the incoming Request is left entirely to you.

Here's an example:

```ts
convex/messages.tsimport { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const postMessage = httpAction(async (ctx, request) => {
  const { author, body } = await request.json();

  await ctx.runMutation(internal.messages.sendOne, {
    body: \`Sent via HTTP action: ${body}\`,
    author,
  });

  return new Response(null, {
    status: 200,
  });
});
```

To expose the HTTP Action, export an instance of [`HttpRouter`](https://docs.convex.dev/api/classes/server.HttpRouter) from the `convex/http.ts` file. To create the instance call the `httpRouter` function. On the `HttpRouter` you can expose routes using the `route` method:

```ts
convex/http.tsimport { httpRouter } from "convex/server";
import { postMessage, getByAuthor, getByAuthorPathSuffix } from "./messages";

const http = httpRouter();

http.route({
  path: "/postMessage",
  method: "POST",
  handler: postMessage,
});

// Define additional routes
http.route({
  path: "/getMessagesByAuthor",
  method: "GET",
  handler: getByAuthor,
});

// Define a route using a path prefix
http.route({
  // Will match /getAuthorMessages/User+123 and /getAuthorMessages/User+234 etc.
  pathPrefix: "/getAuthorMessages/",
  method: "GET",
  handler: getByAuthorPathSuffix,
});

// Convex expects the router to be the default export of \`convex/http.js\`.
export default http;
```

You can now call this action via HTTP and interact with data stored in the Convex Database. HTTP actions are exposed on `https://<your deployment name>.convex.site`.

```bash
export DEPLOYMENT_NAME=... # example: "happy-animal-123"
curl -d '{ "author": "User 123", "body": "Hello world" }' \
    -H 'content-type: application/json' "https://$DEPLOYMENT_NAME.convex.site/postMessage"
```

Like other Convex functions, you can view your HTTP actions in the [Functions view](https://docs.convex.dev/dashboard/deployments/functions) of [your dashboard](https://dashboard.convex.dev/) and view logs produced by them in the [Logs view](https://docs.convex.dev/dashboard/deployments/logs).

## Limits

HTTP actions run in the same environment as queries and mutations so also do not have access to Node.js-specific JavaScript APIs. HTTP actions can call [actions](https://docs.convex.dev/functions/actions), which can run in Node.js.

Like [actions](https://docs.convex.dev/functions/actions#error-handling), HTTP actions may have side-effects and will not be automatically retried by Convex when errors occur. It is a responsibility of the caller to handle errors and retry the request if appropriate.

Request and response size is limited to 20MB.

HTTP actions support request and response body types of `.text()`, `.json()`,`.blob()`, and `.arrayBuffer()`.

Note that you don't need to define an HTTP action to call your queries, mutations and actions over HTTP if you control the caller, since you can use use the JavaScript [`ConvexHttpClient`](https://docs.convex.dev/api/classes/browser.ConvexHttpClient) or the [Python client](https://docs.convex.dev/client/python) to call these functions directly.

## Debugging

### Step 1: Check that your HTTP actions were deployed.

Check the [functions page](https://dashboard.convex.dev/deployment/functions) in the dashboard and make sure there's an entry called `http`.

If not, double check that you've defined your HTTP actions with the `httpRouter` in a file called `http.js` or `http.ts` (the name of the file must match exactly), and that `npx convex dev` has no errors.

### Step 2: Check that you can access your endpoint using curl

Get your URL from the dashboard under [Settings](https://dashboard.convex.dev/deployment/settings) > URL and Deploy Key.

Make sure this is the URL that ends in **`.convex.site`**, and not`.convex.cloud`. E.g. `https://happy-animal-123.convex.site`

Run a `curl` command to hit one of your defined endpoints, potentially defining a new endpoint specifically for testing

```markdown
curl -X GET https://<deployment name>.convex.site/myEndpoint
```

Check the [logs page](https://dashboard.convex.dev/deployment/logs) in the dashboard to confirm that there's an entry for your HTTP action.

### Step 3: Check the request being made by your browser

If you've determined that your HTTP actions have been deployed and are accessible via curl, but there are still issues requesting them from your app, check the exact requests being made by your browser.

Open the *Network* tab in your browser's developer tools, and trigger your HTTP requests.

Check that this URL matches what you tested earlier with curl -- it ends in`.convex.site` and has the right deployment name.

You should be able to see these requests in the dashboard [logs page](https://dashboard.convex.dev/deployment/logs).

If you see "CORS error" or messages in the browser console like `Access to fetch at '...' from origin '...' has been blocked by CORS policy`, you likely need to configure CORS headers and potentially add a handler for the pre-flight `OPTIONS` request. See [this section](https://docs.convex.dev/functions/http-actions#cors) below.

## Common patterns

### File Storage

HTTP actions can be used to handle uploading and fetching stored files, see:

- [Uploading files via an HTTP action](https://docs.convex.dev/file-storage/upload-files#uploading-files-via-an-http-action)
- [Serving files from HTTP actions](https://docs.convex.dev/file-storage/serve-files#serving-files-from-http-actions)

### CORS

To make requests to HTTP actions from a website you need to add [Cross-Origin Resource Sharing (CORS)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) headers to your HTTP actions.

There are existing resources for exactly which CORS headers are required based on the use case. [This site](https://httptoolkit.com/will-it-cors/) provides an interactive walkthrough for what CORS headers to add. Here's an example of adding CORS headers to a Convex HTTP action:

```ts
convex/http.tsimport { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

http.route({
  path: "/sendImage",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Step 1: Store the file
    const blob = await request.blob();
    const storageId = await ctx.storage.store(blob);

    // Step 2: Save the storage ID to the database via a mutation
    const author = new URL(request.url).searchParams.get("author");
    await ctx.runMutation(api.messages.sendImage, { storageId, author });

    // Step 3: Return a response with the correct CORS headers
    return new Response(null, {
      status: 200,
      // CORS headers
      headers: new Headers({
        // e.g. https://mywebsite.com, configured on your Convex dashboard
        "Access-Control-Allow-Origin": process.env.CLIENT_ORIGIN!,
        Vary: "origin",
      }),
    });
  }),
});
```

Here's an example of handling a pre-flight `OPTIONS` request:

### Authentication

You can leverage Convex's built-in [authentication](https://docs.convex.dev/auth) integration and access a user identity from [`ctx.auth.getUserIdentity()`](https://docs.convex.dev/api/interfaces/server.Auth#getuseridentity). To do this call your endpoint with an `Authorization` header including a JWT token: