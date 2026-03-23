if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw-installer.js').catch(function (err) {
    console.log("sw", err);
  });
  navigator.serviceWorker.register('/sw-album.js').catch(function (err) {
    console.log("sw", err);
  });
}
