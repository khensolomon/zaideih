// const path = require('path');
const webpack = require('webpack');
const { merge } = require('webpack-merge')
const configuration = require('./webpack.config.js');

module.exports = merge(configuration, {
  entry: {
    script: [
      'webpack-hot-middleware/client?path=/__webpack_hmr&reload=true&timeout=1000',
      './assets/webpack/development.js',
      './assets/script/analytics.js',
      './assets/script/sw.register.js',
    ],
    sw:[
      './assets/script/sw.js'
    ]
  },
  plugins: [
    new webpack.HotModuleReplacementPlugin()
  ]
});