import { route, config } from "lethil";

const routes = new route.cli();

routes.get("", function (_req) {
	console.log("framework.config.name is");
	return config.name;
});

routes.get("apple", () => "Did you know apple is fruit?");
routes.get("orange", () => "Orange is good for health");

routes.get("environment", (req) =>
	import("./admin/deployment.js").then((e) => e.transferEnvironment(req))
);

routes.get("ecosystem", (req) =>
	import("./admin/deployment.js").then((e) => e.createOrUpdate(req))
);

routes.get(
	"register-:bucketName/:albumId?",
	async (req) => await import("./admin/register.js").then((e) => e.default(req))
);

routes.get(
	"scan-:jobName/:bucketName/:more?",
	async (req) => await import("./admin/scan.js").then((e) => e.default(req))
);

routes.get(
	"rename-:jobName/:bucketName/:albumId?",
	async (req) => await import("./admin/rename.js").then((e) => e.default(req))
);

routes.get(
	"id3-:jobName/:bucketName/:albumId?",
	async (req) => await import("./admin/id3.js").then((e) => e.default(req))
);

routes.get(
	"m3s-:jobName/:jobType?",
	async (req) => await import("./admin/m3s.js").then((e) => e.default(req))
);

routes.get(
	"crypto-:jobName",
	async (req) => await import("./admin/crypto.js").then((e) => e.default(req))
);

routes.get(
	"upgrade/:id?",
	async (req) => await import("./admin/upgrade.js").then((e) => e.default(req))
);

routes.get(
	"mobile-artist",
	async (req) => await import("./admin/mobile.js").then((e) => e.default(req))
);
