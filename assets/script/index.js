// import Vue from 'vue';

import main from './main.vue';
import router from './router';


// Vue.config.productionTip = false;
// Vue.config.devtools = false

// const nextBtn = document.createElement('button');
// nextBtn.textContent = 'Next';

function createFakeData(){
  let data = [];
  for(let i = 0; i < 100; i++){
    data.push({first: 'Johnss', last:'Doe', suffix:'#' + i});
  }
  return data;
}

new Vue({
  router:router,
  data:{
    ready:false,
    loading:true,
    message:null,
    error:null,
    people: createFakeData(),
    all:{
      data:[]
    },
    todo:[
      {title:'A'},
      {title:'B'},
      {title:'C'}
    ],

  },

  methods:{
    fetchData(){
      this.$http.get('/api/track').then(response=>{
        this.all = response.data;
        this.ready = true;
      }, error=>{
        console.log(error.statusText);
        this.error = error.statusText;
      });
      this.$http.get('/api/testing').then(response=>{
        console.log(response.data)
      }, error=>{
        console.log(error.statusText);
      });
    }
  },
  watch: {
    // call again the method if the route changes
    // '$route': 'fetchData'
  },
  created() {
    this.fetchData();
  },
  mounted () {
  },
  render: h => h(main),
}).$mount('#app');
