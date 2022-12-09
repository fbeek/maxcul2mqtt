const JSONdb = require('simple-json-db');
const logger = require('./logger');

class Database{
    constructor(dbPath,dbFilename) {
        this.db = new JSONdb(dbPath+'/'+dbFilename);
    }

    saveDevice(deviceId, deviceType){
        if(this.db.has(deviceId)){
            logger.debug("Device with id "+deviceId+" already in db.")
        }else{
            this.db.set(deviceId,{"deviceType" : deviceType, "state": {}})
        }
    }

    saveModeForThermostat(deviceId,mode){
        let deviceData = this.getDeviceStateById(deviceId);
        if(deviceData){
            deviceData.haMode = mode;
            let maxMode = 0;
            switch(deviceData.haMode){
                case "auto": deviceData.mode = 0;break;
                case "heat":
                    deviceData.mode = 1;
                    deviceData.desiredTemperature = deviceData.lastSetpoint;
                    break;
                case "off":
                    deviceData.mode = 1;
                    deviceData.desiredTemperature = 4.5;break;
                case "boost": deviceData.mode = 2;break;
                default: logger.info("Unknown Mode:"+ mode);
            }
            this.updateDevice(deviceId,deviceData.deviceType, deviceData);
        }else{
            logger.debug("Requested device not in database.");
        }
    }

    getLastSetpointByDeviceId(deviceId){
        let deviceData = this.getDeviceStateById(deviceId);
        if(deviceData){
            let state = deviceData;
            if(state.hasOwnProperty("lastSetpoint")){
                return state.lastSetpoint
            }else{
                return 4.5; //Default to Off
            }
        }else{
            logger.debug("Requested device not in database.");
        }
    }

    saveTemperatureForThermostat(deviceId,setpoint){
        let deviceData = this.getDeviceStateById(deviceId);
        if(deviceData){
            deviceData.lastSetpoint = setpoint;
            deviceData.desiredTemperature = setpoint;
            if(setpoint == 4.5){
                deviceData.mode = 1;
            }
            this.updateDevice(deviceId,deviceData.deviceType, deviceData);
        }else{
            logger.debug("Requested device not in database.");
        }

    }

    saveMeasuredTemperatureForThermostat(deviceId,measuredTemperature){
        let deviceData = this.getDeviceStateById(deviceId);
        if(deviceData){
            deviceData.measuredTemperature = measuredTemperature;
            this.updateDevice(deviceId,deviceData.deviceType, deviceData);
        }else{
            logger.debug("Requested device not in database.");
        }

    }

    updateDevice(deviceId, type, state){
        const deviceData = this.getDeviceById(deviceId);
        const d = new Date();

        if(deviceData){
            Object.assign(deviceData.state, state);
            deviceData.state = Object.assign(deviceData.state, state);
            deviceData.state.lastUpdate = d.toString();
            if(type){
                deviceData.deviceType = type;
            }
            if(state.hasOwnProperty("mode")){
                let haMode = "off"
                switch(parseInt(state.mode)){
                    case 0: haMode = "auto";break;
                    case 1:
                        if(state.desiredTemperature == 4.5){
                            haMode = "off";
                        }else{
                            haMode = "heat";
                        }
                        break;
                    case 2: haMode = "boost";break;
                    default: logger.info("Unknown Mode:"+ state.mode);
                }
                deviceData.state.haMode = haMode;
            }
            this.db.set(deviceId, deviceData);
        }else{
            logger.debug("No data set found to update.");
        }
    }

    getDeviceById(deviceId){
        if(this.db.has(deviceId)){
            return this.db.get(deviceId);
        }else{
            logger.debug("Requested device not in database.");
            return false;
        }
    }

    getDeviceStateById(deviceId) {
        if (this.db.has(deviceId)) {
            let data = this.db.get(deviceId);
            return data.state;
        } else {
            logger.debug("Requested device not in database.");
            return false;
        }
    }
}

module.exports = Database;
