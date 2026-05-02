# mapcheckr-cli

A blazing fast Geoguessr map checker and validator. CLI port of [mapcheckr.vercel.app](https://mapcheckr.vercel.app)

~1,000 to 3,000 validations/s on a single machine on a fast wifi connection.
A 270k-point world map finishes in 2 to 5 minutes.

## Install

You don't have to install anything. Run it on demand:

```bash
npx mapcheckr-cli map.json
```

If you'll use it often, install it globally so the `mapcheckr` binary is on
your PATH:

```bash
npm install -g mapcheckr-cli
mapcheckr map.json
```

Requires Node 18 or newer.

## Quick start

Run with no arguments (or `--help`) to see the friendly banner with examples:

```bash
mapcheckr
```

Run with a map file to check it using the website's vanilla settings:

```bash
mapcheckr map.json
```

This produces `map.fixed.json` next to the input and prints a live progress
panel:

```
████████████░░░░░░░░░░░░░░░░  42%  │  113,248/269,639  │  ETA 1m 53s  │  1180 req/s
✓ Resolved              108,432    40.21%
✗ SV not found            3,892     1.44%
✗ Unofficial                924     0.34%
• No description              0     0.00%
• Wrong generation            0     0.00%
• Out of date range           0     0.00%
✗ Isolated                    0     0.00%
• Network errors              0     0.00%
```

## Input format

`map.json` can be either a bare array or the GeoGuessr export shape:

```jsonc
// bare array
[
  { "lat": 48.85837, "lng": 2.294481 },
  { "lat": 51.5074,  "lng": -0.1278, "panoId": "zpXm1qNHGh9bdDRcDHorEw" }
]
```

```jsonc
// GeoGuessr export
{
  "name": "My Map",
  "customCoordinates": [
    { "lat": 48.85837, "lng": 2.294481 },
    { "lat": 51.5074,  "lng": -0.1278 }
  ]
}
```

Each entry needs `lat` and `lng`. Optional fields `panoId`, `heading`,
`pitch`, `zoom`, `country`, etc. are preserved and may be updated by the
options below. With `--fix-in-place` the original wrapper (and any extra
keys like `name`) is preserved on write.

## Output

By default the resolved locations land in `<input>.fixed.json` as a bare
JSON array. Pass `-o path/to/file.json` to choose the destination, or
`--fix-in-place` to overwrite the input atomically (writes to a sibling
tempfile then renames).

Pass `-r rejected.json` to also dump entries the checker dropped, each
tagged with a `reason` field:

```jsonc
[
  { "lat": 0, "lng": 0, "reason": "SV_NOT_FOUND" },
  { "lat": 35.0, "lng": 17.0, "panoId": "CIAB...", "reason": "UNOFFICIAL" }
]
```

Possible `reason` values: `SV_NOT_FOUND`, `UNOFFICIAL`, `NO_DESCRIPTION`,
`WRONG_GENERATION`, `OUT_OF_DATE_RANGE`, `ISOLATED`, `OTHER`.

## Recipes

### Mirror the website's vanilla "Start checking" run

```bash
mapcheckr map.json \
  --gen1 --gen23 --gen4 \
  --from 2008-01 --to 2026-05 \
  --reject-unofficial --change-to-official \
  --reject-no-links \
  --update-pano-ids --update-coordinates \
  --remove-nearby --nearby-radius 10 \
  --heading-for-panoid --heading-for-non-panoid \
  --heading-for-panned --heading-for-unpanned \
  --heading-direction-gen23 forward \
  --heading-direction-gen4 forward \
  --heading-range 0,0 \
  --update-pitch --pitch-range 0,0
```

### Just convert photospheres to nearest official street view

```bash
mapcheckr map.json --fix-in-place --change-to-official
```

### Drop trekkers and locations with no street arrows

```bash
mapcheckr map.json --reject-no-description --reject-no-links
```

### Limit to recent coverage on Gen 4 cars only

```bash
mapcheckr map.json --no-gen1 --no-gen23 --gen4 --from 2022-01
```

### Save and reuse a settings profile

```bash
# write the resolved settings out, then run with them
mapcheckr map.json --change-to-official --update-pano-ids \
                  --save-config mysettings.json --print-config

# later, on another map
mapcheckr other-map.json --config mysettings.json
```

### Rerun fast (mostly cache hits)

After the first pass, Google's edge cache is warm for the same panoIds.
You don't have to do anything: by default the CLI starts at 50 parallel
requests and ramps up to 200 (AIMD style: bumps the target every 500
clean responses, halves it on a 5%+ error spike). On a warm cache it'll
saturate near the cap within a few seconds.

If you'd rather pin a value (for benchmarking, or to be polite on a flaky
network), pass `-c`:

```bash
mapcheckr map.json -c 80 --fix-in-place    # hold at 80, no auto-tune
```

Use `--max-concurrency <n>` to keep auto-tuning but lift or lower the cap.

## Options reference

```
Arguments:
  <input>                         Input JSON file (bare array or
                                  { customCoordinates: [...] }).

Output:
  -o, --output <file>             Where to write resolved locations.
                                  Default: <input>.fixed.json.
  -i, --fix-in-place              Overwrite <input> instead of writing a
                                  sibling. Mutually exclusive with --output.
  -r, --rejected <file>           Also write rejected entries here.

Performance:
  -c, --concurrency <n>           Pin parallel requests to <n>. If omitted,
                                  the CLI auto-tunes from 50 upward while
                                  Google handles the load (up to
                                  --max-concurrency, default 200).
  --max-concurrency <n>           Ceiling for auto-tuned mode (default 200).
                                  Ignored when -c is set.
  --retries <n>                   Retries on network errors (default 2).
  --quiet                         Suppress the live UI (still prints summary).

Coverage filters (mirror the website's panel):
  --gen1 / --no-gen1              Allow Gen 1 cars.
  --gen23 / --no-gen23            Allow Gen 2 and 3 cars.
  --gen4 / --no-gen4              Allow Gen 4 cars.
  --from <YYYY-MM>                Earliest acceptable image date.
  --to <YYYY-MM>                  Latest acceptable image date.
  --radius <m>                    Lookup radius for non-panoId locations
                                  (10 to 1000, default 50).

Source / quality filters:
  --reject-unofficial             Drop user photospheres (default on).
  --no-reject-unofficial          Allow photospheres.
  --reject-no-description         Drop locations with no street name
                                  (catches most trekkers).
  --change-to-official            For unofficial inputs, swap to the
                                  nearest official street view if any.
  --reject-no-links               Drop isolated panoramas (no arrows).
  --no-reject-no-links            Keep isolated panoramas.
  --reject-no-links-if-no-heading Only drop isolated AND unpanned ones.

In-place updates to each location:
  --update-pano-ids               Replace panoId with the most recent
                                  capture at the same viewpoint.
  --update-coordinates            Snap lat/lng to the actual pano center.
  --remove-nearby                 Drop duplicates closer than --nearby-radius.
  --nearby-radius <m>             Duplicate distance (1 to 10000000).

Headings (only fire when at least one --heading-for-* below matches):
  --heading-for-panoid            Update heading for entries that already
                                  have a panoId.
  --heading-for-non-panoid        Update heading for entries without one.
  --heading-for-panned            Update heading for entries with
                                  heading != 0.
  --heading-for-unpanned          Update heading for entries with
                                  heading == 0.
  --heading-direction-gen1   <d>  Direction picker for Gen 1 panos.
  --heading-direction-gen23  <d>  Direction picker for Gen 2 and 3 panos.
  --heading-direction-gen4   <d>  Direction picker for Gen 4 panos.
  --heading-direction-dead-end <d>
                                  Direction picker for dead ends.
                                  <d> is one of: link, forward, backward, any.
  --heading-range <min,max>       Heading deviation in degrees (-180..180).
  --heading-random                Random in range instead of an endpoint.

Pitch (the auto-pitch the website does):
  --update-pitch                  Set loc.pitch using --pitch-range.
  --pitch-range <min,max>         Pitch range in degrees (-90..90).
  --pitch-random                  Random in range.

Zoom:
  --update-zoom                   Set loc.zoom using --zoom-range.
  --zoom-range <min,max>          Zoom range (0..4).
  --zoom-random                   Random in range.

Config:
  --config <file>                 Load full settings JSON (overridden by
                                  flags below it on the command line).
  --save-config <file>            Write the resolved settings to disk.
  --print-config                  Print resolved settings to stdout
                                  and exit (does not run the checker).
```

## How it works

The website uses the Google Maps JavaScript SDK
(`new google.maps.StreetViewService()`) to look up each panorama. That SDK
calls two Google endpoints under the hood:

1. `GeoPhotoService.SingleImageSearch` for "find the nearest panorama at
   this lat/lng".
2. `photometa/v1` for "give me the metadata for this panoId".

`mapcheckr-cli` calls the same endpoints directly, encodes the same
protobuf-over-URL request the SDK builds, and parses the same JSON
response shape. The filter logic in `lib/svreq.js` is a near-line-for-line
port of `src/utils/SVreq.js` from the original webapp, so accept and reject
decisions match the website to within network nondeterminism (typically
under 0.1% disagreement on a 270k-point map).

For the 22-character `CI...` and `CAoS...` panoId variants that GeoGuessr
maps frequently contain, the by-id lookup tries the heuristic-determined
source type first and falls back to the other type before giving up. This
means a wrong source-type guess is a one-extra-request perf cost rather
than a misclassification.

## Credits

All credit for the original mapcheckr concept, the Vue webapp this CLI was
ported from, and the underlying filter logic goes to
[**tzhf**](https://github.com/tzhf). This package is just a faithful CLI
port of [their webapp](https://mapcheckr.vercel.app); if you find this
useful, go star the [original repo](https://github.com/tzhf/mapcheckr). And of course, there aren't enough words to thank Google for the amazing Maps and Street View product.

## License

MIT.
