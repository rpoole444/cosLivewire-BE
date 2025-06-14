const dayjs = require('dayjs');

module.exports = trialEnd => dayjs().isBefore(dayjs(trialEnd));
