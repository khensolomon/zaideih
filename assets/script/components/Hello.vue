<template>
  <h1>{{ msg }}</h1>
</template>

<script>
// Option A: Keep pointing to your external file
import script from './hello.js';
export default script;

// Option B: If you prefer to paste your hello.js content here, 
// remove the import above and paste the export default { ... } block here.
// export default {
//   name: 'hello',

//   props: ['name'],

//   computed: {
//     msg () {
//       return `Hello, ${ this.name }!`
//     }
//   }
// }
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
/* If you have an external CSS file, you can also import it here:
@import "./layout.css"; 
*/
</style>