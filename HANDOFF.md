# Sonorum member system: handoff

For Claude (or anyone) finishing this for the Sonorum founder. Written 5 November 2026 by Edward, the site manager, with Claude. Read this and `README.md`, check the current state yourself, then confirm the plan with the founder before changing anything live.

## The goal

Members create an account on `sonorum.org`, join sonorumBands, sonorumCreate, or both, and answer sorting questions. The Board sorts them into groups in a shared panel. Members see their group only after the Board publishes it.

To finish, move the system into the Cloudflare account that manages `sonorum.org` and make `sonorum.org` serve it.

## Where things are now

| Piece | State |
| --- | --- |
| `sonorum.org` | Old static site on GitHub Pages, from `main` in `sonorumproject/sonorum.org` |
| DNS for `sonorum.org` | On Cloudflare, in the founder's account (Edward has no access) |
| Member system code | Branch `member-sorting` |
| Test deployment | `https://sonorum-org.e-t-kimk72.workers.dev`, on Edward's personal Cloudflare account |
| Test database | D1 `sonorum` on Edward's account, holding only Edward's own account |
| Draft PR | [sonorumproject/sonorum.org#1](https://github.com/sonorumproject/sonorum.org/pull/1) adds links from the old site to the test deployment |

**What works:** accounts, questionnaire, consent box, board panel, sync between board members, publishing, bot check.

**What doesn't work yet:** new members can't confirm their accounts or reset passwords, because email can't send from the test deployment. Do not announce sign-ups until this is fixed.

**Not tested live:** a real email being delivered, and a full sign-up through the bot check.

## Stack

- Cloudflare Worker (`src/index.js`) serving the API and the static pages in `public/`
- Cloudflare D1 for all data, including everything about each person
- Cloudflare Email Service for confirmation and reset emails
- Cloudflare Turnstile on sign-up
- Workers rate limiting on sign-in, sign-up and reset

**R2 is not used and not needed.** People's information is structured data and belongs in D1. Add R2 only if members start uploading files such as audio or photos. Those files would go in R2, with D1 recording who owns them.

## Decisions for the founder

Ask these first:

1. **Plan:** Cloudflare says sending to any address requires the Workers Paid plan. Who pays? Check the current price.
2. **Questions:** are the questions in `public/assets/questions.js` right, including the year options? They were not supplied by the founder. Avoid renaming question ids once people have answered.
3. **Site text:** is the sonorumBands and sonorumCreate text on the Home, About and Join pages right?
4. **Board:** which email addresses get board access?
5. **Rules:** is Sonorum tied to a school? Do the advisor or school need to approve collecting member data, and do under-18s need parental consent? Decide how long data is kept and who handles deletion requests.
6. **Timing:** when should the site switch over? There may be a short gap while DNS changes.

## Steps

Stop and ask before steps marked **(live)**.

### 1. Get the code

Edward needs to share the `member-sorting` branch, for example from his fork at `EdwardTHK/sonorum.org`. If it isn't there, ask him. Then:

```bash
npm install
```

### 2. Log in to the right account

```bash
npx wrangler login
```

```bash
npx wrangler whoami
```

Confirm the account actually lists `sonorum.org` as a zone. If it doesn't, stop.

### 3. Create the database

```bash
npx wrangler d1 create sonorum
```

Put the new id in `database_id` in `wrangler.jsonc`, replacing Edward's. Then:

```bash
npm run db:migrate:remote
```

Don't copy the test database. Edward's account can be recreated by signing up. Never run `db:seed:local` against production; it is for made-up local data.

### 4. Set up the bot check

Create a Turnstile widget for `sonorum.org` and `www.sonorum.org`. Replace `TURNSTILE_SITE_KEY` in `wrangler.jsonc` with its site key, because the current key only works on the test address. Store the secret, without printing it or pasting it into a command:

```bash
npx wrangler secret put TURNSTILE_SECRET
```

### 5. Turn on email (live: changes DNS)

Read the current Email Service docs first, then:

```bash
npx wrangler email sending enable sonorum.org
```

**Protect existing email.** As of this writing, public DNS shows:

- MX records pointing at `eforward1` to `eforward5.registrar-servers.com`, which looks like registrar email forwarding
- TXT `v=spf1 include:spf.efwd.registrar-servers.com ~all`
- No DMARC record

Export the DNS records first. Don't delete the MX records. A domain may only have one SPF record, so if the same name needs another entry, merge it into the existing record. Check that `hello@sonorum.org` really reaches someone, because the consent text promises deletion requests can be sent there. The site sends mail from that address (`MAIL_FROM` in `wrangler.jsonc`).

### 6. Deploy and test before moving the domain

Make sure `DEV_LOG_EMAIL` is never set in production. It prints email links to the logs.

```bash
npm run deploy
```

On the new `workers.dev` address, or a temporary subdomain added to the widget, test with real addresses you control:

- [ ] Sign up with the consent box and bot check, and receive the email
- [ ] The confirmation link asks for the password, then works
- [ ] A wrong password at that step is rejected
- [ ] Password reset email works
- [ ] Sign-up is refused without the consent box
- [ ] Mail lands in the inbox, not spam

Then add the first board member, using the address they signed up with:

```bash
npx wrangler d1 execute sonorum --remote --command "INSERT INTO board_members (email, added_by) VALUES ('name@example.com', 'setup')"
```

Board members add each other from the panel after that. Then, with at least two test accounts:

- [ ] A non-board account gets refused by `/api/board/state`
- [ ] Two board tabs stay in sync
- [ ] Unpublished groups can't be seen by members
- [ ] After publishing, a member sees only their own group, with no board notes or private answers
- [ ] Later draft edits stay hidden until the next publish

### 7. Move the domain (live: the public site changes)

`sonorum.org` and `www` currently point at GitHub Pages:

- `sonorum.org` A records: `185.199.108.153`, `.109`, `.110`, `.111`
- `www` CNAME: `sonorumproject.github.io`

Attach the Worker as a custom domain for both names. Cloudflare may require the existing records to be removed first, which can cause a short gap. Change only these web records and keep every mail record. Check the old pages, including `/about`, `/leadership` and `/contact`, still load afterwards.

### 8. Clean up GitHub (live: changes `main`)

Do this only after step 7 works, because the pages moved from the repo root to `public/`. Merging earlier would break the GitHub Pages site.

1. Close draft PR #1. Its links point at the test deployment, and the member branch already includes this page content.
2. Check the branch's history for anything unwanted, then merge `member-sorting` into `main`.
3. Turn off GitHub Pages and remove the root `CNAME` file.

### 9. Finish

- Tell Edward so he can delete his test Worker, database and Turnstile widget. You can't do that from another account.
- Give at least two trusted people admin access to the Cloudflare account, ideally including the club advisor.
- Set up regular database backups with `wrangler d1 export`.

## Rules to keep

- **Keep the consent box.** If its meaning changes, update both `CONSENT_TEXT` and `CONSENT_VERSION` in `public/assets/questions.js`. The current text names "the people who run the site's hosting" because Cloudflare account admins can see all of the data.
- **Keep the draft/published split.** Members must only ever read the frozen snapshot in `publications`, never the draft group tables.
- **Keep private answers private.** `publicParts()` in `src/index.js` decides what group members can see. Questions marked `boardOnly` and board notes must never reach them.
- **Keep the password step on email confirmation.** Without it, someone could register a board member's email first and keep a working password.
- **Grant board access only to accounts you know are genuine.** Sign-up is public, so check with the person before confirming anything by hand.

## Known gaps

- **Deleting a person is manual.** There is no delete button. Remove them from D1, then republish their track, because published snapshots keep a copy of their name and email.
- **No automated tests.** Earlier checks weren't saved in the repo, so use the lists above.
- **Expired sessions and email tokens are never cleaned up.** A scheduled job could do this if the tables grow.
