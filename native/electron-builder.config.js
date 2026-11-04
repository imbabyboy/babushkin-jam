// Настройки сборки — в package.json. Версия приложения — номер релиза, он же версия расширения.
const { build } = require('./package.json');
const { version } = require('../extension/manifest.json');

module.exports = { ...build, extraMetadata: { version } };
