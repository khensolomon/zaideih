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
      this.audio.volume = value / 100;
		},
		playing(value) {
      this.$parent.playing = value;
		}
	},
  methods: {
    timeupdate() {
      this.current = this.audio.currentTime;
      this.seek = this.audio.currentTime / this.audio.duration * 100;
    },
    loadeddata() {
			if (this.audio.readyState >= 2) {
				this.duration = this.audio.duration;
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
      if (this.audio.duration){
        var seekto = this.audio.duration * (e.target.value / 100);
        this.audio.currentTime = seekto;
        this.audio.play();
      } else {
        // this.seek = 0;
      }
      e.target.blur();
		},
    eventSeekFocus(e) {
      this.audio.pause();
      if (this.audio.duration){
        var seekto = this.audio.duration * (e.target.value / 100);
        this.audio.currentTime = seekto;
      }
		},
    eventSeekOver(e) {
      if (this.audio.duration){
        const el = e.target.getBoundingClientRect();
        const seekClient = (e.clientX - el.left);
        const seekMax = el.width;
        const seekPos = seekClient / seekMax
        if (seekClient > 0 && seekClient < seekMax ){
          this.hover = this.audio.duration * seekPos;
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
      var demo = 'http://zaideih.com/api/audio/play/*'.replace('*',e);
      return isNaN(e)?e:demo;
		},
    play(){
      if (this.audio.src){
        console.log('yes',this.audio.src);
        if (this.audio.paused) {
          this.audio.play();
        } else {
          this.audio.pause();
        }
      } else {
        this.$parent.play(0);
        this.audio.play();
        console.log('no',this.audio.src);
      }
      // if (Object.keys(this.track).length){
      //   if (this.audio.paused) {
      //     this.audio.play();
      //   } else {
      //     this.audio.pause();
      //   }
      // } else {
      //   this.$parent.play(0);
      // }

      // var audio = this.audio;
      // audio.src = this.$parent.queue[0].id;
      // audio.preload = "auto";
      // audio.loop = this.isLoop;
      // // audio.load();
      // audio.play();
      /*
      var length = audio.duration;
      var current_time = audio.currentTime;
      console.log(length,current_time)
      audio.addEventListener('timeupdate', ()=>{
        // var length = audio.duration;
        // var current_time = audio.currentTime;
        // console.log(length,current_time)
        // this.$parent.testPlayerEvent.push('timeupdate');
      }, false);
      audio.addEventListener('progress', ()=>{
        this.$parent.testPlayerEvent.push('progress');
      }, false);
      audio.addEventListener('canplaythrough', ()=>{
        // console.log('canplaythrough')
        this.$parent.testPlayerEvent.push('canplaythrough');
      }, false);
      audio.addEventListener('loadstart', ()=>{
        // console.log('loadstart')
        this.$parent.testPlayerEvent.push('loadstart');
      }, false);
      audio.addEventListener('durationchange',()=>{
        // console.log('durationchange')
        this.$parent.testPlayerEvent.push('durationchange');
      }, false);
      audio.addEventListener('loadedmetadata', ()=>{
        // console.log('loadedmetadata')
        this.$parent.testPlayerEvent.push('loadedmetadata');
      }, false);
      audio.addEventListener('loadeddata', ()=>{
        // console.log('loadeddata')
        this.$parent.testPlayerEvent.push('loadeddata');
      }, false);
      audio.addEventListener('canplay', ()=>{
        // console.log('canplay')
        this.$parent.testPlayerEvent.push('canplay');
      }, false);
      audio.addEventListener('seeking', function(e) {
        // console.log(e,audio.buffered.length);
        this.$parent.testPlayerEvent.push(e);
      });
      */

    },
    pause(){
      this.audio.pause();
    },
    next(){
      this.$parent.next();
    },
    previous(){
      this.$parent.previous();
    },
    loop(){
      this.isLoop = !this.isLoop;
      this.audio.loop = this.isLoop;
    },
    shuffle(){
      this.isShuffle= !this.isShuffle;
    },
    stop(){
			this.audio.pause();
			this.audio.currentTime = 0;
    },
    mute() {
      if (this.audio.volume == 0){
        this.audio.volume = 1;
      } else {
        this.audio.volume = 0;
      }
      this.volume = this.audio.volume* 100;
		}
  },
  computed: {
    audio(){
      // return this.$refs.audio;
      // return new Audio(this.track.id);
      var audio = new Audio();
      // audio.src = this.$parent.queue[0].id;
      if (Object.keys(this.track).length) audio.src = this.filterSRC(this.track.id);
      // audio.src = this.filterSRC(this.track.id);
      audio.preload = "auto";
      audio.loop = this.isLoop;
      return audio;
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
    // this.audio.addEventListener('timeupdate', this.timeupdate);
		// this.audio.addEventListener('loadeddata', this.loadeddata);
		// this.audio.addEventListener('pause', this.eventPause);
    // this.audio.addEventListener('play', this.eventPlay);
    // this.audio.addEventListener('ended', this.eventEnded);
    /*
    <audio ref="audio"
    @timeupdate="timeupdate"
    @loadeddata="loadeddata"
    @play="eventPlay"
    @pause="eventPause"
    @ended="eventEnded"
    :loop="isLoop"
    :src="filterSRC(track.id)"
    type="audio/mp3"
    preload="auto" autoplay hidden></audio>
    */
    this.audio.addEventListener('timeupdate', this.timeupdate);
    this.audio.addEventListener('loadeddata', this.loadeddata);
    this.audio.addEventListener('play', this.eventPlay);
    this.audio.addEventListener('pause', this.eventPause);
    this.audio.addEventListener('ended', this.eventEnded);
    // this.audio.addEventListener('progress', ()=>{
    //   this.$parent.testPlayerEvent.push('progress');
    // }, false);
    // this.audio.addEventListener('canplaythrough', ()=>{
    //   // console.log('canplaythrough')
    //   this.$parent.testPlayerEvent.push('canplaythrough');
    // }, false);
    // this.audio.addEventListener('loadstart', ()=>{
    //   // console.log('loadstart')
    //   this.$parent.testPlayerEvent.push('loadstart');
    // }, false);
    // this.audio.addEventListener('durationchange',()=>{
    //   // console.log('durationchange')
    //   this.$parent.testPlayerEvent.push('durationchange');
    // }, false);
    // this.audio.addEventListener('loadedmetadata', ()=>{
    //   // console.log('loadedmetadata')
    //   this.$parent.testPlayerEvent.push('loadedmetadata');
    // }, false);
    // this.audio.addEventListener('canplay', ()=>{
    //   // console.log('canplay')
    //   this.$parent.testPlayerEvent.push('canplay');
    // }, false);
    // this.audio.addEventListener('seeking', function(e) {
    //   // console.log(e,audio.buffered.length);
    //   this.$parent.testPlayerEvent.push(e);
    // });
  }
}
// playSound (sound) {
//   if(sound) {
//     var audio = new Audio(sound);
//     audio.play();
//   }
// }