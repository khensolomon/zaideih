/**
 * Your account (#/account, docs/accounts.md): signing in, the ways the
 * person signs in, adding or removing one, and signing out of this device.
 *
 * Google is offered first: most listeners have a Google account and have
 * never heard of GitHub, which is for catalog editors. Both sign-ins come
 * back here (#/account?google=… or ?signin=…), where they are finished and
 * the code is taken out of the address at once.
 */
import { AUTH_URL } from "../config.js";
import { html } from "../core/html.js";
import { saveWho, TOKEN_KEY } from "../core/access.js";
import { account, githubSession } from "../core/signin.js";
import { createGitHub } from "../admin/github.js";
import { icon } from "./icons.js";

const GITHUB_LINK_KEY = "zaideih.account.github-link";
const PROVIDERS = { google: "Google", github: "GitHub" };

// Browsers inside other apps (Facebook, Messenger, Instagram, LINE, WeChat, Android web views): Google refuses to sign in there.
export const inAppBrowser = (ua) => /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|; wv\)/.test(ua);

// State that survives re-renders of the page.
let st = { me: null, busy: "", error: "" };

/** @param {{ onChange: () => void, notify: (text: string, o?: object) => void, desktop: boolean }} ctx  onChange: someone signed in or out */
export function accountView(ctx) {
	return {
		title: account().signedIn ? "Your account" : "Sign in",
		body: html`<div class="acct-root"></div>`,
		mount: (view) => mount(view.querySelector(".acct-root"), ctx),
	};
}

function signInCard(ctx) {
	const caught = inAppBrowser(navigator.userAgent);
	return html`<section class="acct-card">
		<h1 class="page-title">Sign in</h1>
		<p class="acct-lead">Keep music of your own, and later your liked songs and playlists on every device.</p>
		${caught ? html`<p class="acct-warn" role="note">This page is open inside another app. Google does not allow signing in here: open <b>${location.host}</b> in Chrome or Safari first.</p>` : ""}
		<div class="acct-buttons">
			<button class="btn primary acct-google" data-acct="google" ${st.busy ? "disabled" : ""}>Continue with Google</button>
			<button class="btn acct-github" data-acct="github" ${st.busy ? "disabled" : ""}>${icon("github")} Continue with GitHub</button>
		</div>
		<p class="acct-small">GitHub is for catalog editors and people who already use it. Signing in with both, with the same email, is one account.</p>
		<p class="acct-small">Zaideih keeps your name, the email Google or GitHub confirms, and their id for you, only to know it is you. <a class="text-link" href="#/about">About</a></p>
	</section>`;
}

function accountCard() {
	const me = st.me;
	if (!me) return html`<section class="acct-card"><h1 class="page-title">Your account</h1><p class="muted">Reading your account…</p></section>`;
	const has = new Set(me.logins.map((l) => l.provider));
	const many = me.logins.length > 1;
	return html`<section class="acct-card">
		<h1 class="page-title">Your account</h1>
		<p class="acct-name"><span class="acct-avatar" aria-hidden="true">${icon("person")}</span><b>${me.member.name}</b></p>
		<h2>You sign in with</h2>
		<ul class="acct-logins">${me.logins.map((l) => html`<li>
			${l.provider === "github" ? icon("github") : html`<span class="acct-g" aria-hidden="true">G</span>`}
			<span><b>${PROVIDERS[l.provider] ?? l.provider}</b><small>${[l.login ? `@${l.login}` : "", l.email ?? ""].filter(Boolean).join(" · ") || "no email shared"}</small></span>
			${many ? html`<button class="link-btn" data-acct="remove" data-provider="${l.provider}" data-subject="${l.subject}">Remove</button>` : ""}
		</li>`)}</ul>
		<div class="acct-buttons">
			${has.has("google") ? "" : html`<button class="btn" data-acct="google" data-link="1">Add Google</button>`}
			${has.has("github") ? "" : html`<button class="btn" data-acct="github" data-link="1">${icon("github")} Add GitHub</button>`}
		</div>
		<p class="acct-small">Signing in with Google and GitHub with the same verified email is one account; with different emails, add the second here.</p>
		<p class="acct-links"><a class="text-link" href="#/library/uploads">Your uploads</a></p>
		<p><button class="btn" data-acct="signout">Sign out on this device</button></p>
	</section>`;
}

function draw(root, ctx) {
	if (!root.isConnected) return;
	if (ctx.desktop) {
		root.innerHTML = html`<section class="acct-card"><h1 class="page-title">Sign in</h1><p>Signing in works in the web app for now: open <a class="text-link" href="https://zaideih.com/#/account">zaideih.com</a>.</p></section>`;
		return;
	}
	root.innerHTML = html`${account().signedIn ? accountCard() : signInCard(ctx)}
		${st.busy ? html`<p class="muted acct-busy" role="status">${st.busy}</p>` : ""}
		${st.error ? html`<p class="error" role="alert">${st.error}</p>` : ""}`;
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

async function mount(root, ctx) {
	st = { me: null, busy: "", error: "" };
	const query = new URLSearchParams(location.hash.split("?")[1] ?? "");
	const back = ["google", "google-error", "signin", "signin-error"].some((k) => query.has(k));
	// A code is single-use: out of the address and the history at once.
	if (back) history.replaceState(history.state, "", "#/account");
	root.addEventListener("click", async (e) => {
		const b = e.target.closest("[data-acct]");
		if (!b) return;
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
