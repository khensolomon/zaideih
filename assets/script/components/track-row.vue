<template>
  <!-- <div :class="{active:$parent.queueId == track.id}">
    <div class="option">
      <span class="play" @click="$parent.playTrack(track)" :class="[$parent.queueId == track.id && $parent.playing? 'icon-pause':'icon-play']"></span>
      <span class="plays icon-flag" v-text="track.p"></span>
    </div>
    <div class="info">
      <a class="title">{{track.tl}}</a> -
      <router-link v-for="(artist,index) in track.ar" :to="{ path: '/artist/'+artist}" :key="index" class="artist">{{artist}}</router-link>
    </div>
    <div class="length">
      <span v-text="track.l"></span>
    </div>
  </div> -->
  <div v-if="track" :class="{active:queueId == track.id}">
    <div class="begin">
      <span class="play" @click="$parent.playTrack(track)" :class="[queueId == track.id && playing? 'icon-pause':'icon-play']"></span>
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
    // title: String,
    // likes: Number,
    // isPublished: Boolean,
    // commentIds: Array,
    // author: Object,
    // callback: Function,
    // contactsPromise: Promise // or any other constructor
  },

  computed: {
    queueId(){
      return this.$parent.$parent.queueId;
    },
    playing(){
      return this.$parent.$parent.playing;
    },
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped></style>