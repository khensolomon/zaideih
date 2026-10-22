/**
 * Admin drafts: catalog edits kept as a list of changes, not as edited files,
 * so a draft can be put onto the newest data from GitHub at publish time and
 * a change made on GitHub meanwhile is not overwritten.
 *
 * A change is { kind, id, field, value }:
 *   album   id = album ui;  fields ab (title), yr (year or null), lg (language id), gr (genre ids)
 *   track   id = track i;   fields t (title), a (artist ids), h (hidden)
 *   artist  id = artist id; fields name, aka, type, thesaurus (spelling variants)
 * Pure functions: tested in Node (tests/admin.test.mjs).
 */

export class DraftError extends Error {}

export const FIELDS = Object.freeze({
	album: ["ab", "yr", "lg", "gr"],
	track: ["t", "a", "h"],
	artist: ["name", "aka", "type", "thesaurus"],
});
const LABELS = { ab: "title", yr: "year", lg: "language", gr: "genres", t: "title", a: "artists", h: "hidden", name: "name", aka: "also known as", type: "type", thesaurus: "spellings" };

const text = (v) => String(v ?? "").normalize("NFC").trim();
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

/** Indexes of the source data, for finding what a change refers to. */
export function indexData({ albums, artists }) {
	const album = new Map();
	const track = new Map();
	for (const al of albums) {
		album.set(al.ui, al);
		for (const t of al.tk) track.set(t.i, { album: al, track: t });
	}
	const artist = new Map(artists.map((a) => [a.id, a]));
	return { album, track, artist };
}

/** The current value of a field in the source data. */
export function currentValue(index, { kind, id, field }) {
	if (kind === "album") {
		const al = index.album.get(id);
		if (!al) return undefined;
		return field === "yr" ? (al.yr?.[0] ?? null) : al[field];
	}
	if (kind === "track") {
		const t = index.track.get(id)?.track;
		if (!t) return undefined;
		return field === "h" ? t.h === true : t[field];
	}
	const a = index.artist.get(id);
	if (!a) return undefined;
	return field === "aka" ? (a.aka ?? "") : field === "thesaurus" ? (a.thesaurus ?? []) : a[field];
}

/** Checks a value for a field and returns it in canonical form; throws DraftError with the reason. */
export function cleanValue({ kind, field }, value, category = {}) {
	if (!FIELDS[kind]?.includes(field)) throw new DraftError(`unknown field ${kind}.${field}`);
	switch (field) {
		case "ab": case "t": case "name": {
			const v = text(value);
			if (!v) throw new DraftError(`the ${LABELS[field]} cannot be empty`);
			return v;
		}
		case "aka": return text(value);
		case "yr": {
			if (value === null || value === "") return null;
			const y = Number(value);
			if (!Number.isInteger(y) || y < 1900 || y > 2100) throw new DraftError("the year must be between 1900 and 2100, or empty");
			return y;
		}
		case "lg": {
			const id = Number(value);
			if (category.lang && !category.lang.some((l) => l.id === id)) throw new DraftError(`unknown language ${value}`);
			return id;
		}
		case "gr": {
			const ids = [...new Set((value ?? []).map(Number))];
			if (category.genre) for (const g of ids) if (!category.genre.some((x) => x.id === g)) throw new DraftError(`unknown genre ${g}`);
			return ids;
		}
		case "a": {
			const ids = [...new Set((value ?? []).map(Number))];
			if (ids.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new DraftError("artists must be artist ids");
			return ids;
		}
		case "h": return value === true;
		case "type": {
			const t = Number(value);
			if (category.artist && !category.artist.some((x) => x.id === t)) throw new DraftError(`unknown artist type ${value}`);
			return t;
		}
		case "thesaurus": return [...new Set((Array.isArray(value) ? value : String(value ?? "").split(",")).map(text).filter(Boolean))];
		default: throw new DraftError(`unknown field ${field}`);
	}
}

/**
 * Adds or replaces the change for one field. A value equal to the source
 * removes the change (the field is back as it was).
 */
export function setChange(changes, index, change) {
	const rest = changes.filter((c) => !(c.kind === change.kind && c.id === change.id && c.field === change.field));
	const before = currentValue(index, change);
	if (before === undefined) throw new DraftError(`${change.kind} ${change.id} does not exist`);
	return same(before, change.value) ? rest : [...rest, change];
}

/**
 * Applies the changes to (copies of) the source data. Returns the new data
 * and the changes that could not be applied (their record is gone), each
 * with the reason.
 */
export function applyChanges(data, changes) {
	const albums = structuredClone(data.albums);
	const artists = structuredClone(data.artists);
	const index = indexData({ albums, artists });
	const missing = [];
	for (const c of changes) {
		if (c.kind === "album") {
			const al = index.album.get(c.id);
			if (!al) { missing.push({ change: c, reason: `album ${c.id} is no longer in albums.json` }); continue; }
			if (c.field === "yr") al.yr = c.value === null ? [] : [c.value];
			else al[c.field] = c.value;
		} else if (c.kind === "track") {
			const hit = index.track.get(c.id);
			if (!hit) { missing.push({ change: c, reason: `track ${c.id} is no longer in albums.json` }); continue; }
			if (c.field === "h") {
				if (c.value) hit.track.h = true;
				else delete hit.track.h;
			} else hit.track[c.field] = c.value;
		} else if (c.kind === "artist") {
			const a = index.artist.get(c.id);
			if (!a) { missing.push({ change: c, reason: `artist ${c.id} is no longer in artist.name.json` }); continue; }
			a[c.field] = c.value;
		}
	}
	return { albums, artists, missing };
}

/** One line describing a change, for the draft list, the pull request and the changelog. */
export function describe(change, index, names = {}) {
	const { kind, id, field, value } = change;
	const label = LABELS[field];
	const show = (v) => {
		if (field === "a") return (v ?? []).map((a) => names.artist?.(a) ?? `#${a}`).join(", ") || "none";
		if (field === "lg") return names.lang?.(v) ?? String(v);
		if (field === "gr") return (v ?? []).map((g) => names.genre?.(g) ?? `#${g}`).join(", ") || "none";
		if (field === "type") return names.type?.(v) ?? String(v);
		if (field === "thesaurus") return (v ?? []).join(", ") || "none";
		if (field === "yr") return v ?? "no year";
		return `"${v}"`;
	};
	if (kind === "track" && field === "h") {
		const t = index.track.get(id);
		return `${value ? "Hide" : "Show again"} the song "${t?.track.t ?? id}"${t ? ` (${t.album.ab})` : ""}`;
	}
	const what = kind === "album" ? `album "${index.album.get(id)?.ab ?? id}"` : kind === "track" ? `song "${index.track.get(id)?.track.t ?? id}"` : `artist "${index.artist.get(id)?.name ?? id}"`;
	return `${what}: ${label} ${show(currentValue(index, change))} → ${show(value)}`;
}

/**
 * The source file text as the repository keeps it: 2-space JSON, ending with
 * a newline only when the original did, so a change touches only its lines.
 */
export const sourceText = (value, original = "") => `${JSON.stringify(value, null, 2)}${original.endsWith("\n") ? "\n" : ""}`;
