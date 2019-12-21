const merge = require('webpack-merge');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
// const CleanWebpackPlugin = require('clean-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const configuration = require('./webpack.config.js');

module.exports = merge(configuration, {
  mode: 'production',
  // devtool: 'source-map',
  devtool: false,
  entry: {},
  output: {},
  plugins: [
    new CleanWebpackPlugin(),
    new MiniCssExtractPlugin({filename: 'style.css'})
  ],
  module:{
    rules:[
      {
        test: /\.s?css$/,
        use: [
          MiniCssExtractPlugin.loader,
          "css-loader",
          "sass-loader"
        ]
      }
    ]
  }
});