import trackRow from '../components/track-row.vue';
export default {
  name: 'Queue',
  props: ['albumId','language'],
  data: () => ({
    trackLimit: 100
  }),
  components: {
    trackRow
  },
  methods: {
  },
  computed: {
    common(){
      console.log('Queue',e);
      return this.$parent;
    }
  }
}