<template>
  <div class="home">
    <div class="row center head">
      <h1 class="t1">Zaideih Music Station</h1>
    </div>

    <div class="row board">
      <div class="music">
        <p class="icon-track">discover thousand of <span>Music</span> in your language</p>
      </div>
      <div class="artist">
        <p class="icon-artist">find your favorite <span>Artist</span></p>
      </div>
      <div class="album">
        <p class="icon-album">In addition to get detail information about the <span>Album</span></p>
      </div>
    </div>

    <div class="row center desc">
      <p>Create your own collections, manage your <strong>Lyric</strong> and <strong>Comment</strong>, share your
        <em>PlayList</em>, works with Lyrics &amp; Chord and many more...
      </p>
    </div>

    <!-- <div v-if="all.lang.length" class="show-lang badge-tag">
    <router-link v-for="(lg,index) in all.lang" :to="{ path: '/album/'+lg.name}" :key="index">{{lg.name}}</router-link>
  </div> -->
    <!-- <div v-if="all.lang.length" class="show-lang badge-tag">
    <div v-for="(lang,index) in all.lang" :key="index">
      <h3>
        <router-link :to="{ path: '/album/'+lang.name}" :key="index">{{lang.name}} {{lang.id}}</router-link>
      </h3>
      <ol v-if="artists[lang.name].length">
        <li v-for="(a,index) in artists[lang.name]" :key="index">{{a.name}}</li>
      </ol>
    </div>
  </div> -->
    <div v-if="dataStore.all.lang.length" class="row center most">
      <div v-for="(lang, index) in dataStore.all.lang" :key="index" :class="lang.name">
        <h2>
          <router-link :to="{ path: '/album/' + lang.name }" :key="index">{{ lang.name }}</router-link>
        </h2>
        <div v-if="popularArtist[lang.id].length" class="show-lang badge-tag">
          <router-link v-for="(artist, index) in popularArtist[lang.id]" :to="{ path: '/artist/' + artist.name }"
            :key="index">{{ artist.name }}<span v-if="artist.aka">({{ artist.aka }})</span></router-link>
        </div>
      </div>
    </div>

    <div class="row lmr" style="display: none">
      <div class="left">
        <p>left</p>
      </div>
      <div class="main">
        <p>main</p>
      </div>
      <div class="right">
        <p>right</p>
      </div>
    </div>
    <div class="row bar" style="display: none">
      <div class="left">
        <p>left</p>
      </div>
      <div class="main">
        <p>main</p>
      </div>
      <div class="right">
        <p>right</p>
      </div>
    </div>
    <div class="row lar" style="display: none">
      <div class="left">
        <p>left</p>
      </div>
      <div class="right">
        <p>right</p>
      </div>
    </div>
    <div class="row dco" style="display: none">
      <div class="zola">
        <div>
          <span data-count="3586">zola</span>
          <p>Zola, Zolapi, Laipian late</p>
          <em data-title="Play">593024</em>
        </div>
      </div>
      <div class="mizo">
        <div>
          <span data-count="4555">mizo</span>
          <p>Interpret Mizo Musics</p>
          <em data-title="Play">209397</em>
        </div>
      </div>
      <div class="myanmar">
        <div>
          <span data-count="1933">myanmar</span>
          <p>Myanmar Christian Musics</p>
          <em data-title="Play">33943</em>
        </div>
      </div>
      <div class="english">
        <div>
          <span data-count="7051">english</span>
          <p>Hymns, Praise & Worship</p>
          <em data-title="Play">17944</em>
        </div>
      </div>
      <div class="chin">
        <div>
          <span data-count="26">chin</span>
          <p>Collection of tribal songs</p>
          <em data-title="Play">2231</em>
        </div>
      </div>
      <div class="collection">
        <div>
          <span data-count="41">collection</span>
          <p>the best 70s,80s,90s collection</p>
          <em data-title="Play">1403</em>
        </div>
      </div>
      <div class="falam">
        <div>
          <span data-count="91">falam</span>
          <p>Hymns, Praise & Worship</p>
          <em data-title="Play">968</em>
        </div>
      </div>
    </div>

  </div>
</template>

<script>
export default {
	name: "Home",
	data: () => ({
		// artists: {
		// 	all: [],
		// 	zola: [],
		// 	myanmar: [],
		// 	mizo: [],
		// 	falam: []
		// },
		popularArtist: {}
	}),
	inject: ["root", "dataStore", "storageStore"],
	// methods: {},
	// computed: {},
	created() {
		// console.log("home.created");
		// console.log("layout.$parent.dataStore", this.$parent.testDelete);
		// this.dataStore.increment();
		// console.log("layout.dataStore.searchAt", this.dataStore.searchAt);
		// console.log("layout.created=1", this.dataStore.count);
		// console.log("home.created=1", this.dataStore.count);
		var artists = this.dataStore.all.artist
			.filter(e => e.id > 1)
			.sort((a, b) => (a.plays < b.plays ? 1 : -1));

		// this.artists.zola = artists.filter(
		//   e=> e.lang.find(i=>i == 1)
		// ).slice(0, 10);

		// this.artists.myanmar = artists.filter(
		//   e=> e.lang.find(i=>i == 2) && !this.artists.zola.find(i=>i.id == e.id)
		// ).slice(0, 10);

		// this.artists.mizo = artists.filter(
		//   e=>e.lang.find(i=>i == 3) && !this.artists.zola.find(i=>i.id == e.id)
		// ).slice(0, 10);
		// this.artists.falam = artists.filter(
		//   e=>e.lang.find(i=>i == 4) && !this.artists.zola.find(i=>i.id == e.id)
		// ).slice(0, 10);

		// var artists = this.all.artist.filter(e=>e.id > 1).sort((a, b) => (a.plays < b.plays) ? 1 : -1);
		// artists.slice(0, 10).forEach((e)=>{
		//   var id = e.id;
		//   console.log(e)
		//   this.artist[id]
		// })

		// var most = id =>
		// 	Object.values(this.popularArtist).filter(e => e.find(i => i.id == id));

		this.dataStore.all.lang.forEach(l => {
			this.popularArtist[l.id] = artists
				.filter(
					a => a.l[0] == l.id
					// a=>a.l.find(i=>i == l.id) && most(a.id).length == 0
				)
				.slice(0, 15);
		});
	}

	// setup() {}
};

</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>