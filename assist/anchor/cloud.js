import {Storage} from '@google-cloud/storage';
import config from './config.js';

/**
 * $env:GOOGLE_APPLICATION_CREDENTIALS="C:\server\www\secure\Server-245222d1b962.json"
 * set GOOGLE_APPLICATION_CREDENTIALS=C:\server\www\secure\Server-245222d1b962.json
 * gsaks.json
 */

export const storage = new Storage();
export const bucket = storage.bucket(config.setting.bucket);

export const buckets = async () => await storage.getBuckets();

/**
 * @param {string} file
 */
export const download = async (file) => await bucket.file(file).download();

/**
 * @param {string} file
 * @param {any} destination
 */
export const upload = async (file,destination) => await bucket.upload(file, {destination:destination})

/**
 * @param {string} file
 */
export const createReadStream = async (file) => bucket.file(file).createReadStream();