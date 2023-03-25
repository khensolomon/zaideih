import { command, config } from "lethil";

const app = command();
const routes = app.routes();

routes.register("", function (_req) {
	console.log("framework.config.name is");
	return config.name;
});

routes.register("apple", () => "Did you know apple is fruit?");
routes.register("orange", () => "Orange is good for health");

routes.register("ecosystem", async function (req) {
	return import("./admin/deployment.js").then((e) => e.createOrUpdate(req));
});

routes.register("environment", async function (req) {
	return import("./admin/deployment.js").then((e) =>
		e.transferEnvironment(req)
	);
});

routes.register(
	"register-:bucketName/:albumId?",
	async (req) => await import("./admin/register.js").then((e) => e.default(req))
);

routes.register(
	"scan-:jobName/:bucketName/:more?",
	async (req) => await import("./admin/scan.js").then((e) => e.default(req))
);

routes.register(
	"rename-:jobName/:bucketName/:albumId?",
	async (req) => await import("./admin/rename.js").then((e) => e.default(req))
);

routes.register(
	"id3-:jobName/:bucketName/:albumId?",
	async (req) => await import("./admin/id3.js").then((e) => e.default(req))
);

routes.register(
	"m3s-:jobName/:jobType?",
	async (req) => await import("./admin/m3s.js").then((e) => e.default(req))
);

routes.register(
	"crypto-:jobName",
	async (req) => await import("./admin/crypto.js").then((e) => e.default(req))
);

routes.register(
	"upgrade/:id?",
	async (req) => await import("./admin/upgrade.js").then((e) => e.default(req))
);

routes.register(
	"mobile-artist",
	async (req) => await import("./admin/mobile.js").then((e) => e.default(req))
);
