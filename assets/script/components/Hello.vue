<template>
  <h1>{{ msg }}</h1>
</template>

<script>
	export default {
  name: 'hello',

  props: ['name'],

  computed: {
    msg () {
      return `Hello, ${ this.name }!`
    }
  }
}

</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped></style>