# Numazu point cloud demo

Status: implemented and demonstrated. This page holds what the README
leaves out about the real-data tileset.

A real-data tileset built from Shizuoka Prefecture's VIRTUAL SHIZUOKA MMS
point cloud (2019, mesh `08NE2701`, CC BY; 976,195 points). The data is not
in this repository.

## Rebuild

```sh
mkdir -p data/virtual-shizuoka/2019-mms-08NE2701
curl -o data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.zip https://virtual-shizuoka.s3.ap-northeast-1.amazonaws.com/2019/MMS/Ground/08/NE/27/08NE2701.zip
unzip data/virtual-shizuoka/2019-mms-08NE2701/08NE2701.zip -d data/virtual-shizuoka/2019-mms-08NE2701
npm run demo:numazu
```

The zip is 14,113,240 bytes (SHA-256 `0af0a8ac…e1ca126d`). `npm run
demo:numazu` writes a tile pyramid with a `tilejson.json` to
`demo/tiles/numazu/`, the finest Gaussians as a reference-3DGS PLY next to
the LAS, and the same tiles as one PMTiles archive,
`demo/tiles/dorayaki-numazu.pmtiles` (tile type MLT, gzip directories).

## Hosting

The published archive is served by stars as
`https://stars.optgeo.org/dorayaki-numazu/{z}/{x}/{y}` (TileJSON at
`https://stars.optgeo.org/dorayaki-numazu`). It is not committed here.
Placing a new archive on stars follows the stars project's procedure and
needs the repository owner's instruction to the stars session.

## Profiles

| profile | tiles | PMTiles size | × COPC |
| --- | --- | --- | --- |
| `coarse` (default, hosted) | aggregated z18; z19 maxzoom, one 12 cm level | 603,132 B | 0.12 |
| `medium` (`DORAYAKI_NUMAZU_PROFILE=medium`) | z18, z19; z20 one 6 cm level | 2,204,268 B | 0.43 |
| `fine` (`DORAYAKI_NUMAZU_PROFILE=fine`) | z20, three nested thinned levels | 2,571,701 B | 0.50 |

The COPC reference is 5,183,226 B (xyz + rgb of the same points, PDAL
`writers.copc`). The comparison is size at a given level of detail, not
fidelity: `coarse` keeps one Gaussian per 12 cm cell and discards finer
structure. `EXPERIMENTS.md` (E002–E004) has the measurements and the
reasoning for making `coarse` the standard.

To view a locally built tileset, run `npm run demo` and open
`http://127.0.0.1:8000/demo/?fixture=numazu` (`numazu-medium`,
`numazu-fine` if built). `&lod=22` chooses tiles and levels as if the map
were at that zoom. Heights are the source's elevations (標高), so on the
flat basemap the data floats at its real elevation, about 7.5 m above the
map plane.
