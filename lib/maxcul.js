const logger = require('./util/logger');
const settings = require('./util/settings');
const data = require('./util/data');
const utils = require('./util/utils');
const events = require('events');
const MaxculDriver = require('./maxculDriver');

class Maxcul extends events.EventEmitter {
    constructor() {
        super();
    }

    async start() {
        logger.info(`Starting Maxcul Driver...`);
        const maxculSettings = {
            baudRate: settings.maxcul.baudrate,
            path: settings.maxcul.port,
            homeBaseAdress: settings.maxcul.homeBaseAdress,
            pairModeEnabled: settings.maxcul.pairModeEnabled
        };

        try {
            this.maxcul = new MaxculDriver(maxculSettings);
            await this.maxcul.start();
            this.maxcul.on('checkTimeIntervalFired', this.onCheckTimeIntervalFired.bind(this));
            this.maxcul.on('NewDevice', this.onNewDevice.bind(this));
            this.maxcul.on('ShutterContactStateRecieved', this.onShutterContactStateRecieved.bind(this));
            this.maxcul.on('PushButtonStateRecieved', this.onPushButtonStateRecieved.bind(this));
            this.maxcul.on('WallThermostatControlRecieved', this.onWallThermostatControlRecieved.bind(this));
            this.maxcul.on('WallThermostatSetTempRecieved', this.onWallThermostatSetTempRecieved.bind(this));
            this.maxcul.on('ThermostatStateRecieved', this.onThermostatStateRecieved.bind(this));
            this.maxcul.on('deviceRequestTimeInformation', this.onDeviceRequestTimeInformation.bind(this));
            this.maxcul.on('WallThermostatStateRecieved', this.onWallThermostatStateRecieved.bind(this));
        } catch (error) {
            logger.error('Error while starting maxcul-driver');
            throw error;
        }
    }

    async sendConfigToDevice(deviceId){
        const devices = settings.devices
        if(devices.hasOwnProperty(deviceId)){
            logger.debug("Found config for device "+deviceId);
            const deviceConfig = settings.devices[deviceId]
            if(deviceConfig.deviceType == "Thermostat" || deviceConfig.deviceType == "WallMountedThermostat"){
                this.maxcul.sendConfig(
                    deviceConfig.deviceId,
                    deviceConfig.comfyTemp,
                    deviceConfig.ecoTemp,
                    deviceConfig.minimumTemperature,
                    deviceConfig.maximumTemperature,
                    deviceConfig.measurementOffset,
                    deviceConfig.windowOpenTime,
                    deviceConfig.windowOpenTemperature,
                    deviceConfig.deviceType
                );
            }else{
                logger.info("unsupported device type for sendConfig");
            }


        }else{

        }
    }

    setTemperature(deviceId,temperature){
        const devices = settings.devices;
        if(devices.hasOwnProperty(deviceId)){
            logger.debug("Found config for device "+deviceId);
            const deviceConfig = settings.devices[deviceId]
            if(deviceConfig.deviceType == "Thermostat" || deviceConfig.deviceType == "WallMountedThermostat") {
                try {
                    return this.maxcul.sendDesiredTemperature(deviceId, temperature, "manu", "00", deviceConfig.deviceType);
                } catch (error) {
                    logger.error('Failed to send temperature:' + error);
                }
            }else{
                logger.info("Device doesn't support set temperature");
            }
        }else{
            logger.info("Unknown device to set temperature");
        }
    }

    updatePair(src,target,srcType,targetType){
        this.maxcul.sendPair(src,target,targetType,srcType);
    }

    setDisplayMode(target,mode,deviceType){
        this.maxcul.sendDisplayMode(target,mode,deviceType);
    }

    setMode(deviceId,mode,temperature){
        //We only support manuel mode and off because we cannot set a week programm
        const devices = settings.devices;
        if(devices.hasOwnProperty(deviceId)){
            logger.debug("Found config for device "+deviceId);
            const deviceConfig = settings.devices[deviceId]
            if(deviceConfig.deviceType == "Thermostat" || deviceConfig.deviceType == "WallMountedThermostat"){
                return this.maxcul.sendDesiredTemperature(deviceId,temperature,"manual","00",deviceConfig.deviceType);
            }else{
                throw("Device doesn't support set mode");
            }
        }else{
            throw("Unknown device to set mode: "+deviceId);
        }
    }

    async stop() {
        this.maxcul.stop()
        logger.info('maxcul stopped');
    }

    async onCheckTimeIntervalFired(){
        logger.debug("onCheckTimeIntervalFired");
    }

    onNewDevice(deviceId,repair){
        this.emit("saveNewDevice", deviceId, repair);
    }

    onShutterContactStateRecieved(state){
        const deviceId = state.src;
        delete state.src;
        this.emit("updateDeviceState",{"deviceId": deviceId,"type": "ShutterContact","state": state});
    }

    async onPushButtonStateRecieved(state){
        const deviceId = state.src;
        delete state.src;
        this.emit("updateDeviceState",{"deviceId": deviceId,"type": "PushButton","state": state});
    }

    async onWallThermostatControlRecieved(state){
        console.log(state);
        logger.debug("onWallThermostatControlRecieved",state);
    }

    async onWallThermostatSetTempRecieved(state){
        console.log(state);
        logger.debug("onWallThermostatSetTempRecieved",state);
    }

    async onThermostatStateRecieved(state){
        const deviceId = state.src;
        delete state.src;
        this.emit("updateDeviceState",{"deviceId": deviceId,"type": "Thermostat","state": state});
    }

    async onWallThermostatStateRecieved(state){
        const deviceId = state.src;
        delete state.src;
        this.emit("updateDeviceState",{"deviceId": deviceId,"type": "WallMountedThermostat","state": state});
    }

    onDeviceRequestTimeInformation(packet){
        logger.debug("onDeviceRequestTimeInformation",packet.getSource());
        return this.maxcul.sendTimeInformation(packet.getSource(),packet.getRawType())
    }

}

module.exports = Maxcul;