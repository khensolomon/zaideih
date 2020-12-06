<template>
  <div v-if="track" :class="[queueId == track.i? 'active':$.isQueued(track.i)?'queued':null]" @click="play">
    <div class="at art">
      <span class="play track" :class="[queueId == track.i && playing? 'icon-pause':'icon-play']"></span>
    </div>
    <div class="begin">
      <span class="trk"></span>
      <span class="count icon-headphones" v-text="$.digitShortenTesting(track.p)"></span>
    </div>
    <div class="meta">
      <p class="title"><a>{{track.t}}</a></p>
      <p class="artist"><router-link v-for="(artist,index) in $.artistName(track)" :to="{ path: '/artist/'+artist}" :key="index">{{artist}}</router-link></p>
    </div>
    <div class="end">
      <span v-text="track.d"></span>
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
  methods: {
    play(){
      if (event.target.nodeName != 'A'){
        if (this.queued){
          if (this.queueId != this.track.i) this.$.player.stop();
          this.$.playNow(this.track.i);
        } else {
          this.$.addQueue(this.track).then(
            isQueued => {
              if (isQueued || this.playing == false) {
                this.$.playNow(this.track.i);
              }
            }
          );
        }
      }
    }
  },
  computed: {
    $(){
      return this.$parent.$parent;
    },
    // audio(){
    //   return this.$.track(this.track);
    // },
    queueId(){
      return this.$.queueId;
    },
    playing(){
      return this.$.playing;
    }
  }
}
</script>