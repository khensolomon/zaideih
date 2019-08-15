const merge = require('webpack-merge');
const configuration = require('./webpack.config.js');

const CleanWebpackPlugin = require('clean-webpack-plugin');

// const MiniCssExtractPlugin = require('mini-css-extract-plugin');
// const VueLoaderPlugin = require('vue-loader/lib/plugin');


module.exports = merge(configuration, {
  mode: 'production',
  devtool: 'source-map',
  entry: {},
  output: {},
  plugins: [

    new CleanWebpackPlugin([
      'static/*.*'
    ], {
      root: __dirname,
      exclude: [],
      verbose: true,
      dry: false
    }),
    // new MiniCssExtractPlugin({
    //   filename: 'style.css'
    // }),
    // new VueLoaderPlugin()
  ],
  module:{
    rules:[
      // {
      //   test: /\.s?css$/,
      //   use: [
      //     MiniCssExtractPlugin.loader,
      //     "css-loader",
      //     "sass-loader"
      //   ]
      // }
    ]
  }
});