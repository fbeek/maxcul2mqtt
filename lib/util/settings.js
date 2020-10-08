const yaml_config = require('node-yaml-config');
const config = yaml_config.load('configuration.yaml');

module.exports = config;
