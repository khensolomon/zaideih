/**
 * Where a catalog song's file is in R2, from its album's folder in
 * media.json (docs/library.md, "Publishing in place"). Shared by the audio
 * Worker, the tools and the Workspace, so all of them agree.
 *
 *   "zola/Agape"            the catalog's own place: music/zola/Agape/<file>
 *   "/Archive/Zola 2000"    in place, where the files already were in
 *                           storage when the album was published:
 *                           Archive/Zola 2000/<file>
 *
 * A folder in place starts with "/" (from the bucket's top). It is never
 * under the catalog's own root (written without the "/" instead), members'
 * uploads (users/, deleted once published) or the audio studio's versions
 * (edits/).
 */
export const CATALOG_ROOT = "music";
const NOT_IN_PLACE = ["music/", "users/", "edits/"];

/** True for a folder published in place ("/…"). */
export const inPlace = (folder) => typeof folder === "string" && folder.startsWith("/");

/** The R2 key of a file in an album's folder. */
export function trackKey(folder, file) {
	return inPlace(folder) ? `${folder.slice(1)}/${file}` : `${CATALOG_ROOT}/${folder}/${file}`;
}

/** The folder written in media.json for files left where they are in storage: "Archive/Zola 2000" → "/Archive/Zola 2000". */
export const inPlaceFolder = (dir) => `/${dir.replace(/^\/+|\/+$/g, "")}`;

/**
 * Why a media.json folder cannot be used, or null when it can: a path of
 * plain segments (no empty, ".", ".." or backslash), and in place never
 * where NOT_IN_PLACE says.
 */
export function folderProblem(folder) {
	const rest = inPlace(folder) ? folder.slice(1) : folder;
	if (typeof folder !== "string" || !rest || rest.includes("\\") || rest.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return `folder path is empty or unsafe: ${JSON.stringify(folder)}`;
	if (inPlace(folder) && NOT_IN_PLACE.some((p) => `${rest}/`.startsWith(p))) {
		return `${folder}: a folder in place cannot be under ${NOT_IN_PLACE.join(", ")}${rest.startsWith("music/") ? ` (write it as "${rest.slice(6)}", without the "/")` : ""}`;
	}
	return null;
}
