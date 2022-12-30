// @ts-ignore
import trackRow from "../components/track-row.vue";

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
