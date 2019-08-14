export default {
  name: 'hello',
  template:`<div>
      <h1>{{ msg }}</h1>
    </div>
  `,
  props: ['name'],

  computed: {
    msg () {
      return `Hello, ${ this.name }!`
    }
  }
};