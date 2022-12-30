<template>
  <div v-if="track" :class="[playerId == track.i? 'active':root.isQueued(track.i)?'queued':null]" @click="play">
    <div class="at art">
      <span class="play track" :class="[playerId == track.i && playing? 'icon-pause':'icon-play']"></span>
    </div>
    <div class="begin">
      <span class="trk"></span>
      <span class="count icon-headphones" v-text="track.p > 0 ? dataStore.digitShortenTesting(track.p):''"></span>
    </div>
    <div class="meta">
      <p class="title"><a>{{track.t}}</a></p>
      <p class="artist"><router-link v-for="(artist,index) in root.artistName(track)" :to="{ path: '/artist/'+artist}" :key="index">{{artist}}</router-link></p>
    </div>
    <div class="end">
      <!-- <span v-text="track.d"></span> -->
      <span v-text="dataStore.trackDuration(track.d)"></span>
    </div>
    <div class="at mre">
      <span class="icon-info"></span>
    </div>
  </div>
</template>
<script>
export default {
  name: 'track-row',
  props: {
    track: Object,
    queued: Boolean,
    // title: String,
    // likes: Number,
    // isPublished: Boolean,
    // commentIds: Array,
    // author: Object,
    // callback: Function,
    // contactsPromise: Promise // or any other constructor
  },
  inject: ["root", "dataStore", "storageStore"],
  methods: {
    play(event){
      if (event.target.nodeName != 'A'){
        if (this.queued){
          if (this.playerId != this.track.i) this.root.player.stop();
          this.root.playNow(this.track.i);
        } else {
          this.root.addQueue(this.track).then(
            isQueued => {
              if (isQueued || this.playing == false) {
                this.root.playNow(this.track.i);
              }
            }
          );
        }
      }
    }
  },
  computed: {

    playerId(){
      return this.root.playerId;
    },
    playing(){
      return this.dataStore.playing;
    }
  }
}
</script>