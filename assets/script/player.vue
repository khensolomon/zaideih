<template>
  <div class="player-controls">
    <div class="meta">
      <div class="info">
        <p class="title icon-music">{{ track.t || '...' }}</p>
        <p v-if="track.a" class="artist icon-artist">
          <router-link v-for="artist in artistName()" :to="{ path: '/artist/' + artist }" :key="artist">{{ artist
            }}</router-link>
        </p>
        <p v-if="track.b" class="album icon-cd">
          <router-link :to="{ path: '/album/' + track.b }">{{ track.b }}</router-link>
        </p>
      </div>
    </div>
    <div class="controls">
      <div class="progress">
        <audio ref="audio" @timeupdate="timeupdate" @loadeddata="loadeddata" @progress="progress" @loadstart="loadstart"
          @loadedmetadata="loadedmetadata" @canplaythrough="canplaythrough" @canplay="canplay" @play="eventPlay"
          @pause="eventPause" @ended="eventEnded" :loop="isLoop" :src="src" type="audio/mpeg" controls hidden>
        </audio>
        <!-- <div class="time start">{{ current | timeFormat }}</div> -->
        <div class="time start">{{ timeOfCurrent }}</div>
        <div class="seek">
          <!-- v-if="hover>0"  -->
          <span class="tooltip" :style="{ left: hoverLeft + 'px' }">{{ timeOfHover }}</span>
          <div>
            <div :style="{ width: percentSeeker + '%' }" class="seeker"></div>
            <div :style="{ width: percentProgress + '%' }" class="progress"></div>
            <input v-model="percentSeeker" @focus="eventSeekFocus" @mousemove="eventSeekOver" @change="eventSeek"
              type="range" step="0.00000001" min="0" max="100" />
          </div>
        </div>
        <div class="time end">{{ timeOfDuration }}</div>
      </div>
      <ul>
        <li class="icon-loop toggle" @click="loop()" :class="{ active: isLoop }"></li>
        <li class="icon-play-previous" @click="previous()"></li>
        <li @click="play()"
          :class="[loading ? 'icon-loading animate-spin' : playing ? 'icon-pause' : 'icon-play', 'round']">
        </li>
        <!-- <li @click="play()" :class="[playing? 'icon-pause' : loading?'icon-loading animate-spin':'icon-play','round']"></li> -->
        <!-- <li @click="play()" :class="[playing? 'icon-pause' : 'icon-play','round']"></li> -->
        <li class="icon-play-next" @click="next()"></li>
        <!-- <li class="icon-shuffle toggle" @click="shuffle()" :class="{active:isShuffle}"></li> -->
        <li class="queue">
          <router-link :to="{ path: '/queue' }" class="icon-list-bullet" title="Queue"
            :data-count="dataStore.totalQueue"></router-link>
          <!-- <router-link :to="{ path: '/queue'}" class="icon-list-bullet" title="Queue" :data-count="totalQueue"></router-link> -->
        </li>
      </ul>
    </div>
    <div class="options">
      <ul>
        <li>
          <div class="volume">
            <span v-if="volume > 0.9" v-on:click="mute" class="icon-volume-up"></span>
            <span v-else-if="volume == 0" v-on:click="mute" class="muted icon-volume-off"></span>
            <span v-else v-on:click="mute" class="icon-volume-down"></span>
            <!-- <span v-on:click="mute" title="Mute" class="icon-volume-up" >Mute</span> -->
            <!-- <input v-model.lazy.number="volume" type="range" min="0" max="100"/> -->
            <input v-model="volume" type="range" step="0.0001" min="0.0" max="1.0" />
          </div>
        </li>
        <!-- <li>
        <router-link :to="{ path: '/queue'}" class="icon-music">
          Queue <span class="queue" v-text="totalQueue"></span>
        </router-link>
      </li> -->
      </ul>
    </div>
  </div>
</template>

<script>
export default {
  name: "Player",
  data: () => ({
    current: 0,
    duration: 0,
    isLoop: false,
    preload: "auto",
    loading: false,
    autoplay: true,
    isShuffle: false,
    // loaded: false,
    playing: false,
    track: {
      i: null
    },
    hover: 0,
    hoverLeft: -13,
    volume: 0.4,
    volumePrevious: 0.3,
    percentProgress: 0,
    percentSeeker: 0
  }),

  inject: ["root", "dataStore", "storageStore"],

  watch: {
    volume(value) {
      this.audio.volume = value;
      // this.volumePrevious = value;
    },
    playing(value) {
      this.dataStore.playing = value;
    }
  },
  methods: {
    timeupdate() {
      this.current = this.audio.currentTime;
      this.percentSeeker = (this.audio.currentTime / this.audio.duration) * 100;
    },
    loadeddata() {
      if (this.audio.readyState >= 2) {
        this.duration = this.audio.duration;
        document.title = this.track.t + " - " + this.artistName().join(", ");
      }
    },
    artistName() {
      return this.root.artistName(this.track);
    },
    progress() {
      var ranges = [];
      for (var i = 0; i < this.audio.buffered.length; i++) {
        ranges.push([this.audio.buffered.start(i), this.audio.buffered.end(i)]);
      }
      for (var i = 0; i < this.audio.buffered.length; i++) {
        this.percentProgress = Math.round(
          (100 / this.audio.duration) * (ranges[i][1] - ranges[i][0])
        );
      }
    },
    loadstart() {
      this.loading = true;
    },
    loadedmetadata() { },
    canplaythrough() { },
    canplay() {
      this.loading = false;
    },
    eventPlay() {
      this.playing = true;
    },
    eventPause() {
      this.playing = false;
    },
    eventEnded() {
      if (this.isLoop) {
        this.play();
      } else {
        this.next();
      }
    },
    eventSeek(e) {
      if (this.audio.duration) {
        var seekto = this.audio.duration * (e.target.value / 100);
        this.audio.currentTime = seekto;
        this.audio.play();
      }
      e.target.blur();
    },
    eventSeekFocus(e) {
      this.audio.pause();
      if (this.audio.duration) {
        var seekto = this.audio.duration * (e.target.value / 100);
        this.audio.currentTime = seekto;
      }
    },
    eventSeekOver(e) {
      if (this.audio.duration) {
        let el = e.target.getBoundingClientRect();
        let seekClient = e.clientX - el.left;
        let seekMax = el.width;
        let seekPos = seekClient / seekMax;
        if (seekClient > 0 && seekClient < seekMax) {
          this.hover = this.audio.duration * seekPos;
          this.hoverLeft = seekClient - 18;
        }
      }
    },
    play() {
      if (this.audio.src) {
        if (this.audio.paused) {
          this.audio.play();
        } else {
          this.audio.pause();
        }
      } else {
        this.dataStore
          .randamQueue()
          .then(e =>
            this.root.setQueue(e.i).then(() => (this.audio.autoplay = true))
          );
      }
    },
    pause() {
      this.audio.pause();
    },
    next() {
      this.root.nextQueue();
    },
    previous() {
      this.root.previousQueue();
    },
    loop() {
      this.isLoop = !this.isLoop;
      this.audio.loop = this.isLoop;
    },
    shuffle() {
      this.isShuffle = !this.isShuffle;
    },
    stop() {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.track = {};
    },
    mute() {
      if (this.audio.volume == 0) {
        this.audio.volume = this.volumePrevious;
      } else {
        this.volumePrevious = this.volume;
        this.audio.volume = 0;
      }
      this.volume = this.audio.volume;
    },
    addTrack(e) {
      this.track = e;
    }
  },
  computed: {
    audio() {
      return this.$refs.audio;
    },
    src() {
      // if (this.track){
      //   if (isNaN(this.track.id)){
      //     return this.track.id;
      //   }
      //   return this.dataStore.api.audio.replace('*',this.track.id);
      // }
      // return null;
      /*
      if (!this.id){
        return null;
      } else if (isNaN(this.id)){
        return this.dataStore.api.audio.replace('*',this.id);
      }
      return this.dataStore.api.audio_test.replace('*',this.id);
      */
      // @ts-ignore
      if (this.id) return this.dataStore.api.audio.replace("*", this.id);
    },

    id() {
      return this.track.i;
    },
    // {{ current | timeFormat }}
    timeOfCurrent() {
      return this.dataStore.timeFormat(this.current);
    },
    // {{ hover | timeFormat }}
    timeOfHover() {
      return this.dataStore.timeFormat(this.hover);
    },
    // {{ duration | timeFormat }}
    timeOfDuration() {
      return this.dataStore.timeFormat(this.duration);
    }
  }
  // filters: {
  // 	timeFormat(e) {
  // 		if (!e) return "00:00";
  // 		let hhmmss = new Date(e * 1000).toISOString().substr(11, 8);
  // 		return hhmmss.indexOf("00:") === 0 ? hhmmss.substr(3) : hhmmss;
  // 	}
  // }
  // created() {}
};

</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>