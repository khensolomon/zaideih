import trackRow from '../components/track-row.vue';
export default {
  name: 'Queue',
  props: ['albumId','language'],
  data: () => ({
    trackLimit: 10
  }),
  components: {
    trackRow
  },
  methods: {
  },
  computed: {
    $(){
      return this.$parent;
    },
    // trackLimit(){
    //   if (this.$.queue.length < this.limit){
    //     return this.$.queue.length
    //   }
    //   return this.limit
    // }
  },
}