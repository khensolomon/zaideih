<template>
  <div v-if="album" class="album-box--">
    <div class="disc icon-albums" :class="album.gr.join(' ')">
      <p class="genre">
        <a v-for="genre in album.gr" :key="genre" v-text="genre"></a>
      </p>
      <p class="year">
        <a v-for="year in album.yr" :key="year" v-text="year">2001</a>
      </p>
      <p class="play">
        <span class="icon-play" @click="$parent.playAlbum(album.ui)"></span>
      </p>
      <p class="length icon-time" v-text="formatTimer(album.tk)"></p>
      <p class="total icon-flag"  v-text="album.tp"></p>
      <p class="artist">
        <span v-for="artist in albumArtist(album.tk)" :key="artist">{{artist}}</span>
      </p>
    </div>
    <div class="name">
      <p class="album">
        <!-- <a v-text="album.ab" :title="album.ab"></a> -->
        <router-link :to="{ path: '/album/'+album.ui}" :title="album.ab">{{album.ab}}</router-link>
      </p>
      <p class="artist">
        <!-- <span v-for="artist in albumArtist(album.tk)" :key="artist">{{artist}}</span> -->
        <!-- <a v-for="artist in album.ar" v-text="artist"></a> -->
        <!-- <a v-for="artist in album.ar" v-text="artist"></a> -->
      </p>
    </div>
  </div>
</template>

<script>
import Timer from '../timer';
export default {
  name: 'album-raw',
  // props: ['name'],
  props: {
    album: Object,
    // title: String,
    // likes: Number,
    // isPublished: Boolean,
    // commentIds: Array,
    // author: Object,
    // callback: Function,
    // contactsPromise: Promise // or any other constructor
  },
  methods: {
    formatTimer(e){
      return new Timer(e.map(e=>e.l)).format();
    },
    albumArtist: function(e){
      var o = e.map((a) => a.ar );
      return new Set([].concat.apply([], o));
    },
  },
  computed: {
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped></style>