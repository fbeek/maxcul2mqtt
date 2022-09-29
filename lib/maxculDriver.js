const logger = require('./util/logger');
const {EventEmitter} = require('events');
const BitSet = require('bitset');
const Moment = require('moment');
const Sprintf = require("sprintf-js").sprintf;
const BinaryParser = require("binary-parser").Parser;

const CommunicationServiceLayer = require('./maxCulCommunicationWrapper');
const CulPacket = require('./data/culPaket');

class MaxculDriver extends EventEmitter {
    constructor(options) {
        super();

        //this.sendMsg = this.sendMsg.bind(this);
        this.baseAddress = options.homeBaseAdress;
        this.baudrate = options.baudRate;
        this.serialPort = options.path;
        this.pairModeEnabled = options.pairModeEnabled;
        this.msgCount = 0;
        this.waitingForReplyQueue = [];
    }

    async start() {
        this.comLayer = new CommunicationServiceLayer(this.baudrate, this.serialPort, this.baseAddress);
        this.comLayer.on("culDataReceived", data => {
            console.log(data);
            return this.handleIncommingMessage(data);
        });

        this.comLayer.on('culFirmwareVersion', data => {
            return logger.info(`CUL FW Version: ${data}`);
        });

        await this.comLayer.connect();

        setInterval( () => {
                this.emit('checkTimeIntervalFired');
            }
            , 1000 * 60 * 60
        );
    }

    async stop(){
        this.disconnect();
    }

    enablePairMode() {
        this.pairModeEnabled = true;
        return setTimeout(() => {
                return this.pairModeEnabled = false;
            }
            , 1000 * 20);
    }

    disconnect() {
        return this.comLayer.disconnect();
    }

    getDeviceId(dev) {
        //Supportet device types
        this.deviceTypes = {
            Cube : 0,
            HeatingThermostat : 1,
            HeatingThermostatPlus : 2,
            WallMountedThermostat : 3,
            ShutterContact : 4,
            PushButton : 5
        };
        if (dev in this.deviceTypes) { return this.deviceTypes[dev]; } else { return 255; }
    }

    decodeCmdId(id) {
        const key = "cmd"+id;
        this.commandList = {
            cmd00 : {
                functionName : "PairPing",
                id : "00"
            },
            cmd01 : {
                functionName : "PairPong",
                id : "01"
            },
            cmd02 : {
                functionName : "Ack",
                id : "02"
            },
            cmd03 : {
                functionName : "TimeInformation",
                id : "03"
            },
            cmd10 : "ConfigWeekProfile",
            cmd11 : "ConfigTemperatures",
            cmd12 : "ConfigValve", //use for boost duration
            cmd20 : "AddLinkPartner",
            cmd21 : "RemoveLinkPartner",
            cmd22 : "SetGroupId",
            cmd23 : "RemoveGroupId",
            cmd30 : {
                functionName : "ShutterContactState",
                id : "30"
            },
            cmd40 : {
                functionName : "WallThermostatSetTemp",
                id : "40"
            },
            cmd42 : {
                functionName : "WallThermostatControl",
                id : "42"
            },
            cmd43 : "SetComfortTemperature",
            cmd44 : "SetEcoTemperature",
            cmd50 : {
                functionName : "PushButtonState",
                id : "50"
            },
            cmd60 : {
                functionName : "ThermostatState",
                id : 60
            },
            cmd70 : {
                functionName : "WallThermostatState",
                id : 70
            },
            cmd82 : "SetDisplayActualTemperature",
            cmdF1 : "WakeUp",
            cmdF0 : "Reset"
        };
        if (key in this.commandList) { return this.commandList[key]['functionName']; } else { return false; }
    }

    handleIncommingMessage(message) {
        const packet = this.parseIncommingMessage(message);
        if (packet) {
            if (packet.getSource() === this.baseAddress) {
                return logger.debug("ignored auto-ack packet");
            } else {
                if ( packet.getCommand() ) {
                    try {
                        return this[packet.getCommand()](packet);
                    } catch (error) {
                        return logger.info(`Error in handleIncommingMessage Function, command : ${packet.getCommand()}, error: ${error}`);
                    }
                } else {
                    return logger.debug(`received unknown command id ${packet.getRawType()}`);
                }
            }
        } else {
            return logger.debug("message was no valid MAX! paket.");
        }
    }

    parseIncommingMessage(message) {
        logger.debug(`decoding Message ${message}`);
        message = message.replace(/\n/, '');
        message = message.replace(/\r/, '');

        let rssi = parseInt(message.slice(-2), 16);
        if (rssi >= 128) {
            rssi = ((rssi - 256) / 2) - 74;
        } else {
            rssi = (rssi / 2) - 74;
        }
        logger.debug(`RSSI for Message : ${rssi}`);

        // remove rssi value from message string
        message = message.substring(0, message.length - 2);

        const data = message.split(/Z(..)(..)(..)(..)(......)(......)(..)(.*)/);
        data.shift(); // Removes first element from array, it is the 'Z'.

        if ( data.length <= 1) {
            logger.debug("cannot split packet");
            return false;
        }

        const packet = new CulPacket();
        // Decode packet length
        packet.setLength(parseInt(data[0],16)); //convert hex to decimal

        // Check Message length
        // We get a HEX Message from the CUL, so we have 2 Digits per Byte
        // -> lengthfield from the packet * 2
        // We also have a trailing 'Z' -> + 1
        // Because the length we get from the cul is calculated for the whole packet
        // and the length field is also hex we have to add two more digits for the calculation -> +2
        if (((2 * packet.getLength()) + 3) !== message.length) {
            logger.debug("packet length missmatch");
            return false;
        }

        packet.setMessageCount(parseInt(data[1],16));
        packet.setFlag(parseInt(data[2],16));
        packet.setGroupId(parseInt(data[6],16));
        packet.setRawType(data[3]);
        packet.setSource(data[4]);
        packet.setDest(data[5]);
        packet.setRawPayload(data[7]);

        if (this.baseAddress === packet.getDest()) {
            packet.setForMe(true);
        } else {
            packet.setForMe(false);
        }

        packet.setCommand(this.decodeCmdId(data[3]));
        packet.setStatus('incomming');
        return packet;
    }

    sendMsg(cmdId, src, dest, payload, groupId, flags, deviceType) {
        const packet = new CulPacket();
        packet.setCommand(cmdId);
        packet.setSource(src);
        packet.setDest(dest);
        packet.setRawPayload(payload);
        packet.setGroupId(groupId);
        packet.setFlag(flags);
        packet.setMessageCount(this.msgCount + 1);
        packet.setRawType(deviceType);

        const msgCount =  Sprintf('%02x',packet.getMessageCount());
        const data = msgCount+flags+cmdId+src+dest+groupId+payload;
        let length = data.length/2;
        length = Sprintf('%02x',length);
        packet.setRawPacket(length+data);
        return new Promise( (resolve, reject) => {
            packet.resolve = resolve;
            packet.reject = reject;
            return this.comLayer.addPacketToTransportQueue(packet);
        });
    }

    generateTimePayload() {
        const now = Moment();
        const prep = {
            sec   : now.seconds(),
            min   : now.minutes(),
            hour  : now.hours(),
            day   : now.date(),
            month : now.month() + 1,
            year  : now.diff('2000-01-01', 'years')
        }; //Years since 2000

        prep.compressedOne = prep.min | ((prep.month & 0x0C) << 4);
        prep.compressedTwo = prep.sec | ((prep.month & 0x03) << 6);

        const payload =  Sprintf('%02x',prep.year) +   Sprintf('%02x',prep.day) + Sprintf('%02x',prep.hour) +  Sprintf('%02x',prep.compressedOne) +  Sprintf('%02x',prep.compressedTwo);
        return payload;
    }

    sendTimeInformation(dest, deviceType) {
        const payload = this.generateTimePayload();
        return this.sendMsg("03",this.baseAddress,dest,payload,"00","04",deviceType);
    }

    sendGroup(dest, groupId, deviceType) {
        return this.sendMsg("22",this.baseAddress,dest,groupId,"00","00",deviceType);
    }

    removeGroup(dest, deviceType) {
        return this.sendMsg("23",this.baseAddress,dest,"00","00","00",deviceType);
    }

    sendPair(dest, pairId, pairType, deviceType) {
        const type= this.getDeviceId(pairType);
        const payload = Sprintf('%s%02x',pairId,type);
        return this.sendMsg("20",this.baseAddress,dest,payload,"00","00",deviceType);
    }

    removePair(dest, pairId, pairType, deviceType) {
        const type= this.getDeviceId(pairType);
        const payload = Sprintf('%s%02x',pairId,type);
        return this.sendMsg("21",this.baseAddress,dest,payload,"00","00",deviceType);
    }

    sendDisplayMode(dest, dmode, deviceType) {
        const state = dmode ? "04" : "00";
        return this.sendMsg("82",this.baseAddress,dest,state,"00","00",deviceType);
    }

    sendFactoryReset(dest, deviceType) {
        return this.sendMsg("F0",this.baseAddress,dest,"","00","00",deviceType);
    }

    sendConfig(dest,comfortTemperature,ecoTemperature,minimumTemperature,maximumTemperature,offset,windowOpenTime,windowOpenTemperature,deviceType) {
        const comfortTemperatureValue = Sprintf('%02x',(comfortTemperature*2));
        const ecoTemperatureValue = Sprintf('%02x',(ecoTemperature*2));
        const minimumTemperatureValue = Sprintf('%02x',(minimumTemperature*2));
        const maximumTemperaturenValue = Sprintf('%02x',(maximumTemperature*2));
        const offsetValue = Sprintf('%02x',((offset + 3.5)*2));
        const windowOpenTempValue = Sprintf('%02x',(windowOpenTemperature*2));
        const windowOpenTimeValue = Sprintf('%02x',(Math.ceil(windowOpenTime/5)));

        const payload = comfortTemperatureValue+ecoTemperatureValue+maximumTemperaturenValue+minimumTemperatureValue+offsetValue+windowOpenTempValue+windowOpenTimeValue;
        this.sendMsg("11",this.baseAddress,dest,payload,"00","00",deviceType);
        return Promise.resolve(true);
    }

    //send fake shutter message
    sendShutterMessage(dest, src, event, groupId, deviceType) {
        const state = event ? "10" : "12";
        if (groupId === "00") {
            return this.sendMsg("30",src,dest,state,"00","00",deviceType);
        } else {
            return this.sendMsg("30",src,dest,state,groupId,"06",deviceType);
        }
    }

    //send fake wallthermostat message
    sendTemperatureMessage(dest, measuredTemp, desiredTemp, groupId, deviceType) {
        if (measuredTemp < 0) {
            measuredTemp = 0;
        }
        if (measuredTemp > 51) {
            measuredTemp = 51;
        }
        if (desiredTemp <= 4.5) {
            desiredTemp = 4.5;
        }
        if (desiredTemp >= 30.5) {
            desiredTemp = 30.5;
        }
        let val2 = measuredTemp * 10;
        const val1 = ((val2 & 0x100)>>1) | ((desiredTemp * 2) & 0x7F);
        val2 = val2 & 0xFF;
        const payload = Sprintf('%02x%02x',val1,val2);
        if (groupId === "00") {
            return this.sendMsg("42",this.baseAddress,dest,payload,"00","00",deviceType);
        } else {
            return this.sendMsg("42",this.baseAddress,dest,payload,groupId,"04",deviceType);
        }
    }

    sendDesiredTemperature(dest,temperature,mode,groupId,deviceType) {
        let payloadHex;
        let modeBin = "";

        switch (mode) {
            case 'auto':
                modeBin = '00';break;
            case 'manu':
                modeBin = '01';break;
            case 'boost':
                modeBin = '11';break;
            default: modeBin = '01';break;
        }

        if (isNaN(temperature) || (typeof temperature !== "number")) {
            return Promise.reject("Invalid temperature supplied");
        }

        if (temperature <= 4.5) {
            temperature = 4.5;
        }
        if (temperature >= 30.5) {
            temperature = 30.5;
        }

        if ((mode === 'auto') && ((typeof temperature === "undefined") || (temperature === null))) {
            payloadHex = "00";
        } else {
            // Multiply the temperature with 2 to remove eventually supplied 0.5 and convert to
            // binary
            // We can't get a value smaller than 4.5 (0FF) and
            // higher as 30.5 (ON)(see the specifications of the system)
            // example: 30.5 degrees * 2 = 61
            // example: 3 degrees * 2 = 6
            temperature = (temperature * 2).toString(2);
            // Fill the value with zeros so that we allways get 6 bites
            // example: 61 =  0011 1101 => 000000 00111101 => 111101
            // example: 6 =  0110 => 000000 0110 => 000110
            const temperatureBinary =  ("000000" + temperature).substr(-6);
            // Add the mode at the position of the removed bits
            // example: Mode temporary 11 => 11 111101
            // example: Mode manuel 01 => 01 000110
            const payloadBinary = modeBin + temperatureBinary;
            // convert the binary payload to hex
            payloadHex = Sprintf('%02x',(parseInt(payloadBinary, 2)));
        }
        //if a  groupid is given we set the flag to 04 to switch all devices in this group
        if (groupId === "00") {
            return this.sendMsg("40",this.baseAddress,dest,payloadHex,"00","00",deviceType);
        } else {
            return this.sendMsg("40",this.baseAddress,dest,payloadHex,groupId,"04",deviceType);
        }
    }

    parseTemperature(temperature) {
        if (temperature === 'on') {
            return 30.5;
        } else if (temperature === 'off') {
            return 4.5;
        } else { return temperature; }
    }

    PairPing(packet) {
        logger.debug("handling PairPing packet");

        const payloadBuffer = new Buffer.from(packet.getRawPayload(), 'hex');
        const payloadParser = new BinaryParser().uint8('firmware').uint8('type').uint8('test');
        const temp = payloadParser.parse(payloadBuffer);
        packet.setDecodedPayload(temp);

        if(this.pairModeEnabled) {
            console.log(packet.getDest())
            console.log(packet.getForMe());
            if ((packet.getDest() !== "000000") && (packet.getForMe() !== true)) {
                //Pairing Command is not for us
                logger.debug("handled PairPing packet is not for us");
                return;
            } else if ( packet.getDest() === "000000" ) { //The device is new and needs a full pair
                logger.debug(`beginn pairing of a new device with deviceId ${packet.getSource()}`);
                this.sendMsg("01", this.baseAddress, packet.getSource(), "00", "00", "00", "");
                this.emit('NewDevice',packet.getSource(),false);
            }
        }

        if ( packet.getForMe() ) { //The device only wants to repair
            logger.debug(`beginn repairing with device ${packet.getSource()}`);
            this.sendMsg("01", this.baseAddress, packet.getSource(), "00", "00", "00", "");
            this.emit('NewDevice',packet.getSource(),true);
        } else {
            return logger.debug(", but pairing is disabled so ignore");
        }
    }

    Ack(packet) {
        const payloadBuffer = new Buffer.from(packet.getRawPayload(),'hex');
        const payloadParser = new BinaryParser().uint8('state');
        const temp = payloadParser.parse(payloadBuffer);
        packet.setDecodedPayload( temp.state );
        if( packet.getDecodedPayload() === 1 ) {
            logger.debug(`got OK-ACK Packet from ${packet.getSource()}`);
            return this.comLayer.ackPacket();
        } else {
            //????
            return logger.debug(`got ACK Error (Invalid command/argument) from ${packet.getSource()} with payload ${packet.getRawPayload()}`);
        }
    }

    ShutterContactState(packet) {
        const rawBitData = new BitSet('0x'+packet.getRawPayload());

        const shutterContactState = {
            src : packet.getSource(),
            isOpen : rawBitData.get(1),
            rfError : rawBitData.get(6),
            batteryLow : rawBitData.get(7)
        };

        logger.debug(`got data from shutter contact ${packet.getSource()} ${rawBitData.toString()}`);
        this.emit('ShutterContactStateRecieved',shutterContactState);
    }

    PushButtonState(packet) {
        const rawBitData = new BitSet('0x'+packet.getRawPayload());

        const pushButtonState = {
            src : packet.getSource(),
            isOpen : rawBitData.get(0),
            rfError : rawBitData.get(6),
            batteryLow : rawBitData.get(7)
        };

        logger.debug(`got data from push button ${packet.getSource()} ${rawBitData.toString()}`);
        this.emit('PushButtonStateRecieved',pushButtonState);
    }

    WallThermostatState(packet) {
        logger.debug(`got data from wallthermostat state ${packet.getSource()} with payload ${packet.getRawPayload()}`);

        const rawPayload = packet.getRawPayload();

        if( rawPayload.length >= 10) {
            let WallthermostatState;
            const rawPayloadBuffer = new Buffer.from(rawPayload, 'hex');

            const payloadParser = new BinaryParser().uint8('bits').uint8('displaymode').uint8('desiredRaw').uint8('null1').uint8('heaterTemperature');

            const rawData = payloadParser.parse(rawPayloadBuffer);

            const rawBitData = new BitSet(rawData.bits);

            return WallthermostatState = {
                src : packet.getSource(),
                mode : rawBitData.slice(0,1).toString(16),
                desiredTemperature : (('0x'+(packet.getRawPayload().substr(4,2))) & 0x7F) / 2.0,
                measuredTemperature : 0,
                dstSetting : rawBitData.get(3),
                langateway : rawBitData.get(4),
                panel : rawBitData.get(5),
                rferror : rawBitData.get(6),
                batterylow : rawBitData.get(7)
            };
        }
    }

    WallThermostatControl(packet) {
        const rawBitData = new BitSet('0x'+packet.getRawPayload());
        const desiredRaw = '0x'+(packet.getRawPayload().substr(0,2));
        const measuredRaw = '0x'+(packet.getRawPayload().substr(2,2));
        const desired = (desiredRaw & 0x7F) / 2.0;
        const measured = ((((desiredRaw & 0x80)*1)<<1) | ((measuredRaw)*1)) / 10.0;

        logger.debug(`got data from wallthermostat ${packet.getSource()} desired temp: ${desired} - measured temp: ${measured}`);

        const WallThermostatControl = {
            src : packet.getSource(),
            desired,
            measured
        };
        this.emit('WallThermostatControlRecieved',WallThermostatControl);
    }

    WallThermostatSetTemp(packet) {
        const setTemp = (('0x'+packet.getRawPayload()) & 0x3f) / 2.0;
        const mode = ('0x'+packet.getRawPayload())>>6;

        logger.debug(`got data from wallthermostat ${packet.getSource()} set new temp ${setTemp} mode ${mode}`);

        const wallSetTemp = {
            src : packet.getSource(),
            mode,
            temp : setTemp
        };
        this.emit('WallThermostatSetTempRecieved',wallSetTemp);
    }

    ThermostatState(packet) {
        logger.debug(`got data from heatingelement ${packet.getSource()} with payload ${packet.getRawPayload()}`);

        const rawPayload = packet.getRawPayload();

        if( rawPayload.length >= 10) {
            let calculatedMeasuredTemperature, payloadParser;
            const rawPayloadBuffer = new Buffer.from(rawPayload, 'hex');
            if( rawPayload.length === 10) {
                payloadParser = new BinaryParser().uint8('bits').uint8('valvePosition').uint8('desiredTemp').uint8('untilOne').uint8('untilTwo');
            } else {
                payloadParser = new BinaryParser().uint8('bits').uint8('valvePosition').uint8('desiredTemp').uint8('untilOne').uint8('untilTwo').uint8('untilThree');
            }

            const rawData = payloadParser.parse(rawPayloadBuffer);

            const rawBitData = new BitSet(rawData.bits);
            const rawMode = rawBitData.slice(0,1).toString(16);
            //If the control mode is not "temporary", the cube sends the current (measured) temperature
            if( rawData.untilTwo && (rawMode !== 2)) {
                calculatedMeasuredTemperature = (((rawData.untilOne &0x01)<<8) + rawData.untilTwo)/10;
            } else {
                calculatedMeasuredTemperature = 0;
            }
            //Sometimes the HeatingThermostat sends us temperatures like 0.2 or 0.3 degree Celcius - ignore them
            if ( (calculatedMeasuredTemperature !== 0) && (calculatedMeasuredTemperature < 1)) {
                calculatedMeasuredTemperature = 0;
            }
            let untilString = "";

            if( rawData.untilThree && (rawMode === 2)) {
                const timeData = ParseDateTime(rawData.untilOne,rawData.untilTwo,rawData.untilThree);
                untilString = timeData.dateString;
            }
            //Todo: Implement offset handling

            const thermostatState = {
                src : packet.getSource(),
                mode : rawMode,
                desiredTemperature : (rawData.desiredTemp&0x7F)/2.0,
                valvePosition : rawData.valvePosition,
                measuredTemperature : calculatedMeasuredTemperature,
                dstSetting : rawBitData.get(3),
                langateway : rawBitData.get(4),
                panel : rawBitData.get(5),
                rferror : rawBitData.get(6),
                batterylow : rawBitData.get(7),
                untilString
            };

            this.emit('ThermostatStateRecieved',thermostatState);
        } else {
            return logger.debug("payload to short ?");
        }
    }

    TimeInformation(packet) {
        logger.debug(`got time information request from device ${packet.getSource()}`);
        this.emit('deviceRequestTimeInformation',packet);
    }

    ParseDateTime(byteOne,byteTwo,byteThree) {
        const timeData = {
            day : byteOne & 0x1F,
            month : ((byteTwo & 0xE0) >> 4) | (byteThree >> 7),
            year : byteTwo & 0x3F,
            time : byteThree & 0x3F,
            dateString : ""
        };

        if (timeData.time%2) {
            timeData.time = parseInt(time/2)+":30";
        } else {
            timeData.time = parseInt(time/2)+":00";
        }

        timeData.dateString = timeData.day+'.'+timeData.month+'.'+timeData.year+' '+timeData.time;
        return timeData;
    }


}

module.exports = MaxculDriver;
