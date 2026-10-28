import assert from "node:assert/strict";
import { test } from "node:test";

// The router reads location.hash by default; a stand-in for Node.
globalThis.location ??= { hash: "" };
const { href, parse, route } = await import("../src/core/router.js");
const { escape, html, raw } = await import("../src/core/html.js");

test("router: patterns match whole paths, decode their parts and carry the query; a cut-off link is not found", () => {
	const album = () => "album";
	const song = () => "song";
	route("album/:id", album);
	route("lyrics/:id/studio", song);
	route("", () => "home");
	const a = parse("#/album/zola%2Fagape?song=7&x=1");
	assert.equal(a.handler, album);
	assert.deepEqual(a.params, { id: "zola/agape" });
	assert.equal(a.query.get("song"), "7");
	assert.deepEqual([a.path, a.pattern], ["album/zola%2Fagape", "album/:id"]);
	assert.equal(parse("#/lyrics/12/studio").handler, song);
	assert.equal(parse("#/lyrics/12/studio/more"), null, "a longer path is another address");
	assert.equal(parse("#/album/"), null, "an empty part does not match");
	assert.equal(parse("#/").handler(), "home");
	assert.equal(parse("").handler(), "home");
	assert.equal(parse("#/album/ab%2"), null, "a cut-off percent escape is no address, not an error");
	assert.equal(href("album/x", { song: 7 }), "#/album/x?song=7");
	assert.equal(href("top"), "#/top");
});

test("html: values are escaped, nested html and arrays are not, and nothing renders for null, undefined or false", () => {
	assert.equal(escape(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
	const inner = html`<b>${"<i>"}</b>`;
	assert.equal(String(html`<p>${inner}${[inner, "&"]}${null}${undefined}${false}${0}</p>`), "<p><b>&lt;i&gt;</b><b>&lt;i&gt;</b>&amp;0</p>");
	assert.equal(String(html`${raw("<svg/>")}`), "<svg/>");
	assert.equal(String(html`${{ toString: () => "<x>" }}`), "&lt;x&gt;", "objects are rendered by their text, escaped");
});
