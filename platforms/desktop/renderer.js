/**
 * Desktop (Electron) renderer entry point. The page is served from the local
 * app:// origin with the catalog bundled, so no service worker is needed.
 */
import { boot } from "../../src/app.js";

boot({ name: "desktop", catalogBase: "catalog/" });
