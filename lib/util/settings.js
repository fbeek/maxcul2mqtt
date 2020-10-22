const yaml_config = require('node-yaml-config');
const config = yaml_config.load('storage/configuration.yaml');

module.exports = config;
