'use strict'
const async = require('async');
function SiteTestHandlers() {
    SiteTestHandlers.prototype.testConnection = function(configuration, connid, signalRClient){
        if (configuration.protocol === "mbus") {
            util.addNpmPackages("node-mbus", true, function (err) {
                if (!err) {
                    if(configuration.connectivity.transport === "tcp"){
                        let mbusOptions = {
                            host: configuration.connectivity.ip,
                            port: configuration.connectivity.port,
                            timeout : 5000
                        };
                        const MbusMaster = require('node-mbus');
                        const mbusMaster = new MbusMaster(mbusOptions);
                        mbusMaster.connect(function(err){
                            if(!err){
                                signalRClient.invoke('testConnectionResponse', connid, true);
                                mbusMaster.close();
                            }
                            else{
                                signalRClient.invoke('testConnectionResponse', connid, false);
                            }
                        });
                    }
                    else if(configuration.connectivity.transport === "serial"){
                        let mbusOptions = {
                            serialPort : configuration.connectivity.serialPort,
                            serialBaudRate : configuration.connectivity.baudRate
                        };
                        const MbusMaster = require('node-mbus');
                        const mbusMaster = new MbusMaster(mbusOptions);
                        mbusMaster.connect(function(err){
                            if(!err){
                                signalRClient.invoke('testConnectionResponse', connid, true);
                                mbusMaster.close();
                            }
                            else{
                                signalRClient.invoke('testConnectionResponse', connid, false);
                            }
                        });
                    }
                    
                }
                else {
                    signalRClient.invoke('notify', connid, `Failed downloading Npm package needed for test`, "INFO");
                }
            });
        }
        else if (configuration.protocol === "modbus") {
            let packageVersion = "modbus-serial";
            switch (process.version.substring(1, 3)) { // Get version to decide which version to use
                case "8.":
                    packageVersion = `${packageVersion}@5.3.2`;
                    break;
                default:
                    break;
            }
            util.addNpmPackages(packageVersion, true, function (err) {
                if (!err) {
                    const ModbusRTU = require('modbus-serial');
                    const client = new ModbusRTU();
                    if (configuration.connectivity.transport === "tcp") {
                        client.connectTCP(configuration.connectivity.ip, { port: configuration.connectivity.networkPort }, function (error) {
                            if (!error) {
                                signalRClient.invoke('testConnectionResponse', connid, true);
                                client.close();
                            }
                            else {
                                signalRClient.invoke('testConnectionResponse', connid, false);
                            }
                        });
                    }
                    else if (configuration.transport === "Serial") {
                        client.connectRTUBuffered(configuration.connectivity.port, {
                            baudRate: configuration.connectivity.baudRate,
                            parity: configuration.connectivity.parity,
                            stopBits : configuration.connectivity.stopBits,
                            dataBits : configuration.connectivity.dataBits
                        }, function(error){
                            if (!error) {
                                signalRClient.invoke('testConnectionResponse', connid, true);
                                client.close();
                            }
                            else {
                                signalRClient.invoke('testConnectionResponse', connid, false);
                            }
                        });
                    }
                }
                else {
                    signalRClient.invoke('notify', connid, `Failed downloading Npm package needed for test`, "INFO");
                }
            });
        }
    };
    SiteTestHandlers.prototype.testSiteConfiguration = function(configuration, connid, signalRClient){
        if (configuration.protocol === "mbus") {
            util.addNpmPackages("node-mbus", true, function (err) {
                if (!err) {
                    if(configuration.connectivity.transport === "tcp"){
                        let mbusOptions = {
                            host: configuration.connectivity.ip,
                            port: configuration.connectivity.port,
                            timeout : 5000
                        };
                        const MbusMaster = require('node-mbus');
                        const mbusMaster = new MbusMaster(mbusOptions);
                        mbusMaster.connect(function(err){
                            if(!err){
                                client.invoke('notify', connid, `Connection to mbus TCP meter successfull, initiating scan`, "INFO");
                                mbusMaster.scanSecondary(function(error, deviceList){
                                    if(!error){
                                        signalRClient.invoke('notify', connid, `Scan complete, found ${deviceList.length} devices. Fetching data..`, "INFO");
                                        let payload = [];
                                        async.eachSeries(deviceList, function(device, callback){
                                            mbusMaster.getData(device, function(err, data){
                                                if(!err){
                                                    payload.push(data);
                                                }
                                                callback();
                                            });
                                        }, function(){
                                            mbusMaster.close();
                                            if(payload.length > 0){
                                                signalRClient.invoke('testSiteConfigurationResponse', connid, payload);
                                            }
                                            else{
                                                signalRClient.invoke('notify', connid, `Failed getting data from all of the devices`, "INFO");
                                            }
                                            
                                        });
                                    }
                                });
                            }
                            else{
                                signalRClient.invoke('notify', connid, `Connection to mbus TCP meter failed`, "INFO");
                            }
                        });
                    }
                    else if(configuration.connectivity.transport === "serial"){
                        let mbusOptions = {
                            serialPort : configuration.connectivity.serialPort,
                            serialBaudRate : configuration.connectivity.baudRate
                        };
                        const MbusMaster = require('node-mbus');
                        const mbusMaster = new MbusMaster(mbusOptions);
                        mbusMaster.connect(function(err){
                            if(!err){
                                signalRClient.invoke('notify', connid, `Connection to mbus serial meter successfull`, "INFO");
                                mbusMaster.scanSecondary(function(error, deviceList){
                                    if(!error){
                                        signalRClient.invoke('notify', connid, `Scan complete, found ${deviceList.length} devices. Fetching data..`, "INFO");
                                        let payload = [];
                                        async.eachSeries(deviceList, function(device, callback){
                                            mbusMaster.getData(device, function(err, data){
                                                if(!err){
                                                    payload.push(data);
                                                }
                                                callback();
                                            });
                                        }, function(){
                                            mbusMaster.close();
                                            if(payload.length > 0){
                                                signalRClient.invoke('testSiteConfigurationResponse', connid, payload);
                                            }
                                            else{
                                                signalRClient.invoke('notify', connid, `Failed getting data from all of the devices`, "INFO");
                                            }
                                        });
                                    }
                                });
                            }
                            else{
                                signalRClient.invoke('notify', connid, `Connection to mbus serial meter failed`, "INFO");
                            }
                        });
                    }
                }
                else {
                    signalRClient.invoke('notify', connid, `Failed downloading Npm package needed for test`, "INFO");
                }
            });
        }
        else if (configuration.protocol === "modbus") {
            let packageVersion = "modbus-serial";
            switch (process.version.substring(1, 3)) { // Get version to decide which version to use
                case "8.":
                    packageVersion = `${packageVersion}@5.3.2`;
                    break;
                default:
                    break;
            }
            util.addNpmPackages(packageVersion, true, function (err) {
                if (!err) {
                    const ModbusRTU = require('modbus-serial');
                    const client = new ModbusRTU();
                    if (configuration.connectivity.transport === "tcp") {
                        client.connectTCP(configuration.ip, { port: configuration.connectivity.networkPort }, function (error) {
                            if (!error) {
                                client.setID(configuration.connectivity.slaveAddress);
                                let value = 0;
                                let registerSize = 1;
                                switch (configuration.dataType) {
                                    case "Int16":
                                    case "UInt16":
                                        registerSize = 1;
                                        break;
                                    case "Float32":
                                    case "Int32":
                                    case "UInt32":
                                        registerSize = 2;
                                        break;
                                    default:
                                        break;
                                }
                                signalRClient.invoke('notify', connid, `Connection to modbus TCP meter successfull`, "INFO");
                                switch (configuration.modbusFunction) {
                                    case "Read holding registers":
                                        client.readHoldingRegisters(configuration.registerAddress, registerSize, function (err, data) {
                                            if (!err) {
                                                switch (configuration.dataType) {
                                                    case "Int32":
                                                        value = ((data.data[1] << 16) | data.data[0]); // 32 bit are signed values

                                                        // Check if negative
                                                        if (value > 2147483647) {
                                                            value = -1 * (4294967296 - value);
                                                        }
                                                        break;
                                                    case "UInt32":
                                                        value = ((data.data[1] << 16) | data.data[0]);
                                                    case "Float32":
                                                        value = data.buffer.readFloatBE(0);
                                                        value = Number(Number.parseFloat(value).toFixed(7)); //Remove unnecessary decimals and convert back to a number
                                                    default:
                                                        value = data.data[0];
                                                        break;
                                                }
                                                signalRClient.invoke('testSiteConfigurationResponse', connid, value);
                                                client.close();
                                            }
                                            else {
                                                signalRClient.invoke('notify', connid, `Failed getting data`, "INFO");
                                                client.close();
                                            }
                                        });
                                        break;
                                    case "Read input registers":
                                        client.readInputRegisters(configuration.registerAddress, registerSize, function (err, data) {
                                            if (!err) {
                                                switch (configuration.dataType) {
                                                    case "Int32":
                                                        value = ((data.data[1] << 16) | data.data[0]); // 32 bit are signed values

                                                        // Check if negative
                                                        if (value > 2147483647) {
                                                            value = -1 * (4294967296 - value);
                                                        }
                                                        break;
                                                    case "UInt32":
                                                        value = ((data.data[1] << 16) | data.data[0]);
                                                    case "Float32":
                                                        value = data.buffer.readFloatBE(0);
                                                        value = Number(Number.parseFloat(value).toFixed(7)); //Remove unnecessary decimals and convert back to a number
                                                    default:
                                                        value = data.data[0];
                                                        break;
                                                }
                                                signalRClient.invoke('testSiteConfiguration', connid, value);
                                                client.close();
                                            }
                                            else {
                                                signalRClient.invoke('notify', connid, `Failed getting data`, "INFO");
                                                client.close();
                                            }
                                        });
                                        break;
                                    default:
                                        client.close();
                                        break;
                                }
                            }
                            else {
                                signalRClient.invoke('notify', connid, `Connection to modbus TCP meter failed`, "INFO");
                            }
                        });
                    }
                    else if (configuration.transport === "Serial") {
                        client.connectRTUBuffered(configuration.port, {
                            baudRate: configuration.baudRate,
                            parity: configuration.parity,
                            stopBits : configuration.stopBits,
                            dataBits : configuration.dataBits
                        }, function(error){
                            if (!error) {
                                client.setID(configuration.connectivity.slaveAddress);
                                let value = 0;
                                let registerSize = 1;
                                switch (configuration.dataType) {
                                    case "Int16":
                                    case "UInt16":
                                        registerSize = 1;
                                        break;
                                    case "Float32":
                                    case "Int32":
                                    case "UInt32":
                                        registerSize = 2;
                                        break;
                                    default:
                                        break;
                                }
                                signalRClient.invoke('notify', connid, `Connection to modbus TCP meter successfull`, "INFO");
                                switch (configuration.modbusFunction) {
                                    case "Read holding registers":
                                        client.readHoldingRegisters(configuration.registerAddress, registerSize, function (err, data) {
                                            if (!err) {
                                                switch (configuration.dataType) {
                                                    case "Int32":
                                                        value = ((data.data[1] << 16) | data.data[0]); // 32 bit are signed values

                                                        // Check if negative
                                                        if (value > 2147483647) {
                                                            value = -1 * (4294967296 - value);
                                                        }
                                                        break;
                                                    case "UInt32":
                                                        value = ((data.data[1] << 16) | data.data[0]);
                                                    case "Float32":
                                                        value = data.buffer.readFloatBE(0);
                                                        value = Number(Number.parseFloat(value).toFixed(7)); //Remove unnecessary decimals and convert back to a number
                                                    default:
                                                        value = data.data[0];
                                                        break;
                                                }
                                                signalRClient.invoke('testSiteConfiguration', connid, value);
                                                client.close();
                                            }
                                            else {
                                                signalRClient.invoke('notify', connid, `Failed getting data`, "INFO");
                                                client.close();
                                            }
                                        });
                                        break;
                                    case "Read input registers":
                                        client.readInputRegisters(configuration.registerAddress, registerSize, function (err, data) {
                                            if (!err) {
                                                switch (configuration.dataType) {
                                                    case "Int32":
                                                        value = ((data.data[1] << 16) | data.data[0]); // 32 bit are signed values

                                                        // Check if negative
                                                        if (value > 2147483647) {
                                                            value = -1 * (4294967296 - value);
                                                        }
                                                        break;
                                                    case "UInt32":
                                                        value = ((data.data[1] << 16) | data.data[0]);
                                                    case "Float32":
                                                        value = data.buffer.readFloatBE(0);
                                                        value = Number(Number.parseFloat(value).toFixed(7)); //Remove unnecessary decimals and convert back to a number
                                                    default:
                                                        value = data.data[0];
                                                        break;
                                                }
                                                signalRClient.invoke('testSiteConfiguration', connid, value);
                                                client.close();
                                            }
                                            else {
                                                signalRClient.invoke('notify', connid, `Failed getting data`, "INFO");
                                                client.close();
                                            }
                                        });
                                        break;
                                    default:
                                        client.close();
                                        break;
                                }
                            }
                            else {
                                signalRClient.invoke('notify', connid, `Connection to modbus TCP meter failed`, "INFO");
                            }
                        });
                    }
                }
                else {
                    signalRClient.invoke('notify', connid, `Failed downloading Npm package needed for test`, "INFO");
                }
            });
        }
    };
}
module.exports = SiteTestHandlers;