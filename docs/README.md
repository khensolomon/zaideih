# ?

```bash
source venv/bin/activate
python manage.py runserver

python manage.py scan_library --src korea/collection
python manage.py scan_library --src zola/Lengtong/Ka.Zua.Ngaih
python manage.py scan_library --src zola/Lengtong/Laizom.Meelma
# /mnt/keep/storage/music/zola/Lengtong/Laizom.Meelma

# Local Scan:
python manage.py scan_library --src zola/Lengtong
# Cloud Scan:
python manage.py scan_library --src zola/Lengtong --cloud

python manage.py compile_catalog --lang zola
python manage.py compile_catalog --lang zola falam
python manage.py compile_catalog --lang all --minify

python manage.py migrate_plays
python manage.py migrate_buckets
```

SQL

```sql
DROP TABLE file;

-- _album
select `fl`.`uid` AS `uid`,sum(`fl`.`plays`) AS `play`,count(`fl`.`id`) AS `track`,trim(trailing concat('/',substring_index(`fl`.`dir`,'/',-1)) from `fl`.`dir`) AS `dir` from `file` `fl` group by `fl`.`uid` order by sum(`fl`.`plays`) desc

-- _track
select `fl`.`id` AS `id`,`fl`.`uid` AS `uid`,`fl`.`plays` AS `plays`,concat(`lg`.`dir`,`fl`.`dir`) AS `dir` from (`file` `fl` left join `lang` `lg` on(`lg`.`id` = `fl`.`lang`))
