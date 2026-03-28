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
// Option A: Keep pointing to your external file
import script from './script.js';
export default script;

// Option B: If you prefer to paste your script.js content here, 
// remove the import above and paste the export default { ... } block here.
</script>

<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./style.css"; 
*/
</style>