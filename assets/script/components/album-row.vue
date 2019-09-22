<template>
  <div class="album-row">
    <div class="left">
      <p class="play">
        <span class="icon-play" @click="$parent.playAlbum(album.ui)"></span>
      </p>
    </div>
    <div class="right">
      <h3>
        <router-link :to="{ path: '/album/'+album.ui}">{{album.ab}}</router-link>
      </h3>
      <div class="badge-tag artist-name artist icon-artist">
        <router-link v-for="artist in albumArtist(album.tk)" :to="{ path: '/artist/'+artist}" :key="artist">{{artist}}</router-link>
      </div>
      <p class="other">
        <span class="plays icon-flag">{{album.tk | sumplay}}</span>
        <router-link v-for="genre in album.gr" :to="{}" :key="genre" class="genre">{{genre}}</router-link>
        <router-link v-for="year in album.yr" :to="{}" :key="year" class="year">{{year}}</router-link>
      </p>
    </div>
  </div>
</template>
<script>
export default {
  name: 'album-row',
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
  filters:{
    sumplay: function(e){
      return e.reduce((a, b) => a + parseInt(b.p), 0);
    }
  },
  methods:{
    albumArtist: function(e){
      var o = e.map((a) => a.ar );
      return new Set([].concat.apply([], o));
    },
  },
  computed: {
  }
}
</script>