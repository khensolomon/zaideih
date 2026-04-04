# tag
ပျောက်ဆုံးဝိညာဥ်
SPI,Spi
ကြိုးကြာ
ကြုးကြာ
ကြိုးကြား

ဇမ်နူး
ဇမ်းနူး

ဦးညွန့်လှ
ဦးညွန့်လှ

ဝတ်ရည်ကျော်
ဝတ်ရည်ကျော်ကျော်

ဖြူဖြူကျောသိန်း
ဖြူဖြူကျော်သိန်း

ဖြူနှင်းပွင့်သွေး
ဖြူနှင်းပွင့်သွေး

ဖြူနှင်းပွင့်သွေး

ဘရိတ်ကိ
ဘရိတ်ကီ

ပိုးဒါလီသိန်း
ပိုးဒါလီသိန်းတန်

ဒါးပီး
ဒါးလ်ပီး

ဇိုးရေဗက္ကာ
ရေဗက္ကာဝင်း

ဖူးဖူးညွန့်တင်
ဖူးဖူးညွှန့်တင်

နန့်ခနုတ်ဖောင်
နန့်ခနုတ်ဖေါင်

ဒီလုံး
ဒိုးလုံး

ဆရာဦးညွှန့်လှ
ဆရာဦးညွှန့်လှ

ဆရာဦးညွှန့်လှ

ဝီလျံ
ဝီလျံ(မ်)

ကြုးကြာ
ကြုးကြာ
ကြိုးကြာ

ဂျုးဂျုး
ဂျူးဂျူး
ဂျူးဂျူး Lun
ဂျူးဂျူးLun

M.V. Pauno
MV Pauno
MV. Pauno

J.K. Kam
JK. Kam

Zamdal
Zam Dal

magdalene
Magdalene
...

- MYANMAR - mya
- ZOLA - zoa
- MIZO -miz
- FALAM - fam
- ENGLISH - eng

TL. Zamnu
TL. Zam

သောမတ်(စ်)မြသွင်
သောမတ်(စ်) မြသွင်

ဆရာဦးညွှန့်လှ
ဦးညွန့်လှ

ပေါညိုအောင်
ပေါလ်ညိုအောင်

ကိုင်ဇာတင်မုံ
Kai Zai Tin Moong

N. ကိုင်ရာ
N.ကိုင်ရာ

ဗန်းသောဒ့်ကျင်း
ဗန်းသော့ကျင်း

ကျွနု်က်ရဲ့ရှင်ဘုရင်
ကျွန်ုပ်ရဲ့ရှင်ဘုရင်

ကိုယ်တာ်ရဲ့ရှေ့တော်
ကိုယ်တော်ရဲ့ရှေ့တော်

ပျောက်ဆုံးဝိညာဥ်
ပျောက်ဆုံးဝိညာဉ်
ဥ်
ဉ်

ဥ္
ဉ်

ဥ
ဉ

ဥ္မီး
ဉ်မီး


```sql
SELECT * FROM zd_track WHERE ARTIST LIKE '%magdalene%';
SELECT * FROM zd_track WHERE ARTIST LIKE '%ဦးညွန့်လှ%';
SELECT * FROM zd_track WHERE ARTIST LIKE '%ဆရာဦးညွှန့်လှ%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဇမ်းနူး', 'ဇမ်နူး') WHERE ARTIST LIKE '%ဇမ်းနူး%';
SELECT * FROM zd_track WHERE ARTIST LIKE '%ဇမ်နူး%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဂျုးဂျုး', 'ဂျူးဂျူး') WHERE ARTIST LIKE '%ဂျုးဂျုး%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဂျူးဂျူးLun', 'ဂျူးဂျူး') WHERE ARTIST LIKE '%ဂျူးဂျူးLun%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဂျူးဂျူး Lun', 'ဂျူးဂျူး') WHERE ARTIST LIKE '%ဂျူးဂျူး Lun%';
SELECT * FROM zd_track WHERE ARTIST LIKE '%ဂျူးဂျူး%';


UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ချောစုခင်', 'ချော်စုခင်') WHERE ARTIST LIKE '%ချောစုခင်%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ကြုးကြာ', 'ကြိုးကြာ') WHERE ARTIST LIKE '%ကြုးကြာ%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဆရာဦးညွှန့်လှ', 'ဆရာဦးညွှန့်လှ') WHERE ARTIST LIKE '%ဆရာဦးညွှန့်လှ%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဦးညွန့်လှ', 'ဆရာဦးညွှန့်လှ') WHERE ARTIST LIKE '%ဦးညွန့်လှ%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဆရာဦးညွှန့်လှ', 'ဦးညွှန့်လှ') WHERE ARTIST LIKE '%ဆရာဦးညွှန့်လှ%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဦး', 'ဦး') WHERE ARTIST LIKE '%ဦး%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'L.လွန်းဝါ', 'L. လွန်းဝါ') WHERE ARTIST LIKE '%L.လွန်းဝါ%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'ဆိုင်းဇီ', 'L.ဆိုင်းဇီ') WHERE ARTIST LIKE 'ဆိုင်းဇီ%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'L.ဆိုင်းဇီ', 'L. ဆိုင်းဇီ') WHERE ARTIST LIKE '%L.ဆိုင်းဇီ%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'J.K. စံ', 'JK. စံ') WHERE ARTIST LIKE '%J.K. စံ%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'J.K.စံ', 'JK. စံ') WHERE ARTIST LIKE '%J.K.စံ%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'J.K. Sang', 'JK. Sang') WHERE ARTIST LIKE '%J.K. Sang%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.S. Khaipi', 'TS. Khaipi') WHERE ARTIST LIKE '%T.S. Khaipi%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.S. Khai', 'TS. Khai') WHERE ARTIST LIKE '%T.S. Khai%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'C.K. Khai', 'CK. Khai') WHERE ARTIST LIKE '%C.K. Khai%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'C.S. Khai', 'CS. Khai') WHERE ARTIST LIKE '%C.S. Khai%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'G.L. Khai', 'GL. Khai') WHERE ARTIST LIKE '%G.L. Khai%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.T. Lianno', 'TT. Lianno') WHERE ARTIST LIKE '%T.T. Lianno%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'L.L. Paupi', 'LL. Paupi') WHERE ARTIST LIKE '%L.L. Paupi%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.T. Thangpi', 'TT. Thangpi') WHERE ARTIST LIKE '%T.T. Thangpi%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'V.C. Mang', 'VC. Mang') WHERE ARTIST LIKE '%V.C. Mang%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.S. Mang', 'TS. Mang') WHERE ARTIST LIKE '%T.S. Mang%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.L. Tuang', 'TL. Tuang') WHERE ARTIST LIKE '%T.L. Tuang%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.L.Tuang', 'TL. Tuang') WHERE ARTIST LIKE '%T.L.Tuang%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'G.L. Kap', 'GL. Kap') WHERE ARTIST LIKE '%G.L. Kap%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'S.M Mangno', 'SM. Mangno') WHERE ARTIST LIKE '%S.M Mangno%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.L. Mungbawi', 'TL. Mungbawi') WHERE ARTIST LIKE '%T.L. Mungbawi%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'D.K. Mungpi', 'DK. Mungpi') WHERE ARTIST LIKE '%D.K. Mungpi%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.L. Zam', 'TL. Zam') WHERE ARTIST LIKE '%T.L. Zam%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.Mung', 'T. Mung') WHERE ARTIST LIKE '%T.Mung%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.S. Pau', 'TS. Pau') WHERE ARTIST LIKE '%T.S. Pau%';
UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'T.T. Luai', 'TT. Luai') WHERE ARTIST LIKE '%T.T. Luai%';

UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'Cia Khai', 'Ciakhai') WHERE ARTIST LIKE '%Cia Khai%';


UPDATE zd_track SET ARTIST = REPLACE(ARTIST, 'Zamdal', 'Zam Dal') WHERE ARTIST LIKE '%Zamdal%';

```
