# Todo

## utilities

- [x] search bar
- playlist/queue
  - [ ] save
  - [ ] sort
  - [ ] name
  - [ ] multi
- [ ] track-list - sortable
- [x] artist-list - css
- [ ] artist-detail - genre
- [ ] artist-detail - all albums
- [ ] album-detail - css
- [ ] album-list - lang - css
- [ ] track-list - meta - inline-flex

- [x] play all - album, artist
- [x] Shorten plays count
- [ ] volume off highlight
- [ ] feedback
- [ ] info.(id3) suggestion

## feature

- [ ] searchable myanmar artist in latin -> 25%
  - eg: ဗဒင်, badin or ba-din
- [ ] custom queue

## bugs

- [x] reading data from both disk & cloud (server)
- [x] repair local storage (client)
- [x] ၄း (need to replace)
- [ ] jsconfig.json

## upload

- [ ] storage/media/store

## remove

- [x] uid/754: 0ab020b111a08ba693f3/id

## prefix

- artist

```sql
# SELECT COUNT(id) FROM `file`;
# SELECT * FROM `file` WHERE id = '17977';
# SELECT * FROM `file` WHERE uid = '0389203e11b3de78b962';
# DELETE FROM `file` WHERE uid = '0ab020b111a08ba693f3';

# SELECT * FROM `file` WHERE dir LIKE 'music/myanmar/m3s%' AND plays = 1;
# UPDATE `file` SET plays=0 WHERE dir LIKE 'music/myanmar/m3s%' AND plays = 1;

UPDATE `file` SET lang=1 WHERE dir LIKE 'music/zola/%';
UPDATE `file` SET lang=2 WHERE dir LIKE 'music/myanmar/%';
UPDATE `file` SET lang=3 WHERE dir LIKE 'music/mizo/%';
UPDATE `file` SET lang=4 WHERE dir LIKE 'music/falam/%';
UPDATE `file` SET lang=5 WHERE dir LIKE 'music/haka/%';
UPDATE `file` SET lang=6 WHERE dir LIKE 'music/english/%';
UPDATE `file` SET lang=7 WHERE dir LIKE 'music/chin/%';
UPDATE `file` SET lang=8 WHERE dir LIKE 'music/korea/%';
UPDATE `file` SET lang=9 WHERE dir LIKE 'music/norwegian/%';
UPDATE `file` SET lang=10 WHERE dir LIKE 'music/collection/%';

UPDATE `file` SET lang=1, dir = REPLACE(dir, 'music/zola/', '') WHERE dir LIKE 'music/zola/%';
UPDATE `file` SET lang=2, dir = REPLACE(dir, 'music/myanmar/', '') WHERE dir LIKE 'music/myanmar/%';
UPDATE `file` SET lang=3, dir = REPLACE(dir, 'music/mizo/', '') WHERE dir LIKE 'music/mizo/%';
UPDATE `file` SET lang=4, dir = REPLACE(dir, 'music/falam/', '') WHERE dir LIKE 'music/falam/%';
UPDATE `file` SET lang=5, dir = REPLACE(dir, 'music/haka/', '') WHERE dir LIKE 'music/haka/%';
UPDATE `file` SET lang=6, dir = REPLACE(dir, 'music/english/', '') WHERE dir LIKE 'music/english/%';
UPDATE `file` SET lang=7, dir = REPLACE(dir, 'music/chin/', '') WHERE dir LIKE 'music/chin/%';
UPDATE `file` SET lang=8, dir = REPLACE(dir, 'music/korea/', '') WHERE dir LIKE 'music/korea/%';
UPDATE `file` SET lang=9, dir = REPLACE(dir, 'music/norwegian/', '') WHERE dir LIKE 'music/norwegian/%';
UPDATE `file` SET lang=10, dir = REPLACE(dir, 'music/collection/', '') WHERE dir LIKE 'music/collection/%';

INSERT INTO
  `lang` (`id`, `name`, `dir`)
VALUES
  (0,'untitle','music/untitle/'),
  (1,'zola','music/zola/'),
  (2,'myanmar','music/myanmar/'),
  (3,'mizo','music/mizo/'),
  (4,'falam','music/falam/'),
  (5,'haka','music/haka/'),
  (6,'english','music/english/'),
  (7,'chin','music/chin/'),
  (8,'korea','music/korea/'),
  (9,'norwegian','music/norwegian/'),
  (10,'collection','music/collection/');

SELECT fl.id AS id, fl.uid, fl.plays, fl.status, lg.id AS lid, lg.name, CONCAT(lg.dir,fl.dir) AS dir
  FROM `file` as fl, `lang` as lg
WHERE fl.uid = '451019b00988bfbf619d' and fl.lang = lg.id;

SELECT * FROM `file` as fl WHERE fl.uid = '451019b00988bfbf619d';

SELECT fl.id AS id, fl.uid, fl.plays, fl.status, lg.id AS lid, lg.name, CONCAT(lg.dir,fl.dir) AS dir
  FROM `file` as fl
LEFT JOIN `lang` as lg
  ON lg.id = fl.lang;

SELECT fl.id AS id, fl.uid, fl.plays, fl.status, lg.id AS lid, lg.name, CONCAT(lg.dir,fl.dir) AS dir
  FROM `file` as fl
LEFT JOIN `lang` as lg
  ON lg.id = fl.lang
WHERE fl.lang = 1;

SELECT fl.id AS id, fl.uid, fl.plays, fl.status, lg.id AS lid, lg.name, CONCAT(lg.dir,fl.dir) AS dir
  FROM `file` as fl
LEFT JOIN `lang` as lg
  ON lg.id = fl.lang
WHERE fl.uid = '451019b00988bfbf619d';

SELECT fl.uid, fl.plays, fl.status, lg.id AS lid, lg.name, CONCAT(lg.dir,fl.dir) AS dir
  FROM `file` as fl
LEFT JOIN `lang` as lg
  ON lg.id = fl.lang
WHERE fl.id = 1;

CREATE TABLE `lang` (
  `id` INT(3) NOT NULL DEFAULT '0',
  `name` CHAR(50) NOT NULL COLLATE 'utf8_general_ci',
  `dir` TEXT NOT NULL COLLATE 'utf8_general_ci'
)
COLLATE='utf8_general_ci'
ENGINE=InnoDB;

CREATE TABLE `file` (
  `id` INT(10) NOT NULL AUTO_INCREMENT,
  `uid` CHAR(50) NULL DEFAULT NULL COLLATE 'utf8_unicode_ci',
  `plays` INT(15) NOT NULL DEFAULT '0',
  `status` INT(10) NULL DEFAULT '0',
  `dir` TEXT NOT NULL COLLATE 'utf8_unicode_ci',
  `lang` INT(3) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`) USING BTREE
)
COLLATE='utf8_unicode_ci'
ENGINE=InnoDB
ROW_FORMAT=DYNAMIC
AUTO_INCREMENT=28170;


-- CREATE VIEW `track` AS
CREATE OR REPLACE VIEW `_track` AS
SELECT fl.id AS id, fl.uid, fl.plays, CONCAT(lg.dir,fl.dir) AS dir
  FROM `file` as fl
LEFT JOIN `lang` as lg
  ON lg.id = fl.lang;

SELECT * FROM `track` WHERE id = 1;
UPDATE `track` SET plays=999 WHERE id = 1;

--- DROP VIEW IF EXISTS `track`;

CREATE VIEW `_album` AS
SELECT fl.uid, SUM(fl.plays) AS play, COUNT(fl.id) AS track, SUM(fl.status) AS status, TRIM(TRAILING CONCAT('/', SUBSTRING_INDEX(fl.dir, '/', -1)) FROM fl.dir) AS dir
  FROM `file` as fl
GROUP BY fl.uid
ORDER BY play DESC;

CREATE OR REPLACE VIEW `_album` AS
SELECT fl.uid, SUM(fl.plays) AS play, COUNT(fl.id) AS track, TRIM(TRAILING CONCAT('/', SUBSTRING_INDEX(fl.dir, '/', -1)) FROM fl.dir) AS dir
  FROM `file` as fl
GROUP BY fl.uid
ORDER BY play DESC;

-- DROP VIEW IF EXISTS `_album`;

INSERT INTO `test` (id,plays) VALUES(1234,1) ON DUPLICATE KEY UPDATE id=1234, plays=plays+1
```

"3:50"
240

formalName@formalNumber, accountRegistration(uppercase), accountType(lowercase),version
Khensolo@81Ic1

direct: api/audio/3606?d1v=l1

```json
{
  host: 'localhost:8081',
  connection: 'keep-alive',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (K
HTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
  'accept-encoding': 'identity;q=1, *;q=0',
  accept: '*/*',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'no-cors',
  'sec-fetch-dest': 'video',
  referer: 'http://localhost:8081/api/audio/3606?d1v=l1',
  'accept-language': 'en-US,en;q=0.9,nb-NO;q=0.8,nb;q=0.7',
  cookie: '_ga=GA1.1.1439059404.1607746462; _gid=GA1.1.370901501.1608006104; key
ofcookie=valueofcookie-1',
  range: 'bytes=0-'
}

{
  host: 'localhost:8081',
  connection: 'keep-alive',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (K
HTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36',
  'accept-encoding': 'identity;q=1, *;q=0',
  accept: '*/*',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'no-cors',
  'sec-fetch-dest': 'audio',
  referer: 'http://localhost:8081/artist/Ciakhai',
  'accept-language': 'en-US,en;q=0.9,nb-NO;q=0.8,nb;q=0.7',
  cookie: '_ga=GA1.1.1439059404.1607746462; _gid=GA1.1.370901501.1608006104; key
ofcookie=valueofcookie-1',
  range: 'bytes=0-'
}

```
