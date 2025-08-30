Convex allows you to schedule functions to run on a recurring basis. For example, cron jobs can be used to clean up data at a regular interval, send a reminder email at the same time every month, or schedule a backup every Saturday.

**Example:**[Cron Jobs](https://github.com/get-convex/convex-demos/tree/main/cron-jobs)

## Defining your cron jobs

Cron jobs are defined in a `crons.ts` file in your `convex/` directory and look like:

```ts
convex/crons.tsimport { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "clear messages table",
  { minutes: 1 }, // every minute
  internal.messages.clearAll,
);

crons.monthly(
  "payment reminder",
  { day: 1, hourUTC: 16, minuteUTC: 0 }, // Every month on the first day at 8:00am PST
  internal.payments.sendPaymentEmail,
  { email: "my_email@gmail.com" }, // argument to sendPaymentEmail
);

// An alternative way to create the same schedule as above with cron syntax
crons.cron(
  "payment reminder duplicate",
  "0 16 1 * *",
  internal.payments.sendPaymentEmail,
  { email: "my_email@gmail.com" }, // argument to sendPaymentEmail
);

export default crons;
```

The first argument is a unique identifier for the cron job.

The second argument is the schedule at which the function should run, see [Supported schedules](https://docs.convex.dev/scheduling/cron-jobs#supported-schedules) below.

The third argument is the name of the public function or [internal function](https://docs.convex.dev/functions/internal-functions), either a [mutation](https://docs.convex.dev/functions/mutation-functions) or an [action](https://docs.convex.dev/functions/actions).

## Supported schedules

- [`crons.interval()`](https://docs.convex.dev/api/classes/server.Crons#interval) runs a function every specified number of `seconds`, `minutes`, or `hours`. The first run occurs when the cron job is first deployed to Convex. Unlike traditional crons, this option allows you to have seconds-level granularity.
- [`crons.cron()`](https://docs.convex.dev/api/classes/server.Crons#cron) the traditional way of specifying cron jobs by a string with five fields separated by spaces (e.g. `"* * * * *"`). Times in cron syntax are in the UTC timezone. [Crontab Guru](https://crontab.guru/) is a helpful resource for understanding and creating schedules in this format.
- [`crons.hourly()`](https://docs.convex.dev/api/classes/server.Crons#cron),[`crons.daily()`](https://docs.convex.dev/api/classes/server.Crons#daily),[`crons.weekly()`](https://docs.convex.dev/api/classes/server.Crons#weekly),[`crons.monthly()`](https://docs.convex.dev/api/classes/server.Crons#monthly) provide an alternative syntax for common cron schedules with explicitly named arguments.

## Viewing your cron jobs

You can view all your cron jobs in the [Convex dashboard cron jobs view](https://docs.convex.dev/dashboard/deployments/schedules#cron-jobs-ui). You can view added, updated, and deleted cron jobs in the logs and history view. Results of previously executed runs of the cron jobs are also available in the logs view.

Mutations and actions have the same guarantees that are described in [Error handling](https://docs.convex.dev/scheduling/scheduled-functions#error-handling) for scheduled functions.

At most one run of each cron job can be executing at any moment. If the function scheduled by the cron job takes too long to run, following runs of the cron job may be skipped to avoid execution from falling behind. Skipping a scheduled run of a cron job due to the previous run still executing logs a message visible in the logs view of the dashboard.