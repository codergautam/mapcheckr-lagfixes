// Node port of src/utils/SVreq.js — same filter logic, against the
// reverse-engineered API in lib/api.js.

import { getPanoramaByLocation, getPanoramaById } from "./api.js";

const reject = (loc, reason) => { throw { ...loc, reason }; };

export default async function SVreq(loc, settings) {
    let res;

    if (settings.pitch.removePitch) delete loc.pitch;

    if (!loc.panoId) {
        if (settings.changeToOfficial && settings.rejectUnofficial) {
            try {
                res = await getPanoramaByLocation(loc.lat, loc.lng, settings.radius, { officialOnly: true });
            } catch (e) {
                reject(loc, e.message || "FETCH_FAILED");
            }
            if (!res) {
                try {
                    res = await getPanoramaByLocation(loc.lat, loc.lng, settings.radius, { officialOnly: false });
                } catch (e) {
                    reject(loc, e.message || "FETCH_FAILED");
                }
            }
        } else {
            try {
                res = await getPanoramaByLocation(loc.lat, loc.lng, settings.radius, { officialOnly: false });
            } catch (e) {
                reject(loc, e.message || "FETCH_FAILED");
            }
        }
    } else {
        try {
            res = await getPanoramaById(loc.panoId);
        } catch (e) {
            reject(loc, e.message || "FETCH_FAILED");
        }
    }

    return checkPano(loc, res, settings);
}

function checkPano(loc, res, settings) {
    if (!res) reject(loc, "SV_NOT_FOUND");

    if (settings.rejectUnofficial) {
        if (res.location.pano.length !== 22) reject(loc, "UNOFFICIAL");
        if (settings.rejectNoDescription && !res.location.description && !res.location.shortDescription)
            reject(loc, "NO_DESCRIPTION");
    }

    const cameraGeneration = getCameraGeneration(res);
    const isPanoID = !!loc.panoId;
    const isPanned = loc.heading !== 0 && loc.heading !== undefined;

    // Skip generation filter for unofficial coverage (gen 0) when rejectUnofficial is false
    if (cameraGeneration !== 0 && !settings.filterByGen[cameraGeneration]) {
        reject(loc, "WRONG_GENERATION");
    }

    if (
        Date.parse(res.imageDate) < Date.parse(settings.filterByDate.from) ||
        Date.parse(res.imageDate) > Date.parse(settings.filterByDate.to)
    ) {
        reject(loc, "OUT_OF_DATE_RANGE");
    }

    if (settings.rejectNoLinks && res.links.length === 0) reject(loc, "ISOLATED");
    if (settings.rejectNoLinksIfNoHeading && res.links.length === 0 && !isPanned) reject(loc, "ISOLATED");

    if (settings.updateCoordinates) {
        loc.lat = res.location.latLng.lat();
        loc.lng = res.location.latLng.lng();
    }

    if (settings.updatePanoIDs) {
        loc.panoId = res.time[res.time.length - 1].pano;
    }

    if (
        res.links.length !== 0 &&
        ((settings.heading.filterBy.panoID && isPanoID) || (settings.heading.filterBy.nonPanoID && !isPanoID)) &&
        ((settings.heading.filterBy.panned && isPanned) || (settings.heading.filterBy.unpanned && !isPanned))
    ) {
        let heading = 0;
        if (res.links.length === 1) {
            heading = getHeading(settings.heading.directionBy["DEAD_END"], res);
        } else if (cameraGeneration) {
            heading = getHeading(settings.heading.directionBy[cameraGeneration], res);
        }

        if (settings.heading.randomInRange) {
            heading += randomInRange(settings.heading.range[0], settings.heading.range[1]);
        } else {
            heading += Math.random() < 0.5 ? settings.heading.range[0] : settings.heading.range[1];
        }
        loc.heading = heading;

        if (
            !settings.pitch.removePitch &&
            settings.pitch.updatePitch &&
            (!settings.pitch.onlyIfMissing || loc.pitch === undefined || loc.pitch === null)
        ) {
            loc.pitch = settings.pitch.randomInRange
                ? randomInRange(settings.pitch.range[0], settings.pitch.range[1])
                : (Math.random() < 0.5 ? settings.pitch.range[0] : settings.pitch.range[1]);
        }
        if (settings.zoom.updateZoom) {
            loc.zoom = settings.zoom.randomInRange
                ? randomInRange(settings.zoom.range[0], settings.zoom.range[1])
                : (Math.random() < 0.5 ? settings.zoom.range[0] : settings.zoom.range[1]);
        }
    }

    if (settings.pitch.removePitch) delete loc.pitch;

    return loc;
}

function getCameraGeneration(res) {
    switch (res.tiles.worldSize.height) {
        case 1664: return 1;
        case 6656: return 23;
        case 8192: return 4;
        default: return 0;
    }
}

function getHeading(direction, res) {
    const link = parseInt(res.links[0].heading);
    const forward = res.tiles.centerHeading;
    const backward = (res.tiles.centerHeading + 180) % 360;
    switch (direction) {
        case "link": return link;
        case "forward": return forward;
        case "backward": return backward;
        case "any":
            const r = randomInRange(1, 3);
            return r === 1 ? link : r === 2 ? forward : backward;
    }
}

const randomInRange = (min, max) => Math.round((Math.random() * (max - min + 1) + min) * 100) / 100;
