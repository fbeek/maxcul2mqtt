class CulPacket {
    constructor() {
        this.length = 0;
        this.messageCount = 0;
        this.flag = 0;
        this.groupid = 0;
        this.source = '';
        this.dest = '';
        this.rawType = '';
        this.rawPayload = '';
        this.forMe = false;
        this.command = '';
        this.status = 'new';
        this.rawPacket = '';
        this.rawPayload = '';
        this.sendTries = 0;
        this.decodedPayload = null;
    }

    getLength() { return this.length; }
    setLength(length) { this.length = length; }

    getMessageCount() { return this.messageCount; }
    setMessageCount(messageCount) { this.messageCount = messageCount; }

    getFlag() { return this.flag; }
    setFlag(flag) {  this.flag = flag; }

    getGroupId() { return this.groupid; }
    setGroupId(groupid) { this.groupid = groupid; }

    getSource() { return this.source; }
    setSource(source) { this.source = source.toLowerCase(); }

    getDest() { return this.dest; }
    setDest(dest) { this.dest = dest.toLowerCase(); }

    getRawType() { return this.rawType; }
    setRawType(rawType) { this.rawType = rawType; }

    getRawPayload() { return this.rawPayload; }
    setRawPayload(rawPayload) { this.rawPayload = rawPayload; }

    getForMe() { return this.forMe; }
    setForMe(forMe) { this.forMe = forMe; }

    getCommand() { return this.command; }
    setCommand(command) { this.command = command; }

    getStatus() { return this.status; }
    setStatus(status) { this.status = status; }

    getRawPacket() { return this.rawPacket; }
    setRawPacket(rawPacket) { this.rawPacket = rawPacket; }

    getRawPayload() { return this.rawPayload; }
    setRawPayload(rawPayload) { this.rawPayload = rawPayload.toUpperCase(); }

    getSendTries() { return this.sendTries; }
    setSendTries(sendTries) { this.sendTries = sendTries; }

    getDecodedPayload() { return this.decodedPayload; }
    setDecodedPayload(decodedPayload) { this.decodedPayload = decodedPayload; }
};
module.exports = CulPacket;
