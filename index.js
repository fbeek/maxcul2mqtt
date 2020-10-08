const Controller = require('./lib/controller');
const controller = new Controller();

process.on('unhandledRejection', (err) => {
    console.error(err);
    process.exit(1);
})

controller.start();

process.on('SIGINT', handleQuit);
process.on('SIGTERM', handleQuit);

let stopping = false;

function handleQuit() {
    if (!stopping) {
        stopping = true;
        controller.stop();
    }
}