const { merge } = require('webpack-merge');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const configuration = require('./webpack.config.js');

module.exports = merge(configuration, {
  mode: 'production',
  // devtool: 'source-map',
  devtool: false,
  plugins: [
    new CleanWebpackPlugin(),
  ],
  entry: {
    script:[
      './assets/script/analytics.js',
      './assets/script/sw.register.js',
    ],
    sw:[
      './assets/script/sw.js'
    ]
  },
  module:{
    rules:[
    ]
  }
});