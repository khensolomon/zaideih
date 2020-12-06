export default {
  name: 'Player',
  data: () => ({
		current: 0,
    duration: 0,
    isLoop: false,
    preload: "auto",
    loading:false,
    autoplay: true,
		isShuffle: false,
		// loaded: false,
		playing: false,
    track:{
      i:null
    },
    hover:0,
    hoverLeft:-13,
		volume: 0.4,
		volumePrevious: 0.3,
    percentProgress:0,
    percentSeeker:0
  }),
  watch: {
		volume(value) {
      this.audio.volume = value;
      // this.volumePrevious = value;
		},
		playing(value) {
      this.$.playing = value;
		}
  },
  methods: {
    timeupdate() {
      this.current = this.audio.currentTime;
      this.percentSeeker = this.audio.currentTime / this.audio.duration * 100;
    },
    loadeddata() {
			if (this.audio.readyState >= 2) {
        this.duration = this.audio.duration;
        document.title =  this.track.t;
			}
		},
    progress() {
      var ranges = [];
      for(var i = 0; i < this.audio.buffered.length; i ++){
        ranges.push([this.audio.buffered.start(i),this.audio.buffered.end(i)]);
      }
      for(var i = 0; i < this.audio.buffered.length; i ++){
        this.percentProgress = Math.round((100 / this.audio.duration) * (ranges[i][1] - ranges[i][0]));
      }
      // this.$.testPlayerEvent.push('ss:'+this.percentProgress);
    },
    loadstart() {
      this.loading=true;
    },
    loadedmetadata() {
    },
    canplaythrough() {
    },
    canplay() {
      this.loading=false;
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
		},
    play(){
      if (this.audio.src){
        if (this.audio.paused) {
          this.audio.play();
        } else {
          this.audio.pause();
        }
      } else {
        this.$.randamQueue().then(
          e => this.$.setQueue(e.i).then(
            () => this.audio.autoplay=true
          )
        );

      }
    },
    pause(){
      this.audio.pause();
    },
    next(){
      this.$.nextQueue();
    },
    previous(){
      this.$.previousQueue();
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
      this.track={};
    },
    mute() {
      if (this.audio.volume == 0){
        this.audio.volume = this.volumePrevious;
      } else {
        this.volumePrevious = this.volume;
        this.audio.volume = 0;
      }
      this.volume = this.audio.volume;
    },
    addTrack(e){
      this.track = e;
    }
  },
  computed: {
    $(){
      return this.$parent;
    },
    audio(){
      return this.$refs.audio;
    },
    src(){
      // if (this.track){
      //   if (isNaN(this.track.id)){
      //     return this.track.id;
      //   }
      //   return this.$.api.audio.replace('*',this.track.id);
      // }
      // return null;
      /*
      if (!this.id){
        return null;
      } else if (isNaN(this.id)){
        return this.$.api.audio.replace('*',this.id);
      }
      return this.$.api.audio_test.replace('*',this.id);
      */
     if (this.id) return this.$.api.audio.replace('*',this.id);
    },
    totalQueue() {
			return this.$.queue.length;
    },
    id(){
      return this.track.i;
    }
  },
  filters:{
    timeFormat: function(e){
      if (!e)return '00:00';
      let hhmmss = new Date(e * 1000).toISOString().substr(11, 8);
      return hhmmss.indexOf("00:") === 0 ? hhmmss.substr(3) : hhmmss;
    }
  },
  created(){

    // console.log(this.$.all.lang)
    // console.log(this.$.queueId)
  }
}