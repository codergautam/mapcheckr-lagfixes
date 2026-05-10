#!/usr/bin/env node
// MapCheckr CLI. Same defaults as the website, calling the same Google
// Street View metadata endpoints (no Puppeteer, no DOM).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Command, Option } from "commander";

import SVreq from "./lib/svreq.js";
import { removeNearby } from "./lib/spatial-grid.js";
import { defaultSettings } from "./lib/defaults.js";
import { AutoConcurrency } from "./lib/auto-concurrency.js";
import * as ui from "./lib/ui.js";

const REJECTION_REASONS = [
    "SV_NOT_FOUND", "UNOFFICIAL", "NO_DESCRIPTION",
    "WRONG_GENERATION", "OUT_OF_DATE_RANGE", "ISOLATED", "OTHER",
];
const packageVersion = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

const program = new Command();
program
    .name("mapcheckr")
    .description("Reverse-engineered Geoguessr map checker. Fast CLI version of mapcheckr.vercel.app.")
    .version(packageVersion, "-v, --version", "display version")
    .showHelpAfterError("(run `mapcheckr --help` for the full option list)")
    .argument("<input>", "Input JSON map file (raw array or { customCoordinates: [...] })")
    .option("-o, --output <file>", "Output JSON file (default: <input>.fixed.json)")
    .option("-i, --fix-in-place", "Overwrite the input file with the resolved locations (preserves the input's customCoordinates wrapper if any)")
    .option("-r, --rejected <file>", "Also write rejected locations to this JSON file")
    .option("-c, --concurrency <n>", "Pin parallel requests to this value. If omitted, the CLI auto-tunes from 50 upward while Google handles the load.", (v) => parseInt(v, 10), 50)
    .option("--max-concurrency <n>", "Cap on auto-tuned concurrency (default 200; ignored if -c is set)", (v) => parseInt(v, 10), 200)
    .option("--retries <n>", "Retries on network/HTTP errors (default 2)", (v) => parseInt(v, 10), 2)

    // Coverage / date / radius (mirror website)
    .option("--gen1",  "Allow Gen 1 coverage (default OFF)")
    .option("--no-gen1")
    .option("--gen23", "Allow Gen 2 & 3 coverage (default ON)")
    .option("--no-gen23")
    .option("--gen4",  "Allow Gen 4 coverage (default ON)")
    .option("--no-gen4")
    .option("--from <YYYY-MM>", "Earliest acceptable image date (default 2008-01)")
    .option("--to <YYYY-MM>",   "Latest acceptable image date (default: today)")
    .option("--radius <m>", "Search radius for non-panoID locations, 10..1000 (default 50)", (v) => parseInt(v, 10))

    // Booleans
    .addOption(new Option("--reject-unofficial",          "Reject unofficial coverage (default ON)"))
    .addOption(new Option("--no-reject-unofficial",       "Allow photospheres / unofficial coverage"))
    .option("--reject-no-description",                    "Reject locations without description, catches most trekkers (default OFF)")
    .option("--change-to-official",                       "Convert unofficial locations to nearest official (default OFF)")
    .addOption(new Option("--reject-no-links",            "Reject all isolated locations (default ON)"))
    .addOption(new Option("--no-reject-no-links",         "Keep isolated locations"))
    .option("--reject-no-links-if-no-heading",            "Reject only unpanned isolated locations (default ON)")
    .option("--update-pano-ids",                          "Update panoIDs to most recent coverage (default OFF)")
    .option("--update-coordinates",                       "Snap coordinates to nearest pano (default OFF)")
    .option("--remove-nearby",                            "Reject duplicates within --nearby-radius (default OFF)")
    .option("--nearby-radius <m>", "Duplicate radius, 1..10000000 (default 10)", (v) => parseInt(v, 10))

    // Heading auto-update (mirrors the website's "Headings" panel)
    .option("--heading-for-panoid",     "Update heading for locations that already have a panoId (default OFF)")
    .option("--heading-for-non-panoid", "Update heading for locations without a panoId (default OFF)")
    .option("--heading-for-panned",     "Update heading for already-panned locations, heading != 0 (default OFF)")
    .option("--heading-for-unpanned",   "Update heading for unpanned locations, heading == 0 (default OFF)")
    .addOption(new Option("--heading-direction-gen1 <dir>",     "Direction picker for Gen 1 panos").choices(["link", "forward", "backward", "any"]))
    .addOption(new Option("--heading-direction-gen23 <dir>",    "Direction picker for Gen 2 & 3 panos").choices(["link", "forward", "backward", "any"]))
    .addOption(new Option("--heading-direction-gen4 <dir>",     "Direction picker for Gen 4 panos").choices(["link", "forward", "backward", "any"]))
    .addOption(new Option("--heading-direction-dead-end <dir>", "Direction picker for dead ends").choices(["link", "forward", "backward", "any"]))
    .option("--heading-range <min,max>", "Heading deviation range in degrees, -180..180 (e.g. -30,30)", parseRange)
    .option("--heading-random",          "Pick a random value within --heading-range instead of one of the endpoints")

    // Pitch auto-update (the "auto pitch" the website does)
    .option("--update-pitch",            "Auto-set loc.pitch using --pitch-range, only fires when at least one --heading-for-* is set (default OFF)")
    .option("--pitch-range <min,max>",   "Pitch range in degrees, -90..90 (e.g. -10,10)", parseRange)
    .option("--pitch-random",            "Pick a random value within --pitch-range instead of one of the endpoints")

    // Zoom auto-update
    .option("--update-zoom",             "Auto-set loc.zoom using --zoom-range, only fires when at least one --heading-for-* is set (default OFF)")
    .option("--zoom-range <min,max>",    "Zoom range, 0..4 (e.g. 0,1.5)", parseRange)
    .option("--zoom-random",             "Pick a random value within --zoom-range instead of one of the endpoints")

    .option("--config <file>", "Load full settings JSON (overrides individual flags)")
    .option("--save-config <file>", "Write the resolved settings to a JSON file and continue")
    .option("--quiet", "Suppress live UI (still prints summary)")
    .option("--print-config", "Print resolved settings and exit")

    // Hidden preset for the WorldGuessr maintainer's standard pass.
    .addOption(new Option("--worldguessr").hideHelp());

// No arguments at all -> show the friendly banner + help and exit cleanly,
// instead of commander's "missing argument 'input'" error.
if (process.argv.length <= 2) {
    showBanner();
    program.outputHelp();
    process.exit(0);
}

program.parse(process.argv);
const opts = program.opts();
const inputPath = path.resolve(program.args[0]);

// ----- Build settings -------------------------------------------------------
const settings = defaultSettings();

if (opts.config) {
    const userCfg = JSON.parse(fs.readFileSync(opts.config, "utf8"));
    deepMerge(settings, userCfg);
}

// CLI flag overrides (these win over --config)
if (opts.gen1  !== undefined) settings.filterByGen[1]  = opts.gen1;
if (opts.gen23 !== undefined) settings.filterByGen[23] = opts.gen23;
if (opts.gen4  !== undefined) settings.filterByGen[4]  = opts.gen4;
if (opts.from)               settings.filterByDate.from = opts.from;
if (opts.to)                 settings.filterByDate.to   = opts.to;
if (opts.radius)             settings.radius            = clamp(opts.radius, 10, 1000);
if (opts.rejectUnofficial !== undefined) settings.rejectUnofficial = opts.rejectUnofficial;
if (opts.rejectNoDescription)            settings.rejectNoDescription = true;
if (opts.changeToOfficial)               settings.changeToOfficial = true;
if (opts.rejectNoLinks !== undefined)    settings.rejectNoLinks = opts.rejectNoLinks;
if (opts.rejectNoLinksIfNoHeading)       settings.rejectNoLinksIfNoHeading = true;
if (opts.updatePanoIds)                  settings.updatePanoIDs = true;
if (opts.updateCoordinates)              settings.updateCoordinates = true;
if (opts.removeNearby)                   settings.removeNearby = true;
if (opts.nearbyRadius)                   settings.nearbyRadius = clamp(opts.nearbyRadius, 1, 10_000_000);

// Heading
if (opts.headingForPanoid)     settings.heading.filterBy.panoID    = true;
if (opts.headingForNonPanoid)  settings.heading.filterBy.nonPanoID = true;
if (opts.headingForPanned)     settings.heading.filterBy.panned    = true;
if (opts.headingForUnpanned)   settings.heading.filterBy.unpanned  = true;
if (opts.headingDirectionGen1)    settings.heading.directionBy[1]        = opts.headingDirectionGen1;
if (opts.headingDirectionGen23)   settings.heading.directionBy[23]       = opts.headingDirectionGen23;
if (opts.headingDirectionGen4)    settings.heading.directionBy[4]        = opts.headingDirectionGen4;
if (opts.headingDirectionDeadEnd) settings.heading.directionBy.DEAD_END  = opts.headingDirectionDeadEnd;
if (opts.headingRange) settings.heading.range          = clampRange(opts.headingRange, -180, 180);
if (opts.headingRandom) settings.heading.randomInRange = true;

// Pitch
if (opts.updatePitch) settings.pitch.updatePitch = true;
if (opts.pitchRange)  settings.pitch.range       = clampRange(opts.pitchRange, -90, 90);
if (opts.pitchRandom) settings.pitch.randomInRange = true;

// Zoom
if (opts.updateZoom)  settings.zoom.updateZoom = true;
if (opts.zoomRange)   settings.zoom.range      = clampRange(opts.zoomRange, 0, 4);
if (opts.zoomRandom)  settings.zoom.randomInRange = true;

// Hidden WorldGuessr preset. Applied last so it's authoritative over any
// individual flag the caller may have also passed. Forces --fix-in-place.
if (opts.worldguessr) {
    settings.radius = 50;
    settings.filterByGen = { 1: true, 23: true, 4: true };
    settings.filterByDate = { from: "2008-01", to: settings.filterByDate.to };
    settings.rejectUnofficial = true;
    settings.rejectNoDescription = false;
    settings.changeToOfficial = true;
    settings.rejectNoLinks = true;
    settings.rejectNoLinksIfNoHeading = true;
    settings.updatePanoIDs = true;
    settings.updateCoordinates = true;
    settings.removeNearby = true;
    settings.nearbyRadius = 10;
    settings.heading = {
        range: [0, 0],
        randomInRange: false,
        filterBy: { panoID: true, nonPanoID: true, panned: true, unpanned: true },
        directionBy: { 1: "link", 23: "link", 4: "link", DEAD_END: "link" },
    };
    settings.pitch = { updatePitch: true, range: [5, 5], randomInRange: false };
    settings.zoom  = { updateZoom: false, range: [0, 0], randomInRange: false };
    opts.fixInPlace = true;
}

if (opts.saveConfig) {
    fs.writeFileSync(opts.saveConfig, JSON.stringify(settings, null, 2));
    ui.info(`Saved settings to ${opts.saveConfig}`);
}
if (opts.printConfig) {
    process.stdout.write(JSON.stringify(settings, null, 2) + "\n");
    process.exit(0);
}

// ----- Load input -----------------------------------------------------------
let raw;
try { raw = JSON.parse(fs.readFileSync(inputPath, "utf8")); }
catch (e) { ui.error(`Could not read JSON: ${e.message}`); process.exit(1); }

let mapData = raw;
let inputWrapper = null;       // remembered so --fix-in-place can re-wrap on write
if (mapData && typeof mapData === "object" && !Array.isArray(mapData) && Array.isArray(mapData.customCoordinates)) {
    inputWrapper = { ...mapData, customCoordinates: null };
    mapData = mapData.customCoordinates;
}
if (!Array.isArray(mapData) || !mapData.every((o) => o && "lat" in o && "lng" in o)) {
    ui.error("Invalid map data — expected an array of { lat, lng, ... } or { customCoordinates: [...] }");
    process.exit(1);
}

if (opts.fixInPlace && opts.output) {
    ui.error("--fix-in-place and --output are mutually exclusive");
    process.exit(1);
}

const outputPath = opts.fixInPlace
    ? inputPath
    : opts.output
        ? path.resolve(opts.output)
        : inputPath.replace(/(\.[^./\\]+)?$/, (m) => `.fixed${m || ".json"}`);
const rejectedPath = opts.rejected ? path.resolve(opts.rejected) : null;

// ----- Concurrency controller ----------------------------------------------
// Auto-tune iff the user did not explicitly pin concurrency with -c. The
// pinned value is treated as a hard contract (good for benchmarking,
// debugging rate limits, and behaving on flaky networks).
const concurrencyPinned = program.getOptionValueSource("concurrency") === "cli";
const ctrl = concurrencyPinned
    ? null
    : new AutoConcurrency({
          initial: opts.concurrency,        // 50 by default
          min:     opts.concurrency,
          max:     opts.maxConcurrency,
      });
const getTarget = () => ctrl ? ctrl.target() : opts.concurrency;

// ----- Run ------------------------------------------------------------------
if (!opts.quiet) {
    ui.header({
        inputPath,
        count: mapData.length,
        settings,
        outputPath,
        concurrencyPolicy: ctrl
            ? `auto, ${opts.concurrency}..${ctrl.range()[1]}`
            : `fixed, ${opts.concurrency}`,
    });
}

const started = Date.now();
const resolvedLocs = [];
const rejectedLocs = [];
const counts = Object.fromEntries(REJECTION_REASONS.map((r) => [r, 0]));
let success = 0;

const progress = opts.quiet ? null : ui.makeProgress(mapData.length, getTarget);

await runPool(mapData, getTarget, async (loc) => {
    let attempt = 0;
    while (true) {
        try {
            const out = await SVreq(loc, settings);
            ctrl?.record(true);
            resolvedLocs.push(out);
            success++;
            progress?.tick("OK");
            return;
        } catch (err) {
            const reason = err && err.reason;
            if (REJECTION_REASONS.includes(reason)) {
                // Filter rejection: lookup itself succeeded, so it's a "good"
                // signal for the autoscaler.
                ctrl?.record(true);
                counts[reason]++;
                rejectedLocs.push(err);
                progress?.tick(reason);
                return;
            }
            // Network / HTTP / parse error: bad signal for the autoscaler.
            ctrl?.record(false);
            if (attempt < opts.retries) { attempt++; await sleep(150 * attempt); continue; }
            counts.OTHER++;
            rejectedLocs.push({ ...loc, reason: "OTHER", error: String(err && err.message || err) });
            progress?.tick("OTHER");
            return;
        }
    }
});

progress?.stop();

let removedNearbyCount = 0;
let finalResolved = resolvedLocs;
if (settings.removeNearby) {
    const before = finalResolved.length;
    finalResolved = removeNearby(finalResolved, settings.nearbyRadius);
    removedNearbyCount = before - finalResolved.length;
}

await writeMap(outputPath, finalResolved, opts.fixInPlace ? inputWrapper : null);
if (rejectedPath) await writeJson(rejectedPath, rejectedLocs);

const totalDuration = (Date.now() - started) / 1000;

if (!opts.quiet) {
    ui.summary({
        totalDuration,
        total: mapData.length,
        resolved: finalResolved.length,
        rejectedCounts: counts,
        removedNearbyCount,
        outputPath,
        rejectedPath,
    });
}

// ----- Helpers --------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function showBanner() {
    const lines = [
        "",
        "  mapcheckr  ·  fast Geoguessr map checker (CLI port of mapcheckr.vercel.app)",
        "",
        "  Quick start:",
        "    mapcheckr map.json                                 # use website defaults",
        "    mapcheckr map.json --change-to-official            # convert photospheres",
        "    mapcheckr map.json --fix-in-place                  # overwrite the input",
        "    mapcheckr map.json -o fixed.json -r rejected.json  # explicit outputs",
        "",
        "  Defaults that are ON unless overridden:",
        "    --gen23 --gen4                allow Gen 2/3 and Gen 4 cars",
        "    --reject-unofficial           drop user photospheres",
        "    --reject-no-links             drop isolated panoramas (no arrows)",
        "    --reject-no-links-if-no-heading  ...also drop unpanned isolated",
        "    --from 2008-01 --to <today>   no date filter by default",
        "    --radius 50                   lookup radius (m) for non-panoId entries",
        "    auto-concurrency              starts at 50, ramps up to 200 if Google",
        "                                  keeps up. Pin with -c <n> to disable.",
        "    --retries 2                   per-request network retry budget",
        "",
        "  Defaults that are OFF until you opt in:",
        "    --gen1                        also accept Gen 1 cars",
        "    --change-to-official, --reject-no-description,",
        "    --update-pano-ids, --update-coordinates,",
        "    --remove-nearby (--nearby-radius 10m),",
        "    --update-pitch, --update-zoom,",
        "    --heading-for-{panoid,non-panoid,panned,unpanned}",
        "",
        "  Tip: `mapcheckr <map> --print-config` shows the resolved settings without running.",
        "",
    ];
    process.stdout.write(lines.join("\n") + "\n");
}
function parseRange(value) {
    const m = String(value).split(",").map((p) => Number(p.trim()));
    if (m.length !== 2 || m.some((n) => Number.isNaN(n))) {
        throw new Error(`Bad range "${value}" — expected "min,max"`);
    }
    return [Math.min(m[0], m[1]), Math.max(m[0], m[1])];
}
function clampRange(r, lo, hi) { return [clamp(r[0], lo, hi), clamp(r[1], lo, hi)]; }

function deepMerge(target, src) {
    for (const k of Object.keys(src)) {
        if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k]) && typeof target[k] === "object" && target[k] != null) {
            deepMerge(target[k], src[k]);
        } else {
            target[k] = src[k];
        }
    }
    return target;
}

async function writeJson(filePath, data) {
    // Stream-write to avoid one giant string for very large arrays.
    const fd = await fs.promises.open(filePath, "w");
    try {
        await fd.write("[");
        const chunkSize = 5000;
        for (let i = 0; i < data.length; i += chunkSize) {
            const slice = data.slice(i, i + chunkSize).map((x) => JSON.stringify(x)).join(",");
            if (i > 0) await fd.write(",");
            await fd.write(slice);
        }
        await fd.write("]");
    } finally {
        await fd.close();
    }
}

// Stream-write a map. If `wrapper` is non-null, re-emit the original
// `{customCoordinates: [...]}` (or richer) shape the input came in. Writes to
// a sibling tempfile and renames so an in-place overwrite stays atomic.
async function writeMap(filePath, data, wrapper) {
    const tmpPath = filePath + ".tmp" + process.pid;
    const fd = await fs.promises.open(tmpPath, "w");
    try {
        if (wrapper) {
            // Emit the wrapper keys, leaving customCoordinates as a streamed array.
            const wrapperKeys = Object.keys(wrapper).filter((k) => k !== "customCoordinates");
            await fd.write("{");
            for (const k of wrapperKeys) {
                await fd.write(JSON.stringify(k) + ":" + JSON.stringify(wrapper[k]) + ",");
            }
            await fd.write(JSON.stringify("customCoordinates") + ":");
            await streamArray(fd, data);
            await fd.write("}");
        } else {
            await streamArray(fd, data);
        }
    } finally {
        await fd.close();
    }
    await fs.promises.rename(tmpPath, filePath);
}

async function streamArray(fd, data) {
    await fd.write("[");
    const chunkSize = 5000;
    for (let i = 0; i < data.length; i += chunkSize) {
        const slice = data.slice(i, i + chunkSize).map((x) => JSON.stringify(x)).join(",");
        if (i > 0) await fd.write(",");
        await fd.write(slice);
    }
    await fd.write("]");
}

// `getConcurrency` is a function so the pool can pick up live changes from the
// adaptive controller between scheduling decisions. Scale-up takes effect on
// the next iteration; scale-down is enforced by simply not starting new work
// until in-flight drops below the new target.
async function runPool(items, getConcurrency, worker) {
    const inflight = new Set();
    let cursor = 0;
    const next = () => {
        if (cursor >= items.length) return null;
        const item = items[cursor++];
        const p = worker(item).finally(() => inflight.delete(p));
        inflight.add(p);
        return p;
    };
    while (cursor < items.length || inflight.size > 0) {
        const target = getConcurrency();
        while (inflight.size < target && cursor < items.length) next();
        if (inflight.size === 0) break;
        await Promise.race(inflight);
    }
}
