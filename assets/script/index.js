import main from './main.vue';
import router from './router';


Vue.config.productionTip = false;
Vue.config.devtools = false

// const nextBtn = document.createElement('button');
// nextBtn.textContent = 'Next';

function createFakeData(){
  let data = [];
  for(let i = 0; i < 100; i++){
    data.push({first: 'John', last:'Doe', suffix:'#' + i});
  }
  return data;
}

new Vue({
  router:router,
  data:{
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
      this.loading = true;
      this.$http.get('/api/track').then(response=>{
        this.all = response.data;
        this.loading = false;
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
