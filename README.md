# Simple RSVP

Mobile-first web app for tracking who's in for a game or event. Players RSVP with their name, attendance status, and any extra guests. The list auto-clears after a configurable window so it stays fresh for the next game.

## Features

- RSVP in/out with guest count
- Live list updates every 10 seconds
- Cancel/uncancel the game (PIN-protected, with rate limiting)
- RSVPs auto-clear after 48 hours (configurable)
- Name remembered in `localStorage` across visits
- Cross-promo callout and one-time welcome modal pointing at [All Aboard](https://www.getallaboard.app)

## All Aboard cross-promotion

This app runs a single hard-coded game. [All Aboard](https://www.getallaboard.app) is the
hosted product where anyone can create their own event links, so the page funnels visitors
there in two places.

**Persistent callout.** A bar sits directly above the "Your RSVP" card on every page load
and reads "Head over to All Aboard to get your own event link", with "All Aboard" linking
to `https://www.getallaboard.app`. It is always visible and cannot be dismissed.

**First-visit modal.** New visitors get a dialog titled "Have an event of your own?" with
the body "Create your own sign up links at All Aboard" and a single Dismiss button. It also
closes on Escape or a click on the backdrop. Focus moves to Dismiss when it opens and Tab
is held inside the dialog, so a keyboard user cannot reach the page behind the overlay.

The modal is shown at most once per browser. The `localStorage` flag is written the moment
the dialog opens, not when it is dismissed, so a visitor who closes the tab without
clicking Dismiss still never sees it a second time. Clearing site data makes it show again.

The modal opens only if that flag can actually be persisted. When storage is unavailable
(private browsing, cookies blocked, quota exceeded) the modal is skipped, because showing
it without being able to record the visit would mean showing it on every page load. The
same applies when the flag cannot be read: an unreadable flag is treated as "already seen"
rather than "never shown".

All `localStorage` access goes through `readStored` and `writeStored`, which swallow the
exceptions a storage-blocked browser throws. Without them the very first line of `init()`
throws and the page never boots — no RSVP list, no polling.

## Browser storage

| Key | Value | Purpose |
|---|---|---|
| `simple_rsvp_name` | The visitor's name | Pre-fills the RSVP form on return visits |
| `simple_rsvp_allaboard_promo_seen` | `'1'` | Suppresses the first-visit All Aboard modal |

To see the modal again while developing, run `localStorage.clear()` in the browser console
and reload, or open the page in a private window.

## Setup

Requires Node.js 20.12 or later.

```bash
npm install
cp .env.example .env   # then edit .env and set your own CANCEL_PIN
npm start
```

Open `http://localhost:3000`.

### Set your admin PIN

Cancelling, uncancelling, resetting the game and entering admin mode all require a PIN.
**The default PIN is `0000`, and because this repository is public, anyone can look it up.**
Set your own before you deploy:

```bash
# .env
CANCEL_PIN=4821
```

The server reads `.env` from the project root at startup. Variables already set in the
environment (for example, on your hosting platform's settings page) take precedence over
`.env`. While the default PIN is in use, the server prints a warning on startup.

`.env` is listed in `.gitignore`. Never commit it.

### PIN rate limiting

After 5 incorrect PIN attempts, a client IP is locked out of every PIN endpoint for 15
minutes. During the lockout the server returns `429 Too Many Requests` with a
`Retry-After` header, even for the correct PIN. Correct PINs do not count toward the
limit. Lockouts are held in memory and clear when the server restarts.

If you run behind a reverse proxy or load balancer (Nginx, Heroku, Render, Fly.io, etc.),
set `TRUST_PROXY` so the limit applies to each visitor's real IP. Without it, every
visitor appears to come from the proxy's IP, and one person guessing wrong locks everyone
out. Use `TRUST_PROXY=1` for a single proxy hop; see the
[Express docs](https://expressjs.com/en/guide/behind-proxies.html) for other values.
Do not set it when the server is reached directly, or clients can spoof their IP with an
`X-Forwarded-For` header.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `CANCEL_PIN` | `0000` | PIN for admin mode and cancel/uncancel/reset. **Change this.** |
| `CLEAR_AFTER_HOURS` | `48` | Hours after first RSVP before the list auto-clears |
| `TRUST_PROXY` | unset | Express `trust proxy` setting; set when behind a reverse proxy |

Set these in `.env` (see `.env.example`) or in your host's environment.

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/state` | Current RSVPs and cancelled status |
| `POST` | `/api/rsvp` | Submit or update an RSVP |
| `DELETE` | `/api/rsvp` | Remove an RSVP by name |
| `POST` | `/api/cancel` | Cancel the game (requires PIN) |
| `POST` | `/api/uncancel` | Uncancel the game (requires PIN) |
| `POST` | `/api/verify-pin` | Check a PIN without changing state (requires PIN) |
| `POST` | `/api/reset` | Clear all RSVPs and the cancelled status (requires PIN) |

All PIN endpoints share the rate limit described above.
