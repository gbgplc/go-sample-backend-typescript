# Onboarding service (TypeScript) — SDK implementation

One of two implementations in this repo: this one calls GBG Go v2 through the
official TypeScript Core SDK, `@gbg/go-core` (alpha, pinned to
`0.2.0-alpha.0`). See `../api-implementation/` for the sibling built on
hand-rolled `fetch`, and the root `README.md` for how the two relate. Both
serve the identical REST contract — a front end cannot tell which one it is
talking to — and share every Go-agnostic file (`app/`, `middleware.ts`,
`lib/dto`, `lib/session`, `lib/http`, `lib/errors`, `lib/go/mock`) unchanged.

The thin-proxy backend from *Market onboarding applications — front-end
handoff*, section 1: holds the GBG Go client credentials, mints and refreshes
access tokens, forwards interaction traffic, and keeps the session-to-instance
mapping. Neither a Go access token nor a client secret ever reaches the
browser.

## Architecture

```
lib/
├── dto/types.ts        wire types — identical to api-implementation's
├── config/              app.*, go.*, screen-plan.* per market (markets/*.ts) + selection (index.ts)
├── session/             Session, sessionStore, sessionMutex — the session-to-instance mapping
├── errors/               OnboardingException + the ErrorCode table
├── http/                 jsonResponse (null-omitting) + the error dispatch
└── go/
    ├── goClient.ts       what the session layer needs from Go (interface + GO_MODE-selected singleton)
    ├── mock/             canned-fixture client + per-market scenario scripts (unchanged)
    └── sdk/              real GBG Go v2 integration via @gbg/go-core
        ├── goSdkClient.ts            journeys/interactions orchestration, caches, error handling
        ├── goSdkAuthService.ts       token mint + cache via tokens.generate()
        ├── buildSdkSubmitRequest.ts  front-end fields -> the SDK's typed SubmitInteractionRequest
        ├── sdkResponses.ts           the SDK's full/slim response unions -> one read model
        ├── goViews.ts                that read model (interaction view, state view)
        └── sdkInteractionMapper.ts   screen selection and the record — unchanged from api-implementation
app/v1/                   Route Handlers — the 7 REST endpoints (unchanged)
```

`GoClient` has two implementations, selected by `GO_MODE`, exactly as in
api-implementation:

- **mock** (default) — `mockGoClient`, the identical module.
- **live** — `goSdkClient`, calling the SDK's `journeys.start`,
  `interactions.fetch`, `interactions.submit` and `journeys.getState`. The
  per-instance caches, the document / document-back / selfie capture routing,
  marking a stage complete only after a successful submit, and the three-way
  terminal check in `fetchState` all behave as in api-implementation.
  `sdkResponses.ts` turns whichever SDK response variant arrives into one
  read model, so `sdkInteractionMapper.ts` is api-implementation's mapper
  with only its imports changed.

Every Go call has a 15-second timeout and SDK retries are off (start and
submit are POSTs and must not be replayed). A 401/403 drops the cached token
and retries once. A 400/422 whose Go problems name a submitted field comes
back as a per-field validation error.

## Running

Needs Node 18.17+ and npm.

```
npm install
npm run dev:northbank         # :8091, mock mode
npm run dev:meridian-health   # :8092, mock mode
npm run dev:ridgeline-play    # :8093, mock mode
```

**Ports are 8091/8092/8093**, ten above api-implementation's, so both can run
side by side. They are the same ports as go-sample-backend-java's
sdk-implementation, so run one SDK backend at a time. CORS still allows the
front-end apps on 3000/3001/3002; point an app at this backend by setting
its `NEXT_PUBLIC_API_BASE_URL` to the matching port.

## Running against real GBG Go

Copy `.env.example` to `.env.local`, fill in `GBG_CLIENT_ID` and
`GBG_CLIENT_SECRET`, then:

```
npm run dev:northbank:live          # :8091
npm run dev:meridian-health:live    # :8092
npm run dev:ridgeline-play:live     # :8093
```

All three markets point at published journeys on the public platform (EU),
the same resource IDs as api-implementation.

**`ConnectionError: fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`?**
Node uses its own bundled CA list, not the operating system's. Behind a
TLS-inspecting proxy (Zscaler, for example) the Go host's certificate is
issued by a root only your OS trusts, so every Go call fails while curl and
Java work. On Node 22.15+ set `NODE_OPTIONS=--use-system-ca` before `npm run`;
on older Node, point `NODE_EXTRA_CA_CERTS` at the proxy's root certificate.

## Session auth

Identical to api-implementation — see its README.

## Tests

```
npm test
```

- The Go-agnostic suites (`onboardingFlow`, `contractShape`, `session`,
  `mockGoClient`, `screenPlanConfig`) are copied unchanged from
  api-implementation.
- `sdkInteractionMapper.test.ts` and `systemError.test.ts` are
  api-implementation's mapper tests, with state fixtures nesting steps and
  journey info under `context.process`, where live Go sends them and the
  SDK keeps them.
- `goSdkClient.test.ts` runs the client through the **real SDK** against a
  fake Go (a stubbed global `fetch`). It pins the request URLs, the bearer
  token on fetch and submit, the token mint, prefill handling, capture
  routing, the 401 retry, per-field validation errors, status
  classification, a non-success submit, an empty JSON body, and the full vs.
  slim state view.
- `sdkMapping.test.ts` covers the server-URL helper, the typed submit
  request builder, and the response narrowing.

## Known gaps in this SDK integration

Each gap below is worked around here; the ones worth raising with the SDK
developer are listed at the end.

**(a) `/v2/captain` is in every operation path.** The SDK's servers are
host-only (`https://eu.platform.go.gbgplc.com`) and each operation adds
`/v2/captain/...` itself, so passing the documented base URL to `serverURL`
requests `/v2/captain/v2/captain/...`, which Go answers with a misleading 401.
`sdkServerUrl()` in `lib/config/index.ts` strips the suffix (case-insensitive)
from the configured `baseUrl` and keeps any other path prefix.

**(b) Fetch and submit ignore the client's token.** The global
`customerAccess` (a token provider here) only covers `journeys.*`.
`interactions.fetch` and `interactions.submit` take their own security
object, and with nothing in it the SDK sends no `Authorization` header at
all. The client passes `{ interactionAccess: token }` on every call.

**(c) Full and slim responses arrive as a union.** Both interaction/fetch
and state/fetch return a TS union of a full and a slim variant, picked by the
SDK's best-match heuristic rather than by the `view` requested. `sdkResponses.ts`
reads the fields both fetch variants share. For state, only the full view has
step status and timing, so a slim state response is refused and logged
rather than misreporting every module as still running.

**(d) Most of the interesting fields are untyped.** On the full fetch variant
`interaction`, `result` and `context` are records and `outstanding`/
`instructions` are `any`. The state view's `context` (with
`context.process.steps` and `context.process.journey`) and `result` are
records too. `goViews.ts` supplies the types; non-string list entries are
skipped.

**(e) Typed subjects strip unknown keys.** `SubmitInteractionSubject` and
`StartJourneySubject` are typed zod objects that silently drop any key they
have no field for, with no escape hatch. The submit builder uses the wider
field table proved live in go-sample-backend-java and logs and drops anything
unmapped (leaving it out of `participants` too). A start prefill is sent as
the typed subject; unknown top-level keys are logged, and a prefill that
fails the SDK's validation is dropped so the journey still starts.

**(f) Errors come in several unrelated classes.** Documented error statuses
throw `ErrorResponse`, others `GoDefaultError`, a schema mismatch
`ResponseValidationError` (all three extend `GoError`, which has `statusCode`
and `body`); network failures and timeouts throw `HTTPClientError`
subclasses; a request the SDK rejects before sending throws
`SDKValidationError`, and `instanceof SDKValidationError` is also true for a
`ResponseValidationError`. An empty or malformed JSON body escapes as a raw
`SyntaxError`. `call()` in `goSdkClient.ts` handles each, in that order.

**(g) Submit status only allows `success`.** Any other status fails the SDK's
schema and surfaces as a `ResponseValidationError`; the stage is not marked
complete. There is no in-band error code to classify.

**(h) Start only accepts HTTP 201.** A 200 would throw. Go returns 201
today, so this works.

**(i) The token endpoint path is fixed.** `tokens.generate()` always posts to
`/as/token.oauth2`; only the host can be overridden. That is the public
platform's endpoint exactly, so client_credentials works. A fabric tenant's
Keycloak realm (`/realms/{realm}/protocol/openid-connect/token`) cannot be
reached, so the password grant will not work through the SDK. No market here
uses it. The SDK's `scope` is also a one-value enum (`gbg.token`), so
`go.scope` is not sent.

**(j) The SDK's debug logger prints secrets.** With `debugLogger` set (or
`GO_DEBUG`), it logs the `Authorization` header and full request bodies,
including base64 document and selfie images. It is not enabled here.
