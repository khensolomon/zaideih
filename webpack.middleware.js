const webpack = require('webpack');
const merge = require('webpack-merge');
const configuration = require('./webpack.config.js');

// const MiniCssExtractPlugin = require('mini-css-extract-plugin');
// const VueLoaderPlugin = require('vue-loader/lib/plugin');

const path = require('path');

module.exports = merge(configuration, {
  mode: 'development',
  devtool: 'inline-source-map',
  context: __dirname,
  entry: [
    'webpack-hot-middleware/client?path=/__webpack_hmr&timeout=20000',
    path.resolve(__dirname, 'assets/webpack/development.js')
  ],
  output: {
    filename:'script.js',
  },
  plugins: [
    new webpack.HotModuleReplacementPlugin(),
    new webpack.NoEmitOnErrorsPlugin(),
    // new MiniCssExtractPlugin({filename: 'style.css'}),
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