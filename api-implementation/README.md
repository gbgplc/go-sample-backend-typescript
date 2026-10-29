# Onboarding service (TypeScript) — API implementation

One of two implementations in this repo: this one calls GBG Go v2 with
hand-rolled `fetch` requests. See `../sdk-implementation/` for the sibling
built on the official TypeScript SDK (`@gbg/go-core`), and the root
`README.md` for how the two relate.

The thin-proxy backend from *Market onboarding applications — front-end
handoff*, section 1: holds the GBG Go client credentials, mints and refreshes
access tokens, forwards interaction traffic, and keeps the session-to-instance
mapping. Neither a Go access token nor a client secret ever reaches the
browser. Java implementations of the same contract live in
`go-sample-backend-java` — a front end must not be able to tell which it's
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

`GoClient` has two implementations, selected by `GO_MODE` (`mock`,
`test-scenarios` or `live`, any case; anything else fails at load, and
`callsGo` in `lib/config/index.ts` decides which modes get the real one):

- **mock** (default) — `mockGoClient` runs the same scenario scripts as the
  front end's own mock transport, so this service runs standalone with no
  live Go credentials, mirroring the front-end's mock-mode requirement.
- **live** — `goApiClient` calls the real GBG Go v2 API, using
  `goTokenService` for token auth (client_credentials or password grant,
  selected per market). `defaultInteractionMapper` turns Go's flat,
  domain-element-shaped interaction into a screen, but carries no
  market-specific knowledge itself — which outstanding elements map to which
  screen, in what order, with what copy, is each market's `screenPlan` config
  (`lib/config/markets/*.ts`). An element no configured stage claims gets a
  generic form built from whatever Go reports outstanding, rather than a
  stall or a crash.

  Every Go call has a 15-second timeout. A 401/403 drops the cached token
  and retries once with a freshly minted one. A 400/422 whose Go problems
  name a submitted field (`context.subject.identity.phones.0.number: ...`)
  comes back as a per-field validation error.
- **test-scenarios** — the same `goApiClient` and credentials as live, but
  every journey starts on a named GBG Go test scenario, so its modules return
  outcomes you chose instead of running real checks. See "Running against
  GBG Go test scenarios" below.

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

Copy `.env.example` to `.env.local`, fill in `GBG_CLIENT_ID` and
`GBG_CLIENT_SECRET`, then:

```
npm run dev:northbank:live          # :8081
npm run dev:meridian-health:live    # :8082
npm run dev:ridgeline-play:live     # :8083
```

All three markets point at published journeys on the public platform (EU),
the same resource IDs as go-sample-backend-java uses.

**`fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`?** Node uses its own
bundled CA list, not the operating system's. Behind a TLS-inspecting proxy
(Zscaler, for example) the Go host's certificate is issued by a root only
your OS trusts, so every Go call fails while curl and Java work. On Node
22.15+ set `NODE_OPTIONS=--use-system-ca` before `npm run`; on older Node,
point `NODE_EXTRA_CA_CERTS` at the proxy's root certificate.

## Running against GBG Go test scenarios

GBG Go's Test Scenarios feature runs a journey along a simulated path: each
module returns the outcome a scenario sets, without calling live data
providers, so a run needs no verification licence and incurs no charges. The
journey's screens are unchanged — the customer still enters details and
captures their ID and a selfie — but the decision comes from the scenario.

1. In the Journey builder, open the market's journey, click **Test
   Scenarios**, and save a scenario for each outcome you want to try, for
   example `northbank-pass`, `northbank-refer` and `northbank-fail`. Outcome
   names must match the journey's exactly, including case.
2. Set the market's default as `go.testScenario` in
   `lib/config/markets/<market>.ts`. Each market ships with a suggested
   `<market>-pass`.
3. Start the backend in test-scenarios mode, with the same `.env.local` as
   live:

   ```
   npm run dev:northbank:test-scenarios          # :8081
   npm run dev:meridian-health:test-scenarios    # :8082
   npm run dev:ridgeline-play:test-scenarios     # :8083
   ```
4. Open the app. It starts on the default scenario; to pick another, open it
   with `?mock_scenario=<scenario-name>`, for example
   `http://localhost:3000/?mock_scenario=northbank-refer`. That is the same
   query parameter mock mode uses to pick a scripted outcome.

How it works: `goApiClient` adds the `x-gbg-scenario` header to
`journey/start`, and only to it; Go ties the scenario to the instance. A
`?mock_scenario=` that doesn't match Go's rule (letters, numbers, `_`, `-`,
up to 64 characters) is refused with a 400 `BAD_REQUEST` rather than swapped
for the default, so asking for the refer path can never quietly run the pass
one. An invalid `go.testScenario` fails as soon as the backend loads.

Safeguards:

- If Go starts the journey without confirming a test run (`"test": false`,
  or no `"test"` flag and no `sandbox_` or `test_` instance-ID prefix), the
  backend abandons it before the first interaction, and logs its instance
  ID. Only
  Go's reply to the start can say whether the scenario took, so the instance
  exists by then, but none of the customer's details or captures ever reach
  it.
- If Go starts the run on a different scenario from the one asked for, the
  backend abandons it the same way.
- A start Go refuses with 400, 404 or 422 is logged with Go's reason,
  instead of reaching the customer as "Your session has ended" or a form
  error. The exception is a 400 or 422 naming a `context.` path: that is Go
  rejecting the prefill, and it stays a field error. A 404 can also mean the
  journey itself doesn't exist; in live mode too, a 404 or 410 at start is
  reported as a failed start, not an ended session. A 403 that persists
  with a fresh token is logged as a likely sign that test scenarios aren't
  enabled for the organisation.
- None of these start failures is marked retryable: each is a
  configuration fault, and on the abandon paths every retry would create
  another Go instance.
- The result screen of a test run carries a **Test run** summary row naming
  the scenario, so its outcome is never mistaken for a real verification.
  The scenario is kept on the session, so the row lasts as long as the
  session does.

Status: covered by `goApiClientTestScenarios.test.ts`, and run against GBG
Go on gbggo4-demo (2026-10-29): named and default scenarios start test
runs, an unknown scenario is reported with Go's 404 reason, and an invalid
`?mock_scenario=` gets a 400. Mirrors go-sample-backend-java's
api-implementation.

Two things seen there that this backend can't guard against:

- Go starts a scenario saved on a *different* journey, still with
  `"test": true`. Scenarios aren't scoped to a journey, so the mismatch
  check can't catch a scenario name that belongs to another journey: check
  the name against this market's journey in the Journey builder.
- A journey whose mocked modules feed later modules can deadlock. Document
  Classification returns its outcome but not `PrimaryDocument/classification`
  or `AnchorImage`, so a module that needs them never runs, and Go abandons
  the journey (`result.status: "abandoned"`). The record reports that as
  "We could not run your checks".

### Two tenant shapes

The public documented platform and the nonprod *fabric* tenants disagree on
both auth and host layout, so `lib/config/types.ts`'s `GoConfig` makes both
configurable: `authUrl`, `baseUrl`, `grantType` and `scope`. Every market here
uses the public-platform defaults (`client_credentials`, `scope:
'gbg.token'`); a fabric tenant uses its Keycloak realm's token URL, its own
`baseUrl`, `grantType: 'password'` and `scope: 'openid'`. Moving to a
different tenant means changing those four fields plus `resourceId` —
journey IDs are per-tenant, so this sample's will not exist on yours.

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
- `goApiClient.test.ts` runs the live client against a fake Go (a stubbed
  `fetch`): the token retry on 401/403, timeouts, and Go validation problems
  mapped back to the submitted fields. `goApiClientTestScenarios.test.ts`
  does the same for test-scenarios mode.

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
- **The submit field table** (`lib/go/live/buildSubmitRequest.ts`) is a
  sample mapping, the same one go-sample-backend-java uses. A field it does
  not know falls back to a flat `subject.<key>` placement, which a real
  journey will not read; a real deployment replaces the table with its
  journey's own schema.
- **The default consent record URL and terms text** (`consentUrl` and
  `consentTerms` in each market's own config file under
  `lib/config/markets/`) are placeholders — override them for real before any
  real submission, since Go stores the URL as the auditable record of what
  was agreed to, and the terms text is sent as the wording the user is
  recorded as having consented to.
