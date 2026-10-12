# Onboarding service (TypeScript)

The thin-proxy backend from *Market onboarding applications — front-end
handoff*, section 1: holds the GBG Go client credentials, mints and refreshes
access tokens, forwards interaction traffic, and keeps the session-to-instance
mapping. Neither a Go access token nor a client secret ever reaches the
browser. A Java implementation of the same contract exists alongside this one
(`go-sample-backend`) — a front end must not be able to tell which it's
talking to.

## Architecture

```
lib/
├── dto/types.ts        wire types — must match onboarding-core's TS types field-for-field
├── config/              app.*, go.*, screen-plan.* per market (markets/*.ts) + selection (index.ts)
├── session/             Session, sessionStore, sessionMutex — the session-to-instance mapping
├── errors/               OnboardingException + the ErrorCode table
├── http/                 jsonResponse (null-omitting) + the GlobalExceptionHandler-equivalent dispatch
└── go/
    ├── goClient.ts       what the session layer needs from Go (interface + GO_MODE-selected singleton)
    ├── mock/             canned-fixture client + per-market scenario scripts
    └── live/             real GBG Go v2 integration (token, journey/start,
                           interaction/fetch, interaction/submit, state/fetch)
app/v1/                   Route Handlers — the 7 REST endpoints, paths matching the contract exactly
```

`GoClient` has two implementations, selected by `GO_MODE`:

- **mock** (default) — `mockGoClient` runs the same scenario scripts as the
  front end's own mock transport, so this service runs standalone with no
  live Go credentials, mirroring the front-end's mock-mode requirement.
- **live** — `goApiClient` calls the real GBG Go v2 API, using
  `goTokenService` for token auth (client_credentials or password grant,
  selected per market). `defaultInteractionMapper` turns Go's flat,
  domain-element-shaped interaction into a screen, but carries no
  market-specific knowledge itself — which outstanding elements map to which
  screen, in what order, with what copy, is each market's `screenPlan` config
  (`lib/config/markets/*.ts`). Meridian Health's plan is real, verified
  content; a market with nothing configured there — Northbank and Ridgeline
  Play today — gets a generic form built from whatever Go reports outstanding,
  rather than a stall or a crash.

One deployment fronts exactly one market — `MARKET` plus `GO_MODE` (env vars,
set per npm script) select the brand config, resource ID, and port, matching
the three front-end apps one-to-one.

## Running

Needs Node 18.17+ (Next.js's own minimum) and npm.

```
npm install
npm run dev:northbank         # :8081, mock mode
npm run dev:meridian-health   # :8082, mock mode
npm run dev:ridgeline-play    # :8083, mock mode
```

Mock mode needs no credentials and no network. Point a front-end app at an
instance by copying `apps/<market>/.env.example` to `.env.local` in the
front-end repo — the ports pair up 3000/8081, 3001/8082, 3002/8083, and each
backend's CORS config allows exactly its own. This backend uses the *same*
ports as the Java one — it's a swap-in alternative, not something you'd run
alongside it on the same port.

`?mock_scenario=<id>` on `POST /v1/sessions` (i.e. the same query param the
front end already appends to its own URL) reaches every designed outcome,
exactly as it does against the Java backend and the TypeScript mock transport.

## Running against real GBG Go

Copy `.env.example` to `.env.local`, fill in the four values, then:

```
npm run dev:meridian-health:live
```

Only **Meridian Health** has a published journey and a populated `screenPlan`.
Northbank and Ridgeline Play still carry placeholder resource IDs and will
fail at journey start in live mode until journeys exist for them — same
limitation the Java backend documents for itself.

### Two tenant shapes

The public documented platform and the nonprod *fabric* tenants disagree on
both auth and host layout, so `lib/config/types.ts`'s `GoConfig` makes both
configurable — see `lib/config/markets/meridianHealth.ts` for the fabric
nonprod tenant's overrides (`authUrl`, `baseUrl`, `grantType: 'password'`,
`scope: 'openid'`) versus `lib/config/markets/northbank.ts`/`ridgelinePlay.ts`
for the public-platform defaults (`client_credentials`, `scope: 'gbg.token'`).
Moving to a different tenant means changing those four fields plus
`resourceId` — journey IDs are per-tenant, so this sample's will not exist on
yours.

Credentials always come from environment variables
(`GBG_CLIENT_ID`/`GBG_CLIENT_SECRET`/`GBG_USERNAME`/`GBG_PASSWORD`), never
from a market config file — `GBG_USERNAME`/`GBG_PASSWORD` are read only under
the password grant.

## Session auth

`POST /v1/sessions` sets an HTTP-only, `SameSite=None` cookie scoped to
`/v1/sessions`. Every other endpoint requires it to match the session it was
issued for; missing or mismatched → `410 SESSION_EXPIRED` (the two failure
cases — session not found, and cookie mismatch — are deliberately reported
identically, so a client can't distinguish which check failed). Every
authenticated route reissues the cookie with a refreshed `maxAge` on success
(`lib/session/sessionCookie.ts`, `lib/http/withSession.ts`), matching
`sessionStore`'s own sliding idle timeout — otherwise an active session would
keep itself alive server-side past a fixed client-side cookie expiry.

`SameSite=None`, not `Lax`: the front end and this API are different origins
by design (see each market's `corsAllowedOrigins` and `middleware.ts`'s
credentialed CORS handling), and `Lax` withholds a cookie from a cross-site
fetch/XHR entirely — it's only sent on a top-level navigation. Browsers in
turn require `Secure` whenever `SameSite=None`, so cross-origin cookie
delivery only works once this API is served over HTTPS; the `Secure` flag is
set from the *incoming* request's own scheme
(`request.nextUrl.protocol === 'https:'`), not hardcoded true, so it turns on
automatically once that's the case. A local http://-to-http:// pairing needs
an HTTPS dev proxy in front of this API to exercise the cross-origin cookie
path at all. To test with curl over plain HTTP (same-origin, no CORS in
play): `curl -c cookies.txt -b cookies.txt ...`.

## Tests

```
npm test
```

- `onboardingFlow.test.ts` drives the whole Northbank flow through the real
  Route Handlers (constructing a `NextRequest` and calling the exported
  `GET`/`POST` directly, without a running server) — start, submit, idempotent
  resubmission, stale-interaction rejection, cookie enforcement, and the
  terminal record.
- `contractShape.test.ts` asserts the exact field-name sets real handler
  responses return, for the DTOs a front end reads by name — the equivalent
  protective value the Java backend gets from its generated OpenAPI spec plus
  a snapshot test, without needing an OpenAPI generation pipeline here (see
  "What's a placeholder" below).
- `session.test.ts`, `mockGoClient.test.ts`, `screenPlanConfig.test.ts` and
  `defaultInteractionMapper.test.ts` are plain unit tests covering the
  idempotent-retry logic, the mock state machine (staleness, choice
  branching, the stage-plan "rail" builder), each market's screen-plan config,
  and the live-mode module-verdict mapping.

## What's a placeholder here

- **No OpenAPI/Swagger UI.** The Java backend gets this for free from
  springdoc's annotations; there's no equivalent zero-effort path for
  hand-written Next.js Route Handlers. `contractShape.test.ts` gives the same
  "a silent rename fails a test" protection without generating a browsable
  spec — a real deployment wanting one would want something like
  `zod-to-openapi` with schemas defined once and reused for validation too.
- **Attachment upload** (`POST /v1/sessions/{id}/attachments`) synthesises a
  reference (the base64-encoded bytes) rather than proxying to a real Go
  endpoint — document/selfie capture is explicitly a placeholder pending an
  SDK choice, same as the Java backend.
- **The verification record composition** (`GET /v1/sessions/{id}/record`) is
  a design proposal being served, same as the mock front end and the Java
  backend — which fields a customer should actually see is a compliance
  decision, not yet made.
- **Session storage** is in-memory and single-node (a `Map`, stashed on
  `globalThis` so `next dev`'s hot-reload doesn't wipe it) — swap for Redis
  or similar before running more than one instance.
- **Live mode is structurally complete, not tenant-tested.** No real GBG Go
  credentials were available while porting this — same caveat the Java
  backend's own live mode carries for Northbank and Ridgeline Play.
- **The default consent record URL and terms text** (`consentUrl` and
  `consentTerms` in each market's own config file under
  `lib/config/markets/`) are placeholders — override them for real before any
  real submission, since Go stores the URL as the auditable record of what
  was agreed to, and the terms text is sent as the wording the user is
  recorded as having consented to.
