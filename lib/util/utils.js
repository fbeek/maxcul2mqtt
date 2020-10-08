async function getMaxcul2mqttVersion() {
    return new Promise((resolve, reject) => {
        const git = require('git-last-commit');
        const packageJSON = require('../../package.json');
        const version = packageJSON.version;

        git.getLastCommit((err, commit) => {
            let commitHash = null;

            if (err) {
                try {
                    commitHash = require('../../.hash.json').hash;
                } catch (error) {
                    commitHash = 'unknown';
                }
            } else {
                commitHash = commit.shortHash;
            }

            resolve({commitHash, version});
        });
    });
}

function getKeyByValue(object, value) {
    return Object.keys(object).find(key => object[key] === value);
}

module.exports = {
    millisecondsToSeconds: (milliseconds) => milliseconds / 1000,
    secondsToMilliseconds: (seconds) => seconds * 1000,
    getMaxcul2mqttVersion,
    getKeyByValue,
};