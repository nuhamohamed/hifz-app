const {
  getSentryExpoConfig
} = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Bundle the mushaf SQLite database as an asset
config.resolver.assetExts.push('db');

module.exports = config;
