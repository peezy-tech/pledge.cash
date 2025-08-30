A schema is a description of

1. the tables in your Convex project
2. the type of documents within your tables

While it is possible to use Convex *without* defining a schema, adding a `schema.ts` file will ensure that the documents in your tables are the correct type. If you're using [TypeScript](https://docs.convex.dev/understanding/best-practices/typescript), adding a schema will also give you end-to-end type safety throughout your app.

We recommend beginning your project without a schema for rapid prototyping and then adding a schema once you've solidified your plan. To learn more see our [Schema Philosophy](https://docs.convex.dev/database/advanced/schema-philosophy).

**Example:**[TypeScript and Schemas](https://github.com/get-convex/convex-demos/tree/main/typescript)

## Writing schemas

Schemas are defined in a `schema.ts` file in your `convex/` directory and look like:

```ts
convex/schema.tsimport { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  messages: defineTable({
    body: v.string(),
    user: v.id("users"),
  }),
  users: defineTable({
    name: v.string(),
    tokenIdentifier: v.string(),
  }).index("by_token", ["tokenIdentifier"]),
});
```

This schema (which is based on our [users and auth example](https://github.com/get-convex/convex-demos/tree/main/users-and-auth)), has 2 tables: messages and users. Each table is defined using the [`defineTable`](https://docs.convex.dev/api/modules/server#definetable) function. Within each table, the document type is defined using the validator builder,[`v`](https://docs.convex.dev/api/modules/values#v). In addition to the fields listed, Convex will also automatically add `_id` and `_creationTime` fields. To learn more, see [System Fields](https://docs.convex.dev/database/types#system-fields).

### Validators

The validator builder, [`v`](https://docs.convex.dev/api/modules/values#v) is used to define the type of documents in each table. It has methods for each of [Convex's types](https://docs.convex.dev/database/types):

```ts
convex/schema.tsimport { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  documents: defineTable({
    id: v.id("documents"),
    string: v.string(),
    number: v.number(),
    boolean: v.boolean(),
    nestedObject: v.object({
      property: v.string(),
    }),
  }),
});
```

It additionally allows you to define unions, optional property, string literals, and more. [Argument validation](https://docs.convex.dev/functions/validation) and schemas both use the same validator builder, `v`.

#### Optional fields

You can describe optional fields by wrapping their type with `v.optional(...)`:

```typescript
defineTable({
  optionalString: v.optional(v.string()),
  optionalNumber: v.optional(v.number()),
});
```

This corresponds to marking fields as optional with `?` in TypeScript.

#### Unions

You can describe fields that could be one of multiple types using `v.union`:

```typescript
defineTable({
  stringOrNumber: v.union(v.string(), v.number()),
});
```

If your table stores multiple different types of documents, you can use `v.union` at the top level:

```typescript
defineTable(
  v.union(
    v.object({
      kind: v.literal("StringDocument"),
      value: v.string(),
    }),
    v.object({
      kind: v.literal("NumberDocument"),
      value: v.number(),
    }),
  ),
);
```

In this schema, documents either have a `kind` of `"StringDocument"` and a string for their `value`:

```json
{
  "kind": "StringDocument",
  "value": "abc"
}
```

or they have a `kind` of `"NumberDocument"` and a number for their `value`:

```json
{
  "kind": "NumberDocument",
  "value": 123
}
```

#### Literals

Fields that are a constant can be expressed with `v.literal`:

```typescript
defineTable({
  oneTwoOrThree: v.union(
    v.literal("one"),
    v.literal("two"),
    v.literal("three"),
  ),
});
```

#### Record objects

You can describe objects that map arbitrary keys to values with `v.record`:

```typescript
defineTable({
  simpleMapping: v.record(v.string(), v.boolean()),
});
```

You can use other types of string validators for the keys:

```typescript
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export default mutation({
  args: {
    userIdToValue: v.record(v.id("users"), v.boolean()),
  },
  handler: async ({ db }, { userIdToValue }) => {
    //...
  },
});
```

Notes:

- This type corresponds to the [Record<K,V>](https://www.typescriptlang.org/docs/handbook/utility-types.html#recordkeys-type) type in TypeScript
- You cannot use string literals as a `record` key
- Using `v.string()` as a `record` key validator will only allow ASCII characters

#### Any

Fields or documents that could take on any value can be represented with `v.any()`:

```typescript
defineTable({
  anyValue: v.any(),
});
```

This corresponds to the `any` type in TypeScript.

### Options

These options are passed as part of the [options](https://docs.convex.dev/api/interfaces/server.DefineSchemaOptions) argument to [`defineSchema`](https://docs.convex.dev/api/modules/server#defineschema).

#### schemaValidation: boolean

Whether Convex should validate at runtime that your documents match your schema.

By default, Convex will enforce that all new and existing documents match your schema.

You can disable `schemaValidation` by passing in `schemaValidation: false`:

```typescript
defineSchema(
  {
    // Define tables here.
  },
  {
    schemaValidation: false,
  },
);
```

When `schemaValidation` is disabled, Convex will not validate that new or existing documents match your schema. You'll still get schema-specific TypeScript types, but there will be no validation at runtime that your documents match those types.

#### strictTableNameTypes: boolean

Whether the TypeScript types should allow accessing tables not in the schema.

By default, the TypeScript table name types produced by your schema are strict. That means that they will be a union of strings (ex. `"messages" | "users"`) and only support accessing tables explicitly listed in your schema.

Sometimes it's useful to only define part of your schema. For example, if you are rapidly prototyping, it could be useful to try out a new table before adding it your `schema.ts` file.

You can disable `strictTableNameTypes` by passing in `strictTableNameTypes: false`:

```typescript
defineSchema(
  {
    // Define tables here.
  },
  {
    strictTableNameTypes: false,
  },
);
```

When `strictTableNameTypes` is disabled, the TypeScript types will allow access to tables not listed in the schema and their document type will be `any`.

Regardless of the value of `strictTableNameTypes`, your schema will only validate documents in the tables listed in the schema. You can still create and modify documents in other tables in JavaScript or on the dashboard (they just won't be validated).

## Schema validation

Schemas are pushed automatically in [`npx convex dev`](https://docs.convex.dev/cli#run-the-convex-dev-server) and [`npx convex deploy`](https://docs.convex.dev/cli#deploy-convex-functions-to-production).

The first push after a schema is added or modified will validate that all existing documents match the schema. If there are documents that fail validation, the push will fail.

After the schema is pushed, Convex will validate that all future document inserts and updates match the schema.

Schema validation is skipped if [`schemaValidation`](https://docs.convex.dev/database/#schemavalidation-boolean) is set to `false`.

Note that schemas only validate documents in the tables listed in the schema. You can still create and modify documents in other tables (they just won't be validated).

### Circular references

You might want to define a schema with circular ID references like:

```typescript
convex/schema.tsimport { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    preferencesId: v.id("preferences"),
  }),
  preferences: defineTable({
    userId: v.id("users"),
  }),
});
```

In this schema, documents in the `users` table contain a reference to documents in `preferences` and vice versa.

Because schema validation enforces your schema on every `db.insert`,`db.replace`, and `db.patch` call, creating circular references like this is not possible.

The easiest way around this is to make one of the references nullable:

```typescript
convex/schema.tsimport { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    preferencesId: v.id("preferences"),
  }),
  preferences: defineTable({
    userId: v.union(v.id("users"), v.null()),
  }),
});
```

This way you can create a preferences document first, then create a user document, then set the reference on the preferences document:

```ts
convex/users.tsimport { mutation } from "./_generated/server";

export default mutation({
  handler: async (ctx) => {
    const preferencesId = await ctx.db.insert("preferences", {});
    const userId = await ctx.db.insert("users", { preferencesId });
    await ctx.db.patch(preferencesId, { userId });
  },
});
```

[Let us know](https://docs.convex.dev/production/contact) if you need better support for circular references.

## TypeScript types

Once you've defined a schema,[`npx convex dev`](https://docs.convex.dev/cli#run-the-convex-dev-server) will produce new versions of [`dataModel.d.ts`](https://docs.convex.dev/generated-api/data-model) and [`server.d.ts`](https://docs.convex.dev/generated-api/server) with types based on your schema.

### Doc<TableName>

The [`Doc`](https://docs.convex.dev/generated-api/data-model#doc) TypeScript type from [`dataModel.d.ts`](https://docs.convex.dev/generated-api/data-model) provides document types for all of your tables. You can use these both when writing Convex functions and in your React components:

```tsx
MessageView.tsximport { Doc } from "../convex/_generated/dataModel";

function MessageView(props: { message: Doc<"messages"> }) {
  ...
}
```

If you need the type for a portion of a document, use the [`Infer` type helper](https://docs.convex.dev/functions/validation#extracting-typescript-types).

### query and mutation

The [`query`](https://docs.convex.dev/generated-api/server#query) and [`mutation`](https://docs.convex.dev/generated-api/server#mutation) functions in [`server.js`](https://docs.convex.dev/generated-api/server) have the same API as before but now provide a `db` with more precise types. Functions like [`db.insert(table, document)`](https://docs.convex.dev/api/interfaces/server.GenericDatabaseWriter#insert) now understand your schema. Additionally [database queries](https://docs.convex.dev/database/reading-data/) will now return the correct document type (not `any`).

Related posts from

[![](https://cdn.sanity.io/images/ts10onj4/production/0311b2e9d45427cf032449a7a9a22e1b548a0e18-1938x1094.png?h=188)](https://stack.convex.dev/migrate-data-postgres-to-convex)

[Migrating data from Postgres to Convex](https://stack.convex.dev/migrate-data-postgres-to-convex)

[![](https://cdn.sanity.io/images/ts10onj4/production/eeaff08d0b347cb2f22b687993672aa1a0a8a1f9-5472x3648.jpg?h=188)

Relationship Structures: Let's Talk About Schemas

](https://stack.convex.dev/relationship-structures-let-s-talk-about-schemas)[![](https://docs.convex.dev/database/?h=188)

Building AI Chat with Convex and ChatGPT

](https://stack.convex.dev/real-time-ai-chat-with-convex-and-chatgpt)[![](https://cdn.sanity.io/images/ts10onj4/production/74abeed88d680f9ae35e6e1020c3b0812b6b6a87-1452x956.png?h=188)

Stateful Online Migrations using Mutations

](https://stack.convex.dev/migrating-data-with-mutations)