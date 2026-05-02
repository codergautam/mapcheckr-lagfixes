// Synchronous Node port of src/utils/spatialGrid.js — same O(N) dedup,
// without the requestAnimationFrame chunking (we can saturate a CPU here).

function haversineDistance(a, b) {
    const R = 6371.071;
    const rlat1 = a.lat * (Math.PI / 180);
    const rlat2 = b.lat * (Math.PI / 180);
    const dlat = rlat2 - rlat1;
    const dlon = (b.lng - a.lng) * (Math.PI / 180);
    const km = 2 * R * Math.asin(Math.sqrt(
        Math.sin(dlat / 2) ** 2 + Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(dlon / 2) ** 2
    ));
    return km * 1000;
}

function cellKey(lat, lng, cellSize) {
    const latCell = cellSize / 111320;
    const lngCell = cellSize / (111320 * Math.cos(lat * Math.PI / 180) || 111320);
    return `${Math.floor(lng / lngCell)},${Math.floor(lat / latCell)}`;
}

function adjacentCellKeys(lat, lng, cellSize) {
    const latCell = cellSize / 111320;
    const lngCell = cellSize / (111320 * Math.cos(lat * Math.PI / 180) || 111320);
    const cx = Math.floor(lng / lngCell);
    const cy = Math.floor(lat / latCell);
    const keys = [];
    for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
            keys.push(`${cx + dx},${cy + dy}`);
    return keys;
}

export function removeNearby(arr, radius, onProgress) {
    if (arr.length === 0) return [];
    const cellSize = radius * 1.5;
    const grid = new Map();
    const result = [];

    for (let i = 0; i < arr.length; i++) {
        const point = arr[i];
        const { lat, lng } = point;
        const cells = adjacentCellKeys(lat, lng, cellSize);

        let close = false;
        for (const k of cells) {
            const bucket = grid.get(k);
            if (!bucket) continue;
            for (const ex of bucket) {
                if (haversineDistance(point, ex) < radius) { close = true; break; }
            }
            if (close) break;
        }

        if (!close) {
            result.push(point);
            const k = cellKey(lat, lng, cellSize);
            let bucket = grid.get(k);
            if (!bucket) { bucket = []; grid.set(k, bucket); }
            bucket.push(point);
        }
        if (onProgress && i % 5000 === 0) onProgress(i, arr.length);
    }
    if (onProgress) onProgress(arr.length, arr.length);
    return result;
}
