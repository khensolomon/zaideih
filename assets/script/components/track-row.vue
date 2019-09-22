<template>
  <div v-if="track" :class="[trackId == track.id? 'active':zaideih.isQueued(track.id)?'queued':null]" @click="play(track)">
    <div class="begin">
      <span class="play" :class="[trackId == track.id && playing? 'icon-pause':'icon-play']"></span>
      <span class="count icon-flag" v-text="track.p"></span>
    </div>
    <div class="meta">
      <p class="title"><a>{{track.tl}}</a></p>
      <p class="artist"><router-link v-for="(artist,index) in track.ar" :to="{ path: '/artist/'+artist}" :key="index">{{artist}}</router-link></p>
    </div>
    <div class="end">
      <span v-text="track.l"></span>
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
  methods: {
    play(track){
      if (this.queued){
        this.zaideih.playNow(track.id);
      } else {
        this.zaideih.addQueue(track).then(
          (isQueued) => {
            if (isQueued || this.playing == false) {
              this.zaideih.playNow(track.id);
            }
          }
        );
      }
    }
  },
  computed: {
    zaideih(){
      return this.$parent.$parent;
    },
    trackId(){
      return this.zaideih.queueId;
    },
    playing(){
      return this.zaideih.playing;
    }
  },
  ready(){
    return this.zaideih.playing;
  }
}
</script>