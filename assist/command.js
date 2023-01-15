import { route } from "lethil";

const routes = route();

routes.get("", async () => "?");
routes.get("apple", async () => "Did you know apple is fruit?");
routes.get("orange", async () => "Orange is good for health");

routes.get("environment", async (req = {}) =>
	import("./admin/ecosystem.js").then((e) => e.transferEnvironment(req))
);

routes.get("ecosystem", async (req = {}) =>
	import("./admin/ecosystem.js").then((e) => e.createOrUpdate(req))
);

routes.get(
	"register-:bucketName/:albumId?",
	async (req = {}) =>
		await import("./admin/register.js").then((e) => e.default(req))
);

routes.get(
	"scan-:jobName/:bucketName/:more?",
	async (req = {}) =>
		await import("./admin/scan.js").then((e) => e.default(req))
);

routes.get(
	"rename-:jobName/:bucketName/:albumId?",
	async (req = {}) =>
		await import("./admin/rename.js").then((e) => e.default(req))
);

routes.get(
	"id3-:jobName/:bucketName/:albumId?",
	async (req = {}) => await import("./admin/id3.js").then((e) => e.default(req))
);

routes.get(
	"m3s-:jobName/:jobType?",
	async (req = {}) => await import("./admin/m3s.js").then((e) => e.default(req))
);

routes.get(
	"crypto-:jobName",
	async (req = {}) =>
		await import("./admin/crypto.js").then((e) => e.default(req))
);

routes.get(
	"upgrade/:id?",
	async (req = {}) =>
		await import("./admin/upgrade.js").then((e) => e.default(req))
);

routes.get(
	"mobile-artist",
	async (req = {}) =>
		await import("./admin/mobile.js").then((e) => e.default(req))
);
