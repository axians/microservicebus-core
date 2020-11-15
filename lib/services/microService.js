/*
The MIT License (MIT)

Copyright (c) 2014 microServiceBus.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/* jshint node: true */
/* jshint esversion: 6 */
/* jshint strict:false */
'use strict';
var extend = require('extend');
var guid = require('uuid');
var os = require('os');
var momentTZ = require('moment-timezone');
var cronJob = require('cron').CronJob;
var fs = require('graceful-fs');
var path = require("path");
var util = require('../utils.js');
//var npmFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname + "/../../../";
var npmFolder = path.resolve(os.userInfo().homedir, 'node_module');

function MicroService(microService) {
    // Common helpers and functions
    this.util = require('../utils.js');
    this.TTLCollection = require("../TTLCollection");
    this.RaucHandler = require("../RaucHandler"); 

    // Settings applied in startServiceAsync
    this.settingsHelper = "Not set";
    this.NodeName = "Not set";
    this.Name = "Not set";
    this.OrganizationId = "Not set";
    this.IntegrationId = "Not set";
    this.IntegrationName = "Not set";
    this.Version = "Not set";
    this.Environment = "Not set";
    this.ItineraryId = "Not set";
    this.Itinerary = "Not set";
    this.Config = { "general": {}, "static": {}, "security": {} };
    this.IsEnabled = "Not set";
    this.UseEncryption = false;
    this.App = null; // Used for Azure API Apps

    this.RunInboundScript = "Not set";
    this.RunOutboundScript = "Not set";
    this.RunScript = "Not set";
    this.ValidateRoutingExpression = "Not set";
    this.ComSettings = null;

    // Callbacks
    this.onMessageReceivedCallback = null;
    this.onReceivedStateCallback = null;
    this.onCompletedCallback = null;
    this.onErrorCallback = null;
    this.onDebugCallback = null;
    this.onThrowErrorCallback = null;
    this.onReceivedLocationCallback = null;
    this.onUnitTestComplete = null;

    const PREVIOUS_NODE = "PreviousNode";
    MicroService.prototype.Start = function () {
        console.log("microserviceBus::Started - NOT IMPLEMENTED!");
    };

    MicroService.prototype.StartAsync = null;
    
    MicroService.prototype.Stop = function () {
        console.log("microserviceBus::Stopped - NOT IMPLEMENTED!");
    };

    MicroService.prototype.StopAsync = null;

    MicroService.prototype.Process = function (message, context) {
        console.log("microserviceBus::Process - NOT IMPLEMENTED!");
    };

    // Callback for messages going back to the host 
    MicroService.prototype.OnMessageReceived = function (callback) {
        this.onMessageReceivedCallback = callback;
    };
    // Callback for messages going back to the host 
    MicroService.prototype.OnReceivedState = function (callback) {
        this.onReceivedStateCallback = callback;
    };
    // Callback indicating the outbound message has been processed.
    MicroService.prototype.OnCompleted = function (callback) {
        this.onCompletedCallback = callback;
    };
    // [Depricated] Callback for errors 
    MicroService.prototype.OnError = function (callback) {
        this.onErrorCallback = callback;
    };
    // Callback for debug information
    MicroService.prototype.OnDebug = function (callback) {
        this.onDebugCallback = callback;
    };
    // Callback for Report location
    MicroService.prototype.OnReportLocation = function (callback) {
        this.onReceivedLocationCallback = callback;
    };
    MicroService.prototype.OnUnitTestComplete = function (callback) {
        this.onUnitTestComplete = callback;
    };

    // Submits message back to the host
    MicroService.prototype.SubmitMessage = function (payload, contentType, variables) {

        var messageBuffer;
        var isBinary = false;
        switch (contentType) {
            case 'application/json':
                if (typeof payload == 'object') {
                    payload = JSON.stringify(payload);
                }

                messageBuffer = new Buffer(payload);
                break;
            case 'application/xml':
            case 'text/plain':
                messageBuffer = new Buffer(String(payload));
                break;
            case 'application/octet-stream':
                isBinary = true;
                messageBuffer = payload;
                break;
            default:
                isBinary = true;
                var base64string = payload.toString('base64');
                messageBuffer = new Buffer(base64string);
                break;
        }

        var integrationMessage = this.CreateMessage(messageBuffer, contentType, variables, isBinary);

        this.onMessageReceivedCallback(integrationMessage, this);
    };
    // Submits state message back to the host 
    MicroService.prototype.SubmitState = function (state) {

        this.onReceivedStateCallback(state, this.Name);
    };

    // Submits reponse message back to host
    MicroService.prototype.SubmitResponseMessage = function (payload, context, contentType) {

        var isBinary = false;
        var messageBuffer;
        switch (contentType) {
            case 'application/json':
                payload = JSON.stringify(payload);
                messageBuffer = new Buffer(payload);//.toString('base64');
                break;
            case 'application/xml':
            case 'text/plain':
                messageBuffer = new Buffer(payload);//.toString('base64');
                break;
            default:
                messageBuffer = payload;
                isBinary = true;
                break;
        }

        var integrationMessage = {
            InterchangeId: context.InterchangeId,
            IntegrationId: context.IntegrationId,
            ItineraryId: context.ItineraryId,
            CreatedBy: context.CreatedBy,
            LastActivity: this.Name,
            ContentType: contentType,
            Itinerary: context.Itinerary,
            MessageBuffer: messageBuffer,
            _messageBuffer: messageBuffer,
            IsBinary: isBinary,
            IsLargeMessage: false,
            IsCorrelation: false,
            IsFirstAction: false,
            Variables: context.Variables
        };

        this.onMessageReceivedCallback(integrationMessage, this);
    };

    // Call indicating the outbound message has been processed.
    MicroService.prototype.Done = function (integrationMessage, destination) {
        this.onCompletedCallback(integrationMessage, destination);
    };

    // Call indicating the outbound message has been processed.
    MicroService.prototype.UnitTestComlete = function (err) {
        if (this.onUnitTestComplete) {
            this.onUnitTestComplete(err);
        }
        else {
        }
    };

    MicroService.prototype.ReportLocation = function (location) {
        if (this.onReceivedLocationCallback)
            this.onReceivedLocationCallback(location);
    };

    /* istanbul ignore next */
    MicroService.prototype.Error = function (source, errorId, errorDescription) {
        this.onErrorCallback(source, errorId, errorDescription);
    };

    MicroService.prototype.ThrowError = function (originalMessage, errorId, errorDescription) {
        if (originalMessage == null) { // Inbound service
            var messageBuffer = new Buffer('').toString('base64');
            originalMessage = this.CreateMessage(messageBuffer, 'text/plain', [], false);
            originalMessage.IsFirstAction = true;
        }
        originalMessage.LastActivity = this.Name;
        originalMessage.FaultCode = errorId;
        originalMessage.FaultDescripton = errorDescription;
        this.onMessageReceivedCallback(originalMessage, this);
    };

    MicroService.prototype.CreateTicket = function (originalMessage, errorId, errorDescription) {
        if (originalMessage == null) { // Inbound service
            var messageBuffer = new Buffer('').toString('base64');
            originalMessage = this.CreateMessage(messageBuffer, 'text/plain', [], false);
            originalMessage.IsFirstAction = true;
        }
        originalMessage.LastActivity = this.Name;
        originalMessage.FaultCode = errorId;
        originalMessage.CreateTicket = true;
        originalMessage.FaultDescripton = errorDescription;
        this.onMessageReceivedCallback(originalMessage, this);
    };
    MicroService.prototype.Debug = function (info) {
        // Truncating information if exceeding 1000 character
        info = info.length > 1000 ? `[TRUNCATED!] ${info.substring(0,1000)}` : info;
        this.onDebugCallback(this.Name, info);
    };

    MicroService.prototype.ReportLocation = function (location) {
        if (this.onReceivedLocationCallback)
            this.onReceivedLocationCallback(location);
    };

    MicroService.prototype.AddNpmPackage = function (npmPackages, logOutput, callback) {
        util.addNpmPackages(npmPackages, logOutput, callback);
    };

    MicroService.prototype.ParseString = function (str, payload, context) {
        try {
            // Parse with context '{}'
            var match;
            var regstr = str;
            var pattern = /\{(.*?)\}/g;

            while ((match = pattern.exec(str)) != null) {
                var variable = context.Variables.find(function (v) { return v.Variable === match[1]; });
                if (variable != null) {
                    regstr = regstr.replace('{' + match[1] + '}', variable.Value);
                    // return str;
                }
            }

            if (context.ContentType != 'application/json') {
                return regstr;
            }

            if (context.ContentType == 'application/json' && typeof payload == "object") {
                payload = JSON.stringify(payload);
            }

            // Parse with payload '[]'
            pattern = /\[(.*?)\]/g;

            while ((match = pattern.exec(regstr)) != null) {
                var someStr = "";
                var expression = "var message = " + payload + ";\nsomeStr = message." + match[1] + ";";
                eval(expression);
                regstr = regstr.replace('[' + match[1] + ']', someStr);

                //return str;
            }
            return regstr;
        }
        catch (ex) {
            throw ex;
        }
    };
    MicroService.prototype.GetCurrentState = function () {
        return this.settingsHelper.settings.deviceState;
    }
    MicroService.prototype.GetValueByPath = function (obj, path, defaultValue) {
        return util.getValueByPath(obj, path, defaultValue);
    }
    MicroService.prototype.Compile = function (tarUri, addonName, done) {
        let async = require("async");
        let settingsHelper = this.settingsHelper;
        let me = this;
        let addonsDirectory = path.resolve(settingsHelper.homeDirectory, "addons");
        async.waterfall([
            // Create folder
            function (callback) {
                try {

                    me.onDebugCallback(me.Name, "addonsDirectory : " + addonsDirectory);
                    // Create addOn directory
                    if (!fs.existsSync(addonsDirectory)) {
                        console.log('Create directory: ' + addonsDirectory);
                        fs.mkdirSync(addonsDirectory);
                    }

                    var directory = path.resolve(addonsDirectory, addonName);

                    // Create addOn directory
                    if (!fs.existsSync(directory)) {
                        console.log('Create directory: ' + directory);
                        fs.mkdirSync(directory);
                    }
                    callback(null, directory);
                }
                catch (err) {
                    me.onDebugCallback(me.Name, 'Unable to create addons directory');
                    callback(err);
                }
            },
            // Download tar file
            function (directory, callback) {
                let requestSettings = {
                    method: 'GET',
                    url: tarUri,
                    encoding: null
                };
                require("request")(requestSettings, function (err, response, scriptContent) {
                    if (response.statusCode != 200 || err != null) {
                        callback("Unable to get dependancy file");
                    }
                    else {
                        try {
                            var localFilePath = path.resolve(directory, addonName + ".tar");
                            me.onDebugCallback(me.Name, 'Saving addon file: ' + localFilePath);
                            fs.writeFileSync(localFilePath, scriptContent);
                            callback(null, directory, localFilePath);
                        }
                        catch (err) {
                            me.onDebugCallback(me.Name, 'Unable to save addons file');
                            callback(err);
                        }
                    }
                });
            },
            // Extract
            function (directory, localFilePath, callback) {
                util.addNpmPackages("tar@4.0.2", false, function (err) {
                    if (err) {
                        me.onDebugCallback(me.Name, 'Unable to add tar npm pkg');
                        callback(err);
                    }
                    else {
                        let tar = require('tar');
                        tar.x(
                            {
                                cwd: directory,
                                file: localFilePath
                            }
                        ).then(function () {
                            callback(null, directory);

                        });
                    }
                });
            },
            // Create gyp file
            function (directory, callback) {
                let target = {
                    target_name: addonName,
                    sources: []
                };
                let bindingsGypExists = false;
                fs.readdir(directory, function (err, files) {
                    async.forEach(files, function (file, done2) {
                        target.sources.push(file);
                        if (file === "binding.gyp")
                            bindingsGypExists = true;
                        done2();
                    }, function (err) {
                        let bindingGyp = {
                            targets: [target]
                        };

                        if (bindingGyp.targets.length) {
                            // Create binding file if not wxists
                            if (!bindingsGypExists) {
                                fs.writeFileSync(path.resolve(directory, "binding.gyp"), JSON.stringify(bindingGyp));
                            }
                            // Create package file
                            me.onDebugCallback(me.Name, 'Addon name: ' + addonName);
                            fs.writeFileSync(path.resolve(directory, "package.json"), '{"name":"' + addonName + '","version":"1.0.0","description":"...","dependencies":{},"devDependencies":{},"scripts":{},"author":"","license":"MIT","repository":{},"config":{"unsafe-perm":true},"gypfile":true}');
                            // BUILD
                            callback(null, directory);
                        }
                        else {
                            callback(null, directory);
                        }
                    });

                });
            },
            // Build
            function (directory, callback) {
                me.onDebugCallback(me.Name, 'Compiling addon...');
                util.compile(directory, function (err, data) {
                    me.onDebugCallback(me.Name, 'Done compiling...');

                    me.onDebugCallback(me.Name, '');
                    if (err) {
                        me.onDebugCallback(me.Name, 'Unable to compile service.'.red);
                        me.onDebugCallback(me.Name, 'ERROR: '.red + err);
                        callback(err);
                    }
                    else {
                        me.onDebugCallback(me.Name, 'Service compiled successfully..'.green);
                        me.onDebugCallback(me.Name, 'data = ' + JSON.stringify(data));

                        callback(null, directory);
                    }
                });
            },
        ],
            function (err, directory) {
                if (!err) {
                    let npmpath = path.resolve(settingsHelper.nodePackagePath + "/" + addonName + "/build/Release/" + addonName);
                    me.onDebugCallback(me.Name, 'NPM path: ' + npmpath);
                    done(null, npmpath);
                }
                else {
                    me.onDebugCallback(me.Name, 'ERROR: ' + err);
                    done(err);
                }
            });
    }
    // Internal
    MicroService.prototype.CreateMessage = function (messageBuffer, contentType, variables, isBinary) {

        // clone itinerary
        // var json = JSON.stringify(this.Itinerary);
        // var itinerary = JSON.parse(json);
        var itinerary = this.Itinerary;
        if (variables && itinerary.variables) {
            itinerary.variables.forEach(function (itineraryVariable) {
                if (!variables.find(function (messageVariable) {
                    return messageVariable.Variable === itineraryVariable.Variable;
                })) {
                    variables.push(itineraryVariable);
                }
            });
        }
        //variables = itinerary.variables.concat(variables);

        var sameAsLastAction = variables.find(function (v) { return v.key === PREVIOUS_NODE; });
        if (sameAsLastAction) {
            sameAsLastAction = this.NodeName;
        }
        else {
            let previousNode = variables.find(function (v) {
                return v.Variable === PREVIOUS_NODE;
            });
            if (previousNode) {
                previousNode.Value = this.NodeName;
            }
            else {
                variables.push({ Variable: PREVIOUS_NODE, Type: 'String', Value: this.NodeName });
            }
        }

        itinerary.variables = variables;

        var integrationMessage = {
            InterchangeId: guid.v1(),
            IntegrationId: this.IntegrationId,
            IntegrationName: this.IntegrationName,
            Environment: this.Environment,
            TrackingLevel: this.TrackingLevel,
            ItineraryId: this.ItineraryId,
            CreatedBy: this.Name,
            LastActivity: this.Name,
            ContentType: contentType,
            Itinerary: itinerary,
            MessageBuffer: null,//messageBuffer.toString('base64'),
            _messageBuffer: messageBuffer.toString('base64'),
            IsBinary: isBinary,
            IsLargeMessage: false,
            IsCorrelation: false,
            IsFirstAction: true,
            Variables: variables
        };

        return integrationMessage;
    };

    MicroService.prototype.GetPropertyValue = function (category, prop) {
        try {
            switch (category) {
                case 'general':
                    return this.Config.general[prop];
                case 'static':
                    return this.Config.static[prop];
                case 'security':
                    return this.Config.security[prop];
                default:
                    throw 'Unsuported category';
            }
        }
        catch (e) {
            throw "Property " + prop + " of category " + category + " not found in service setup configuration.";
        }
    }
    MicroService.prototype.GetLocalTime = function () {
        var localTime = momentTZ().tz(this.timezone).format();
        return localTime;
    }
    MicroService.prototype.GetInstanceOf = function (serviceName, callback) {
        try {
            let allServices = this.getAllServices();
            let service = allServices.find(function (s) {
                return s.Name === serviceName;
            });
            callback(null, service);
        }
        catch (err) {
            callback(err);
        }

    }
    MicroService.prototype.SetCronInterval = function (callback, cronExp) {
        try {
            let localOffset = momentTZ.tz(this.timezone).utcOffset();
            return new cronJob(cronExp, function () {
                callback();
            }, null, true, null, null, null, localOffset);
        }
        catch (e) {
            this.onDebugCallback("Could not create cron interval due to : " + JSON.stringify(e));
        }

    }
    MicroService.prototype.ClearCronInterval = function (interval) {
        try {
            interval.stop();
        }
        catch (e) {
            this.onDebugCallback("Could not stop cron interval due to : " + JSON.stringify(e));
        }

    }
    // Build up the configuration object
    MicroService.prototype.Init = function (config) {

        // General
        for (var i = 0; i < config.generalConfig.length; i++) {
            var name = config.generalConfig[i].id;
            var val = config.generalConfig[i].value;
            if (typeof val == "string" && val.startsWith("env:")) {
                this.Config.general[name] = process.env[val.substring(4)];
            }
            else {
                this.Config.general[name] = val;
            }
        };

        // Static
        for (var i = 0; i < config.staticConfig.length; i++) {
            var name = config.staticConfig[i].id;
            var val = config.staticConfig[i].value;
            try {
                switch (config.staticConfig[i].type) {
                    case "integer":
                        val = Number(val);
                        break;
                    case "bool":
                        val = Boolean(val);
                        break;
                    default:
                        break;
                }
            }
            catch(e){
                this.Debug(`Unable to cast ${name} (${val}) to ${config.staticConfig[i].type}`);
            }
            if (typeof val == "string" && val.startsWith("env:")) {
                this.Config.static[name] = process.env[val.substring(4)];
            }
            else {
                this.Config.static[name] = val;
            }
        };

        // Security
        for (var i = 0; i < config.securityConfig.length; i++) {
            var name = config.securityConfig[i].id;
            var val = config.securityConfig[i].value;

            try {
                switch (config.securityConfig[i].type) {
                    case "integer":
                        val = Number(val);
                        break;
                    case "bool":
                        val = Boolean(val);
                        break;
                    default:
                        break;
                }
            }
            catch(e){
                this.Debug(`Unable to cast ${name} (${val}) to ${config.securityConfig[i].type}`);
            }

            if (typeof val == "string" && val.startsWith("env:")) {
                this.Config.security[name] = process.env[val.substring(4)];
            }
            else {
                this.Config.security[name] = val;
            }
        };

    }

    extend(this, microService);
}

module.exports = MicroService;