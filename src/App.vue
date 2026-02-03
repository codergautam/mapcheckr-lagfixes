<template>
    <div class="wrapper">
        <div class="flex-center wrap space-between p-05">
            <h1>MapCheckr</h1>
            <div v-if="!state.started" class="flex-center wrap gap-05">
                Paste or
                <input @change="loadFromJSON" type="file" id="file" class="input-file" accept="application/json" />
                <label for="file" class="btn">Import JSON</label>
            </div>
            <div v-if="state.finished" class="flex-center wrap gap-02">
                <Button @click="resetState" text="Reset" />
            </div>
        </div>

        <div class="wrapper__inner">
            <div v-if="error" class="container center danger">{{ error }}</div>

            <div v-if="state.loaded" class="container center">
                <h4>{{ customMap.nbLocs }} imported {{ pluralize("location", customMap.nbLocs) }}</h4>
                <Button v-if="!state.started" @click="handleClickStart" class="mt-02" text="Start checking" />
            </div>

            <div v-if="!state.started" class="container">
                <h2>General settings</h2>
                <div class="content">
                    <div class="flex">
                        <div class="col-50">
                            <h4>Filter by coverage</h4>
                            <Checkbox v-model:checked="settings.filterByGen[1]" label="Gen 1" />
                            <Checkbox v-model:checked="settings.filterByGen[23]" label="Gen 2 & 3" />
                            <Checkbox v-model:checked="settings.filterByGen[4]" label="Gen 4" />
                        </div>

                        <div class="col-50">
                            <h4>Filter by date</h4>
                            <div class="form__row space-between">
                                <label>From :</label>
                                <input
                                    type="month"
                                    v-model="settings.filterByDate.from"
                                    min="2007-01"
                                    :max="dateToday"
                                    @change="handleDate($event, 'from')"
                                />
                            </div>
                            <div class="form__row space-between">
                                <label>To :</label>
                                <input
                                    type="month"
                                    v-model="settings.filterByDate.to"
                                    min="2007-01"
                                    :max="dateToday"
                                    @change="handleDate($event, 'to')"
                                />
                            </div>
                        </div>
                    </div>
                    <hr />

                    <Checkbox
                        v-model:checked="settings.rejectUnofficial"
                        label="Reject unofficial"
                        optText="Uncheck for photospheres map"
                    />
                    <hr />

                    <div v-if="settings.rejectUnofficial">
                        <Checkbox
                            v-model:checked="settings.rejectNoDescription"
                            label="Reject locations without description"
                            optText="This might prevent trekkers in most cases, but can reject regular streetview without
						description (eg. Mongolia/South Korea)"
                        />
                        <hr />
                    </div>
                    <div v-if="settings.rejectUnofficial">
                        <Checkbox
                            v-model:checked="settings.changeToOfficial"
                            label="Change unofficial to official"
                            optText="Change unofficial locations to official within the radius."
                        />
                        <hr />
                    </div>

                    <Checkbox
                        @change="settings.rejectNoLinks ? (settings.rejectNoLinksIfNoHeading = true) : true"
                        v-model:checked="settings.rejectNoLinks"
                        label="Reject all isolated locations"
                        optText="Uncheck for photospheres map. This is for locations with no arrows to move to a nearby location, which may include regular but broken coverage."
                    />
                    <hr />

                    <div v-if="!settings.rejectNoLinks">
                        <Checkbox
                            @change="settings.rejectNoLinksIfNoHeading ? true : (settings.rejectNoLinks = false)"
                            v-model:checked="settings.rejectNoLinksIfNoHeading"
                            label="Reject unpanned isolated locations"
                        />
                        <hr />
                    </div>

                    <Checkbox
                        v-model:checked="settings.updatePanoIDs"
                        label="Update panoIDs"
                        optText="Update your locations to the most recent coverage. Also useful to automatically panoID your map."
                    />
                    <hr />

                    <Checkbox
                        v-model:checked="settings.updateCoordinates"
                        label="Update coordinates"
                        optText="non-panoID locations might slightly change"
                    />
                    <hr />

                    Radius<input type="number" v-model.number="settings.radius" @change="handleRadiusInput" />m<br />
                    <small>Radius in which to search for a non-panoID'ed panorama.</small>
                    <hr />

                    <div class="flex-center">
                        <Checkbox v-model:checked="settings.removeNearby" label="Reject duplicates within a " />
                        <input type="number" v-model.number="settings.nearbyRadius" @change="handleNearbyRadiusInput" />m radius
                    </div>
                    <hr />
                </div>

                <h2>Headings</h2>
                <div class="content">
                    <div class="mb-1">
                        <h4>Update heading for :</h4>
                        <div class="indent">
                            <Checkbox v-model:checked="settings.heading.filterBy.panoID" label="panoID" />
                            <Checkbox v-model:checked="settings.heading.filterBy.nonPanoID" label="non-panoID" />
                            <Checkbox v-model:checked="settings.heading.filterBy.panned" label="panned" />
                            <Checkbox v-model:checked="settings.heading.filterBy.unpanned" label="unpanned" />
                            <small
                                v-if="Object.values(settings.heading.filterBy).some((val) => val) && !areHeadingSettingsGood"
                                class="danger"
                                >Incorrect heading settings</small
                            >
                        </div>
                    </div>

                    <div v-if="areHeadingSettingsGood">
                        <div class="mb-1">
                            <h4>Direction :</h4>
                            <div class="indent">
                                <div class="form__row space-between" v-if="settings.filterByGen[1]">
                                    Gen 1 :
                                    <select v-model="settings.heading.directionBy[1]">
                                        <option value="link">Along road</option>
                                        <option value="forward">To front of car</option>
                                        <option value="backward">To back of car</option>
                                        <option value="any">Any</option>
                                    </select>
                                </div>
                                <div class="form__row space-between" v-if="settings.filterByGen[23]">
                                    Gen 2 & 3 :
                                    <select v-model="settings.heading.directionBy[23]">
                                        <option value="link">Along road</option>
                                        <option value="forward">To front of car</option>
                                        <option value="backward">To back of car</option>
                                        <option value="any">Any</option>
                                    </select>
                                </div>
                                <div class="form__row space-between" v-if="settings.filterByGen[4]">
                                    Gen 4 :
                                    <select v-model="settings.heading.directionBy[4]">
                                        <option value="link">Along road</option>
                                        <option value="forward">To front of car</option>
                                        <option value="backward">To back of car</option>
                                        <option value="any">Any</option>
                                    </select>
                                </div>
                                <div
                                    class="form__row space-between"
                                    v-if="Object.values(settings.filterByGen).some((val) => val === true)"
                                >
                                    Dead ends :
                                    <select v-model="settings.heading.directionBy['DEAD_END']">
                                        <option value="link">Along road</option>
                                        <option value="forward">To front of car</option>
                                        <option value="backward">To back of car</option>
                                        <option value="any">Any</option>
                                    </select>
                                </div>

                                <label class="form__row space-between">
                                    Heading deviation :
                                    <Slider
                                        v-model="settings.heading.range"
                                        :min="-180"
                                        :max="180"
                                        :lazy="false"
                                        tooltipPosition="bottom"
                                        style="width: 140px"
                                    />
                                </label>
                                <Checkbox
                                    v-model:checked="settings.heading.randomInRange"
                                    label="Random in range"
                                    class="indent"
                                />
                            </div>
                        </div>

                        <div class="mb-1">
                            <Checkbox v-model:checked="settings.pitch.updatePitch" label="Pitch :" class="strong" />
                            <div v-if="settings.pitch.updatePitch" class="indent">
                                <label class="form__row space-between">
                                    Pitch deviation :
                                    <Slider
                                        v-model="settings.pitch.range"
                                        :min="-90"
                                        :max="90"
                                        :lazy="false"
                                        tooltipPosition="bottom"
                                        style="width: 140px"
                                    />
                                </label>
                                <Checkbox v-model:checked="settings.pitch.randomInRange" label="Random in range" class="indent" />
                            </div>
                        </div>

                        <div class="mb-1">
                            <Checkbox v-model:checked="settings.zoom.updateZoom" label="Zoom :" class="strong" />
                            <div v-if="settings.zoom.updateZoom" class="indent">
                                <label class="form__row space-between">
                                    Zoom deviation :
                                    <Slider
                                        v-model="settings.zoom.range"
                                        :min="0"
                                        :max="4"
                                        :step="0.5"
                                        :lazy="false"
                                        tooltipPosition="bottom"
                                        style="width: 140px"
                                    />
                                </label>
                                <Checkbox v-model:checked="settings.zoom.randomInRange" label="Random in range" class="indent" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div v-if="state.started" class="container center">
                <h2 v-if="!state.finished" class="flex wrap flex-center justify-center">
                    Processing
                    <Spinner />
                </h2>
                <h2 v-else>Results</h2>
                <Button v-if="!state.finished && state.success > 0" @click="downloadFixedJSON" class="mb-1" text="Download Current Progress" />
                <p><Badge :text="state.step + '/' + customMap.nbLocs" /> {{ pluralize("location", customMap.nbLocs) }}</p>
                <p><Badge :number="state.success" /> success</p>
                <p><Badge changeClass :number="state.SVNotFound" /> streetview not found</p>
                <p><Badge changeClass :number="state.unofficial" /> unofficial</p>
                <p><Badge changeClass :number="state.noDescription" /> no description (potential trekker)</p>
                <p><Badge changeClass :number="state.wrongGeneration" /> wrong camera generation</p>
                <p><Badge changeClass :number="state.outOfDateRange" /> out of date criteria</p>
                <p v-if="settings.rejectNoLinks || settings.rejectNoLinksIfNoHeading">
                    <Badge changeClass :number="state.isolated" /> isolated{{ settings.rejectNoLinks ? "" : " and unpanned" }}
                </p>
                <p v-if="settings.removeNearby">
                    <Badge changeClass :number="state.tooClose" /> within the same ({{ settings.nearbyRadius }}m) radius
                </p>
            </div>

            <div v-if="state.finished" class="container center">
                <h2>Export</h2>
                <p class="success mb-1">
                    {{ resolvedLocs.length }} resolved {{ pluralize("location", resolvedLocs.length) }} ({{
                        ((resolvedLocs.length / customMap.nbLocs) * 100).toFixed(2)
                    }}%)
                </p>
                <p class="danger mb-1">
                    {{ allRejectedLocs.length }} rejected {{ pluralize("location", allRejectedLocs.length) }} ({{
                        ((allRejectedLocs.length / customMap.nbLocs) * 100).toFixed(2)
                    }}%)
                </p>
                <Button v-if="resolvedLocs.length" @click="downloadFixedJSON" text="Download Fixed JSON" />
            </div>
        </div>
    </div>
</template>

<script setup>
import { reactive, ref, computed } from "vue";
import { useStorage } from "@vueuse/core";
import SVreq from "@/utils/SVreq";
import { removeNearbyAsync } from "@/utils/spatialGrid";

import Slider from "@vueform/slider";
import Button from "@/components/Elements/Button.vue";
import Checkbox from "@/components/Elements/Checkbox.vue";
import Badge from "@/components/Elements/Badge.vue";
import Spinner from "@/components/Elements/Spinner.vue";

const dateToday = new Date().getFullYear() + "-" + ("0" + (new Date().getMonth() + 1)).slice(-2);

const settings = useStorage("mapcheckr_settings", {
    radius: 50,
    filterByGen: {
        1: false,
        23: true,
        4: true,
    },
    filterByDate: {
        from: "2008-01",
        to: dateToday,
    },
    rejectUnofficial: true,
    rejectNoDescription: false,
    rejectNoLinks: true,
    rejectNoLinksIfNoHeading: true,
    updateCoordinates: false,
    updatePanoIDs: false,
    removeNearby: false,
    nearbyRadius: 10,
    heading: {
        range: [0, 0],
        randomInRange: false,
        filterBy: {
            panned: false,
            unpanned: false,
            panoID: false,
            nonPanoID: false,
        },
        directionBy: {
            1: "forward",
            23: "forward",
            4: "forward",
            DEAD_END: "link",
        },
    },
    pitch: {
        updatePitch: false,
        range: [0, 0],
        randomInRange: false,
    },
    zoom: {
        updateZoom: false,
        range: [0, 0],
        randomInRange: false,
    },
});
settings.value.filterByDate.to = dateToday

const areHeadingSettingsGood = computed(
    () =>
        (settings.value.heading.filterBy.panoID || settings.value.heading.filterBy.nonPanoID) &&
        (settings.value.heading.filterBy.panned || settings.value.heading.filterBy.unpanned)
);

const initialState = {
    loaded: false,
    started: false,
    finished: false,
    step: 0,
    success: 0,
    SVNotFound: 0,
    unofficial: 0,
    noDescription: 0,
    wrongGeneration: 0,
    outOfDateRange: 0,
    isolated: 0,
    tooClose: 0,
};

const state = reactive({ ...initialState });

const customMap = ref({});

let mapToCheck = [];
let resolvedLocs = [];
let rejectedLocs = {
    SVNotFound: [],
    unofficial: [],
    noDescription: [],
    wrongGeneration: [],
    outOfDateRange: [],
    isolated: [],
};
let allRejectedLocs = [];

const resetState = () => {
    Object.assign(state, initialState);
    customMap.value = {};
    mapToCheck.length = 0;
    resolvedLocs.length = 0;
    rejectedLocs = {
        SVNotFound: [],
        unofficial: [],
        noDescription: [],
        wrongGeneration: [],
        outOfDateRange: [],
        isolated: [],
    };
    allRejectedLocs.length = 0;
};

const error = ref("");

// Process
const handleClickStart = () => {
    state.started = true;
    start();
};

const handleRadiusInput = (e) => {
    const value = parseInt(e.target.value);
    if (!value || value < 10) {
        settings.value.radius = 10;
    } else if (value > 1000) {
        settings.value.radius = 1000;
    }
};

const handleDate = (e, type) => {
    const value = parseInt(e.target.value);
    if (!isDateValid(value)) {
        if (type === "from") {
            settings.value.filterByDate.from = "2008-01";
        } else if (type === "to") {
            settings.value.filterByDate.to = dateToday;
        }
    }
};

const isDateValid = (dateStr) => !isNaN(new Date(dateStr));

const handleNearbyRadiusInput = (e) => {
    const value = parseInt(e.target.value);
    if (!value || value < 1) {
        settings.value.nearbyRadius = 1;
    } else if (value > 10000000) {
        settings.value.nearbyRadius = 10000000;
    }
};

// Iterative chunk to avoid stack overflow on large arrays
function chunkArray(arr, n) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += n) {
        chunks.push(arr.slice(i, i + n));
    }
    return chunks;
}

const start = async () => {
    const chunkSize = 1000;
    for (let locationGroup of chunkArray(mapToCheck, chunkSize)) {
        const responses = await Promise.allSettled(locationGroup.map((l) => SVreq(l, settings.value)));
        for (let response of responses) {
            if (response.status === "fulfilled") {
                resolvedLocs.push(response.value);
                state.success++;
            } else {
                switch (response.reason.reason) {
                    case "SV_NOT_FOUND":
                        rejectedLocs.SVNotFound.push(response.reason);
                        state.SVNotFound++;
                        break;
                    case "UNOFFICIAL":
                        rejectedLocs.unofficial.push(response.reason);
                        state.unofficial++;
                        break;
                    case "NO_DESCRIPTION":
                        rejectedLocs.noDescription.push(response.reason);
                        state.noDescription++;
                        break;
                    case "WRONG_GENERATION":
                        rejectedLocs.wrongGeneration.push(response.reason);
                        state.wrongGeneration++;
                        break;
                    case "ISOLATED":
                        rejectedLocs.isolated.push(response.reason);
                        state.isolated++;
                        break;
                    case "OUT_OF_DATE_RANGE":
                        rejectedLocs.outOfDateRange.push(response.reason);
                        state.outOfDateRange++;
                        break;
                }
            }
            state.step++;
        }
    }
    if (settings.value.removeNearby) {
        // Use async spatial grid algorithm - O(N) instead of O(N²)
        // This prevents main thread freeze on large datasets
        const newArr = await removeNearbyAsync(
            resolvedLocs,
            settings.value.nearbyRadius,
            (current, total) => {
                // Optional: could add a progress indicator here
            }
        );
        state.tooClose = resolvedLocs.length - newArr.length;
        resolvedLocs = newArr;
    }

    // Use concat instead of spread to reduce memory pressure
    allRejectedLocs = [].concat(
        rejectedLocs.SVNotFound,
        rejectedLocs.unofficial,
        rejectedLocs.noDescription,
        rejectedLocs.wrongGeneration,
        rejectedLocs.outOfDateRange,
        rejectedLocs.isolated
    );

    state.finished = true;
};

// Import
document.addEventListener("paste", (evt) => {
    const data = evt.clipboardData.getData("text/plain");
    checkJSON(data);
});

const loadFromJSON = (e) => {
    const files = e.target.files || e.dataTransfer.files;
    if (!files.length) return;
    readFile(files[0]);
};

const readFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
        checkJSON(e.target.result);
    };
    reader.readAsText(file);
};

const hasLatLng = (objectArray) =>
    objectArray.every((obj) => obj.hasOwnProperty("lat")) && objectArray.every((obj) => obj.hasOwnProperty("lng"));

const checkJSON = (data) => {
    try {
        let mapData = JSON.parse(data);
        if (mapData.hasOwnProperty("customCoordinates")) {
            mapData = [...mapData.customCoordinates];
        }
        if (!hasLatLng(mapData)) {
            error.value = "Invalid map data";
            state.loaded = false;
            return;
        }

        error.value = "";
        customMap.value = { nbLocs: mapData.length };
        mapToCheck = mapData;
        state.loaded = true;
    } catch (err) {
        state.loaded = false;
        error.value = "Invalid map data";
    }
};

const pluralize = (text, count) => (count > 1 ? text + "s" : text);

const downloadFixedJSON = async () => {
    // For large arrays, serialize in chunks to avoid blocking main thread
    const chunks = [];
    const chunkSize = 10000;

    chunks.push('[');
    for (let i = 0; i < resolvedLocs.length; i += chunkSize) {
        const slice = resolvedLocs.slice(i, i + chunkSize);
        const serialized = slice.map(loc => JSON.stringify(loc)).join(',');
        if (i > 0) chunks.push(',');
        chunks.push(serialized);
        // Yield to browser between chunks
        if (i + chunkSize < resolvedLocs.length) {
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
    }
    chunks.push(']');

    const blob = new Blob(chunks, { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${resolvedLocs.length} resolved locations.json`;
    link.click();
    URL.revokeObjectURL(url);
};
</script>

<style>
@import "@/assets/main.css";
@import "@vueform/slider/themes/default.css";

.wrapper {
    margin: 0 auto;
    max-width: 940px;
}

.wrapper__inner {
    border-radius: 0.25rem;
    box-shadow: 0 20px 40px -14px #00000066;
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0.5rem 0 0.5rem;
    background-color: #303030;
    margin-bottom: 0.5rem;
}

.container {
    background: #3a3a3a;
    padding: 0.5em 1em;
    margin-bottom: 0.5em;
}
.content {
    padding: 0.5rem 1.5rem;
}

.input-file {
    display: none;
}
select,
input[type="range"] {
    width: 140px;
}
.slider-tooltip {
    background-color: var(--success);
    color: #000;
    font-size: 0.8rem;
    padding: 0 5px;
}
</style>
