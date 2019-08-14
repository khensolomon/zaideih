export default {
  name: 'Home',
  // data:function(){
  //   // this.message = this.$parent.message;
  //   // return {
  //   //   message:'this.$parent.message'
  //   // }
  // },
  methods: {
    // reverseMessage: ()=> {
    //   // this.message = this.message.split('').reverse().join('')
    //   console.log('click');
    // },
    // message (e) {
    //   this.$parent.message = e;
    // },
    onEnter: function(e) {
      // this.$parent.message = 'on enter event';
      // console.log(e.target.value);
      this.$parent.todoInsert(e.target.value);
    },
    todoInsert () {
      this.$parent.todoInsert();
    },
    todoDelete (index) {
      this.$parent.todoDelete(index);
    }
  },
  computed: {
    todos(){
      // console.log(this.$parent.todos);
      return this.$parent.todos;
    },
    tracks(){
      // console.log(this.$parent.tracks);
      return this.$parent.tracks;
    },
    // message(){
    //   return this.$parent.message;
    // }
  }
}