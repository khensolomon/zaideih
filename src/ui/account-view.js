/**
 * Your account (#/account, docs/accounts.md): signing in, the ways the
 * person signs in, adding or removing one, and signing out of this device.
 *
 * Google is offered first: most listeners have a Google account and have
 * never heard of GitHub, which is for catalog editors. Both sign-ins come
 * back here (#/account?google=… or ?signin=…), where they are finished and
 * the code is taken out of the address at once.
 *
 * In an app added to the home screen the sign-in cannot come back: it opens
 * in a browser sheet over the app. There the buttons are links prepared in
 * advance (so the sheet opens straight from the tap), the sign-in leaves its
 * code at the Worker, and this page takes it (core/account.js waitForSignIn).
 */
import { AUTH_URL } from "../config.js";
import { html } from "../core/html.js";
import { saveWho, TOKEN_KEY } from "../core/access.js";
import { account, githubSession } from "../core/signin.js";
import { GOOGLE_PENDING_KEY, homeScreenApp, waitForSignIn } from "../core/account.js";
import { PENDING_KEY } from "../admin/session.js";
import { makePasskey, passkeysAvailable, usePasskey } from "../core/passkey.js";
import { createGitHub } from "../admin/github.js";
import { icon } from "./icons.js";

const GITHUB_LINK_KEY = "zaideih.account.github-link";
const PROVIDERS = { google: "Google", github: "GitHub", passkey: "Passkey" };

// Browsers inside other apps (Facebook, Messenger, Instagram, LINE, WeChat, Android web views): Google refuses to sign in there.
export const inAppBrowser = (ua) => /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|; wv\)/.test(ua);

// State that survives re-renders of the page.
let st = { me: null, busy: "", error: "", links: null, waiting: null, cancel: null, passkey: null };

/**
 * The Worker's options for the passkey button on the page ("create" signed
 * in, "get" signed out), fetched before the tap: Safari lets a page ask for
 * a passkey only in direct answer to a tap. Fetched again after each use.
 */
async function preparePasskey() {
	st.passkey = null;
	if (!passkeysAvailable() || !AUTH_URL) return;
	const kind = account().signedIn ? "create" : "get";
	st.passkey = { kind, options: await account().passkeyOptions(kind) };
}

/**
 * A sign-in button: in an app on the home screen, a link prepared in advance
 * that opens the sign-in in a browser sheet; otherwise a button.
 */
function startButton(provider, { label, cls = "btn", link = false }) {
	const prepared = st.links?.[provider];
	const inner = html`${provider === "github" ? icon("github") : ""}${label}`;
	if (homeScreenApp()) {
		return prepared
			? html`<a class="${cls}" href="${prepared.href}" target="_blank" rel="noopener" data-acct-open="${provider}">${inner}</a>`
			: html`<button class="${cls}" disabled>${inner}</button>`;
	}
	return html`<button class="${cls}" data-acct="${provider}" data-link="${link ? "1" : ""}" ${st.busy ? "disabled" : ""}>${inner}</button>`;
}

/** While the sign-in is open in its sheet. */
function waitingPanel() {
	return html`<div class="acct-waiting" role="status">
		<p><b>Finish signing in with ${PROVIDERS[st.waiting]} in the window that opened,</b> then come back here; this page carries on by itself.</p>
		<p><button class="btn" data-acct="cancel">Cancel</button></p>
	</div>`;
}

/** The sign-in links for an app on the home screen, each with its own verifier and nonce kept for this page. */
async function prepareLinks() {
	if (!homeScreenApp() || !AUTH_URL) { st.links = null; return; }
	const here = `${location.origin}${location.pathname}`;
	const link = account().signedIn;
	st.links = {
		google: { href: await account().google.start(here, { link, wait: true }), link },
		github: { href: await githubSession().start(here, { to: "account", wait: true }), link },
	};
}

const nonceOf = (provider) => {
	try { return JSON.parse(sessionStorage.getItem(provider === "google" ? GOOGLE_PENDING_KEY : PENDING_KEY) ?? "null")?.nonce ?? null; } catch { return null; }
};

/**
 * @param {{ onChange: () => void, notify: (text: string, o?: object) => void, desktop: boolean, redrawn?: () => void }} ctx
 *   onChange: someone signed in or out; redrawn: the page drew itself again (its heading is a new element)
 */
export function accountView(ctx) {
	st.cancel?.();
	st = { me: null, busy: "", error: "", links: null, waiting: null, cancel: null };
	// Drawn whole with the page, as every other page is, so its height does not jump while the account and links arrive.
	return {
		title: account().signedIn ? "Your account" : "Sign in",
		body: html`<div class="acct-root">${content(ctx)}</div>`,
		mount: (view) => mount(view.querySelector(".acct-root"), ctx),
	};
}

function signInCard(ctx) {
	const caught = inAppBrowser(navigator.userAgent);
	return html`<section class="acct-card">
		<h1 class="page-title">Sign in</h1>
		<p class="acct-lead">Keep music of your own, and later your liked songs and playlists on every device.</p>
		${caught ? html`<p class="acct-warn" role="note">This page is open inside another app. Google does not allow signing in here: open <b>${location.host}</b> in Chrome or Safari first.</p>` : ""}
		${st.waiting ? waitingPanel() : html`<div class="acct-buttons">
			${startButton("google", { label: "Continue with Google", cls: "btn primary acct-google" })}
			${startButton("github", { label: " Continue with GitHub", cls: "btn acct-github" })}
			${passkeysAvailable() ? html`<button class="btn acct-passkey" data-acct="passkey-signin" ${st.passkey?.kind === "get" ? "" : "disabled"}>${icon("key")} Sign in with a passkey</button>` : ""}
		</div>`}
		<p class="acct-small">GitHub is for catalog editors and people who already use it. Signing in with both, with the same email, is one account.</p>
		<p class="acct-small">Zaideih keeps your name, the email Google or GitHub confirms, and their id for you, only to know it is you. <a class="text-link" href="#/about">About</a></p>
	</section>`;
}

function accountCard() {
	const me = st.me;
	if (!me) {
		// The shape of the card to come, so nothing moves when it arrives.
		return html`<section class="acct-card" aria-busy="true">
			<h1 class="page-title">Your account</h1>
			<p class="acct-name"><span class="acct-avatar" aria-hidden="true">${icon("person")}</span><b class="muted">Reading your account…</b></p>
			<h2>You sign in with</h2>
			<ul class="acct-logins acct-skeleton" aria-hidden="true"><li></li><li></li></ul>
		</section>`;
	}
	const has = new Set(me.logins.map((l) => l.provider));
	const many = me.logins.length > 1;
	return html`<section class="acct-card">
		<h1 class="page-title">Your account</h1>
		<p class="acct-name"><span class="acct-avatar" aria-hidden="true">${icon("person")}</span><b>${me.member.name}</b></p>
		<h2>You sign in with</h2>
		<ul class="acct-logins">${me.logins.map((l) => html`<li>
			${l.provider === "github" ? icon("github") : l.provider === "passkey" ? icon("key") : html`<span class="acct-g" aria-hidden="true">G</span>`}
			<span><b>${PROVIDERS[l.provider] ?? l.provider}</b><small>${l.provider === "passkey"
				? `added ${new Date(l.added * 1000).toLocaleDateString()}${l.used > l.added ? `, last used ${new Date(l.used * 1000).toLocaleDateString()}` : ""}`
				: [l.login ? `@${l.login}` : "", l.email ?? ""].filter(Boolean).join(" · ") || "no email shared"}</small></span>
			${many ? html`<button class="link-btn" data-acct="remove" data-provider="${l.provider}" data-subject="${l.subject}">Remove</button>` : ""}
		</li>`)}</ul>
		${st.waiting ? waitingPanel() : html`<div class="acct-buttons">
			${has.has("google") ? "" : startButton("google", { label: "Add Google", link: true })}
			${has.has("github") ? "" : startButton("github", { label: " Add GitHub", link: true })}
			${passkeysAvailable() ? html`<button class="btn" data-acct="passkey-add" ${st.passkey?.kind === "create" ? "" : "disabled"}>${icon("key")} Add a passkey on this device</button>` : ""}
		</div>`}
		<p class="acct-small">Signing in with Google and GitHub with the same verified email is one account; with different emails, add the second here. A passkey signs you in with this device's face, fingerprint or code.</p>
		<p class="acct-small">Your liked songs and playlists are kept with your account, on every device where you sign in. What is on a device when you first sign in there joins them; signing out keeps it on the device.</p>
		<p class="acct-links"><a class="text-link" href="#/library/uploads">Your uploads</a></p>
		<p><button class="btn" data-acct="signout">Sign out on this device</button></p>
	</section>`;
}

function content(ctx) {
	if (ctx.desktop) return html`<section class="acct-card"><h1 class="page-title">Sign in</h1><p>Signing in works in the web app for now: open <a class="text-link" href="https://zaideih.com/#/account">zaideih.com</a>.</p></section>`;
	return html`${account().signedIn ? accountCard() : signInCard(ctx)}
		${st.busy ? html`<p class="muted acct-busy" role="status">${st.busy}</p>` : ""}
		${st.error ? html`<p class="error" role="alert">${st.error}</p>` : ""}`;
}

function draw(root, ctx) {
	if (!root.isConnected) return;
	root.innerHTML = content(ctx);
	// The heading was drawn anew: the large title follows the new one.
	ctx.redrawn?.();
}

/** Back from GitHub on this page: the GitHub sign-in, who it is, then a Zaideih session (added to the account with Add GitHub). */
async function finishGitHub(query) {
	const link = sessionStorage.getItem(GITHUB_LINK_KEY) === "1";
	sessionStorage.removeItem(GITHUB_LINK_KEY);
	if (query.get("signin-error")) throw new Error(`GitHub did not sign you in: ${query.get("signin-error")}`);
	await githubSession().finish({ code: query.get("signin"), nonce: query.get("nonce") });
	const who = await createGitHub(() => githubSession().token()).whoami();
	saveWho(localStorage, { login: who.login, level: who.level, via: "github" });
	return account().fromGitHub({ link });
}

/** In an app on the home screen: the sign-in opened in its sheet; take its code from the Worker and finish here. */
async function waitFor(provider, root, ctx) {
	const nonce = nonceOf(provider);
	if (!nonce) throw new Error("the sign-in was not prepared on this page; try again");
	st.waiting = provider;
	st.error = "";
	draw(root, ctx);
	const w = waitForSignIn({ authUrl: AUTH_URL, nonce });
	st.cancel = w.cancel;
	try {
		const code = await w.promise;
		st.busy = `Finishing the ${PROVIDERS[provider]} sign-in…`;
		st.waiting = null;
		draw(root, ctx);
		const s = provider === "google"
			? await account().google.finish({ code, nonce })
			: await finishGitHub(new URLSearchParams({ signin: code, nonce }));
		ctx.notify(s.joined === "merged" ? "Your two accounts are now one" : s.joined === "link" ? `${PROVIDERS[provider]} added to your account` : s.joined === "email" ? "Signed in: joined to your account by your email" : `Signed in as ${s.member.name}`);
		ctx.onChange();
		st.me = await account().me();
	} catch (err) {
		if (err.message !== "cancelled") st.error = err.message;
	} finally {
		st.waiting = null;
		st.cancel = null;
		st.busy = "";
		await prepareLinks().catch((err) => { st.error = err.message; });
		draw(root, ctx);
	}
}

async function mount(root, ctx) {
	const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
	const back = ["google", "google-error", "signin", "signin-error"].some((k) => query.has(k));
	// A code is single-use: out of the address and the history at once.
	if (back) history.replaceState(history.state, "", "#/account");
	root.addEventListener("click", async (e) => {
		const open = e.target.closest("[data-acct-open]");
		if (open) {
			// The link opens the sign-in in its sheet; the page waits for it, after the tap has done its work.
			const provider = open.dataset.acctOpen;
			if (provider === "github") {
				if (st.links?.github.link) sessionStorage.setItem(GITHUB_LINK_KEY, "1");
				else sessionStorage.removeItem(GITHUB_LINK_KEY);
			}
			setTimeout(() => waitFor(provider, root, ctx), 0);
			return;
		}
		const b = e.target.closest("[data-acct]");
		if (!b) return;
		if (b.dataset.acct === "cancel") { st.cancel?.(); return; }
		if (b.dataset.acct === "passkey-add" || b.dataset.acct === "passkey-signin") {
			// Straight to the browser's passkey prompt, with the options fetched before the tap.
			const prepared = st.passkey;
			st.passkey = null;
			st.error = "";
			try {
				if (b.dataset.acct === "passkey-add") {
					const made = await makePasskey(prepared.options);
					st.busy = "Adding the passkey…"; draw(root, ctx);
					st.me = await account().addPasskey(made);
					ctx.notify("Passkey added: next time, sign in with this device's face, fingerprint or code");
				} else {
					const used = await usePasskey(prepared.options);
					st.busy = "Signing in…"; draw(root, ctx);
					const s = await account().signInWithPasskey(used);
					ctx.notify(`Signed in as ${s.member.name}`);
					ctx.onChange();
					st.me = await account().me();
				}
			} catch (err) {
				if (err.message !== "cancelled") st.error = err.message;
			}
			st.busy = "";
			await preparePasskey().catch((err) => { st.error = err.message; });
			await prepareLinks().catch((err) => { st.error = err.message; });
			draw(root, ctx);
			return;
		}
		st.error = "";
		try {
			const link = b.dataset.link === "1";
			const here = `${location.origin}${location.pathname}`;
			if (b.dataset.acct === "google") {
				st.busy = "Opening Google…"; draw(root, ctx);
				location.assign(await account().google.start(here, { link }));
			} else if (b.dataset.acct === "github") {
				st.busy = "Opening GitHub…"; draw(root, ctx);
				if (link) sessionStorage.setItem(GITHUB_LINK_KEY, "1");
				location.assign(await githubSession().start(here, { to: "account" }));
			} else if (b.dataset.acct === "remove") {
				st.me = await account().removeLogin(b.dataset.provider, b.dataset.subject);
				ctx.notify(`${PROVIDERS[b.dataset.provider]} removed from your account`);
				draw(root, ctx);
			} else if (b.dataset.acct === "signout") {
				st.busy = "Signing out…"; draw(root, ctx);
				// Everything this device holds: the Zaideih session, the GitHub sign-in, a fine-grained token.
				await account().signOut().catch((err) => console.warn("the Zaideih session could not be signed out", err));
				await githubSession().signOut().catch((err) => console.warn("the GitHub sign-in could not be revoked", err));
				localStorage.removeItem(TOKEN_KEY);
				saveWho(localStorage, null);
				st = { me: null, busy: "", error: "" };
				ctx.notify("Signed out on this device");
				ctx.onChange();
				await prepareLinks();
				await preparePasskey().catch(() => {});
				draw(root, ctx);
			}
		} catch (err) {
			st.busy = "";
			st.error = err.message;
			draw(root, ctx);
		}
	});
	try {
		if (query.has("google") || query.has("google-error")) {
			if (query.get("google-error")) throw new Error(query.get("google-error") === "access_denied" ? "Google sign-in was cancelled." : `Google did not sign you in: ${query.get("google-error")}`);
			st.busy = "Finishing the Google sign-in…"; draw(root, ctx);
			const s = await account().google.finish({ code: query.get("google"), nonce: query.get("nonce") });
			ctx.notify(s.joined === "email" ? `Signed in: joined to your account by your email` : s.joined === "link" ? "Google added to your account" : s.joined === "merged" ? "Your two accounts are now one" : `Signed in as ${s.member.name}`);
			ctx.onChange();
		} else if (query.has("signin") || query.has("signin-error")) {
			st.busy = "Finishing the GitHub sign-in…"; draw(root, ctx);
			const s = await finishGitHub(query);
			ctx.notify(s.joined === "link" ? "GitHub added to your account" : s.joined === "merged" ? "Your two accounts are now one" : `Signed in as ${s.member.name}`);
			ctx.onChange();
		}
		st.busy = "";
		await prepareLinks();
		await preparePasskey().catch((err) => console.warn("passkey options", err));
		draw(root, ctx);
		if (account().signedIn && !ctx.desktop) {
			st.me = await account().me();
			draw(root, ctx);
		}
	} catch (err) {
		st.busy = "";
		st.error = err.message;
		draw(root, ctx);
		// A sign-in that did not finish leaves the account as it was: show it.
		if (account().signedIn && !ctx.desktop && !st.me) {
			st.me = await account().me().catch(() => null);
			draw(root, ctx);
		}
	}
}
