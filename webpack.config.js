const path = require('path')

// Set this to false for easier debugging:
const production = true

const babelOptions = {
  presets: production
    ? ['@babel/preset-env', '@babel/preset-typescript', '@babel/preset-react']
    : ['@babel/preset-typescript', '@babel/preset-react'],
  plugins: [
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    '@babel/plugin-transform-runtime',
    'babel-plugin-transform-fake-error-class'
  ],
  cacheDirectory: true
}

module.exports = {
  devtool: 'source-map',
  entry: './src/io/react-native/react-native-worker.ts',
  mode: production ? 'production' : 'development',
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: { loader: 'babel-loader', options: babelOptions }
      }
    ]
  },
  output: {
    filename: 'lib/react-native/edge-core.js',
    path: path.resolve(__dirname)
  },
  performance: { hints: false },
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  }
}
