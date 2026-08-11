const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const existingBlockList = config.resolver.blockList
  ? Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]
  : [];

config.resolver.blockList = [
  ...existingBlockList,
  /[/\\]android[/\\](?:app[/\\])?(?:build|\.cxx)[/\\].*/,
];

module.exports = config;
