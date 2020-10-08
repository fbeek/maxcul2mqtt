const logger = require('./util/logger');
const {EventEmitter} = require('events');
const SerialPort = require('serialport');
const {Readline} = SerialPort.parsers;
//const SerialPort = serialport.SerialPort

const Promise = require('bluebird');
Promise.promisifyAll(SerialPort.prototype);

class MaxCulCommunicationWrapper extends EventEmitter {

    constructor(baudrate, serialPortName, _baseAddress) {
        super();
        this._baseAddress = _baseAddress;
        this.serialPortName = serialPortName;
        logger.info(`using serial device ${this.serialPortName}@${baudrate}`);

        this._messageQueue = [];
        this._sendMessages = [];
        this._current = undefined;
        this._busy = false;
        this._ackResolver = null;
        this._currentSentPromise = null;

        this.parser = null;

        this._serialDeviceInstance = new SerialPort(serialPortName, {
            baudRate: baudrate,
            autoOpen: false
        });
    }

    async connect() {
        logger.info("Connecting to cul device.");
        this.ready = false;

        this._serialDeviceInstance.removeAllListeners('error');
        this._serialDeviceInstance.removeAllListeners('data');
        this._serialDeviceInstance.removeAllListeners('close');

        if (this.parser != null) {
            this.parser.removeAllListeners('data');
        }

        this.removeAllListeners('newPacketForTransmission');
        this.removeAllListeners('readyForNextPacketTransmission');

        this._serialDeviceInstance.on('error', error => {
            this.emit('error', error);
            logger.error(`serialport communication error ${err}`);
        });

        this._serialDeviceInstance.on('close', () => {
            this.emit('close');
            this.removeAllListeners('newPacketForTransmission');
            this.removeAllListeners('readyForNextPacketTransmission');
        });

        this.parser = this._serialDeviceInstance.pipe(new Readline({ delimiter: '\n', encoding: 'ascii' }));

        this.parser.on('data', data => {
            logger.debug(`incoming raw data from CUL: ${data}`);
            let dataString = `${data}`;
            dataString = dataString.replace(/[\r]/g, '');

            if (/^V(.*)/.test(dataString)) {
                logger.debug("Got Version String");
                //data contains cul version string
                this.emit('culFirmwareVersion', dataString);
                this.ready = true;
                return this.emit('ready');
            } else if (/^Z(.*)/.test(dataString)) {
                return this.emit('culDataReceived',dataString);
            } else if (/^LOVF/.test(dataString)) {
                return this._current.setStatus('sendlimit');
            } else {
                return logger.info(`received unknown data: ${dataString}`);
            }
        });

        this.on('newPacketForTransmission', () => {
            return this.processMessageQueue();
        });

        this.on('readyForNextPacketTransmission', () => {
            return this.processMessageQueue();
        });

        return new Promise( (resolve, reject) => {
            const resolver = resolve;
            logger.debug("Init serial port.")
            return this._open().then(() => {
                    logger.info(`serialPort ${this.serialPortName} is open!`);

                    //check the version of the cul firmware
                    logger.debug("check CUL Firmware version");
                    return Promise.delay(2000).then( () => {
                        return this._serialDeviceInstance.writeAsync('V\n').then( () => {
                            return logger.debug("Requested CUL Version...");
                        }).catch(reject);
                    });
                },

                //set resolver and resolve the promise if on ready event

                this.once("ready", () => {
                    logger.debug("Trigger Resolver on ready");
                    // enable max mode of the cul firmware and rssi reporting
                    logger.debug("enable MAX! Mode of the CUL868");
                    Promise.delay(2000).then( () => {
                        return this._serialDeviceInstance.writeAsync('X20\n').then( () => {
                            return this._serialDeviceInstance.writeAsync('Zr\n').then( () => {
                                return this._serialDeviceInstance.writeAsync('Za'+this._baseAddress+'\n');
                            });
                        }).catch(reject);
                    });
                    return resolver();
                })
            ).timeout(60000).catch( err => {
                if (err.name === "TimeoutError") {
                    return logger.info(('Timeout on CUL connect, cul is available but not responding'));
                }
            });
        }).catch( err => {
            return logger.info((`Can not connect to serial port, cause: ${err}`));
        });
    }

    disconnect() {
        return this._serialDeviceInstance.closeAsync();
    }

    _open() {
        if (!this._serialDeviceInstance.isOpen) {
            logger.debug("Opening Serialport.");
            return this._serialDeviceInstance.openAsync();
        } else {
            logger.debug("Serial Port already opened")
            return Promise.resolve();
        }
    }

    // write data to the CUL device
    serialWrite(data) {
        if( this._serialDeviceInstance.isOpen ) {
            const command = "Zs"+data+"\n";
            return this._serialDeviceInstance.writeAsync(command).then( () => {
                logger.debug((`Send Packet to CUL: ${data}, awaiting drain event`));
                return this._serialDeviceInstance.drainAsync().then( () => {
                    return logger.debug(("serial port buffer have been drained"));
                });
            });
        } else {
            logger.debug(("Can not send packet because serial port is not open"));
            return Promise.reject("Error: serial port is not open");
        }
    }

    addPacketToTransportQueue(packet) {
        if (packet.getRawType() === "ShutterContact") {
            //If the target is a shuttercontact this packet must be send as first, because it is
            //only awake for a short time period after it has transmited his data
            //prepend new packet to queue
            this._messageQueue.unshift(packet);
        } else {
            //append packet to queue
            this._messageQueue.push(packet);
        }
        if(this._busy) { return; }
        return this.emit("newPacketForTransmission");
    }

    processMessageQueue() {
        let next;
        this._busy = true;
        if(!this._current) {
            //The last packet is done so we get the next one
            next = this._messageQueue.shift();
        }
        //If we have no new packet we have nothing to do here
        if(!next) {
            logger.debug("no packet to handle in send queue");
            this._busy = false;
            return;
        }

        if(next.getStatus === 'new') {
            next.setStatus('send');
            next.setSendTries(1);
        }

        this._current = next;
        return this._currentSentPromise = this.sendPacket();
    }

    sendPacket() {
        const packet = this._current;
        return new Promise( (resolve, reject) => {
            this._ackResolver = resolve;
            this.serialWrite( packet.getRawPacket() ).catch( err => {
                return reject(err);
            });
            return this.once("gotAck", () => {
                this._ackResolver();
                packet.resolve(true);
                return this.cleanMessageQueueState();
            });
        }).timeout(3000).catch( err => {
            this.removeAllListeners('gotAck');
            if (err.name === "TimeoutError") {
                if (packet.getStatus() === 'sendlimit') {
                    this._currentSentPromise = this.sendPacket(packet);
                    return logger.debug("Retransmit packet because of limit overflow");
                } else if (packet.getSendTries() < 3) {
                    packet.setSendTries(packet.getSendTries() + 1);
                    this._currentSentPromise = this.sendPacket(packet);
                    return logger.debug(`Retransmit packet ${packet.getRawPacket()}, try ${packet.getSendTries()} of 3`);
                } else {
                    logger.info(`Paket ${packet.getRawPacket()} send but no response!`);
                    packet.reject(`Paket ${packet.getRawPacket()} send but no response!`);
                    return this.cleanMessageQueueState();
                }
            } else {
                logger.info(`Paket ${packet.getRawPacket()} could no be send! ${err}`);
                packet.reject(`Paket ${packet.getRawPacket()} could no be send! ${err}`);
                return this.cleanMessageQueueState();
            }
        });
    }

    cleanMessageQueueState() {
        this._current = null;
        return this.emit('readyForNextPacketTransmission');
    }

    ackPacket(){
        return this.emit('gotAck');
    }
};

module.exports = MaxCulCommunicationWrapper;
