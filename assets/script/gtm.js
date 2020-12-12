
// This listener is based on David Vallejo's HTML5 video listener, thyngster.com/tracking-html5-videos-gtm/
// Edited by Julius Fedorovicius, analyticsmania.com

  // Let's wrap everything inside a function so variables are not defined as globals
(function() {
  // This is gonna our percent buckets ( 10%-90% )
  var divisor = 10;
  // We're going to save our players status on this object.
  var audios_status = {};
  // This is the funcion that is gonna handle the event sent by the player listeners
  function eventHandler(e) {
      switch (e.type) {
          // This event type is sent everytime the player updated it's current time,
          // We're using for the % of the audio played.
      case 'timeupdate':
          // Let's set the save the current player's audio time in our status object
          audios_status[e.target.id].current = Math.round(e.target.currentTime);
          // We just want to send the percent events once
          var pct = Math.floor(100 * audios_status[e.target.id].current / e.target.duration);
          for (var j in audios_status[e.target.id]._progress_markers) {
              if (pct >= j && j > audios_status[e.target.id].greatest_marker) {
                  audios_status[e.target.id].greatest_marker = j;
              }
          }
          // current bucket hasn't been already sent to GA?, let's push it to GTM
          if (audios_status[e.target.id].greatest_marker && !audios_status[e.target.id]._progress_markers[audios_status[e.target.id].greatest_marker]) {
              audios_status[e.target.id]._progress_markers[audios_status[e.target.id].greatest_marker] = true;
              dataLayer.push({
                  'event': 'audio',
                  'audioPlayerAction': 'Progress %' + audios_status[e.target.id].greatest_marker,
                  // We are using sanitizing the current audio src string, and getting just the audio name part
                  'audioTitle': decodeURIComponent(e.target.currentSrc.split('/')[e.target.currentSrc.split('/').length - 1])
              });
          }
          break;
          // This event is fired when user's click on the play button
      case 'play':
          dataLayer.push({
              'event': 'audio',
              'audioPlayerAction': 'play',
              'audioTitle': decodeURIComponent(e.target.currentSrc.split('/')[e.target.currentSrc.split('/').length - 1])
          });
          break;
          // This event is fied when user's click on the pause button
      case 'pause':
          dataLayer.push({
              'event': 'audio',
              'audioPlayerAction': 'pause',
              'audioTitle': decodeURIComponent(e.target.currentSrc.split('/')[e.target.currentSrc.split('/').length - 1]),
              'audioValue': audios_status[e.target.id].current
          });
          break;
          // If the user ends playing the audio, an Finish audio will be pushed ( This equals to % played = 100 )
      case 'ended':
          dataLayer.push({
              'event': 'audio',
              'audioPlayerAction': 'finished',
              'audioTitle': decodeURIComponent(e.target.currentSrc.split('/')[e.target.currentSrc.split('/').length - 1])
          });
          break;
      default:
          break;
      }
  }
  // We need to configure the listeners
  // Let's grab all the the "audio" objects on the current page
  var audios = document.getElementsByTagName('audio');
  for (var i = 0; i < audios.length; i++) {
      // In order to have some id to reference in our status object, we are adding an id to the audio objects
      // that don't have an id attribute.
      var audioTagId;
      if (!audios[i].getAttribute('id')) {
          // Generate a random alphanumeric string to use is as the id
          audioTagId = 'html5_audio_' + Math.random().toString(36).slice(2);
          audios[i].setAttribute('id', audioTagId);
      }// Current audio has alredy a id attribute, then let's use it ?
      else {
          audioTagId = audios[i].getAttribute('id');
      }
      // audio Status Object declaration
      audios_status[audioTagId] = {};
      // We'll save the highest percent mark played by the user in the current audio.
      audios_status[audioTagId].greatest_marker = 0;
      // Let's set the progress markers, so we can know afterwards which ones have been already sent.
      audios_status[audioTagId]._progress_markers = {};
      for (j = 0; j < 100; j++) {
          audios_status[audioTagId].progress_point = divisor * Math.floor(j / divisor);
          audios_status[audioTagId]._progress_markers[audios_status[audioTagId].progress_point] = false;
      }
      // On page DOM, all players currentTime is 0
      audios_status[audioTagId].current = 0;
      // Now we're setting the event listeners.
      audios[i].addEventListener("play", eventHandler, false);
      audios[i].addEventListener("pause", eventHandler, false);
      audios[i].addEventListener("ended", eventHandler, false);
      audios[i].addEventListener("timeupdate", eventHandler, false);
  }
})();
