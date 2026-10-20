/**
 * Usage statistics with Google Analytics 4, only with the listener's consent.
 *
 * Nothing is loaded or sent until the listener chooses "Allow" (basic consent
 * mode): no Google script, no cookies, no requests. The choice is kept per
 * device in localStorage and can be changed on the About page. Builds without
 * a measurement id (dev, desktop, or ZAIDEIH_GA_ID="") have analytics off.
 *
 * Sent: page views (the in-app address and page title) and "play_track" when
 * a song starts (track, album and language ids). Never sent: search text,
 * likes, playlists or anything else from the library.
 */
import { GA_ID } from "../config.js";

const CHOICE_KEY = "zaideih.analytics";
let loaded = false;
let pending = [];

export const analytics = {
	/** True when this build can collect statistics at all. */
	available: Boolean(GA_ID),

	/** "granted", "denied", or "" when the listener has not chosen yet. */
	choice() {
		try {
			const v = localStorage.getItem(CHOICE_KEY);
			return v === "granted" || v === "denied" ? v : "";
		} catch {
			return "denied"; // storage blocked: treat as no consent and do not ask again
		}
	},

	/** Records the listener's choice; "granted" loads Google Analytics. */
	setChoice(value) {
		try { localStorage.setItem(CHOICE_KEY, value); } catch { /* the choice cannot be kept; nothing loads */ }
		if (value === "granted") load();
		else if (loaded) {
			// Loaded earlier this session: stop storage and sending from now on.
			window.gtag("consent", "update", { analytics_storage: "denied" });
			window[`ga-disable-${GA_ID}`] = true;
		}
	},

	/** Starts analytics when consent was given earlier on this device. */
	init() {
		if (this.available && this.choice() === "granted") load();
	},

	pageView(location, title) {
		send("page_view", { page_location: location, page_title: title });
	},

	event(name, params = {}) {
		send(name, params);
	},
};

function send(name, params) {
	if (!analytics.available || analytics.choice() !== "granted") return;
	if (!loaded) { pending.push([name, params]); return; }
	window.gtag("event", name, params);
}

function load() {
	if (loaded || !GA_ID) return;
	loaded = true;
	window[`ga-disable-${GA_ID}`] = false;
	window.dataLayer = window.dataLayer || [];
	// gtag must push the arguments object itself, as Google's snippet does.
	window.gtag = function gtag() { window.dataLayer.push(arguments); }; // eslint-disable-line prefer-rest-params
	window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
	window.gtag("js", new Date());
	// Page views are sent by the app on each route change (hash routing), not automatically.
	window.gtag("config", GA_ID, { send_page_view: false });
	const script = document.createElement("script");
	script.async = true;
	script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
	script.addEventListener("error", () => console.warn("Google Analytics could not be loaded (blocked or offline); statistics are not sent."));
	document.head.append(script);
	for (const [name, params] of pending) window.gtag("event", name, params);
	pending = [];
}
