# Review context for the invoices API

## Always flag

- Any route under `/teams/:team/...` that returns team data without calling `requireMember(user, team)` first. Signing in is not enough; the user must belong to that team.
- Money stored or summed as floats. Amounts are integer cents (`amountCents`).

## Focus areas

- The `routes` table in `src/app.mjs`: every new route is an authorization decision.

## Ignore

- `package-lock.json`

## Conventions

- Handlers throw `HttpError(status, message)` for client errors; `handle()` turns it into a response.
