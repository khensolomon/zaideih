export default {
  name: 'Player',
  // props: ['track'],
  // props: {
  //   track: {
  //     type: Object,
  //     default() {
  //       return {}
  //     }
  //   }
  // },
  data: () => ({
		current: 0,
    duration: 0,
		isLoop: false,
		isShuffle: false,
		// loaded: false,
		playing: false,
    track:{},
    hover:0,
    hoverLeft:-13,
		volume: 70,
		// volumePrevious: 35,
		seek: 0
	}),
  watch: {
		volume(value) {
      this.player.volume = value / 100;
		},
		playing(value) {
      this.$parent.playing = value;
		}
	},
  methods: {
    eventUpdate() {
      this.current = this.player.currentTime;
      this.seek = this.player.currentTime / this.player.duration * 100;
    },
    eventLoad() {
			if (this.player.readyState >= 2) {
				this.duration = this.player.duration;
			}
		},
    eventPlay() {
			this.playing = true
		},
    eventPause() {
			this.playing = false;
		},
    eventEnded() {
			if (this.isLoop){
        this.play();
      } else {
        this.next();
      }
		},
    eventSeek(e) {
      if (this.player.duration){
        var seekto = this.player.duration * (e.target.value / 100);
        this.player.currentTime = seekto;
        this.player.play();
      } else {
        // this.seek = 0;
      }
      e.target.blur();
		},
    eventSeekFocus(e) {
      this.player.pause();
      if (this.player.duration){
        var seekto = this.player.duration * (e.target.value / 100);
        this.player.currentTime = seekto;
      }
		},
    eventSeekOver(e) {
      if (this.player.duration){
        const el = e.target.getBoundingClientRect();
        const seekClient = (e.clientX - el.left);
        const seekMax = el.width;
        const seekPos = seekClient / seekMax
        if (seekClient > 0 && seekClient < seekMax ){
          this.hover = this.player.duration * seekPos;
          this.hoverLeft=seekClient-18;
        }
      }
      // console.log('over');
		},
    eventSeekOut() {
      // this.hover=0;
      // console.log('out');
		},
    filterSRC(e) {
      var abc = 'http://zaideih.com/api/audio/play/*'.replace('*',e);
      return isNaN(e)?e:abc;
		},
    play(){
      if (Object.keys(this.track).length){
        if (this.player.paused) {
          this.player.play();
        } else {
          this.player.pause();
        }
      } else {
        this.$parent.play(0);
      }
    },
    pause(){
      this.player.pause();
    },
    next(){
      this.$parent.next();
    },
    previous(){
      this.$parent.previous();
    },
    loop(){
      this.isLoop = !this.isLoop;
      this.player.loop = this.isLoop;
    },
    shuffle(){
      this.isShuffle= !this.isShuffle;
    },
    stop(){
			this.player.pause();
			this.player.currentTime = 0;
    },
    mute() {
      if (this.player.volume == 0){
        this.player.volume = 1;
      } else {
        this.player.volume = 0;
      }
      this.volume = this.player.volume* 100;
		}
  },
  computed: {
    player(){
      return this.$refs.audio;
    },
    // track: {
    //   get : function() { return this.track; },
    //   set : function(name) { this.track = name; }
    // },
    percentComplete() {
			return this.current / this.duration * 100;
    },
    queueTotal() {
			return this.$parent.queue.length;
    }
  },
  filters:{
    timeFormat: function(e){
      let hhmmss = new Date(e * 1000).toISOString().substr(11, 8);
      return hhmmss.indexOf("00:") === 0 ? hhmmss.substr(3) : hhmmss;
    }
  },
  mounted () {
    // this.player.addEventListener('timeupdate', this.eventUpdate);
		// this.player.addEventListener('loadeddata', this.eventLoad);
		// this.player.addEventListener('pause', this.eventPause);
    // this.player.addEventListener('play', this.eventPlay);
    // this.player.addEventListener('ended', this.eventEnded);
  }
}