// Reverse-engineered Google Street View metadata API.
// Mirrors what the Maps JS SDK calls under the hood, so no API key is needed.

import { toProtobufUrl, E, I } from "./protobuf-url.js";

const SEARCH_URL  = "https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch";
const PHOTOMETA_URL = "https://www.google.com/maps/photometa/v1";

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (mapcheckr-cli)",
    "Accept": "*/*",
};

// At 22 chars almost everything is official. The one well-known exception is
// the `CIHM…` 22-char form, which is the unwrapped inner ID of a `CAoS…`
// share-link and only resolves under type=10. Other `CI…` prefixes (CICe,
// CI4N, CIh0, …) ARE official 22-char IDs that happen to start with CI.
// Anything not 22 chars is third-party regardless of prefix.
const isThirdPartyPanoid = (panoid) => panoid && (panoid.length !== 22 || panoid.startsWith("CIHM"));

// Some maps store panoIds in the URL-share-link "CAoS..." wrapper format —
// a URL-safe base64'd protobuf where field 2 holds the real panoId. Google's
// JS SDK transparently unwraps these; the photometa/by-id endpoint does not,
// so we have to do it ourselves before querying.
function unwrapPanoId(panoid) {
    if (!panoid || !panoid.startsWith("CAoS")) return panoid;
    try {
        const b64 = panoid.replace(/-/g, "+").replace(/_/g, "/").replace(/\./g, "=");
        const buf = Buffer.from(b64, "base64");
        let i = 0;
        while (i < buf.length) {
            const tag = buf[i++];
            const fieldNum = tag >> 3, wireType = tag & 7;
            if (wireType === 0) {                           // varint
                while (i < buf.length && (buf[i++] & 0x80)) {}
            } else if (wireType === 2) {                    // length-delimited
                const len = buf[i++];
                const data = buf.slice(i, i + len);
                i += len;
                if (fieldNum === 2) return data.toString("ascii");
            } else {
                return panoid;                              // unexpected — bail
            }
        }
    } catch { /* fall through */ }
    return panoid;
}

// imageType: 2 = official Street View, 10 = third-party (photospheres etc.)
// The endpoint only accepts ONE source per request, so "any source" means
// firing both in parallel and picking the closer hit.
function buildLocationPb(lat, lng, radius, imageType) {
    const message = {
        1: { 1: "apiv3", 5: "US", 11: { 1: { 1: false } } },
        2: { 1: { 3: lat, 4: lng }, 2: radius },
        3: {
            2:  { 1: "en", 2: "US" },
            9:  { 1: E(2) },
            11: { 1: { 1: E(imageType), 2: true, 3: E(2) } },
        },
        4: {
            1: [E(1), E(2), E(3), E(4), E(6), E(8), E(12)],
            5: {},
            6: {},
        },
    };
    return toProtobufUrl(message);
}

function buildPanoIdPb(panoid) {
    return buildPanoIdPbAs(panoid, isThirdPartyPanoid(panoid) ? 10 : 2);
}

function buildPanoIdPbAs(panoid, panoType) {
    const message = {
        1: { 1: "maps_sv.tactile", 11: { 2: { 1: true } } },
        2: { 1: "en", 2: "US" },
        3: { 1: { 1: E(panoType), 2: panoid } },
        4: {
            1: [E(1), E(2), E(3), E(4), E(5), E(6), E(8), E(12)],
            2: { 1: E(1) },
            4: { 1: I(48) },
            5: {},
            6: {},
            9: {
                1: [
                    { 1: E(2),  2: true,  3: E(2) },
                    { 1: E(2),  2: false, 3: E(3) },
                    { 1: E(3),  2: true,  3: E(2) },
                    { 1: E(3),  2: false, 3: E(3) },
                    { 1: E(8),  2: false, 3: E(3) },
                    { 1: E(1),  2: false, 3: E(3) },
                    { 1: E(4),  2: false, 3: E(3) },
                    { 1: E(10), 2: true,  3: E(2) },
                    { 1: E(10), 2: false, 3: E(3) },
                ],
            },
            11: { 3: { 4: true } },
        },
    };
    return toProtobufUrl(message);
}

async function fetchText(url, signal) {
    const res = await fetch(url, { headers: COMMON_HEADERS, signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

// Strip the JSONP wrapper:  /**/cb && cb( ...data... )
function stripJsonp(text) {
    const fp = text.indexOf("(");
    const lp = text.lastIndexOf(")");
    if (fp < 0 || lp < 0) throw new Error("Bad JSONP response");
    return "[" + text.slice(fp + 1, lp) + "]";
}

// Strip the )]}'\n anti-XSSI prefix from photometa responses
function stripXssi(text) {
    return text.startsWith(")]}'") ? text.slice(text.indexOf("\n") + 1) : text;
}

// ---- Lookup primitives -----------------------------------------------------

async function searchOneSource(lat, lng, radius, imageType, signal) {
    const pb = buildLocationPb(lat, lng, radius, imageType);
    const url = `${SEARCH_URL}?pb=${pb}&callback=cb`;
    const text = await fetchText(url, signal);
    const parsed = JSON.parse(stripJsonp(text));
    const arg1 = parsed[0];
    const statusCode = arg1?.[0]?.[0];
    if (statusCode !== 0) return null;          // 5 = no images
    return normalizePanorama(arg1[1]);
}

function distanceMeters(aLat, aLng, bLat, bLng) {
    const R = 6371071;
    const rlat1 = aLat * Math.PI / 180;
    const rlat2 = bLat * Math.PI / 180;
    const dlat = rlat2 - rlat1;
    const dlng = (bLng - aLng) * Math.PI / 180;
    return 2 * R * Math.asin(Math.sqrt(Math.sin(dlat/2)**2 + Math.cos(rlat1)*Math.cos(rlat2)*Math.sin(dlng/2)**2));
}

export async function getPanoramaByLocation(lat, lng, radius, { officialOnly = false, signal } = {}) {
    if (officialOnly) {
        return searchOneSource(lat, lng, radius, 2, signal);
    }
    // Match the JS SDK's no-source-filter behavior: query both, pick whichever
    // pano is geographically closer.
    const [official, thirdParty] = await Promise.all([
        searchOneSource(lat, lng, radius, 2, signal).catch(() => null),
        searchOneSource(lat, lng, radius, 10, signal).catch(() => null),
    ]);
    if (!official) return thirdParty;
    if (!thirdParty) return official;
    const dOff = distanceMeters(lat, lng, official.location.latLng.lat(), official.location.latLng.lng());
    const dTp  = distanceMeters(lat, lng, thirdParty.location.latLng.lat(), thirdParty.location.latLng.lng());
    return dTp < dOff ? thirdParty : official;
}

async function fetchPanoIdAsType(realId, panoType, signal) {
    const pb = buildPanoIdPbAs(realId, panoType);
    const url = `${PHOTOMETA_URL}?authuser=0&hl=en&gl=us&pb=${pb}`;
    const text = await fetchText(url, signal);
    const stripped = stripXssi(text);
    const parsed = JSON.parse(stripped);
    const statusCode = parsed?.[1]?.[0]?.[0]?.[0];
    if (statusCode !== 1) return null;          // 2 = not found
    return normalizePanorama(parsed[1][0]);
}

export async function getPanoramaById(panoid, { signal } = {}) {
    const realId = unwrapPanoId(panoid);
    const firstType = isThirdPartyPanoid(realId) ? 10 : 2;
    let pano = await fetchPanoIdAsType(realId, firstType, signal);
    // Heuristic miss → retry with the other source type before giving up.
    // Catches edge-case IDs like CICe…/CI4N… (22-char official starting with
    // CI) and the rare 22-char third-party forms we don't recognise.
    if (!pano) pano = await fetchPanoIdAsType(realId, firstType === 2 ? 10 : 2, signal);
    // Mirror the JS SDK: when the caller supplied a wrapped `CAoS…` panoId,
    // res.location.pano keeps the wrapped form (so a downstream
    // `pano.length !== 22` check correctly classifies it as unofficial).
    if (pano && realId !== panoid) pano.location.pano = panoid;
    return pano;
}

// ---- Response normalizer ---------------------------------------------------
// Returns an object shaped like google.maps.StreetViewPanoramaData so the
// downstream filter logic from the website can stay byte-for-byte identical.

function normalizePanorama(msg) {
    if (!msg) return null;

    const tg = (fn, dflt = undefined) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };

    const panoId = tg(() => msg[1][1]);
    if (!panoId) return null;

    const lat = tg(() => msg[5][0][1][0][2]);
    const lng = tg(() => msg[5][0][1][0][3]);

    // worldSize: msg[2][2] = [height, width]
    const worldSizeRaw = tg(() => msg[2][2]) || [0, 0];
    const worldSize = { height: worldSizeRaw[0], width: worldSizeRaw[1] };

    // tile size
    const tileSizeRaw = tg(() => msg[2][3][1]) || [512, 512];
    const tileSize = { height: tileSizeRaw[0], width: tileSizeRaw[1] };

    // h/p/r in degrees: msg[5][0][1][2] = [heading, pitch_from_horizon, roll]
    const hpr = tg(() => msg[5][0][1][2]) || [0, 90, 0];
    const centerHeading = hpr[0] || 0;

    // image date: msg[6][7] = [year, month, day?]
    const dateArr = tg(() => msg[6][7]);
    const imageDate = dateArr
        ? `${dateArr[0]}-${String(dateArr[1] || 1).padStart(2, "0")}`
        : null;

    // Address (description) — msg[3][2] is a list of [text, lang] pairs.
    const addressRaw = tg(() => msg[3][2]) || [];
    const description = addressRaw[0]?.[0] || "";
    // Street labels (shortDescription) — msg[5][0][12]
    const streetLabels = tg(() => msg[5][0][12]) || [];
    const shortDescription = tg(() => streetLabels[0][0][0][2][0]) || "";

    // Connected panos table: msg[5][0][3][0] is an array of nodes; msg[5][0][6]
    // is the index list of links, msg[5][0][8] is the index list of historical
    // captures.
    const others = tg(() => msg[5][0][3][0]) || [];
    const linkIdxs = tg(() => msg[5][0][6]) || [];
    const histIdxs = tg(() => msg[5][0][8]) || [];

    const links = [];
    for (const entry of linkIdxs) {
        const idx = entry[0];
        const other = others[idx];
        if (!other) continue;
        const linkPano = tg(() => other[0][1]);
        const heading = tg(() => entry[1][3], 0);
        if (linkPano) links.push({ pano: linkPano, heading });
    }

    // Historical -> Google's `time` array, sorted ascending by date. Mirrors
    // the JS SDK's StreetViewPanoramaData.time which the website relies on for
    // updatePanoIDs.
    const time = [];
    for (const entry of histIdxs) {
        const idx = entry[0];
        const other = others[idx];
        const histDate = entry[1];
        if (!other || !histDate) continue;
        const histPano = tg(() => other[0][1]);
        if (!histPano) continue;
        const d = new Date(Date.UTC(histDate[0], (histDate[1] || 1) - 1, histDate[2] || 1));
        time.push({ pano: histPano, date: d, dateArr: histDate });
    }
    // Make sure the *current* pano is part of the time line as the most recent
    // capture so SVreq's `time[time.length-1].pano` keeps working even when no
    // historical entries are available.
    if (imageDate) {
        const [y, m] = imageDate.split("-").map(Number);
        const d = new Date(Date.UTC(y, m - 1, dateArr[2] || 1));
        time.push({ pano: panoId, date: d, dateArr });
    }
    time.sort((a, b) => a.date - b.date);

    return {
        location: {
            pano: panoId,
            description,
            shortDescription,
            latLng: { lat: () => lat, lng: () => lng },
        },
        imageDate,
        tiles: { centerHeading, worldSize, tileSize },
        links,
        time,
    };
}
