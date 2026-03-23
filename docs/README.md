# ?

Would you be so kind to add docstring of description, features, complete usage for future reference?

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

python manage.py sync_library --download zola/Lengtong/Ka.Zua.Ngaih
python manage.py sync_library --upload zola/Lengtong/Ka.Zua.Ngaih


python manage.py check --artist "Lengtong Pauno"
python manage.py check --artist 171
python manage.py check --track "ခွဲခွာခြင်း"
python manage.py check --track "Damlai Nite"
python manage.py check --album "Ka Zua Ngaih"

```

VENV

```bash
python -m venv venv
source venv/bin/activate

pip install -r requirements.txt
pip install -r requirements-dev.txt
```

Find and Replace

```js
// For Lighten:
lighten\(([^,]+),\s*(\d+)%?\)
color.adjust($1, $lightness: $2%)

// For Darken:

darken\(([^,]+),\s*(\d+)%?\)
color.adjust($1, $lightness: -$2%)


```

SQL

```sql
DROP TABLE file;

-- _album
select `fl`.`uid` AS `uid`,sum(`fl`.`plays`) AS `play`,count(`fl`.`id`) AS `track`,trim(trailing concat('/',substring_index(`fl`.`dir`,'/',-1)) from `fl`.`dir`) AS `dir` from `file` `fl` group by `fl`.`uid` order by sum(`fl`.`plays`) desc

-- _track
select `fl`.`id` AS `id`,`fl`.`uid` AS `uid`,`fl`.`plays` AS `plays`,concat(`lg`.`dir`,`fl`.`dir`) AS `dir` from (`file` `fl` left join `lang` `lg` on(`lg`.`id` = `fl`.`lang`))
