import { Storage } from "@google-cloud/storage";
// import config from "./config.js";
// config.setting.bucket;
import { config } from "lethil";

/**
 * $env:GOOGLE_APPLICATION_CREDENTIALS="/var/www/secure/gsaks.json"
 * set GOOGLE_APPLICATION_CREDENTIALS=/var/www/secure/gsaks-development.json
 * gsaks.json
 */

const storage = new Storage();

// export const bucket = storage.bucket(config.bucket);

// export const buckets = async () => await storage.getBuckets();

// /**
//  * @param {string} file
//  */
// export const download = async (file) => await bucket.file(file).download();

// /**
//  * @param {string} file
//  * @param {any} destination
//  */
// export const upload = async (file, destination) =>
// 	await bucket.upload(file, { destination: destination });

// /**
//  * @param {string} file
//  */
// export const createReadStream = async (file) =>
// 	bucket.file(file).createReadStream();

class Cloud {
	get bucket() {
		return storage.bucket(config.bucket);
	}
	async buckets() {
		return await storage.getBuckets();
	}
	/**
	 * @param {string} file
	 */
	async download(file) {
		return await this.bucket.file(file).download();
	}
	/**
	 * @param {string} file
	 * @param {any} destination
	 */
	async upload(file, destination) {
		return await this.bucket.upload(file, { destination: destination });
	}
	/**
	 * @param {string} file
	 */
	createReadStream(file) {
		return this.bucket.file(file).createReadStream();
	}
}

export default new Cloud();
