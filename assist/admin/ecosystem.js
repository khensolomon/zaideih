import { deploy, config } from "lethil";
// import { exec } from "child_process";
import util from "util";
import child_process from "child_process";

/**
 * Transfer .env to production
 * @param {any} _req
 */
export async function transferEnvironment(_req) {
	// @ts-ignore
	// const scp = `scp ./assets/env/.env ${config.SSH_USER}@${config.SSH_HOST}:/var/www/zaideih/`;
	const scp = `scp ~/OneDrive/env/dev/zaideih/web/.env ${config.SSH_USER}@${config.SSH_HOST}:/var/www/zaideih/`;
	// exec(scp, (error, stdout, stderr) => {
	// 	if (error) {
	// 		console.log(`There was an error ${error}`);
	// 	}

	// 	console.log(`The stdout is ${stdout}`);
	// 	console.log(`The stderr is ${stderr}`);
	// });
	// return "transfering .env";
	const exec = util.promisify(child_process.exec);
	const { stdout, stderr } = await exec(scp);
	console.log("stdout:", stdout);
	console.error("stderr:", stderr);
}

export const createOrUpdate = deploy.createOrUpdate;
