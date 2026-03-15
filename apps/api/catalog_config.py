"""
Central configuration for all catalog-related file names and JSON structures.
Import this into any management command or view that needs to read/write catalog data.
"""

# --- DIRECTORY NAMES ---
DIR_MUSIC = 'music'

# --- FILE NAMES ---
FILE_ALBUMS = 'albums.json'
FILE_CATEGORY = 'category.json'
FILE_TRACK_CORRECTIONS = 'track.name.json'
FILE_ARTIST_CORRECTIONS = 'artist.name.json'
FILE_ALBUM_CORRECTIONS = 'album.name.json'

def get_bucket_filename(lang):
    """Returns the standardized bucket filename for a given language."""
    return f'bucket.{lang}.json'


# --- BUCKET SCHEMA KEYS ---
B_ALBUM_ID = 'id'
B_ALBUM_DIR = 'dir'
B_ALBUM_DATE = 'date'
B_ALBUM_TRACKS = 'track'

B_TRACK_FILE = 'file'
B_TRACK_TITLE = 'title'
B_TRACK_ARTIST = 'artist'
B_TRACK_ALBUMARTIST = 'albumartist'
B_TRACK_ALBUM = 'album'
B_TRACK_GENRE = 'genre'
B_TRACK_NUM = 'track'
B_TRACK_YEAR = 'year'
B_TRACK_DURATION = 'duration'


# --- DICTIONARY SCHEMA KEYS ---
DICT_NAME = 'name'
DICT_AKA = 'aka'
DICT_CORRECTION = 'correction'
DICT_THESAURUS = 'thesaurus'
DICT_ARTIST_ID = 'i'
DICT_GENRE_ID = 'id'


# --- JSON SCHEMA FACTORIES ---

def get_new_artist_template(artist_id, name):
    """Standardized schema for a new Artist in artist.name.json"""
    return {
        DICT_NAME: name,
        DICT_AKA: "",
        DICT_CORRECTION: [],
        DICT_THESAURUS: [],
        "type": 0,
        DICT_ARTIST_ID: artist_id,
        "t": 0,
        "a": 0,
        "d": 0,
        "p": 0,
        "l": []
    }

def get_new_genre_template(genre_id, name):
    """Standardized schema for a new Genre in category.json"""
    return {
        DICT_GENRE_ID: genre_id,
        DICT_NAME: name,
        DICT_CORRECTION: [],
        DICT_THESAURUS: []
    }

def get_compiled_album_template(uid, album_name, genre_ids, years, lang_id, tracks):
    """Standardized schema for an Album in the final albums.json"""
    return {
        "ui": uid,
        "ab": album_name,
        "gr": genre_ids,
        "yr": years,
        "lg": lang_id,
        "tk": tracks
    }

def get_compiled_track_template(track_name, artist_ids, duration_sec, plays=0, track_id=None):
    """Standardized schema for a Track inside albums.json"""
    payload = {
        "t": track_name,
        "a": artist_ids,
        "d": duration_sec,
        "p": plays
    }
    if track_id is not None:
        payload["i"] = track_id
    return payload

def get_bucket_album_template(album_id, album_dir, date_iso, tracks):
    """Standardized schema for an Album in the raw bucket.[lang].json"""
    return {
        B_ALBUM_ID: album_id,
        B_ALBUM_DIR: album_dir,
        B_ALBUM_DATE: date_iso,
        B_ALBUM_TRACKS: tracks
    }

def get_bucket_track_template(filename, title, artist, albumartist, album, genre, track_num, year, duration):
    """Standardized schema for a Track in the raw bucket.[lang].json"""
    return {
        B_TRACK_FILE: filename,
        B_TRACK_TITLE: title,
        B_TRACK_ARTIST: artist,
        B_TRACK_ALBUMARTIST: albumartist,
        B_TRACK_ALBUM: album,
        B_TRACK_GENRE: genre,
        B_TRACK_NUM: track_num,
        B_TRACK_YEAR: year,
        B_TRACK_DURATION: duration
    }