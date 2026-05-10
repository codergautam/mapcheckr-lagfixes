// Terminal UI: a live multi-line panel (bar + per-reason breakdown) that
// updates in place during processing, and a final summary printed when the
// run finishes.
//
// In a TTY we redraw the panel by moving the cursor up to its first line and
// rewriting each row. With piped/CI output we periodically emit a single
// snapshot line instead.

import process from "node:process";
import chalk from "chalk";

const SYM_OK   = "✓";
const SYM_BAD  = "✗";
const SYM_DOT  = "•";

const isTTY = process.stdout.isTTY;

const ROW_DEFS = [
    { key: "OK",                 label: "Resolved",          good: true  },
    { key: "SV_NOT_FOUND",       label: "SV not found",      good: false },
    { key: "UNOFFICIAL",         label: "Unofficial",        good: false },
    { key: "NO_DESCRIPTION",     label: "No description",    good: false },
    { key: "WRONG_GENERATION",   label: "Wrong generation",  good: false },
    { key: "OUT_OF_DATE_RANGE",  label: "Out of date range", good: false },
    { key: "ISOLATED",           label: "Isolated",          good: false },
    { key: "OTHER",              label: "Network errors",    good: false },
];

export function header({ inputPath, count, settings, concurrencyPolicy, outputPath }) {
    const dim = chalk.dim;
    const accent = chalk.cyan.bold;
    const gens = ["1", "23", "4"].filter((g) => settings.filterByGen[g]).join("+") || "none";
    const dateRange = `${settings.filterByDate.from}..${settings.filterByDate.to}`;
    const flags = [
        settings.rejectUnofficial    ? "official"        : "any-source",
        settings.rejectNoDescription ? "no-trekkers"     : null,
        settings.changeToOfficial    ? "fix-to-official" : null,
        settings.rejectNoLinks       ? "no-isolated"     : settings.rejectNoLinksIfNoHeading ? "no-unpanned-isolated" : null,
        settings.updatePanoIDs       ? "update-pano"     : null,
        settings.updateCoordinates   ? "update-coords"   : null,
        settings.removeNearby        ? `dedup-${settings.nearbyRadius}m` : null,
        settings.heading.filterBy.panoID || settings.heading.filterBy.nonPanoID ? "auto-heading" : null,
        settings.pitch.removePitch   ? "remove-pitch"    : settings.pitch.updatePitch ? "auto-pitch" : null,
        settings.zoom.updateZoom     ? "auto-zoom"       : null,
    ].filter(Boolean).join(" " + chalk.dim("|") + " ");

    const lines = [
        "",
        accent("MapCheckr") + dim("  ·  reverse-engineered Street View checker"),
        dim("─".repeat(72)),
        `${dim("Input    ")} ${chalk.white(inputPath)} ${dim("(" + count.toLocaleString() + " locations)")}`,
        `${dim("Output   ")} ${chalk.white(outputPath)}`,
        `${dim("Coverage ")} gen ${chalk.yellow(gens)}  ${dim("·")}  ${chalk.yellow(dateRange)}  ${dim("·")}  radius ${chalk.yellow(settings.radius + "m")}`,
        `${dim("Filters  ")} ${flags || dim("(none)")}`,
        `${dim("Workers  ")} ${chalk.yellow(concurrencyPolicy)}`,
        dim("─".repeat(72)),
        "",
    ];
    process.stdout.write(lines.join("\n") + "\n");
}

export function makeProgress(total, getConcurrency = null) {
    const startTime = Date.now();
    const counters = Object.fromEntries(ROW_DEFS.map((r) => [r.key, 0]));
    let lastTtyRender = 0;
    let lastNonTtyRender = 0;
    let panelLines = 0;
    let firstRender = true;

    if (isTTY) process.stdout.write("\x1B[?25l");          // hide cursor

    function render(force = false) {
        const now = Date.now();

        if (isTTY) {
            // Throttle to ~12 fps
            if (!force && now - lastTtyRender < 80) return;
            lastTtyRender = now;
        } else {
            // Snapshot once per second, plus a forced render at end
            if (!force && now - lastNonTtyRender < 1000) return;
            lastNonTtyRender = now;
        }

        const done = totalDone(counters);
        const elapsed = (now - startTime) / 1000;
        const rate = elapsed > 0 ? done / elapsed : 0;
        const eta = rate > 0 && done < total ? (total - done) / rate : 0;
        const pct = total > 0 ? done / total : 0;

        const concurrency = getConcurrency ? getConcurrency() : null;
        const lines = buildPanel({ total, done, pct, rate, eta, counters, concurrency });

        if (isTTY) {
            if (!firstRender) process.stdout.write(`\x1B[${panelLines}A`);
            for (const line of lines) process.stdout.write("\x1B[2K" + line + "\n");
            firstRender = false;
            panelLines = lines.length;
        } else {
            // Compact one-liner for piped output
            const ok = counters.OK;
            const fail = done - ok;
            process.stdout.write(
                `  ${(pct * 100).toFixed(1).padStart(5)}%  ` +
                `${fmtNum(done)}/${fmtNum(total)}  ETA ${fmtDuration(eta).padEnd(8)}  ` +
                `${rate.toFixed(0).padStart(5)} req/s  ` +
                `${SYM_OK}${fmtNum(ok)} ${SYM_BAD}${fmtNum(fail)}` +
                `  ${rejectionDigest(counters)}\n`
            );
        }
    }

    // Initial render so the panel shows up immediately
    render(true);

    return {
        tick(reason) {
            counters[reason] = (counters[reason] || 0) + 1;
            render();
        },
        stop() {
            render(true);
            if (isTTY) process.stdout.write("\x1B[?25h"); // show cursor
        },
        counters,
    };
}

function totalDone(counters) {
    let n = 0;
    for (const k of Object.keys(counters)) n += counters[k];
    return n;
}

function buildPanel({ total, done, pct, rate, eta, counters, concurrency }) {
    const dim = chalk.dim;
    const barWidth = 40;
    const filled = Math.min(barWidth, Math.round(barWidth * pct));
    const bar = chalk.cyan("█".repeat(filled)) + dim("░".repeat(barWidth - filled));

    const ok = counters.OK;
    const fail = done - ok;

    const headLine =
        `  ${bar}  ${(pct * 100).toFixed(1).padStart(5)}%  ${dim("│")}  ` +
        `${fmtNum(done)}/${fmtNum(total)}  ${dim("│")}  ` +
        `ETA ${chalk.yellow(fmtDuration(eta).padEnd(8))}  ${dim("│")}  ` +
        `${chalk.white(rate.toFixed(0).padStart(4))} req/s  ${dim("│")}  ` +
        (concurrency != null ? `c=${chalk.cyan(concurrency)}  ${dim("│")}  ` : "") +
        `${chalk.green(SYM_OK)} ${fmtNum(ok)}  ${chalk.red(SYM_BAD)} ${fmtNum(fail)}`;

    const rows = ROW_DEFS.map((r) => {
        const n = counters[r.key];
        const sym  = r.good ? chalk.green(SYM_OK) : (n > 0 ? chalk.red(SYM_BAD) : dim(SYM_DOT));
        const lbl  = r.label.padEnd(20);
        const num  = fmtNum(n).padStart(10);
        const pctS = (total === 0 ? "0.00" : ((n / total) * 100).toFixed(2)).padStart(6) + "%";
        const colorize = n > 0 ? (r.good ? chalk.green : chalk.red) : dim;
        return `  ${sym} ${lbl} ${colorize(num)}  ${dim(pctS)}`;
    });

    return [headLine, "", ...rows];
}

function rejectionDigest(counters) {
    // Compact piped-mode line, e.g. "SV:38 UN:12 IS:4"
    const parts = [];
    for (const r of ROW_DEFS) {
        if (r.key === "OK") continue;
        if (counters[r.key] > 0) parts.push(`${shortKey(r.key)}:${counters[r.key]}`);
    }
    return parts.join(" ");
}

function shortKey(k) {
    return ({
        SV_NOT_FOUND: "SV", UNOFFICIAL: "UN", NO_DESCRIPTION: "ND",
        WRONG_GENERATION: "WG", OUT_OF_DATE_RANGE: "DR", ISOLATED: "IS", OTHER: "ER",
    })[k] || k.slice(0, 2);
}

export function summary({ totalDuration, total, resolved, rejectedCounts, removedNearbyCount, outputPath, rejectedPath }) {
    const dim = chalk.dim;
    const headerLine = dim("─".repeat(72));
    const pct = (n) => total === 0 ? "0.00%" : ((n / total) * 100).toFixed(2) + "%";
    const counters = { OK: resolved, ...rejectedCounts };

    process.stdout.write("\n" + headerLine + "\n");
    process.stdout.write(chalk.cyan.bold("  Results") + dim("  ·  finished in " + fmtDuration(totalDuration)) + "\n");
    process.stdout.write(headerLine + "\n");
    for (const r of ROW_DEFS) {
        const n = counters[r.key] ?? 0;
        const sym = r.good ? chalk.green(SYM_OK) : (n > 0 ? chalk.red(SYM_BAD) : dim(SYM_DOT));
        const lbl = r.label.padEnd(20);
        const num = fmtNum(n).padStart(10);
        const colorize = n > 0 ? (r.good ? chalk.green : chalk.red) : dim;
        process.stdout.write(`  ${sym} ${lbl} ${colorize(num)}  ${dim(pct(n))}\n`);
    }
    if (removedNearbyCount > 0) {
        const lbl = "Dedup'd nearby".padEnd(20);
        const num = fmtNum(removedNearbyCount).padStart(10);
        process.stdout.write(`  ${chalk.yellow(SYM_DOT)} ${lbl} ${chalk.yellow(num)}  ${dim("removed from resolved")}\n`);
    }
    process.stdout.write(headerLine + "\n");
    process.stdout.write(`  ${chalk.green("→ saved")} ${chalk.white(outputPath)} ${dim(`(${resolved.toLocaleString()} locations)`)}\n`);
    if (rejectedPath) {
        process.stdout.write(`  ${chalk.red("→ saved")} ${chalk.white(rejectedPath)} ${dim("(rejected locations)")}\n`);
    }
    process.stdout.write("\n");
}

export function warn(msg)  { process.stderr.write(chalk.yellow("⚠ ") + msg + "\n"); }
export function error(msg) { process.stderr.write(chalk.red("✗ ") + msg + "\n"); }
export function info(msg)  { process.stdout.write(chalk.cyan("ℹ ") + msg + "\n"); }

function fmtDuration(seconds) {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--";
    seconds = Math.round(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function fmtNum(n) { return n.toLocaleString(); }

// Restore cursor on abnormal exit
function restoreCursor() { if (isTTY) process.stdout.write("\x1B[?25h"); }
process.on("exit",     restoreCursor);
process.on("SIGINT",   () => { restoreCursor(); process.exit(130); });
process.on("SIGTERM",  () => { restoreCursor(); process.exit(143); });
