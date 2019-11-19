<template>
  <div v-if="album" class="album-box--">
    <div class="disc icon-albums" :class="$.albumGenre(album).map(e=>e.toLowerCase()).join(' ')">
      <p class="genre">
        <a v-for="gr in $.albumGenre(album)" :key="gr" v-text="gr"></a>
      </p>
      <p class="year">
        <a v-for="year in album.yr" :key="year" v-text="year"></a>
      </p>
      <p class="play">
        <span class="icon-play" @click="$.playAlbum(album.ui)"></span>
      </p>
      <p class="length icon-time" v-text="$.albumDuration(album)"></p>
      <p class="total icon-headphones"  v-text="album.tp"></p>
      <p class="artist">
        <span v-for="artist in $.albumArtist(album)" :key="artist">{{artist}}</span>
      </p>
    </div>
    <div class="name">
      <p class="album">
        <router-link :to="{ path: '/album/'+album.ui}" :title="album.ab">{{album.ab}}</router-link>
      </p>
      <!-- <p class="artist">
        <span v-for="artist in $.albumArtist(album)" :key="artist">{{artist}}</span>
      </p> -->
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
    // formatTimer(e){
    //   try {
    //     return new Timer(e.map(e=>e.d)).format();
    //   } catch (error) {
    //     console.log('time error',this.album.ab);
    //   }
    // },
    // artist(e){
    //   // var o = e.map((i) => i.a );
    //   // return new Set([].concat.apply([], o));
    //   var o = [...new Set([].concat(...e.map(i => i.a)))];
    //   return o.map(
    //     i => this.$.all.artist[i]
    //   ).map(
    //     a => (this.album.lg == 2 && a.aka)?a.aka:a.name
    //   );
    // },
    // genre(e){
    //   return e.map(
    //     i=>this.$.all.genre[i].name
    //   );
    // }
  },
  computed: {
    $(){
      return this.$parent.$
    }
  }
}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<!-- <style scoped></style> -->