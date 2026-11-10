# sonorum.org

The Sonorum Project website, plus member sign-up and the Board's group-sorting panel. It runs on Cloudflare: a Worker (`src/index.js`) serves the API and the static pages in `public/`, and D1 holds the data.

| Page | Who | What |
| --- | --- | --- |
| `/join` | Anyone | Create an account or sign in |
| `/account` | Members | Answer the questions, see your group once it is released |
| `/board` | Board | Sort people into groups, then publish |

The Board edits the questions from **Questions** on `/board`. Edits are saved in D1 and reach the form right away. `public/assets/questions.js` holds the starting set, the rules for edits, and the questions sorting depends on (`LOCKED`), which can be reworded but not removed. Run `npm run check` after changing that file.

## How publishing works

Groups live in draft tables that only board accounts can read. Publishing copies a track's groups into a frozen snapshot, and members only ever read their own group from that snapshot. Later draft edits stay private until someone publishes again. sonorumBands and sonorumCreate publish separately.

## Run it locally

```bash
npm install
```

```bash
printf 'DEV_LOG_EMAIL=1\n' > .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run db:seed:local
```

```bash
npm run dev
```

The seed replaces local data with made-up members and two board accounts (`board1@example.com`, `board2@example.com`, password in `scripts/seed-dev.mjs`). With `DEV_LOG_EMAIL` set, emails print to the terminal instead of sending.

## Deploy

1. Create the database, then put the printed id in `wrangler.jsonc`:

   ```bash
   npx wrangler d1 create sonorum
   ```

2. Apply the schema:

   ```bash
   npm run db:migrate:remote
   ```

3. Email goes through [Resend](https://resend.com). Add `sonorum.org` as a domain there, add the DNS records it lists, then store an API key with sending access:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

   The free plan sends up to 100 emails a day. Past that, sign-up and reset show "We could not send the email right now".

4. Optional but recommended: create a Turnstile widget, put its site key in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, and store its secret:

   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   ```

5. Deploy, then add `sonorum.org` as a custom domain on the Worker:

   ```bash
   npm run deploy
   ```

6. Give the first board member access. After that, board members add each other from the panel:

   ```bash
   npx wrangler d1 execute sonorum --remote --command "INSERT INTO board_members (email, added_by) VALUES ('name@example.com', 'setup')"
   ```

The site used to deploy from the repo root on GitHub Pages. The pages now live in `public/`, so merging this to `main` breaks the Pages site unless the domain has already moved to the Worker.
