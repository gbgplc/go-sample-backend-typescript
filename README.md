# Onboarding service (TypeScript)

Two independent implementations of the same onboarding thin-proxy service,
serving the same REST contract to the same front-end apps. Each is a
standalone Next.js project with its own `package.json`, `node_modules`,
`.env.local` and ports:

- [`api-implementation/`](api-implementation/README.md) — calls GBG Go v2 with
  hand-rolled `fetch` requests. The original implementation. Ports
  8081/8082/8083.
- [`sdk-implementation/`](sdk-implementation/README.md) — the same service
  built on the official TypeScript Core SDK, `@gbg/go-core` (alpha), to
  compare the two and surface gaps in the SDK. Ports 8091/8092/8093.

The Java equivalents, split the same way, are in `go-sample-backend-java`.
Each implementation has its own README covering how to run it, its tests, and
what is still a placeholder.
