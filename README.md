# @todone/sdk

The logic [todone](https://todone.today)'s server and apps share, as plain TypeScript with no runtime dependencies: the task model and its Obsidian Tasks Markdown format (`tasks`), calendar maths (`calendar`), CSV export (`export`), two-way sync planning (`sync`), integration helpers (`integrations`), reminders (`reminders`) and the API's response types (`api`).

```sh
npm install github:todone-today/sdk#v0.1.0
```

```ts
import { parse, serialize } from "@todone/sdk/tasks";
```

Installing from GitHub builds it to JavaScript (`prepare`), so it works in Node, Next.js and bundlers alike. Release a change by tagging it (`git tag v0.x.y && git push --tags`) and bumping the tag in [server](https://github.com/todone-today/server) and [clients](https://github.com/todone-today/clients).

```sh
npm test            # tests
npm run typecheck   # types
npm run build       # dist/
```

GPL-3.0, see [LICENSE](LICENSE).
