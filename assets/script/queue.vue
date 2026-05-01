<template>
  <div class="queue">
    <div v-if="dataStore.queue.length" class="row tracks bg- sh-">
      <div class="track-row">
        <track-row v-for="(n, index) in dataStore.queueTrackLimit" v-bind:track="dataStore.queue[index]" :key="index"
          :queued="true" />
        <div v-if="dataStore.queue.length > dataStore.queueTrackLimit" class="show-more">
          <p @click="dataStore.queueTrackLimit += 9" class="icon-right">
            <span v-text="dataStore.queueTrackLimit" class="limit"></span><span v-text="dataStore.queue.length"
              class="total"></span><span class="more">more</span>
          </p>
        </div>
      </div>
    </div>
    <div v-else class="row center">
      <h1>working: no queue...</h1>
    </div>
  </div>
</template>

<script>
// @ts-ignore
import trackRow from "./components/track-row.vue";

export default {
  name: "Queue",
  props: ["albumId", "language"],
  data: () => ({
    trackLimit: 10
  }),

  inject: ["root", "dataStore", "storageStore"],
  provide() {
    return {
      root: this.root,
      dataStore: this.dataStore,
      storageStore: this.storageStore
    };
  },

  components: {
    trackRow
  },
  methods: {},
  computed: {
    $() {
      return this.$parent;
    }
    // trackLimit(){
    //   if (this.$.queue.length < this.limit){
    //     return this.$.queue.length
    //   }
    //   return this.limit
    // }
  }
};

</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>