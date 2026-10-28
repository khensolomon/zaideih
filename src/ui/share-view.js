/**
 * Sharing private music with other members (docs/library.md, "Sharing";
 * core/uploads.js, worker/media/shares.js).
 *
 *   #/share/<album id>   who has one album of the person's own, and sharing it
 *   #/share/all          the same for all of their music (songs added later too)
 *   #/join/<code>        an invite link, opened by the member it was sent to
 *
 * Anyone shares by an invite link: made here, shown once, used once, gone
 * after two weeks unused. The owner and co-owners may also find a member by
 * name and share at once. Each share can be "Listen only" (no download in
 * the app) and is taken back at once.
 */
import { html } from "../core/html.js";
import { href } from "../core/router.js";
import { account } from "../core/signin.js";
import { uploads } from "../core/uploads.js";
import { icon } from "./icons.js";
import { scriptClass } from "./parts.js";

/** Kept until a member opens an invite after signing in. */
const PENDING_KEY = "zaideih.invite";
const INVITE_DAYS = 14;

/** The invite just made on this page: shown until the page is left. */
let fresh = null; // { key, url }
// The invite link is shown once, while its page is open: leaving the page lets it go.
addEventListener("hashchange", () => { if (fresh && !location.hash.startsWith(`#/share/${fresh.key}`)) fresh = null; });
let found = { q: "", members: [], busy: false };

/** The address an invite opens: the web app, also from the desktop app. */
export function inviteUrl(code) {
	const web = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}` : "https://zaideih.com/";
	return `${web}#/join/${code}`;
}

const ago = (s) => {
	const d = Math.floor((Date.now() / 1000 - s) / 86400);
	return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

function shareRow(x) {
	const left = Math.max(0, INVITE_DAYS - Math.floor((Date.now() / 1000 - x.created) / 86400));
	const who = x.member
		? html`<b>${x.member.name ?? `Member ${x.member.id}`}</b><small>since ${ago(x.accepted ?? x.created)}</small>`
		: html`<b>Invite link, not used yet</b><small>made ${ago(x.created)} · works for ${left} more day${left === 1 ? "" : "s"}</small>`;
	return html`<li class="sh-row">
		<span class="sh-who">${who}</span>
		<label class="switch sh-only"><input type="checkbox" role="switch" data-sh="listen-only" data-id="${x.id}" ${x.listenOnly ? "checked" : ""}><span class="switch-track" aria-hidden="true"></span>Listen only</label>
		<button class="btn" data-sh="take-back" data-id="${x.id}">${x.member ? "Take back" : "Cancel the invite"}</button>
	</li>`;
}

/** #/share/<album id> or #/share/all. */
export function sharePage(c, { id }) {
	if (!uploads.available) return { title: "Share", body: html`<div class="empty"><h2>Sign in to share your music</h2><p><a class="btn primary" href="#/account">Sign in</a></p></div>` };
	if (!uploads.state.member && !uploads.state.error) return { title: "Share", body: html`<p class="muted st-pad" aria-busy="true">Reading your music…</p>` };
	const all = id === "all";
	const album = all ? null : c.album(id);
	if (!all && (!album?.upload || album.shared)) return { title: "Share", body: html`<div class="empty"><h2>This is not an album of your own music</h2><p><a class="btn" href="#/library/uploads">Your music</a></p></div>` };
	const name = all ? null : album.named ? album.title : "";
	const shares = uploads.sharesFor(name);
	const viaAll = all ? [] : uploads.sharesFor(null).filter((x) => x.member);
	const key = all ? "all" : id;
	if (fresh && fresh.key !== key) fresh = null;
	const title = all ? "Share all your music" : html`Share “<span class="${scriptClass(album.title)}">${album.title}</span>”`;
	const body = html`<div class="sh-root" data-key="${key}" data-album="${all ? "" : name}" data-all="${all}">
		<a class="nav-back-inline" href="${all ? "#/library/uploads" : href(`album/${id}`)}">${icon("back")} ${all ? "Your music" : album.title}</a>
		<h1 class="page-title">${title}</h1>
		<p class="muted sh-lead">${all ? "Everything in your library, and what you add later." : `${album.tracks.length} song${album.tracks.length === 1 ? "" : "s"}.`} Members you share with listen in their Library and in search, on any device they sign in on. They cannot change it, share it on, or ask to publish it. You can take it back at any time; it stops at once.</p>

		<section class="panel sh-section">
			<h2>Who has it</h2>
			${shares.length ? html`<ul class="sh-list">${shares.map(shareRow)}</ul>` : html`<p class="muted">Nobody yet.</p>`}
			${viaAll.length ? html`<p class="muted">Also through <a class="text-link" href="#/share/all">all your music</a>: ${viaAll.map((x) => x.member.name).join(", ")}.</p>` : ""}
		</section>

		<section class="panel sh-section">
			<h2>Invite someone</h2>
			<p class="muted">The link works once, for the first member who opens it signed in, for ${INVITE_DAYS} days. Send it only to the person you mean: it is shown only now.</p>
			<label class="check sh-check"><input type="checkbox" data-sh="new-only"> Listen only: no download for offline listening</label>
			<p><button class="btn primary" data-sh="invite">${icon("share")} Make an invite link</button></p>
			${fresh ? html`<div class="sh-link" role="status">
				<input readonly value="${fresh.url}" aria-label="The invite link" data-sh="link">
				<button class="btn" data-sh="copy">Copy</button>
				${navigator.share ? html`<button class="btn" data-sh="send">Send…</button>` : ""}
			</div>` : ""}
		</section>

		${uploads.canNameMembers ? html`<section class="panel sh-section">
			<h2>Share with a member</h2>
			<p class="muted">For the owner and co-owners: find a member by name and share at once, without a link.</p>
			<label class="sb-field"><span>Name</span><input data-sh="find" value="${found.q}" placeholder="At least two letters" autocomplete="off"></label>
			<ul class="sh-found">${found.members.map((m) => html`<li><span>${m.name}</span><button class="btn" data-sh="name" data-member="${m.id}" data-name="${m.name}">Share with ${m.name}</button></li>`)}</ul>
			${found.q.length >= 2 && !found.members.length && !found.busy ? html`<p class="muted">No member by that name.</p>` : ""}
		</section>` : ""}
	</div>`;
	return { title: all ? "Share all your music" : `Share ${album.title}`, body, mount: (view) => mountShare(view.querySelector(".sh-root")) };
}

let ctxShare = null;
/** The app's notices and redraw, given once by app.js. */
export function shareContext(ctx) { ctxShare = ctx; }

function mountShare(root) {
	if (!root) return;
	const albumName = root.dataset.all === "true" ? null : root.dataset.album;
	const key = root.dataset.key;
	const fail = (err) => ctxShare.notify(err.message, { kind: "error" });
	let timer = 0;
	root.addEventListener("input", (e) => {
		if (e.target.dataset.sh !== "find") return;
		const q = e.target.value.trim();
		found.q = e.target.value;
		clearTimeout(timer);
		timer = setTimeout(async () => {
			if (q.length < 2) { found.members = []; ctxShare.redraw({ keepFocus: "[data-sh=find]" }); return; }
			found.busy = true;
			try { found.members = await uploads.findMembers(q); } catch (err) { fail(err); } finally { found.busy = false; }
			ctxShare.redraw({ keepFocus: "[data-sh=find]" });
		}, 250);
	});
	root.addEventListener("change", async (e) => {
		if (e.target.dataset.sh !== "listen-only") return;
		try { await uploads.setListenOnly(Number(e.target.dataset.id), e.target.checked); } catch (err) { fail(err); }
		ctxShare.redraw();
	});
	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-sh]");
		if (!b || b.tagName === "INPUT") return;
		const what = b.dataset.sh;
		try {
			if (what === "invite") {
				b.disabled = true;
				const { code } = await uploads.share(albumName, { listenOnly: root.querySelector("[data-sh=new-only]").checked });
				fresh = { key, url: inviteUrl(code) };
				ctxShare.redraw();
			} else if (what === "copy") {
				try {
					await navigator.clipboard.writeText(fresh.url);
					ctxShare.notify("Invite link copied");
				} catch {
					root.querySelector("[data-sh=link]").select();
					ctxShare.notify("Selected: copy it");
				}
			} else if (what === "send") {
				await navigator.share({ title: "Music shared with you on Zaideih", url: fresh.url }).catch((err) => { if (err.name !== "AbortError") throw err; });
			} else if (what === "take-back") {
				await uploads.unshare(Number(b.dataset.id));
				ctxShare.notify("Taken back");
				ctxShare.redraw();
			} else if (what === "name") {
				await uploads.share(albumName, { member: Number(b.dataset.member), listenOnly: root.querySelector("[data-sh=new-only]").checked });
				found = { q: "", members: [], busy: false };
				ctxShare.notify(`Shared with ${b.dataset.name}`);
				ctxShare.redraw();
			}
		} catch (err) {
			b.disabled = false;
			fail(err);
		}
	});
}

/* --------------------------------------------------------------- join ---- */

let joining = null; // { code, preview, error }

/** An invite to keep while the person signs in first. */
export function pendingInvite() {
	try { return localStorage.getItem(PENDING_KEY); } catch { return null; }
}
const keepInvite = (code) => { try { if (code) localStorage.setItem(PENDING_KEY, code); else localStorage.removeItem(PENDING_KEY); } catch { /* this visit only */ } };

/** #/join/<code>. */
export function joinPage(c, { code }) {
	if (!account().signedIn) {
		keepInvite(code);
		return { title: "Music shared with you", body: html`<div class="empty sh-join">
			<h2>Music shared with you</h2>
			<p>Someone shared music on Zaideih with you. Sign in with Google or GitHub to open it: it is shared with the member who opens this link first.</p>
			<p><a class="btn primary" href="#/account">Sign in</a></p>
			<p class="muted">After signing in, this invite opens again by itself.</p>
		</div>` };
	}
	keepInvite(null);
	if (joining?.code !== code) {
		joining = { code, preview: null, error: "" };
		uploads.invite(code).then((p) => { joining.preview = p; }, (err) => { joining.error = err.message; }).finally(() => { if (joining?.code === code) ctxShare.redraw(); });
	}
	const p = joining.preview;
	let body;
	if (joining.error) body = html`<h2>This invite cannot be opened</h2><p>${joining.error}</p><p><button class="btn primary" data-sh="again">Try again</button> <a class="btn" href="#/library/uploads">Your music</a></p>`;
	else if (!p) body = html`<p class="muted" aria-busy="true">Reading the invite…</p>`;
	else if (p.yours) body = html`<h2>This is your own invite</h2><p>Send the link to the person you are sharing with: it works for the first member who opens it signed in.</p><p><a class="btn" href="#/library/uploads">Your music</a></p>`;
	else {
		const what = p.album === null ? html`all of ${p.owner.name}'s music` : html`“<span class="${scriptClass(p.album || "Singles")}">${p.album || "Singles"}</span>”`;
		body = html`<h2>${p.owner.name} shares ${what} with you</h2>
			<p>${p.songs} song${p.songs === 1 ? "" : "s"}${p.album === null ? ", and what they add later" : ""}. It joins your Library, under Shared with you, and search${p.listenOnly ? "; to listen online only" : ""}. ${p.owner.name} can take it back at any time.</p>
			<p class="sh-join-do"><button class="btn primary" data-sh="accept">Add it to my library</button><a class="btn" href="#/">Not now</a></p>`;
	}
	return {
		title: "Music shared with you",
		body: html`<div class="empty sh-join">${body}</div>`,
		mount: (view) => {
			// A failure (offline, say) is not kept: Try again asks once more.
			view.querySelector("[data-sh=again]")?.addEventListener("click", () => { joining = null; ctxShare.redraw(); });
			view.querySelector("[data-sh=accept]")?.addEventListener("click", async (e) => {
			e.currentTarget.disabled = true;
			try {
				const r = await uploads.acceptInvite(code);
				joining = null;
				ctxShare.notify(r.already ? "It was shared with you already" : "Added to your library");
				location.hash = "#/library/uploads";
			} catch (err) {
				e.currentTarget.disabled = false;
				ctxShare.notify(err.message, { kind: "error" });
			}
			});
		},
	};
}

/* ------------------------------------------------------------ library ---- */

/** Library, Uploads: what others share with the person, by who shared it; and what they share. */
export function sharedSections(tile) {
	const st = uploads.state;
	const byOwner = new Map();
	for (const a of st.shared) {
		const k = a.shared.owner.id;
		if (!byOwner.has(k)) byOwner.set(k, { owner: a.shared.owner, albums: [] });
		byOwner.get(k).albums.push(a);
	}
	const mine = st.shares;
	const named = (x) => (x.album === null ? "All your music" : x.album || "Singles");
	const summary = new Map();
	for (const x of mine) {
		const k = x.album === null ? "\u0000all" : x.album;
		if (!summary.has(k)) summary.set(k, { title: named(x), album: x.album, members: [], invites: 0 });
		const s = summary.get(k);
		if (x.member) s.members.push(x.member.name); else s.invites++;
	}
	const target = (album) => (album === null ? "#/share/all" : (() => {
		const a = st.albums.find((al) => (al.named ? al.title : "") === album);
		return a ? href(`share/${a.id}`) : "#/share/all";
	})());
	return html`${byOwner.size ? html`<section class="section sh-shared"><header><h2>Shared with you</h2></header>
			${[...byOwner.values()].map((g) => html`<h3 class="sh-from">From ${g.owner.name}</h3><div class="albums grid">${g.albums.map((a) => tile(a))}</div>`)}
		</section>` : ""}
		${summary.size ? html`<section class="section sh-mine"><header><h2>You share</h2></header>
			<ul class="sh-list">${[...summary.values()].map((s) => html`<li class="sh-row"><span class="sh-who"><b class="${scriptClass(s.title)}">${s.title}</b><small>${[s.members.length ? `with ${s.members.join(", ")}` : "", s.invites ? `${s.invites} invite${s.invites === 1 ? "" : "s"} not used yet` : ""].filter(Boolean).join(" · ")}</small></span><a class="btn" href="${target(s.album)}">Manage</a></li>`)}</ul>
		</section>` : ""}`;
}
