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

        // Start zigbee
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
        this.mqtt.publish('bridge/state', 'online', {retain: true, qos: 0});
        const devices = settings.devices;
        for(let deviceId in devices){
            logger.debug("Send online message for device: " + deviceId);
            this.mqtt.publish(deviceId+"/availability", 'online', {retain: true, qos: 0});
            let state = this.db.getDeviceStateById(deviceId);
            this.mqtt.publish(deviceId+"/state",JSON.stringify(state),{retain: true, qos: 0});
        }
        this.mqtt.subscribe(`${settings.mqtt.base_topic}/bridge/cmd/#`);
    }

    async stop() {
        const devices = settings.devices;
        for(let deviceId in devices){
            logger.debug("Send offline message for device: " + deviceId);
            this.mqtt.publish(deviceId+"/availability", 'offline', {retain: true, qos: 0});
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
            let oldDbState = Object.assign({}, this.db.getDeviceStateById(deviceId));
            switch(command){
                case "sendConfig":
                    this.maxcul.sendConfigToDevice(deviceId,"HeatingThermostat");
                    break;
                case "setTemp":
                    try{
                        await this.maxcul.setTemperature(deviceId,parseFloat(message));
                        this.db.saveTemperatureForThermostat(deviceId,parseFloat(message));
                        logger.debug("Temperature transmitted to device: "+deviceId)
                        let dbState = this.db.getDeviceStateById(deviceId);
                        this.mqtt.publish(deviceId+"/state",JSON.stringify(dbState),{retain: true, qos: 0});
                    }catch(error){
                        logger.error(error);
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
                        logger.debug("Mode transmitted to device: "+deviceId)
                        let dbState = this.db.getDeviceStateById(deviceId);
                        this.mqtt.publish(deviceId+"/state",JSON.stringify(dbState),{retain: true, qos: 0});
                    }catch(error){
                        logger.error(error);
                        this.mqtt.publish(deviceId+"/state",JSON.stringify(oldDbState),{retain: true, qos: 0});
                    }
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