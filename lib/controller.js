const MQTT = require('./mqtt');
const logger = require('./util/logger');
const utils = require('./util/utils');
const Maxcul = require('./maxcul');
const Database = require('./util/database');
const settings = require('./util/settings');

class Controller {
    constructor() {
        this.maxcul = new Maxcul;
        this.mqtt = new MQTT();
        this.db = new Database(settings.database.db_path,settings.database.db_file);
    }

    async start() {
        const info = await utils.getMaxcul2mqttVersion();
        logger.info(`Starting maxcul2MQTT version ${info.version} (commit #${info.commitHash})`);

        // Start maxcul
        try {
            await this.maxcul.start();
            this.maxcul.on('event', this.onMaxculEvent.bind(this));
            this.maxcul.on('updateDeviceState',this.onUpdateDeviceState.bind(this));
            this.maxcul.on('adapterDisconnected', this.onMaxculAdapterDisconnected);
            this.maxcul.on('saveNewDevice', this.onNewDevice.bind(this));
        } catch (error) {
            logger.error('Failed to start maxcul');
            logger.error('Exiting...');
            logger.error(error.stack);
            process.exit(1);
        }

        // MQTT
        this.mqtt.on('message', this.onMQTTMessage.bind(this));
        await this.mqtt.connect();
        await this.mqtt.publish('bridge/state', 'online', {retain: true, qos: 0});
        await this.sendAvailabilityAndLastState();
        this.mqtt.subscribe(`${settings.mqtt.base_topic}/bridge/cmd/#`);

        this.availabilityTimer = setInterval(this.sendAvailabilityAndLastState.bind(this),1000*60*10);
        this.fakeTemperatureTimer = setInterval(this.sendFakeTemperatureData.bind(this),1000*60*15);
    }

    async sendFakeTemperatureData(){
        logger.debug("Send fake temperature data");
        const devices = settings.devices;
        for(let deviceName in devices){
            let device = devices[deviceName];
            if(device.deviceType === "FakeWallMountedThermostat" && device.deviceType === "FakeShutterContact"){
                for(let pair in device.pairIds){
                    logger.debug("Send Fake Temp. message for device: " + device.pairIds[pair].pairId);
                    let dbState = this.db.getDeviceStateById(device.pairIds[pair].pairId);
                    await this.maxcul.sendFakeTemperatureMessage(device.pairIds[pair].pairId, dbState.measuredTemperature, dbState.desiredTemperature);
                }
            }
        }
    }

    async sendAvailabilityAndLastState(){
        logger.debug("Send availability info");
        const devices = settings.devices;
        for(let deviceName in devices){
            let device = devices[deviceName];
            if(device.deviceType !== "FakeWallMountedThermostat" && device.deviceType !== "FakeShutterContact"){
                logger.debug("Send online message for device: " + device.deviceId);
                let state = this.db.getDeviceStateById(device.deviceId);
                if(state){
                    await this.mqtt.publish(device.deviceId+"/availability", 'online', {retain: true, qos: 0});
                    await this.mqtt.publish(device.deviceId+"/state",JSON.stringify(state),{retain: true, qos: 0});
                }else{
                    await this.mqtt.publish(device.deviceId+"/availability", 'offline', {retain: true, qos: 0});
                }
            }else{
                logger.debug("Found Fake device: " + device.deviceId + " "+device.deviceType);
            }
        }
    }

    async stop() {
        clearInterval(this.availabilityTimer);
        clearInterval(this.fakeTemperatureTimer);
        const devices = settings.devices;
        for(let deviceId in devices){
            logger.debug("Send offline message for device: " + deviceId);
            await this.mqtt.publish(deviceId+"/availability", 'offline', {retain: true, qos: 0});
        }
        await this.mqtt.disconnect();

        try {
            await this.maxcul.stop();
            process.exit(0);
        } catch (error) {
            logger.error('Failed to stop maxcul');
            process.exit(1);
        }
    }

    async onMQTTMessage(payload) {
        const {topic, message} = payload;
        logger.debug(`Received MQTT message on '${topic}' with data '${message}'`);
        const topicParts = topic.split("/");
        const cmdKey = utils.getKeyByValue(topicParts,"cmd");
        if(cmdKey !== undefined){
            const command = topicParts.pop();
            const deviceId = topicParts.pop();
            switch(command){
                case "sendConfig":
                    this.maxcul.sendConfigToDevice(deviceId);
                    break;
                case "setTemp":
                    try{
                        await this.maxcul.setTemperature(deviceId,parseFloat(message));
                        this.db.saveTemperatureForThermostat(deviceId,parseFloat(message));
                        let dbState = this.db.getDeviceStateById(deviceId);
                        this.mqtt.publish(deviceId+"/state",JSON.stringify(dbState),{retain: true, qos: 0});
                    }catch(error){
                        logger.error(error);
                        let oldDbState = Object.assign({}, this.db.getDeviceStateById(deviceId));
                        this.mqtt.publish(deviceId+"/state",JSON.stringify(oldDbState),{retain: true, qos: 0});
                    }
                    break;
                case "setMode":
                    let temp = 4.5;
                    if(message === "heat"){
                        temp = this.db.getLastSetpointByDeviceId(deviceId);
                    }
                    try {
                        await this.maxcul.setMode(deviceId, message, temp);
                        this.db.saveModeForThermostat(deviceId,message);
                        let dbState = this.db.getDeviceStateById(deviceId);
                        this.mqtt.publish(deviceId+"/state",JSON.stringify(dbState),{retain: true, qos: 0});
                    }catch(error){
                        logger.error(error);
                        let oldDbState = Object.assign({}, this.db.getDeviceStateById(deviceId));
                        this.mqtt.publish(deviceId+"/state",JSON.stringify(oldDbState),{retain: true, qos: 0});
                    }
                    break;
                case "setDisplayMode":
                    let device = settings.devices[deviceId];
                    this.maxcul.setDisplayMode(deviceId,message == "true" ? 1 : 0,device.deviceType)
                    break;
                case "updatePairing":
                    const masterDevice = settings.devices[deviceId];
                    if(masterDevice.pairIds.length > 0){
                        logger.info("found pair ids for device: " + deviceId);
                        for(let pair in masterDevice.pairIds){
                            let data = masterDevice.pairIds[pair];
                            await this.maxcul.updatePair(deviceId,data.pairId,masterDevice.deviceType,data.type);
                        }
                    }
                    break;
                case "updateFakeThermostat":
                    let temperature = parseFloat(message);
                    logger.info("Update Fake Wallthermostat with ID : "+deviceId+" and temperature "+message);
                    let fakeDevice = settings.devices[deviceId];
                    for(let pair in fakeDevice.pairIds){
                        let dbState = this.db.getDeviceStateById(fakeDevice.pairIds[pair].pairId);
                        this.db.saveMeasuredTemperatureForThermostat(fakeDevice.pairIds[pair].pairId,message);
                        await this.maxcul.sendFakeTemperatureMessage(fakeDevice.pairIds[pair].pairId, message, dbState.desiredTemperature);
                        this.mqtt.publish(fakeDevice.pairIds[pair].pairId+"/state",JSON.stringify(dbState),{retain: true, qos: 0});
                    }
                    break;
                case "updateFakeShutterContact":
                    let state = parseInt(message);
                    logger.info("Update Fake ShutterContact with ID : "+deviceId+" and state "+ message ? "open" : "closed");
                    break;
                default:
                    logger.info("Unknown Command received via mqtt : "+command);
            }
        }

    }

    onNewDevice(deviceId,repair){
        this.db.saveDevice(deviceId,null);
    }

    onUpdateDeviceState(data){
        const {deviceId,type ,state} = data;
        this.db.updateDevice(deviceId, type, state);
        let dbState = this.db.getDeviceStateById(deviceId);
        this.mqtt.publish(deviceId+"/state",JSON.stringify(dbState),{retain: true, qos: 0});
    }

    async onMaxculAdapterDisconnected() {
        logger.error('Adapter disconnected, stopping');
        await this.stop();
    }

    async onMaxculEvent(type, data) {

    }
}

module.exports = Controller;