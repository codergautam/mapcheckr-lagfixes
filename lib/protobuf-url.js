// Port of streetlevel's protobuf URL serializer.
// Encodes a JS object as Google Maps's `!`-delimited protobuf-over-URL format.
//
// Numbers default to DOUBLE encoding (`d`) since the Maps endpoint rejects
// integer-encoded radii/coordinates. Use `I(n)` to force integer encoding for
// fields that genuinely want an int (e.g. icon size).

export class PEnum { constructor(value) { this.value = value; } }
export class PInt { constructor(value) { this.value = value; } }

export const E = (v) => new PEnum(v);
export const I = (v) => new PInt(v);

export function toProtobufUrl(fields) {
    return _serialize(fields)[1];
}

function _serialize(fields) {
    let serialized = "";
    let childCount = 0;
    for (const [tag, value] of Object.entries(fields)) {
        const [c, s] = _fieldToString(Number(tag), value);
        serialized += s;
        childCount += c;
    }
    return [childCount, serialized];
}

function _fieldToString(tag, value) {
    if (Array.isArray(value)) {
        let serialized = "";
        let childCount = 0;
        for (const entry of value) {
            const [c, s] = _fieldToString(tag, entry);
            serialized += s;
            childCount += c;
        }
        return [childCount, serialized];
    }
    if (value instanceof PEnum) return [1, `!${tag}e${value.value}`];
    if (value instanceof PInt)  return [1, `!${tag}i${value.value}`];
    if (typeof value === "boolean") return [1, `!${tag}b${value ? 1 : 0}`];
    if (typeof value === "string")  return [1, `!${tag}s${value}`];
    if (typeof value === "number")  return [1, `!${tag}d${value}`];
    if (value && typeof value === "object") {
        const [subCount, subSer] = _serialize(value);
        return [subCount + 1, `!${tag}m${subCount}${subSer}`];
    }
    throw new Error(`Cannot encode value of type ${typeof value}: ${value}`);
}
