import path from 'path';
// import fs from 'fs';
import {seek} from 'lethil';
import {setting} from './config.js';

const {media,bucketAvailable} = setting;

/**
 * @param {string} file
 */
export async function read(file) {
  return seek.read(file).then(
    o => JSON.parse(o)
  ).catch(
    () => new Array()
  );
}

/**
 * @param {string} file
 * @param {any} raw
 * @param {any} reps
 */
export async function write(file, raw, reps=null, spac=2) {
  return seek.write(file, JSON.stringify(raw, reps, spac));
}

export const bucket = {
  /**
   * @type {{id:string,dir:string,raw:Array<string>,meta:any,track:any,task:Array<any>}[]}
   */
  data: [],
  id:'',
  tmp:'tmp?',
  invalid:null,
  active: () => (bucket.id && bucketAvailable.includes(bucket.id))? bucket.id: null,
  check: () => bucket.invalid = bucket.active()? null: `no such "${bucket.id}" bucket exists`,
  file: () => path.join(media, setting.store.bucket).replace('?',bucket.active() || bucket.tmp),
  get: () => read(bucket.file()),
  read: () => bucket.get().then(
    o => Object.assign(bucket.data, o)
  ).catch(
    () => bucket.data = []
  ),
  write: () => write(bucket.file(), bucket.data),
  also:{}
}

export const album = {
  data: [],
  file: path.join(media,setting.store.album),
  get: () => read(album.file),
  read: () => album.get().then(
    o => Object.assign(album.data, o)
  ).catch(
    () => album.data = []
  ),
  write: () => write(album.file, album.data,null,0),
  also:{
    name:{
      data: [],
      file: path.join(media, setting.store.albumName),
      read: () => read(album.also.name.file).then(
        o => Object.assign(album.also.name.data, o)
      ).catch(
        () => album.also.name.data = []
      )
    }
  }
}

export const artist = {
  data: [],
  file: path.join(media,setting.store.artist),
  get: () => read(artist.file),
  read: () => artist.get().then(
    o => Object.assign(artist.data, o)
  ).catch(
    () => artist.data = []
  ),
  write: () => write(artist.file, artist.data,null,0),
  also:{}
}

export const genre = {
  data: [],
  file: path.join(media, setting.store.genre),
  get: () => read(genre.file),
  read: () => genre.get().then(
    o => Object.assign(genre.data, o)
  ).catch(
    () => genre.data = []
  ),
  write: () => write(genre.file, genre.data,null,0),
  also:{}
}

export const track = {
  also:{
    name:{
      data: [],
      file: path.join(media, setting.store.trackName),
      read: () => read(track.also.name.file).then(
        o => Object.assign(track.also.name.data, o)
      ).catch(
        () => track.also.name.data = []
      )
    }
  }
}