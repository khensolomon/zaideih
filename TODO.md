# Todo

## utilities

- [x] search bar
- [ ] playlist save
- [ ] track-list - sortable
- [ ] artist-list - css
- [ ] artist-detail - genre
- [ ] artist-detail - all albums
- [ ] album-detail - css
- [ ] album-list - lang - css
- [ ] track-list - meta - inline-flex

- [ ] play all - album, artist
- [x] Shorten plays count
- [ ] volume off highlight

## bugs

- [x] reading data from both disk & cloud (server)
- [x] repair local storage (client)
- [ ] ၄း (need to replace)

## upload

- [ ] storage/media/store

## remove

- [x] uid/754: 0ab020b111a08ba693f3/id

"3:50"
240

formalName@formalNumber, accountRegistration(uppercase), accountType(lowercase),version
Khensolo@81Ic1

```js
abc(4566)
new Blob([str]).size;

function toNumber(a) {
    var sec_num = parseInt(a, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours + ':' + minutes + ':' + seconds;
}

function toTime(num) {
  // var time = "00:3:50";
  var a = num.split(":");
  return (parseInt(a[0], 10) * 60 * 60) + (parseInt(a[1], 10) * 60) + parseInt(a[2], 10)
}
```
