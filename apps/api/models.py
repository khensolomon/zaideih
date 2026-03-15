from django.db import models

class Lang(models.Model):
    id = models.IntegerField(primary_key=True, default=0)
    name = models.CharField(max_length=50)
    dir = models.TextField()

    class Meta:
        db_table = 'lang'
        managed = False # Binds to existing MySQL table

    def __str__(self):
        return self.name

class File(models.Model):
    id = models.AutoField(primary_key=True)
    uid = models.CharField(max_length=50, null=True, blank=True)
    plays = models.IntegerField(default=0)
    lang = models.ForeignKey(Lang, on_delete=models.DO_NOTHING, db_column='lang', null=True, blank=True)
    dir = models.TextField()

    class Meta:
        db_table = 'file'
        managed = False

    def __str__(self):
        return self.dir

class Visit(models.Model):
    ip = models.CharField(max_length=50, primary_key=True, default='1')
    view = models.BigIntegerField(default=1)
    locale = models.CharField(max_length=5, default='en')
    lang = models.CharField(max_length=5, default='en')
    modified = models.DateTimeField(auto_now=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'visits'
        managed = False

    def __str__(self):
        return self.ip
    
class Album(models.Model):
    id = models.AutoField(primary_key=True)
    uid = models.CharField(max_length=50, unique=True)
    folder_path = models.TextField()

    class Meta:
        db_table = 'album'

    def __str__(self):
        return self.folder_path

class Track(models.Model):
    id = models.AutoField(primary_key=True)
    album = models.ForeignKey(Album, on_delete=models.CASCADE, db_column='album_id')
    plays = models.IntegerField(default=0)
    lang = models.ForeignKey(Lang, on_delete=models.DO_NOTHING, db_column='lang', null=True, blank=True)
    mp3 = models.TextField()

    class Meta:
        db_table = 'track'

    def __str__(self):
        return self.mp3