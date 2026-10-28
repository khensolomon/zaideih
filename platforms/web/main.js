/**
 * Web (PWA) entry point: boots the shared app and manages the service worker.
 */
import { boot } from "../../src/app.js";
import { IS_DEV } from "../../src/config.js";
import { notify } from "../../src/core/store.js";

// Waiting for the first view keeps the first visit's bandwidth for the catalog;
// a start that never gets there must still be able to update itself, so the
// service worker is registered after REGISTER_LATEST_MS whatever happens.
const REGISTER_LATEST_MS = 5000;
let registered = false;

function registerServiceWorker() {
	if (registered || !("serviceWorker" in navigator) || IS_DEV) return;
	registered = true;
	// Reload only after the user accepts an update. The first install also fires
	// controllerchange (clients.claim), and reloading then would interrupt the first visit.
	let updateAccepted = false;
	navigator.serviceWorker.register("sw.js").then((reg) => {
		const offerUpdate = (worker) => notify("A new version of Zaideih is ready.", {
			sticky: true,
			action: {
				label: "Reload",
				run: () => {
					updateAccepted = true;
					worker.postMessage({ type: "skip-waiting" });
				},
			},
		});
		if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
		reg.addEventListener("updatefound", () => {
			const w = reg.installing;
			w?.addEventListener("statechange", () => {
				if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w);
			});
		});
	}).catch((err) => console.error("service worker registration failed", err));

	// A page already run by a service worker (not the first install) whose worker changed without
	// its say: the update was accepted in another tab, and this page's files are no longer kept.
	const hadController = Boolean(navigator.serviceWorker.controller);
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (updateAccepted) {
			updateAccepted = false;
			location.reload();
		} else if (hadController) {
			notify("Zaideih was updated in another tab. Reload this one to keep everything working.", {
				sticky: true,
				action: { label: "Reload", run: () => location.reload() },
			});
		}
	});
}

setTimeout(registerServiceWorker, REGISTER_LATEST_MS);
boot({ name: "web", catalogBase: "catalog/", onReady: registerServiceWorker });
