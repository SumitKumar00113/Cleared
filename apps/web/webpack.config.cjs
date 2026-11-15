const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

const apiHost = process.env.CLEARED_API_HOST || '';

module.exports = {
  entry: './src/main.jsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'assets/[name].[contenthash:8].js',
    clean: true,
    publicPath: '/',
  },
  resolve: { extensions: ['.js', '.jsx'] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: { presets: ['@babel/preset-env', ['@babel/preset-react', { runtime: 'automatic' }]] },
        },
      },
      { test: /\.css$/i, use: ['style-loader', 'css-loader'] },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: './index.html' }),
    new webpack.DefinePlugin({
      'process.env.CLEARED_API_HOST': JSON.stringify(apiHost),
    }),
  ],
  devServer: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT || 5173),
    hot: true,
    historyApiFallback: true,
    proxy: [{ context: ['/api'], target: 'http://localhost:4000' }],
  },
};
