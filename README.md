# @todone/sdk

The logic todone's server and apps share, as plain TypeScript with no dependencies: the task model and its Obsidian Tasks Markdown format (`tasks`), calendar maths (`calendar`), CSV export (`export`), two-way sync planning (`sync`), integration helpers (`integrations`), reminders (`reminders`) and the API's response types (`api`).

```ts
import { parse, serialize } from "@todone/sdk/tasks";
```

`npm test` runs its tests; `npm run typecheck` checks it.
