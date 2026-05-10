// Default settings — kept identical to the website's `useStorage` defaults
// so the CLI behaves the same out of the box.

export function defaultSettings() {
    const today = new Date();
    const dateToday = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0");
    return {
        radius: 50,
        filterByGen: { 1: false, 23: true, 4: true },
        filterByDate: { from: "2008-01", to: dateToday },
        rejectUnofficial: true,
        rejectNoDescription: false,
        changeToOfficial: false,
        rejectNoLinks: true,
        rejectNoLinksIfNoHeading: true,
        updateCoordinates: false,
        updatePanoIDs: false,
        removeNearby: false,
        nearbyRadius: 10,
        heading: {
            range: [0, 0],
            randomInRange: false,
            filterBy: { panned: false, unpanned: false, panoID: false, nonPanoID: false },
            directionBy: { 1: "forward", 23: "forward", 4: "forward", DEAD_END: "link" },
        },
        pitch: { updatePitch: false, removePitch: false, range: [0, 0], randomInRange: false, onlyIfMissing: false },
        zoom:  { updateZoom: false,  range: [0, 0], randomInRange: false },
    };
}
