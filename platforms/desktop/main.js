/**
 * Electron main process.
 *
 * The renderer is the same app as the web build, served from the bundled
 * `app/` directory over a privileged `app://zaideih` scheme. A real origin
 * (rather than file://) gives the page IndexedDB, Media Session and fetch
 * with CORS, which the audio Worker allows for app://zaideih.
 *
 * Build the renderer first: npm --prefix ../.. run build:desktop
 */
import { app, BrowserWindow, dialog, nativeTheme, protocol, session, shell } from "electron";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEME = "app";
const HOST = "zaideih";
const ORIGIN = `${SCHEME}://${HOST}`;
const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "app"));

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};

protocol.registerSchemesAsPrivileged([{
	scheme: SCHEME,
	privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

function contentSecurityPolicy(audioOrigin) {
	return [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		`media-src 'self' blob: ${audioOrigin}`,
		`connect-src 'self' ${audioOrigin}`,
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
		"frame-ancestors 'none'",
	].join("; ");
}

/** Maps an app:// URL to a file inside ROOT, refusing anything that escapes it. */
function resolveAsset(url) {
	if (url.host !== HOST) return null;
	let rel;
	try {
		rel = decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
	if (rel === "/" || rel === "") rel = "/index.html";
	const file = resolve(ROOT, `.${rel}`);
	return file.startsWith(ROOT + sep) ? file : null;
}

async function loadBuildInfo() {
	const path = join(ROOT, "build.json");
	try {
		const info = JSON.parse(await readFile(path, "utf8"));
		if (!info.audioOrigin) throw new Error("build.json has no audioOrigin");
		return info;
	} catch (err) {
		throw new Error(`The desktop renderer is not built (${path}: ${err.code ?? err.message}).\nRun: npm --prefix ../.. run build:desktop`);
	}
}

function registerProtocol(csp) {
	protocol.handle(SCHEME, async (request) => {
		const file = resolveAsset(new URL(request.url));
		if (!file) return new Response("Not Found", { status: 404 });
		try {
			const info = await stat(file);
			if (!info.isFile()) return new Response("Not Found", { status: 404 });
			const headers = {
				"Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
				"Content-Length": String(info.size),
				"X-Content-Type-Options": "nosniff",
			};
			if (file.endsWith(".html")) headers["Content-Security-Policy"] = csp;
			return new Response(await readFile(file), { headers });
		} catch (err) {
			if (err.code === "ENOENT") return new Response("Not Found", { status: 404 });
			console.error("app:// read failed", file, err);
			return new Response("Internal Error", { status: 500 });
		}
	});
}

let mainWindow = null;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 360,
		minHeight: 560,
		title: "Zaideih",
		icon: join(ROOT, "icons", "icon-512.png"),
		show: false,
		autoHideMenuBar: true,
		backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1c" : "#f7f7f7",
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: false,
		},
	});
	mainWindow.once("ready-to-show", () => mainWindow.show());

	// Keep the window on the app; open web links in the default browser.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("will-navigate", (event, url) => {
		if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
	});
	mainWindow.on("closed", () => { mainWindow = null; });
	mainWindow.loadURL(`${ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		if (!mainWindow) return;
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	});

	app.whenReady().then(async () => {
		let info;
		try {
			info = await loadBuildInfo();
		} catch (err) {
			dialog.showErrorBox("Zaideih can't start", err.message);
			app.exit(1);
			return;
		}
		registerProtocol(contentSecurityPolicy(info.audioOrigin));
		// The app needs no device permissions; refuse every request.
		session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
		createWindow();
		app.on("activate", () => { if (!mainWindow) createWindow(); });
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
}
