# Dorayaki

Dorayaki is an experiment in carrying fully three-dimensional surfels in
conventional two-dimensional map tiles. It is an implementation
experiment, not a specification or standard. See `AGENTS.md` for the
project's goals and working method.

## Current state

Implemented:

- a naive Surfel Block codec (`src/surfel-block.ts`): a 12-byte header
  followed by 32-byte little-endian surfel records. The byte layout is in
  [`docs/surfel-block-format.md`](docs/surfel-block-format.md);
- deterministic fixture generators: `plane` (`src/fixtures/plane.ts`) and
  `bridge` (`src/fixtures/bridge.ts`: ground, deck, underside, and vertical
  piers, with several surfels at the same x/y and different z);
- automated tests for round trips and malformed input (`test/`).

Not yet implemented: MapLibre Tile (MLT) embedding, browser decoding,
MapLibre GL JS rendering, PMTiles, the remaining fixtures listed in
`AGENTS.md` (`fold`, `overhang`, `floating`, `boundary`), and any
compression or quantization.

## Requirements

Node.js 22 or later.

## Commands

```sh
npm install         # install TypeScript and Node type definitions
npm run typecheck   # type-check src/ and test/ without emitting
npm test            # compile src/ and test/ into build-test/, run node --test
npm run build       # compile src/ into dist/ (JS, .d.ts, source maps)
```

`dist/` and `build-test/` are generated and ignored by git.

## License

CC0 1.0 Universal. See `LICENSE`.
