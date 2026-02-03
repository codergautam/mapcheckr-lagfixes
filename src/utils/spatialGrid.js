/**
 * Spatial grid for O(N) duplicate removal instead of O(N²)
 *
 * Instead of comparing every point to every other point,
 * we divide the world into grid cells and only compare points
 * within the same cell and adjacent cells.
 */

const EARTH_RADIUS_M = 6371071; // Earth radius in meters

/**
 * Convert latitude to meters (approximate)
 */
function latToMeters(lat) {
    return lat * (Math.PI / 180) * EARTH_RADIUS_M;
}

/**
 * Convert longitude to meters at a given latitude
 */
function lngToMeters(lng, lat) {
    return lng * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(lat * Math.PI / 180);
}

/**
 * Haversine distance between two points in meters
 */
function haversineDistance(mk1, mk2) {
    const R = 6371.071;
    const rlat1 = mk1.lat * (Math.PI / 180);
    const rlat2 = mk2.lat * (Math.PI / 180);
    const difflat = rlat2 - rlat1;
    const difflon = (mk2.lng - mk1.lng) * (Math.PI / 180);
    const km =
        2 *
        R *
        Math.asin(
            Math.sqrt(
                Math.sin(difflat / 2) * Math.sin(difflat / 2) +
                Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(difflon / 2) * Math.sin(difflon / 2)
            )
        );
    return km * 1000;
}

/**
 * Get grid cell key for a point
 */
function getCellKey(lat, lng, cellSize) {
    // Use a simple grid based on lat/lng degrees
    // cellSize is in meters, convert to approximate degrees
    const latCellSize = cellSize / 111320; // ~111km per degree latitude
    const lngCellSize = cellSize / (111320 * Math.cos(lat * Math.PI / 180) || 111320);

    const cellX = Math.floor(lng / lngCellSize);
    const cellY = Math.floor(lat / latCellSize);

    return `${cellX},${cellY}`;
}

/**
 * Get all adjacent cell keys (including the cell itself)
 */
function getAdjacentCellKeys(lat, lng, cellSize) {
    const latCellSize = cellSize / 111320;
    const lngCellSize = cellSize / (111320 * Math.cos(lat * Math.PI / 180) || 111320);

    const cellX = Math.floor(lng / lngCellSize);
    const cellY = Math.floor(lat / latCellSize);

    const keys = [];
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            keys.push(`${cellX + dx},${cellY + dy}`);
        }
    }
    return keys;
}

/**
 * Remove nearby duplicates using spatial grid indexing
 * Time complexity: O(N) average case instead of O(N²)
 *
 * @param {Array} arr - Array of location objects with lat/lng
 * @param {number} radius - Minimum distance in meters between points
 * @param {Function} onProgress - Optional callback for progress updates
 * @returns {Array} Filtered array with duplicates removed
 */
export function removeNearbyOptimized(arr, radius, onProgress = null) {
    if (arr.length === 0) return [];

    // Use cell size slightly larger than radius to ensure we catch all nearby points
    const cellSize = radius * 1.5;

    // Grid to store accepted points by cell
    const grid = new Map();
    const result = [];

    const totalItems = arr.length;
    let lastProgressUpdate = 0;

    for (let i = 0; i < arr.length; i++) {
        const point = arr[i];
        const { lat, lng } = point;

        // Get all cells we need to check (current + adjacent)
        const cellsToCheck = getAdjacentCellKeys(lat, lng, cellSize);

        // Check if any existing point in nearby cells is too close
        let hasClosePoint = false;

        for (const cellKey of cellsToCheck) {
            const cellPoints = grid.get(cellKey);
            if (!cellPoints) continue;

            for (const existingPoint of cellPoints) {
                if (haversineDistance(point, existingPoint) < radius) {
                    hasClosePoint = true;
                    break;
                }
            }
            if (hasClosePoint) break;
        }

        if (!hasClosePoint) {
            // Add to result and grid
            result.push(point);

            const cellKey = getCellKey(lat, lng, cellSize);
            if (!grid.has(cellKey)) {
                grid.set(cellKey, []);
            }
            grid.get(cellKey).push(point);
        }

        // Report progress every 1000 items or 100ms
        if (onProgress && (i - lastProgressUpdate >= 1000)) {
            onProgress(i, totalItems);
            lastProgressUpdate = i;
        }
    }

    if (onProgress) {
        onProgress(totalItems, totalItems);
    }

    return result;
}

/**
 * Process in chunks to avoid blocking the main thread
 * Uses requestIdleCallback or setTimeout fallback
 */
export function removeNearbyAsync(arr, radius, onProgress = null) {
    return new Promise((resolve) => {
        if (arr.length === 0) {
            resolve([]);
            return;
        }

        const cellSize = radius * 1.5;
        const grid = new Map();
        const result = [];

        const totalItems = arr.length;
        let currentIndex = 0;
        const chunkSize = 5000; // Process 5000 items per frame

        function processChunk() {
            const startTime = performance.now();
            const endIndex = Math.min(currentIndex + chunkSize, arr.length);

            while (currentIndex < endIndex) {
                const point = arr[currentIndex];
                const { lat, lng } = point;

                const cellsToCheck = getAdjacentCellKeys(lat, lng, cellSize);
                let hasClosePoint = false;

                for (const cellKey of cellsToCheck) {
                    const cellPoints = grid.get(cellKey);
                    if (!cellPoints) continue;

                    for (const existingPoint of cellPoints) {
                        if (haversineDistance(point, existingPoint) < radius) {
                            hasClosePoint = true;
                            break;
                        }
                    }
                    if (hasClosePoint) break;
                }

                if (!hasClosePoint) {
                    result.push(point);
                    const cellKey = getCellKey(lat, lng, cellSize);
                    if (!grid.has(cellKey)) {
                        grid.set(cellKey, []);
                    }
                    grid.get(cellKey).push(point);
                }

                currentIndex++;
            }

            if (onProgress) {
                onProgress(currentIndex, totalItems);
            }

            if (currentIndex < arr.length) {
                // Use requestAnimationFrame to yield to the browser
                requestAnimationFrame(processChunk);
            } else {
                resolve(result);
            }
        }

        // Start processing
        requestAnimationFrame(processChunk);
    });
}
