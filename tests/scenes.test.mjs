import assert from "node:assert/strict";
import { test } from "node:test";
import { enableSteps } from "../src/ui/scenes.js";

test("steps to turn WebGL on name the browser's own settings page", () => {
	const chrome = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
	const edge = `${chrome} Edg/155.0.0.0`;
	const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
	assert.match(enableSteps(chrome)[0], /chrome:\/\/settings\/system/);
	assert.match(enableSteps(edge)[0], /edge:\/\/settings\/system/);
	assert.match(enableSteps(firefox).join(" "), /hardware acceleration/);
	assert.ok(enableSteps("unknown").length >= 2);
});
