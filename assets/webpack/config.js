const path = require("path");
const webpack = require("webpack");
const BundleTracker = require("webpack-bundle-tracker");
const { VueLoaderPlugin } = require("vue-loader");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

const staticPath = "../../static/";

// Change the port to avoid conflicts with other services
const devServerPort = 8081; 

// Manually parse Node's process.argv to detect the --mode flag from the CLI
const modeIndex = process.argv.indexOf("--mode");
const isProduction =
	process.argv.includes("--mode=production") ||
	(modeIndex !== -1 && process.argv[modeIndex + 1] === "production");

module.exports = {
	context: __dirname,
	mode: isProduction ? "production" : "development",

	// IMPROVEMENT 2: Source Maps for debugging
	devtool: isProduction ? "source-map" : "eval-source-map",

	entry: {
		main: "./index.js",
		// Add workers as separate entries to minify and output them independently
		"sw-register": "../script/sw-register.js",
		"sw-installer": "../script/sw-installer.js",
		"sw-album": "../script/sw-album.js"
	},

	output: {
		path: path.resolve(__dirname, staticPath),
		publicPath: isProduction
			? staticPath.replace(/\./g, "")
			: "http://localhost:?/".replace('?', devServerPort),
		// Use includes() to omit hashes for workers, catching dynamically generated chunks like 'script_sw-album_js'
		filename: (pathData) => {
			if (pathData.chunk.name?.includes('sw-')) {
				return '[name].js';
			}
			return "[name]-[fullhash].js";
		},
		// Ensure dynamic chunks also skip hashing
		chunkFilename: (pathData) => {
			if (pathData.chunk.name?.includes('sw-')) {
				return '[name].js';
			}
			return "[name]-[chunkhash].js";
		},
		assetModuleFilename: "assets/[name]-[hash][ext]",
		clean: true,
	},

	// IMPROVEMENT 4: Persistent File System Cache (Massive speed boost)
	cache: {
		type: "filesystem",
	},

	devServer: {
		host: "0.0.0.0",
		port: devServerPort,
		headers: {
			"Access-Control-Allow-Origin": "*",
		},
		hot: true,
		allowedHosts: "all",
		devMiddleware: {
			// Write any chunk containing 'sw-' to disk so Django (port 8000) can serve it directly.
			writeToDisk: (filePath) => {
				return /sw-/.test(filePath);
			},
		},
	},

	resolve: {
		extensions: [".js", ".vue", ".json"],
		alias: {
			vue$: "vue/dist/vue.esm-bundler.js",
		},
	},

	// IMPROVEMENT 3 & 5: Optimization, CSS Minification & Code Splitting
	optimization: {
		minimize: isProduction,
		minimizer: [
			// Minifies JS (Webpack's default plugin, but we must explicitly include '...' to extend it)
			`...`,
			// Minifies CSS
			new CssMinimizerPlugin(),
		],
		splitChunks: {
			// Prevent Webpack from splitting worker code into the vendor chunk by checking string inclusion
			chunks: (chunk) => {
				return !chunk.name?.includes('sw-');
			},
			name: "vendor", // Names the resulting chunk 'vendor-[hash].js'
		},
	},

	plugins: [
		new BundleTracker({
			path: path.resolve(__dirname, staticPath),
			filename: "webpack-stats.json",
		}),
		new VueLoaderPlugin(),
		new MiniCssExtractPlugin({
			filename: "[name]-[fullhash].css",
		}),
		// IMPROVEMENT 1: Vue 3 Feature Flags (Strips dead code in production)
		new webpack.DefinePlugin({
			__VUE_OPTIONS_API__: true,
			__VUE_PROD_DEVTOOLS__: false,
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
		}),
	],

	module: {
		rules: [
			{
				test: /\.vue$/,
				loader: "vue-loader",
			},
			{
				test: /\.js$/,
				exclude: /node_modules/,
				use: ["babel-loader"],
			},
			{
				test: /\.scss$/i,
				use: [
					isProduction ? MiniCssExtractPlugin.loader : "style-loader",
					"css-loader",
					{
						loader: "sass-loader",
						options: {
							// This tells sass-loader to use the new "sass.compile" API
							sassOptions: {
								api: "modern-compiler",
								// Silence the specific warning ID
								silenceDeprecations: ["legacy-js-api"],
								quietDeps: true, // Helps silence warnings from dependencies
							},
						},
					},
				],
			},
			{
				test: /\.css$/i,
				use: [
					isProduction ? MiniCssExtractPlugin.loader : "style-loader",
					"css-loader",
				],
			},
			{
				test: /\.svg$/i,
				type: "asset/resource",
				sideEffects: true,
				use: [
					{
						loader: path.resolve(__dirname, "svg-loader.js"),
					},
				],
				generator: {
					filename: (pathData) => {
						const queryStr = pathData.module.resourceResolveData?.query || "";
						const query = new URLSearchParams(queryStr);
						const as = query.get("as");
						const format = query.get("format");

						if (as) {
							if (format) return `${as}.${format}`;
							if (
								as.includes("favicon") ||
								as.includes("apple") ||
								as.includes("chrome")
							) {
								return `${as}.png`;
							}
							return `${as}[ext]`;
						}
						return "[name][ext]";
					},
				},
			},
			{
				test: /\.(png|ico|jpg|gif|eot|ttf|woff|woff2|webmanifest|txt)$/,
				type: "asset/resource",
				sideEffects: true,
				generator: {
					filename: "[name][ext]",
				},
			},
		],
	},
};