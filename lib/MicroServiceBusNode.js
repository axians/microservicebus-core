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

var moment = require('moment');
var async = require('async');
var reload = require('require-reload')(require);
var fs = require('fs');
var path = require('path');
var guid = require('uuid');
var util = require('./utils.js');
var retryRequest = require('retry-request', {
    request: require('request')
});
var Applicationinsights = require("./Applicationinsights");
var MicroService = require('./services/microService');
var Com = require("./Com.js");
var PersistHelper = require("./PersistHelper");
var Orchestrator = require('./Orchestrator');
var TTLCollection = require("./TTLCollection");

function MicroServiceBusNode(settingsHelper) {
    var self = this;
    this.settingsHelper = settingsHelper;

    // Callbacks
    this.onStarted = null;
    this.onStopped = null;
    this.onSignedIn = null;
    this.onPingResponse = null;
    this.onUpdatedItineraryComplete = null;
    this.onLog = null;
    this.onAction = null;
    this.onCreateNode = null;
    this.onCreateNodeFromMacAddress = null;
    this.onReportLocation = null;
    this.onRequestHistory = null;
    this.onTestResult = null;
    this.onTestComplete = null;
    // Handle settings
    var _hostPrefix = 'node'; // Used for creating new hosts
    var _itineraries; // all downloaded itineries for this host
    this._microServices = []; // all started services
    var _downloadedScripts = [];
    var _firstStart = true;
    var _loadingState = "none"; // node -> loading -> done -> stopped
    var _comSettings;
    var _persistHelper;
    var _historyCollection;
    var _failedHistoryCollection;
    var _eventHistoryCollection;
    var _exceptionCollection
    var _restoreTimeout;
    var signInResponse;
    var com;
    var exceptionsLoadingItineraries = 0;
    var _startWebServer = false;
    var port = process.env.PORT || 1337;
    var app;// = express();
    var server;
    var applicationinsights = new Applicationinsights();
    var _orchestrator = new Orchestrator();
    var http;
    var express;
    var bodyParser;
    var serviceCount = 0;
    this.nodeVersion = null;

    // History persistance and ttl stuff
    const TTLHISTORY_TTL = 7 * 24 * 60 * 60 * 1000; // one week
    const TTLHISTORY_CHECKINTERVAL = 5 * 60 * 1000; // every 5 minutes
    const TTLHISTORY_PERSISTINTERVAL = 5 * 60 * 1000; // 5 minutes
    const TTLEXCEPTION_PERSISTINTERVAL = 60 * 60 * 1000; // every 5 minutes
    const TTLEXCEPTION_INTERVAL = 60 * 60 * 1000; // every hour

    _historyCollection = new TTLCollection({
        key: 'TRANSMIT_SUCCESS_HISTORY',
        ttl: TTLHISTORY_TTL,
        checkPeriod: TTLHISTORY_CHECKINTERVAL,      // Interval to check for expired items
        persistPeriod: TTLHISTORY_PERSISTINTERVAL,  // Interval (this.options.persistPeriod) for persising self._collection
        persistDir: path.resolve(settingsHelper.homeDirectory, "history"),
        persistFileName: 'TRANSMIT_SUCCESS_HISTORY.json'
    });

    _failedHistoryCollection = new TTLCollection({
        key: 'TRANSMIT_FAILED_HISTORY',
        ttl: TTLHISTORY_TTL,
        checkPeriod: TTLHISTORY_CHECKINTERVAL,      // Interval to check for expired items
        persistPeriod: TTLHISTORY_PERSISTINTERVAL,  // Interval (this.options.persistPeriod) for persising self._collection
        persistDir: path.resolve(settingsHelper.homeDirectory, "history"),
        persistFileName: 'TRANSMIT_FAILED_HISTORY.json'
    });

    _eventHistoryCollection = new TTLCollection({
        key: 'TRANSMIT_EVENTS_HISTORY',
        ttl: TTLHISTORY_TTL,
        checkPeriod: TTLHISTORY_CHECKINTERVAL,      // Interval to check for expired items
        persistPeriod: TTLHISTORY_PERSISTINTERVAL,  // Interval (this.options.persistPeriod) for persising self._collection
        persistDir: path.resolve(settingsHelper.homeDirectory, "history"),
        persistFileName: 'TRANSMIT_EVENTS_HISTORY.json'
    });

    _exceptionCollection = new TTLCollection({
        key: 'EXCEPTION_HISTORY',
        ttl: TTLEXCEPTION_INTERVAL,
        checkPeriod: TTLEXCEPTION_PERSISTINTERVAL,      // Interval to check for expired items
        persistPeriod: TTLEXCEPTION_PERSISTINTERVAL,  // Interval (this.options.persistPeriod) for persising self._collection
        persistDir: path.resolve(settingsHelper.homeDirectory, "history"),
        persistFileName: 'EXCEPTION_HISTORY.json'
    });
    // Called by HUB if it wasn't able to process the request
    MicroServiceBusNode.prototype.ErrorMessage = function (message) {
        self.onLog("errorMessage => " + message);
        self.onStarted(0, 1);
    };
    // Called by HUB to receive all active serices
    MicroServiceBusNode.prototype.GetEndpoints = function (message) {
        self.onLog("getEndpoints => " + message);
    };
    // Called by HUB when itineraries has been updated
    MicroServiceBusNode.prototype.UpdateItinerary = function (updatedItinerary) {
        try {
            self.onLog();
            self.onLog("Updating flows".green);
            self.onLog();
            // Stop all services
            stopAllServices(function () {
                self.onLog("All services stopped".yellow);
            });


            var itinerary = _itineraries.find(function (i) {
                return i.itineraryId === updatedItinerary.itineraryId;
            });
            //var itinerary = new linq(_itineraries).First(function (i) { return i.itineraryId === updatedItinerary.itineraryId; });

            for (var i = _itineraries.length; i--;) {
                if (_itineraries[i].itineraryId === updatedItinerary.itineraryId) {
                    _itineraries.splice(i, 1);
                }
            }
            _itineraries.push(updatedItinerary);

            //loadItineraries(settings.organizationId, _itineraries);
            startAllServices(_itineraries, function () {
                if (self.onUpdatedItineraryComplete)
                    self.onUpdatedItineraryComplete();

                _restoreTimeout = setTimeout(function () {
                    restorePersistedMessages();

                }, 3000);
            });
        } catch (e) {
            if (self.onUpdatedItineraryComplete)
                self.onUpdatedItineraryComplete(e);
        }
    };
    // Called by HUB when itineraries has been updated
    MicroServiceBusNode.prototype.Stop = function (callback) {
        self.onLog();
        self.onLog("Stopping".green);
        self.onLog();
        // Stop all services
        stopAllServices(function () {
            self.onLog("All services stopped".yellow);
            callback();
        });
    };
    // Called by HUB when itineraries has been updated
    MicroServiceBusNode.prototype.ChangeState = function (state) {

        self.onLog();
        //_isWaitingForSignInResponse = false;
        settingsHelper.settings.state = state;
        if (state === "Active") {
            _downloadedScripts = [];
            self._microServices = [];
            self.onLog("Starting up COM and all services...");

            startAllServices(_itineraries, function () {
                self.onLog("State:".white + state.green);
                self.onLog();
            });
        }
        else {
            self.onLog("Stopping COM and all services...");
            com.Stop(function (err) {
                if (err) {
                    self.onLog("Unalble to start COM");
                }
                else {
                    stopAllServices(function () {
                        self.onLog("All services stopped".yellow);
                        self.onLog("State:".white + state.yellow);
                        self.onLog();
                    });
                }
            });

        }

    };
    // New token has been received from mSB.com
    MicroServiceBusNode.prototype.UpdateToken = function (token) {
        settingsHelper.settings.sas = token;
        settingsHelper.save();
        _eventHistoryCollection.push(false, 'Token updated');
    };
    // Called by the HUB when disabling/enabling flow
    MicroServiceBusNode.prototype.UpdateFlowState = function (itineraryId, environment, enabled) {

        var itinerary = _itineraries.find(function (i) {
            return i.itineraryId === itineraryId;
        });
        if (!itinerary) {
            self.onLog("Tracking: ".white + "Itinerary not found".red);
            return;
        }
        if (enabled) {
            // Remove old itinerary
            let oldItinerary = _itineraries.find(function (i) {
                return i.itineraryId === itineraryId;
            });
            var index = _itineraries.indexOf(oldItinerary);
            if (index > -1) {
                _itineraries.splice(index, 1);
            }
            // Add updated itinerary
            itinerary.enabled = true;
            _itineraries.push(itinerary);
            // Restart all services
            startAllServices(_itineraries, function () { });
        }
        else {
            let iStatus = enabled ? "enabled".green : "disabled".yellow;
            self.onLog();
            self.onLog("Itinerary [".grey + itinerary.integrationName + "] has been ".grey + iStatus);

            // Get all activities from itinerary
            var microServices = [];
            for (var i = 0; i < itinerary.activities.length; i++) {
                if (itinerary.activities[i].userData.config != undefined) {
                    var host = itinerary.activities[i].userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value;

                    if (host == settingsHelper.settings.nodeName) {
                        microServices.push({ itinerary: itinerary, activity: itinerary.activities[i] });
                    }
                    else if (settingsHelper.settings.tags !== undefined) {
                        var tags = settingsHelper.settings.tags.find(function (tag) { return tag === host; });
                        if (tags !== undefined && tags.length > 0) {
                            if (itinerary.activities[i].userData.baseType === 'onewayreceiveadapter' || itinerary.activities[i].userData.baseType === 'twowayreceiveadapter') {
                                itinerary.activities[i].userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value = settingsHelper.settings.nodeName;
                            }
                            microServices.push({ itinerary: itinerary, activity: itinerary.activities[i] });
                        }
                    }
                }
            }
            self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
            self.onLog("|" + util.padRight(" MicroService", 20, ' ') + "|  Status   |" + util.padRight(" Flow", 40, ' ') + "|");
            self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

            let activeActivities = itinerary.activities.find(function (a) {
                return a.userData.config.generalConfig.find(function (c) { return c.id === 'enabled'; }).value;
            });
            let activeActivitiesLength = activeActivities ? activeActivities.length : 0;
            serviceCount = serviceCount - activeActivitiesLength;
            for (var i = 0; i < microServices.length; i++) {
                let service = self._microServices.find(function (m) {
                    return m.Name === microServices[i].activity.userData.id;
                });
                if (service) {
                    let serviceStatus = "Stopped".yellow;

                    try {
                        if (enabled && service.Config.general.enabled) {
                            serviceStatus = "Started".green;
                            service.Start();
                            serviceCount++;
                        }
                        else {
                            service.Stop();
                            var index = self._microServices.indexOf(service);
                            if (index > -1) {
                                self._microServices.splice(index, 1);
                            }
                        }
                        var lineStatus = "|" + util.padRight(service.Name, 20, ' ') + "| " + serviceStatus + "   |" + util.padRight(service.IntegrationName, 40, ' ') + "|";
                        self.onLog(lineStatus);
                    }
                    catch (ex) {
                        self.onLog('Unable to stop '.red + service.Name.red);
                        self.onLog(ex.message.red);
                    }
                }
            }
        }


        self.onLog();
    };
    // Called by HUB to enable or disable tracking
    MicroServiceBusNode.prototype.SetTracking = function (enableTracking) {

        settingsHelper.settings.enableTracking = enableTracking;
        if (enableTracking)
            self.onLog("Tracking: ".white + "enabled".green);
        else
            self.onLog("Tracking: ".white + "disabled".yellow);

    };
    // Update debug mode
    MicroServiceBusNode.prototype.ChangeDebug = function (debug) {
        self.onLog("Debug: ".white + debug);
        settingsHelper.settings.debug = debug;

    };
    // Incoming message from HUB
    MicroServiceBusNode.prototype.SendMessage = function (message, destination) {
        //receiveMessage(message, destination);
    };
    // Called by HUB when signin  has been successful
    MicroServiceBusNode.prototype.SignInComplete = function (response) {

        let coreVersion = response.coreVersion;
        if (response.tags && response.tags.find(function (t) { return t === "#BETA"; })) {
            coreVersion = "beta";
        }

        if (response.sas != undefined) {
            settingsHelper.settings.sas = response.sas;
            settingsHelper.settings.debug = undefined;
            settingsHelper.settings.state = undefined;
            settingsHelper.settings.port = undefined;
            settingsHelper.settings.tags = undefined;
            settingsHelper.settings.offlineSettings = response.policies.disconnectPolicy.offlineMode?response:null;
            settingsHelper.settings.policies = response.policies;
            settingsHelper.settings.coreVersion = coreVersion;
            settingsHelper.save();
        }

        if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line
            self.onLog(settingsHelper.settings.nodeName.gray + ' successfully logged in'.green);
        }

        signInResponse = response;
        settingsHelper.settings.state = response.state;
        settingsHelper.settings.debug = response.debug;
        settingsHelper.settings.port = response.port == null ? 80 : response.port;
        settingsHelper.settings.tags = response.tags;
        settingsHelper.settings.enableTracking = response.enableTracking;
        settingsHelper.settings.timezone = response.timezone;
        settingsHelper.settings.policies = response.policies;
        settingsHelper.retentionPeriod = response.retentionPeriod;
        settingsHelper.mode = response.mode;

        _comSettings = response;

        _persistHelper = new PersistHelper(settingsHelper);

        if (settingsHelper.settings.enableTracking)
            self.onLog("Tracking: " + "Enabled".green);
        else
            self.onLog("Tracking: " + "Disabled".grey);

        if (settingsHelper.settings.state == "Active")
            self.onLog("State: " + settingsHelper.settings.state.green);
        else
            self.onLog("State: " + settingsHelper.settings.state.yellow);

        _itineraries = signInResponse.itineraries;

        applicationinsights.init(response.instrumentationKey, settingsHelper.settings.nodeName)
            .then(function (resp) {
                if (resp)
                    self.onLog("Application Insights:" + " Successfully initiated".green);
                else
                    self.onLog("Application Insights:" + " Disabled".grey);
            }, function (error) {
                self.onLog("Application Insights:" + " Failed to initiate!".green);
            });

        if (_firstStart) {
            _firstStart = false;

            self.onLog("IoT Provider: " + response.protocol.green);
            com = new Com(settingsHelper.settings.nodeName, response, settingsHelper.settings.hubUri, settingsHelper);

            // New state received from IoT Hob
            com.OnStateReceived(function (stateMessage) {
                receiveState(stateMessage);
            });
            // Inbound D2C message has no destination 
            com.OnMessageReceived(function (cloudMessage) {
                receiveCloudMessage(cloudMessage);
            });
            // InboundD2D message with destination (service) defined
            com.OnQueueMessageReceived(function (sbMessage) {
                var message = sbMessage.body;
                var service = sbMessage.applicationProperties.value.service;
                receiveMessage(message, service);

                if (com.IsConnected()) { // com is no longer in disconnected state
                    com.dissconnectedSince = undefined;
                    com.receivedQueueErrorCount = 0;
                    self.onLog("COM seems to have recovered from disconnected state".green);
                    restorePersistedMessages();
                }
            });
            /*
            * Unable to download NPM package
            * Unable to connect
            * Receiver error
            * Unable to get twin
            * Uncaught exception in start
            * Error changing state
            * Service is stopped
            * Unable to connect to Azure IoT Hub (send)
            *
            * Unable to aquire tracking token
            * Device twin not registered
            * Unable to send tracking message
            */
            com.OnReceivedQueueError(function (message) {
                self.onLog("OnReceivedQueueError: ".red + message);
            });
            // Unauthorized error on connecting receiver
            com.OnUnauthorizedError(function () {
                self.onLog("OnUnauthorizedError".red);
                self.onAction({ action: "restart" });
                _eventHistoryCollection.push(false, 'Unauthorized error');
            });
            /*
            * Event has been sent to Azure IoT Hub
            * If com was not intentially stopped or the dissconnect event was triggered
            * com will continue trying to submit messages
            */
            com.OnSubmitQueueSuccess(function (data) {
                // if (com.dissconnectedSince) { // com is no longer in disconnected state
                //     com.dissconnectedSince = undefined;
                //     com.receivedQueueErrorCount = 0;
                //     self.onLog("COM seems to have recovered from disconnected state".green);
                // }
                _historyCollection.push(true);
            });
            /*
            * Unable to send event to Azure IoT Hub
            */
            com.OnSubmitQueueError(function (message) {
                self.onLog("OnSubmitQueueError: ".red + message);
                recoverDisconnectedComState();
                _failedHistoryCollection.push(false);
            });
            // Debug callback from services
            com.OnQueueDebugCallback(function (message) {
                if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line
                    self.onLog("COM: ".green + message);
                }
                else {
                    console.log("COM: ".green + message);
                }
            });
            // Dissconnect event was triggered
            com.OnDisconnect(function (message, isFault) {
                if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line
                    if (isFault) {
                        self.onLog("COM: ".yellow + "Uncontrolled disconnect.".red);
                    }
                    else {
                        self.onLog("COM: ".yellow + message);
                    }
                }
                if (isFault) {
                    recoverDisconnectedComState();
                }
                _eventHistoryCollection.push(false, 'Dissconnected');
            });
            com.OnActionCallback(function (message) {
                if (message.source == "core") {
                    switch (message.action) {
                        default:
                            self.onLog("Unsupported action: " + message.action);
                            break;
                    }

                }
                else {
                    if (self.onAction) {
                        self.onAction(message);
                    }
                }
            });

            // Persistance stuff
            com.OnPersistEventCallback(function (message) {
                _persistHelper.persist(message, 'event', function (err) {
                  self.onLog("COM: Message persisted.".yellow);
                });
            });
            com.OnPersistMessageCallback(function (message) {
                _persistHelper.persist(message, 'message', function (err) {

                });
            });
            com.OnPersistTrackingCallback(function (message) {
                _persistHelper.persist(message, 'tracking', function (err) {

                });
            });
            com.OnPersistHistoryCallback(function (message) {
                _persistHelper.persist(message, 'history', function (err) {

                });
            });
            // com.OnCommandCallback(function (command, payload) {
            //     switch (command) {
            //         case "restart":                        
            //             break;
            //         case "reboot":                        
            //             break;
            //         default:
            //             break;
            //     }
            // });
            port = process.env.PORT || 1337;
        }
        else {
            com.Update(response);
        }
        startAllServices(_itineraries, function () {
            self.onPingResponse();
            _restoreTimeout = setTimeout(function () {
                restorePersistedMessages();
            }, 3000);
        });
    };
    // Called by HUB when node has been successfully created    
    /* istanbul ignore next */
    MicroServiceBusNode.prototype.NodeCreated = function () {

        if (settingsHelper.settings.aws) {
            var awsSettings = { region: settingsHelper.settings.aws.region };
            let pemPath = path.resolve(settingsHelper.certDirectory, settingsHelper.settings.nodeName + ".cert.pem");
            let privateKeyPath = path.resolve(settingsHelper.certDirectory, settingsHelper.settings.nodeName + ".private.key");
            let settingsPath = path.resolve(settingsHelper.certDirectory, settingsHelper.settings.nodeName + ".settings");
            let caRootPath = path.resolve(settingsHelper.certDirectory, ".root-ca.crt");

            fs.writeFileSync(pemPath, settingsHelper.settings.aws.certificatePem);
            fs.writeFileSync(privateKeyPath, settingsHelper.settings.aws.privateKey);
            fs.writeFileSync(settingsPath, JSON.stringify(awsSettings));

            self.onLog("AWS node certificates installed");

            var caUri = "https://www.symantec.com/content/en/us/enterprise/verisign/roots/VeriSign-Class%203-Public-Primary-Certification-Authority-G5.pem";

            require("request")(caUri, function (err, response, certificateContent) {
                if (response.statusCode != 200 || err != null) {
                    self.onLog("unable to get aws root certificate");
                }
                else {
                    self.onLog("AWS root certificate installed");
                    fs.writeFileSync(caRootPath, certificateContent);
                    self.SignIn();
                }
            });
        }
        else
            self.SignIn();
    };
    // Signing in the to HUB
    MicroServiceBusNode.prototype.SignIn = function (newNodeName, temporaryVerificationCode, useMacAddress, recoveredSignIn) {

        if (useMacAddress) {
            require('getmac').getMac(function (err, macAddress) {
                if (err) {
                    self.onLog('Unable to fetch mac address.');
                }
                else {
                    self.onCreateNodeFromMacAddress(macAddress);
                }
            });
        }
        // Logging in using code
        else if (settingsHelper.settings.nodeName == null || settingsHelper.settings.nodeName.length == 0) { // jshint ignore:line
            if (temporaryVerificationCode != undefined && temporaryVerificationCode.length == 0) { // jshint ignore:line
                self.onLog('No hostname or temporary verification code has been provided.');

            }
            else {

                this.onCreateNode(
                    temporaryVerificationCode,
                    _hostPrefix,
                    newNodeName
                );
            }
        }
        // Logging in using settings
        else {

            var hostData = {
                Name: settingsHelper.settings.nodeName,
                machineName: settingsHelper.settings.machineName,
                OrganizationID: settingsHelper.settings.organizationId,
                npmVersion: this.nodeVersion,
                sas: settingsHelper.settings.sas,
                recoveredSignIn: recoveredSignIn
            };

            this.onSignedIn(hostData);


            if (settingsHelper.settings.debug != null && settingsHelper.settings.debug && !recoveredSignIn) {// jshint ignore:line
                self.onLog("Waiting for signin response".grey);
            }
        }
    };
    MicroServiceBusNode.prototype.InboundServices = function () {
        return self._microServices;
    };
    MicroServiceBusNode.prototype.RestorePersistedMessages = function () {
        restorePersistedMessages();
    };
    MicroServiceBusNode.prototype.ServiceCountCheck = function () {
        serviceCountCheck();
    };
    MicroServiceBusNode.prototype.SetDebug = function (debug) {

        self.onLog(debug ? "Debug: ".white + "enabled".green : "Debug: ".white + "disabled".yellow);

        settingsHelper.settings.debug = debug;
    };
    MicroServiceBusNode.prototype.TrackException = function (msg, lastActionId, status, fault, faultDescription) {

        trackException(msg, lastActionId, status, fault, faultDescription);
    };
    MicroServiceBusNode.prototype.ResendHistory = function (startdate, enddate) {

        restorePersistedHistoryMessages(startdate, enddate);
    };
    MicroServiceBusNode.prototype.RequestHistory = function (startdate, enddate, connId) {

        _historyCollection.filterCollection(startdate, enddate, 'hour', function (err, historyCollection) {
            _failedHistoryCollection.filterCollection(startdate, enddate, 'hour', function (err, failedHistoryCollection) {
                _eventHistoryCollection.filterCollection(startdate, enddate, 'hour', function (err, eventHistoryCollection) {
                    if (self.onRequestHistory)
                        self.onRequestHistory({
                            connId: connId,
                            history: historyCollection,
                            failed: failedHistoryCollection,
                            events: eventHistoryCollection
                        });
                });
            });

        });
    };
    MicroServiceBusNode.prototype.ForceStop = function (callback) {
        stopAllServices(function () {
            self.onLog("All services stopped".yellow);
            callback();
        });
    };
    MicroServiceBusNode.prototype.ReportEvent = function (event) {
        _eventHistoryCollection.push(false, event);
    };
    MicroServiceBusNode.prototype.RunTest = function (testDescription) {
        try {
            stopAllServices(function () {
                self.onLog("All services stopped".yellow);

                var testDirectory = path.resolve(settingsHelper.homeDirectory, "tests");
                if (!fs.existsSync(testDirectory)) {
                    fs.mkdirSync(testDirectory);
                }
                let files = JSON.parse(testDescription.config).config.dependenciesConfig.map(function (depFile) {
                    return settingsHelper.settings.hubUri.replace('wss://', 'https://') + '/api/Scripts/' + depFile.organizationId + '/' + depFile.name
                });

                var testScriptPath = path.resolve(testDirectory, testDescription.fileName);

                async.eachSeries(files, function (fileName, done) {
                    require("request")(fileName, function (err, response, scriptContent) {
                        if (response.statusCode != 200 || err != null) {
                            done("Unable to download test");
                        }
                        else {
                            try {
                                let dependancyFilePath = path.resolve(testDirectory, path.basename(fileName));
                                fs.writeFileSync(dependancyFilePath, scriptContent);
                                done();
                            } catch (err) {
                                done(err);
                            }
                        }
                    });
                }, function (err) {
                    if (err) {
                        let errorMessage = "Unable to download dependancy files";
                        self.onTestResult({ description: "Init test", title: "Download test script", result: errorMessage, code: -1, success: false });
                        self.onLog(errorMessage);
                    }
                    else {
                        let scriptFileUri = settingsHelper.settings.hubUri + '/api/Scripts/' + settingsHelper.settings.organizationId + '/' + testDescription.fileName;
                        scriptFileUri = scriptFileUri.replace('wss://', 'https://');
                        require("request")(scriptFileUri, function (err, response, scriptContent) {
                            if (response.statusCode != 200 || err != null) {
                                let errorMessage = "Unable to download test";
                                self.onTestResult({ description: "Init test", title: "Download test script", result: errorMessage, code: -1, success: false });
                                self.onLog(errorMessage);
                            }
                            else {
                                // Add properties
                                scriptContent += "var testParameters = " + JSON.stringify(testDescription.parameters) + ";";
                                // Add functions
                                scriptContent += "var getPropertyValue = function (propertyName) {let prop =  testParameters.find(function (p) { return p.id === propertyName; }); return prop.value;};"

                                fs.writeFileSync(testScriptPath, scriptContent);
                                let Mocha = require('mocha');
                                let mocha = new Mocha();
                                mocha.addFile(testScriptPath);
                                let testCount = 0;
                                let runner = mocha.run(function (failures) {
                                    self.onTestComplete({
                                        testCount: testCount,
                                        failures: failures,
                                        caller: testDescription.caller
                                    });
                                });
                                runner.on("pass", function (e) {
                                    testCount++;
                                    let result = {
                                        title: e.title,
                                        description: e.parent.title,
                                        result: "Passed",
                                        code: 0,
                                        success: true,
                                        caller: testDescription.caller
                                    };
                                    self.onTestResult(result);
                                    self.onLog(e.parent.title + ":" + e.title + "PASSED");
                                });
                                runner.on("fail", function (e) {
                                    testCount++;
                                    let result = { description: e.parent.title, title: e.title, result: e.err.message, code: e.err.code, success: false, caller: testDescription.caller };
                                    self.onTestResult(result);
                                    self.onLog(e.parent.title + ":" + e.title + "FAILED".red);
                                    self.onLog(JSON.stringify(e.stack));
                                });
                            }
                        });
                    }
                });
            });
        }
        catch (error2) {
            self.onLog(error2.message);

        }
    };

    // Events
    MicroServiceBusNode.prototype.OnSignedIn = function (callback) {
        this.onSignedIn = callback;
    };
    MicroServiceBusNode.prototype.OnStarted = function (callback) {
        this.onStarted = callback;
    };
    MicroServiceBusNode.prototype.OnStopped = function (callback) {
        this.onStopped = callback;
    };
    MicroServiceBusNode.prototype.OnPingResponse = function (callback) {
        this.onPingResponse = callback;
    };
    MicroServiceBusNode.prototype.OnUpdatedItineraryComplete = function (callback) {
        this.onUpdatedItineraryComplete = callback;
    };
    MicroServiceBusNode.prototype.OnLog = function (callback) {
        this.onLog = callback;
    };
    MicroServiceBusNode.prototype.OnAction = function (callback) {
        this.onAction = callback;
    };
    MicroServiceBusNode.prototype.OnCreateNode = function (callback) {
        this.onCreateNode = callback;
    };
    MicroServiceBusNode.prototype.OnCreateNodeFromMacAddress = function (callback) {
        this.onCreateNodeFromMacAddress = callback;
    };
    MicroServiceBusNode.prototype.OnReportLocation = function (callback) {
        this.onReportLocation = callback;
    };
    MicroServiceBusNode.prototype.OnRequestHistory = function (callback) {
        this.onRequestHistory = callback;
    };
    MicroServiceBusNode.prototype.PersistEvent = function (event) {
        _eventHistoryCollection.push(false, event);
    };
    MicroServiceBusNode.prototype.OnTestResult = function (callback) {
        this.onTestResult = callback;
    };
    MicroServiceBusNode.prototype.OnTestComplete = function (callback) {
        this.onTestComplete = callback;
    };

    // Internal functions

    // Starting up all services
    function startAllServices(itineraries, callback) {
        stopAllServices(function () {
            loadItineraries(settingsHelper.settings.organizationId, itineraries, function () {
                callback();
            });
        });
    }
    // This method is called then COM gets dissconnected or when unable to 
    // transmit messages or events.
    function recoverDisconnectedComState(message) {
        if (!com.dissconnectedSince) {
            com.dissconnectedSince = new Date();
            self.onLog("COM is in disconnected state!!".red);

            setInterval(function () {
                try {
                    if (!com.IsConnected()) {
                        self.onLog("Trying to recover COM from disconnected state".yellow);
                        com.Stop(function () {
                            self.onLog("COM has been stopped".yellow);
                            com.Start(function (err) {
                                if (err) {
                                    self.onLog("Still trying to recover COM from disconnected state".yellow);
                                }
                            });
                        });
                    }
                    else {
                        self.onLog("COM seems to have recovered from disconnected state".green);
                        com.dissconnectedSince = undefined;
                        clearInterval(this);
                        restorePersistedMessages();
                    }
                }
                catch (e) {
                    self.onLog("Error in interval for restarting COM: " + e);
                }

            }, 10 * 1000);

            let msg = {
                InterchangeId: guid.v1(),
                IntegrationId: "",
                IntegrationName: "",
                Environment: "",
                TrackingLevel: "",
                ItineraryId: "",
                CreatedBy: "",
                LastActivity: "",
                ContentType: "text/plain",
                Itinerary: "",
                MessageBuffer: null,//messageBuffer.toString('base64'),
                _messageBuffer: new Buffer("").toString('base64'),
                IsBinary: true,
                IsLargeMessage: false,
                IsCorrelation: false,
                IsFirstAction: true,
                FaultCode: "90020",
                FaultDescription: "COM is in disconnected state.",
                Variables: [],
                CreateTicket: false
            };
            trackException(msg, "", "Failed", "COM is in disconnected state.", message);
        }
    }
    // Stopping COM and all services
    function stopAllServices(callback) {

        stopAllServicesSync();

        callback();
    }
    // Stopping all services
    function stopAllServicesSync() {
        if (_startWebServer) {
            self.onLog("Server:      " + "Shutting down web server".yellow);
            server.close();
            app = null;
            app = express();
        }

        if (self._microServices.length > 0) {
            self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
            self.onLog("|" + util.padRight(" MicroService", 20, ' ') + "|  Status   |" + util.padRight(" Flow", 40, ' ') + "|");
            self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

            for (var i = 0; i < self._microServices.length; i++) {
                var service = self._microServices[i];
                try {
                    service.Stop();
                    var lineStatus = "|" + util.padRight(service.Name, 20, ' ') + "| " + "Stopped".yellow + "   |" + util.padRight(service.IntegrationName, 40, ' ') + "|";
                    self.onLog(lineStatus);
                    service = undefined;
                    //delete service;
                }
                catch (ex) {
                    self.onLog('Unable to stop '.red + service.Name.red);
                    self.onLog(ex.message.red);
                }
            }

            if (server != undefined && server != null)
                server.close();

            _startWebServer = false;
            _downloadedScripts = undefined;
            self._microServices = undefined;
            _downloadedScripts = [];
            self._microServices = [];
            serviceCount = 0;
        }
    }
    // Incoming cloudMessage 
    function receiveCloudMessage(cloudMessage) {
        var microService = self._microServices.find(function (i) {
            return i.baseType === "messagereceiveadapter";
        });
        if (!microService)
            return;

        microService.OnCompleted(function (message, destination) {
            //trackMessage(message, destination, "Completed");
        });

        // Submit cloudMessage to service
        microService.Process(cloudMessage, null);
    }
    // Incomming state
    function receiveState(newstate) {
        settingsHelper.settings.deviceState = newstate;
        settingsHelper.save();
        var serviceName = "Unknown";
        try {
            if (newstate.desired.msbaction) {
                if (newstate.desired.msbaction.action) {
                    if (!newstate.reported || !newstate.reported.msbaction || (newstate.reported.msbaction && (newstate.desired.msbaction.id !== newstate.reported.msbaction.id))) {
                        self.onLog("MSBACTION: ".green + newstate.desired.msbaction.action.grey);
                        com.currentState.reported = { msbaction: com.currentState.desired.msbaction };
                        var reportState = {
                            reported: { msbaction: com.currentState.desired.msbaction }
                        };
                        com.ChangeState(reportState, settingsHelper.settings.nodeName);

                        // Wait a bit for the state to update...
                        setTimeout(function () {
                            performActions(com.currentState.desired.msbaction);
                        }, 5000);

                    }
                    // return;
                }
            }

            var microServices = self._microServices.filter(function (i) {
                return i.baseType === "statereceiveadapter";
            });

            microServices.forEach(function (microService) {
                serviceName = microService.Name;
                var message = {};
                message.IsFirstAction = true;
                message.ContentType = 'application/json';
                message.body = newstate;
                let jsonMsg = JSON.stringify(newstate.desired);
                message.messageBuffer = new Buffer(jsonMsg);
                message._messageBuffer = new Buffer(jsonMsg).toString('base64');

                // Track incoming message
                trackMessage(message, microService.Name, "Started");

                // Submit state to service
                microService.Process(newstate, null);
            });
        }
        catch (err) {
            self.onLog("Error at: ".red + serviceName);
            self.onLog("Error id: ".red + err.name);
            self.onLog("Error description: ".red + err.message);
        }
    }
    // Incoming messages from other nodes
    function receiveMessage(message, destination) {
        try {
            var microService = self._microServices.find(function (i) {
                return i.Name === destination &&
                    i.ItineraryId == message.ItineraryId;
            });
            /* istanbul ignore if */
            if (microService == null) {

                // isDynamicRoute means the node of the service was set to dynamic.
                // A dynamicly configured node setting whould mean the node was never initilized
                // and not part of the _inboundServices array.
                // Therefor it need to be initilized and started.
                if (message.isDynamicRoute) {

                    // Find the activity
                    var activity = message.Itinerary.activities.find(function (c) { return c.userData.id === destination; });

                    // Create a startServiceAsync request
                    var intineratyActivity = {
                        activity: activity,
                        itinerary: message.Itinerary
                    };

                    // Call startServiceAsync to initilized and start the service.
                    startServiceAsync(intineratyActivity, settingsHelper.settings.organizationId, true, function () {
                        self.onLog("");
                        self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
                        self.onLog("|" + util.padRight(" MicroService", 20, ' ') + "|  Status   |" + util.padRight(" Flow", 40, ' ') + "|");
                        self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

                        microService = self._microServices[self._microServices.length - 1];
                        var lineStatus = "|" + util.padRight(microService.Name, 20, ' ') + "| " + "Started".green + "   |" + util.padRight(microService.IntegrationName, 40, ' ') + "|";
                        self.onLog(lineStatus);

                        self.onLog();

                        // Set the isDynamicRoute to false and call this method again.
                        microService.Start();
                        serviceCount++;
                        message.isDynamicRoute = false;
                        receiveMessage(message, destination);
                    });
                    return;
                }
                else {
                    var logm = "The service receiving this message is no longer configured to run on this node. This can happen when a service has been shut down and restarted on a different machine";
                    trackException(message, destination, "Failed", "90101", logm);
                    self.onLog(logm);
                    self.onLog("Error: ".red + logm);
                    return;
                }
            }

            message.IsFirstAction = false;
            microService.OnCompleted(function (integrationMessage, destination) {
                trackMessage(integrationMessage, destination, "Completed");
            });

            // Track incoming message
            trackMessage(message, destination, "Started");

            let buf = new Buffer(message._messageBuffer, 'base64');

            // Encrypted?
            if (message.Encrypted) {
                buf = util.decrypt(buf);
            }

            var messageString = buf.toString('utf8');

            // Submit message to service
            if (message.ContentType === 'application/json') {
                var obj = JSON.parse(messageString);
                microService.Process(obj, message);
            }
            else if (message.ContentType === 'application/octet-stream') {
                microService.Process(message._messageBuffer, message);
            }
            else {
                microService.Process(messageString, message);
            }

        }
        catch (err) {
            self.onLog("Error at: ".red + destination);
            self.onLog("Error id: ".red + err.name);
            self.onLog("Error description: ".red + err.message);
            trackException(message, destination, "Failed", err.name, err.message);
        }
    }
    // Restore persisted messages from ./persist folder
    function restorePersistedMessages() {
        try {
            if (!com) {
                return;
            }
            if (!com.IsConnected()) {
                return;
            }

            async.eachSeries(_persistHelper.storage.keys(), function (key, done) {
                let data = _persistHelper.storage.getDataValue(key);
                if (key.startsWith('_h_')) { // history
                    done();
                }
                else if (key.startsWith('_e_')) { // events
                    let variables = [{ Variable: "resent", Value: new Date().toISOString() }];
                    com.SubmitEvent(JSON.parse(data.message), data.service, variables)
                        .then(function () {
                            _persistHelper.remove(key);
                            self.onLog("Transmitting persisted message".yellow);
                            done();
                        });
                }
                else if (key.startsWith('_m_')) { // messages
                    com.Submit(JSON.parse(data.message), data.node, data.service);
                    _persistHelper.remove(key);
                    done();
                }
                else if (key.startsWith('_t_')) { // tracking
                    com.Track(data);
                    _persistHelper.remove(key);
                    done();
                }

            });
        }
        catch (ex) {
            self.onLog(`Unable to restore persisted messages (${ex})`.red);
            self.onLog(ex.red);
        }
    }
    // Restore persisted messages from ./persist folder
    function restorePersistedHistoryMessages(startdate, enddate) {
        try {
            if (!com) {
                return;
            }
            if (!com.IsConnected()) {
                return;
            }
            _persistHelper.forEach(function (key, data) {
                if (key.startsWith('_h_')) { // history
                    let dt = new Date(key.replace('_h_', ''));
                    if (dt >= startdate && dt <= enddate) {
                        self.onLog("Re-submitting " + dt);
                        let variables = [{ Variable: "resent", Value: new Date().toISOString() }];
                        com.SubmitEvent(data, null, variables);
                        //_historyCollection.push(true);
                    }
                }
            });
        }
        catch (ex) {
            self.onLog("Unable to restore persisted messages".red);
            self.onLog(ex.red);
        }
    }
    // Make sure all services are active 
    function serviceCountCheck() {
        if (serviceCount != self._microServices.length && settingsHelper.settings.state === "Active") {
            self.onLog("A service has dropped, restarting services (" + serviceCount + "/" + self._microServices.length + ")");
            self.onAction({ action: "restart" });
        }
    }
    // Handle incomming maintinance actions
    function performActions(msbAction) {
        switch (msbAction.action) {
            case 'stop':
                self.onLog("State changed to " + "Inactive".yellow);
                settingsHelper.settings.state = "InActive";
                stopAllServicesSync(function () {
                    self.onLog("All services stopped".yellow);
                });
                break;
            case 'start':
                self.onLog("State changed to " + "Active".green);
                settingsHelper.settings.state = "Active";
                _downloadedScripts = [];
                self._microServices = [];
                serviceCount = 0;
                startAllServices(_itineraries, function () { });
                break;
            case 'restart':
                break;
            case 'reboot':
                break;
            case 'script':
                break;
            default:
        }
    }
    // Called after successfull signin.
    // Iterates through all itineries and download the scripts, afterwhich the services is started
    function loadItineraries(organizationId, itineraries, callback) {
        // Prevent double loading
        if (_loadingState == "loading") {
            return;
        }

        if (itineraries.length == 0)
            self.onStarted(0, 0);

        async.map(itineraries,
            function (itinerary, callback) {

                _orchestrator.getActivitiesForNode(itinerary, settingsHelper.settings.nodeName, settingsHelper.settings.tags)
                    .then(function (sucessors) {
                        var intineratyActivities = sucessors.map(function (successor) {
                            return { itinerary: itinerary, activity: successor }
                        });

                        async.map(intineratyActivities, function (intineratyActivity, callback) {
                            if (itinerary.enabled === false) {
                                callback(null, null);
                            }
                            else {
                                startServiceAsync(intineratyActivity, organizationId, false, function () {
                                    callback(null, null);
                                });
                            }

                        }, function (err, results) {
                            callback(null, null);
                        });
                    })
                    .catch(function (err) {
                        self.onLog(err);
                        callback(err, null);
                    });
            },
            function (err, results) {
                // Start com to receive messages

                if (settingsHelper.settings.state === "Active") {
                    com.Start(function () {
                        self.onLog("");
                        self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
                        self.onLog("|" + util.padRight(" MicroService", 20, ' ') + "|  Status   |" + util.padRight(" Flow", 40, ' ') + "|");
                        self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

                        com.dissconnectedSince = undefined;
                        com.receivedQueueErrorCount = 0;

                        for (var i = 0; i < self._microServices.length; i++) {
                            var newMicroService = self._microServices[i];

                            var serviceStatus = "Started".green;
                            if (settingsHelper.settings.state == "Active" && (newMicroService.Itinerary.enabled || newMicroService.Itinerary.enabled === undefined)) {
                                newMicroService.Start();
                                serviceCount++;
                            }
                            else
                                serviceStatus = "Stopped".yellow;

                            var lineStatus = "|" + util.padRight(newMicroService.Name, 20, ' ') + "| " + serviceStatus + "   |" + util.padRight(newMicroService.IntegrationName, 40, ' ') + "|";
                            self.onLog(lineStatus);
                        }
                        self.onLog();
                        if (self.onStarted)
                            self.onStarted(itineraries.length, exceptionsLoadingItineraries);

                        if (self.onUpdatedItineraryComplete != null)
                            self.onUpdatedItineraryComplete();

                        startListen();

                        _loadingState = "done";
                        callback();
                    });
                }
                else {
                    self.onLog("");
                    self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");
                    self.onLog("|" + util.padRight(" MicroService", 20, ' ') + "|  Status   |" + util.padRight(" Flow", 40, ' ') + "|");
                    self.onLog("|" + util.padLeft("", 20, '-') + "|-----------|" + util.padLeft("", 40, '-') + "|");

                    for (var i = 0; i < self._microServices.length; i++) {
                        var newMicroService = self._microServices[i];
                        var serviceStatus = "Stopped".yellow;
                        var lineStatus = "|" + util.padRight(newMicroService.Name, 20, ' ') + "| " + serviceStatus + "   |" + util.padRight(newMicroService.IntegrationName, 40, ' ') + "|";
                        self.onLog(lineStatus);
                    }
                    self.onLog();
                    _loadingState = "done";
                    callback();
                }
            });
    }
    // Preforms the following tasks
    // 1. Checks if the service is enabled and continues to set the name of the script 
    // 2. Downloads the script
    // 3. Creatig the service and extends it from MicroService, and registring the events
    // 4. Starts the service
    // 5. Download dependancies
    function startServiceAsync(intineratyActivity, organizationId, forceStart, done) {
        try {
            var activity = intineratyActivity.activity;
            var itinerary = intineratyActivity.itinerary;

            if (activity.type === 'draw2d.Connection' || activity.type === 'LabelConnection') {
                done();
                return;
            }
            // used for addons
            let bindingGyp = {
                "make_global_settings": [
                    {
                        "CXX": ["/snap/microservicebus-node/x1/usr/bin/g++"],
                        "CC": ["/snap/microservicebus-node/x1/usr/bin/gcc"]
                    }],
                targets: []
            };
            async.waterfall([
                // Init
                function (callback) {
                    try {
                        var host = activity.userData.config.generalConfig.find(function (c) { return c.id === 'host'; }).value;

                        var isEnabled = activity.userData.config.generalConfig.find(function (c) { return c.id === 'enabled'; }).value;

                        var hosts = host.split(',');
                        var a = hosts.indexOf(settingsHelper.settings.nodeName);

                        var scriptFileUri = activity.userData.isCustom ?
                            settingsHelper.settings.hubUri + '/api/Scripts/' + settingsHelper.settings.organizationId + '/' + activity.userData.type + '.js' :
                            settingsHelper.settings.hubUri + '/api/Scripts/00000000-0000-0000-0000-000000000001/' + activity.userData.type + '.js';

                        if (activity.userData.bindToVersion && activity.userData.version && settingsHelper.settings.coreVersion !== "beta") {
                            scriptFileUri += "/" + activity.userData.version;
                        }

                        scriptFileUri = scriptFileUri.replace('wss://', 'https://');

                        var integrationId = activity.userData.integrationId;

                        var scriptfileName = activity.userData.type + '.js'

                        if (!isEnabled || (itinerary.enabled !== undefined && itinerary.enabled === false)) {
                            var lineStatus = "|" + util.padRight(activity.userData.id, 20, ' ') + "| " + "Disabled".grey + "  |" + util.padRight(itinerary.integrationName, 40, ' ') + "|";
                            self.onLog(lineStatus);
                            done();
                            return;
                        }
                        var exist = _downloadedScripts.find(function (s) { return s.name === scriptfileName; }); // jshint ignore:line    

                        callback(null, exist, scriptFileUri, scriptfileName, integrationId);
                    }
                    catch (error1) {
                        self.onLog(error1.message);
                        done();
                    }
                },
                // Download 
                function (exist, scriptFileUri, scriptfileName, integrationId, callback) {
                    try {
                        var localFilePath = path.resolve(settingsHelper.serviceDirectory, scriptfileName);

                        if (settingsHelper.isOffline) { // We're offline, and will load files from disk
                            callback(null, localFilePath, integrationId, scriptfileName);
                        }
                        else {
                            let requestOptions = {
                                retries: 2,
                                uri: scriptFileUri
                            };
                            retryRequest(scriptFileUri, requestOptions, function (err, response, scriptContent) {
                                if (response.statusCode != 200 || err != null) {
                                    if (activity.userData.bindToVersion && activity.userData.version) {
                                        self.onLog("Unable to get file: " + scriptfileName + " -version " + activity.userData.version);
                                    }
                                    else {
                                        self.onLog("Unable to get file:" + scriptfileName);

                                    }
                                    if (fs.existsSync(localFilePath)) {
                                        self.onLog("Local file already exists. Proceeding with potentially old version");
                                        _downloadedScripts.push({ name: scriptfileName });
                                        callback(null, localFilePath, integrationId, scriptfileName);
                                    }
                                    var lineStatus = "|" + util.padRight(activity.userData.id, 20, ' ') + "| " + "Not found".red + " |" + util.padRight(itinerary.integrationName, 40, ' ') + "|";
                                    self.onLog(lineStatus);
                                    done();
                                }
                                else {

                                    fs.writeFileSync(localFilePath, scriptContent);
                                    _downloadedScripts.push({ name: scriptfileName });
                                    callback(null, localFilePath, integrationId, scriptfileName);
                                }
                            });
                        }
                    }
                    catch (error2) {
                        self.onLog(error2.message);
                        done();
                    }
                },
                // Create Service
                function (localFilePath, integrationId, scriptfileName, callback) {
                    var newMicroService = null;
                    try {
                        if (localFilePath == null) {
                            callback(null, null);
                        }
                        // Load an instance of the base class
                        newMicroService = new MicroService(reload(localFilePath));
                        newMicroService.NodeName = settingsHelper.settings.nodeName;
                        newMicroService.OrganizationId = organizationId;
                        newMicroService.ItineraryId = itinerary.itineraryId;
                        newMicroService.Id = activity.id;
                        newMicroService.Name = activity.userData.id;
                        newMicroService.Itinerary = itinerary;
                        newMicroService.IntegrationId = activity.userData.integrationId;
                        newMicroService.IntegrationName = itinerary.integrationName;
                        newMicroService.Environment = itinerary.environment;
                        newMicroService.TrackingLevel = itinerary.trackingLevel;
                        newMicroService.Init(activity.userData.config);
                        newMicroService.UseEncryption = settingsHelper.settings.useEncryption;
                        newMicroService.ComSettings = _comSettings;
                        newMicroService.baseType = activity.userData.baseType;
                        newMicroService.Com = com;
                        newMicroService.Orchestrator = _orchestrator;
                        newMicroService.settingsHelper = settingsHelper;
                        newMicroService.timezone = settingsHelper.settings.timezone;
                        newMicroService.getAllServices = function () {
                            return self._microServices;
                        };
                        newMicroService.addonDirectory = path.resolve(settingsHelper.homeDirectory, "addons/build/Release");
                        newMicroService.OnReceivedState(function (state, sender) {
                            com.ChangeState(state, sender);
                        });
                        // Eventhandler for messages sent back from the service
                        newMicroService.OnMessageReceived(function (integrationMessage, sender) {
                            try {
                                integrationMessage.OrganizationId = settingsHelper.settings.organizationId;

                                if (integrationMessage.FaultCode != null) {
                                    trackException(integrationMessage,
                                        integrationMessage.LastActivity,
                                        "Failed",
                                        integrationMessage.FaultCode,
                                        integrationMessage.FaultDescripton);

                                    //self.onLog('Exception: '.red + integrationMessage.FaultDescripton);
                                    self.onLog("EXCEPTION: ".red + '['.gray + sender + ']'.gray + '=>'.red + integrationMessage.FaultDescripton);
                                    return;
                                }

                                trackMessage(integrationMessage, integrationMessage.LastActivity, integrationMessage.IsFirstAction ? "Started" : "Completed");

                                // Process the itinerary to find next service
                                _orchestrator.getSuccessors(integrationMessage)
                                    .then(function (successors) {
                                        successors.forEach(function (successor) {
                                            integrationMessage.Sender = settingsHelper.settings.nodeName;

                                            // No correlation
                                            try {
                                                var messageString = '';
                                                if (integrationMessage.ContentType != 'application/json' && integrationMessage.ContentType != 'application/octet-stream') {
                                                    var buf = new Buffer(integrationMessage._messageBuffer, 'base64');
                                                    messageString = buf.toString('utf8');
                                                }

                                                var destination = sender.ParseString(successor.userData.host, messageString, integrationMessage);
                                                integrationMessage.isDynamicRoute = destination != successor.userData.host;
                                                destination.split(',').forEach(function (destinationNode) {

                                                    // Encrypt?
                                                    if (settingsHelper.settings.useEncryption == true) {
                                                        var messageBuffer = new Buffer(integrationMessage._messageBuffer, 'base64');
                                                        messageBuffer = util.encrypt(messageBuffer);
                                                        integrationMessage.Encrypted = true;
                                                        integrationMessage._messageBuffer = messageBuffer;
                                                        // integrationMessage.MessageBuffer = messageBuffer;
                                                    }

                                                    if (destinationNode == settingsHelper.settings.nodeName) {
                                                        receiveMessage(integrationMessage, successor.userData.id);
                                                    }
                                                    else {
                                                        if (typeof integrationMessage._messageBuffer != "string") {
                                                            integrationMessage._messageBuffer = integrationMessage._messageBuffer.toString('base64');
                                                            //integrationMessage.MessageBuffer = integrationMessage._messageBuffer;
                                                        }
                                                        com.Submit(integrationMessage,
                                                            destinationNode.toLowerCase(),
                                                            successor.userData.id);
                                                    }
                                                });

                                            }
                                            catch (err) {
                                                self.onLog(err);
                                            }
                                        });
                                    })
                                    .catch(function (err) {
                                        self.onLog(err);
                                    });


                            }
                            catch (generalEx) {
                                self.onLog(generalEx.message);
                            }
                        });
                        // [DEPRICATED]Eventhandler for any errors sent back from the service
                        newMicroService.OnError(function (source, errorId, errorDescription) {
                            self.onLog("The Error method is deprecated. Please use the ThrowError method instead.".red);
                            self.onLog("Error at: ".red + source);
                            self.onLog("Error id: ".red + errorId);
                            self.onLog("Error description: ".red + errorDescription);
                        });
                        // Eventhandler for any debug information sent back from the service
                        newMicroService.OnDebug(function (source, info) {

                            self.onLog("DEBUG: ".green + '['.gray + source.gray + ']'.gray + '=>'.green + info);

                            if (settingsHelper.settings.debug != null && settingsHelper.settings.debug == true) {// jshint ignore:line               
                                applicationinsights.trackEvent("Tracking", { service: source, state: info });
                            }
                        });
                        // Eventhander for reporting location 
                        newMicroService.OnReportLocation(function (location) {
                            self.onReportLocation(location);
                        });

                        callback(null, newMicroService, scriptfileName);
                    }
                    catch (error3) {
                        if (!newMicroService) {
                            self.onLog('Unable to load '.red + localFilePath.red + ' ' + error3);
                        }
                        else
                            self.onLog('Unable to start service '.red + newMicroService.Name.red + ' ' + error3);

                        done();
                    }
                },
                // Start Service
                function (newMicroService, scriptfileName, callback) {
                    if (newMicroService == null) {
                        callback(null, null);
                    }
                    // Start the service
                    try {
                        self._microServices.push(newMicroService);
                        if (activity.userData.isInboundREST || activity.userData.type === "azureApiAppInboundService") {
                            if (!_startWebServer) {
                                util.addNpmPackages('express,body-parser', false, function (err) {
                                    http = require('http');
                                    express = require('express');
                                    bodyParser = require('body-parser');
                                    app = express();
                                    _startWebServer = true;
                                    newMicroService.App = app;
                                    callback();
                                });
                            }
                            else {
                                newMicroService.App = app;
                                callback();
                            }
                        }
                        else {
                            callback();
                        }
                    }
                    catch (ex) {
                        self.onLog('Unable to start service '.red + newMicroService.Name.red);
                        if (typeof ex === 'object')
                            self.onLog(ex.message.red);
                        else
                            self.onLog(ex.red);

                        exceptionsLoadingItineraries++;
                        callback(null, 'exception');
                    }
                },
                // Download dependancies
                function (callback) {
                    if (!activity.userData.config.dependenciesConfig ||
                        !activity.userData.config.dependenciesConfig.length ||
                        settingsHelper.isOffline) {
                        callback(null, 'done');
                    }
                    else {
                        self.onLog('Download dependancies');
                        // Get List of all uri's
                        var dependancyFilesURIs = activity.userData.config.dependenciesConfig.map(function (dependancyFile) {
                            let dependancyFileUri = settingsHelper.settings.hubUri + '/api/Scripts/' + dependancyFile.organizationId + "/" + dependancyFile.name;
                            dependancyFileUri = dependancyFileUri.replace('wss://', 'https://');
                            return dependancyFileUri;
                        });

                        var addOnName = activity.userData.type;
                        self.onLog('addOnName: ' + addOnName);
                        // Create build directory
                        var directory = path.resolve(settingsHelper.homeDirectory, "addons");

                        // Download dependancy file
                        let target = {
                            target_name: addOnName,
                            sources: []
                        };

                        let depCount = 0;
                        async.forEach(dependancyFilesURIs, function (dependancyFileURI, done) {
                            var dependancyFileName = path.basename(dependancyFileURI);

                            let requestOptions = {
                                retries: 2,
                                uri: dependancyFileURI
                            };

                            retryRequest(dependancyFileURI, requestOptions, function (err, response, scriptContent) {
                                if (response.statusCode != 200 || err != null) {
                                    self.onLog("Unable to get dependancy file:" + dependancyFileName);
                                    let localFilePath = path.resolve(directory, dependancyFileName);
                                    if (fs.existsSync(localFilePath)) {
                                        self.onLog("Local file already exists. Proceeding with potentially old version");
                                        done();
                                    }
                                    else{}
                                    done("Local file does not exists. This will likely cause issues!. File:" + dependancyFileName);
                                    
                                }
                                else {
                                    if (path.extname(dependancyFilesURIs[0]) === '.js') {
                                        var localFilePath = path.resolve(settingsHelper.serviceDirectory, dependancyFileName);
                                        self.onLog('Saving JS file: ' + localFilePath);
                                        fs.writeFileSync(localFilePath, scriptContent);
                                        done();
                                    }
                                    else {
                                        // Create addOn directory
                                        self.onLog('Create directory: ' + directory);
                                        if (!fs.existsSync(directory)) {
                                            fs.mkdirSync(directory);
                                        }
                                        var localFilePath = path.resolve(directory, dependancyFileName);
                                        self.onLog('Saving addon file: ' + localFilePath);
                                        fs.writeFileSync(localFilePath, scriptContent);
                                        target.sources.push(dependancyFileName);
                                        done();
                                    }

                                }
                            });

                        }, function (err) {
                            if (err) {
                                self.onLog(err);
                                callback(null, 'exception');
                            }
                            else if (target.sources.length) {
                                bindingGyp.targets.push(target);
                                callback(null, 'done', directory);
                            }
                            else
                                callback(null, 'done');
                        });
                    }
                }

            ], function (x, status, directory) {

                if (bindingGyp.targets.length) {
                    // Create binding file
                    fs.writeFileSync(path.resolve(directory, "binding.gyp"), JSON.stringify(bindingGyp));
                    // Create package file
                    fs.writeFileSync(path.resolve(directory, "package.json"), '{"name":"microServiceBus-addons","version":"1.0.0","description":"...","dependencies":{},"devDependencies":{},"scripts":{},"author":"","license":"MIT","repository":{},"config":{"unsafe-perm":true},"gypfile":true}');
                    // BUILD
                    self.onLog('Compiling addon...');
                    util.compile(directory, function (err, data) {
                        self.onLog('Done compiling...');
                        if (err) {
                            self.onLog('Unable to compile service.'.red);
                            self.onLog('ERROR: '.red + err);

                        }
                        else {
                            self.onLog('Service compiled successfully'.green);
                            self.onLog('Response : ' + JSON.stringify(data));
                        }
                        done();
                    });
                }
                else {
                    done();
                }
            });
        }
        catch (ex2) {
            self.onLog('Unable to start service.'.red);
            self.onLog(ex2.message.red);
        }
    }
    // The listner is used for incoming REST calls and is started
    // only if there is an inbound REST service
    function startListen() {
        if (!_startWebServer)
            return;

        try {
            if (settingsHelper.settings.port != undefined)
                port = settingsHelper.settings.port;

            self.onLog("Listening to port: " + settingsHelper.settings.port);
            self.onLog();

            server = http.createServer(app);

            // parse application/x-www-form-urlencoded
            app.use(bodyParser.urlencoded({ extended: false }));

            app.use(function (req, res) {
                res.header('Content-Type', 'text/html');
                var response = '<style>body {font-family: "Helvetica Neue",Helvetica,Arial,sans-serif; background: rgb(52, 73, 94); color: white;}</style>';
                response += '<h1><img src="https://microservicebus.com/Images/Logotypes/Logo6.svg" style="height:75px"/> Welcome to the ' + settingsHelper.settings.nodeName + ' node</h1><h2 style="margin-left: 80px">API List</h2>';

                app._router.stack.forEach(function (endpoint) {
                    if (endpoint.route != undefined) {
                        if (endpoint.route.methods.get != undefined && endpoint.route.methods.get == true)
                            response += '<div style="margin-left: 80px"><b>GET</b> ' + endpoint.route.path + "</div>";
                        if (endpoint.route.methods.delete != undefined && endpoint.route.methods.delete == true)
                            response += '<div style="margin-left: 80px"><b>DELETE</b> ' + endpoint.route.path + "</div>";
                        if (endpoint.route.methods.post != undefined && endpoint.route.methods.post == true)
                            response += '<div style="margin-left: 80px"><b>POST</b> ' + endpoint.route.path + "</div>";
                        if (endpoint.route.methods.put != undefined && endpoint.route.methods.put == true)
                            response += '<div style="margin-left: 80px"><b>PUT</b> ' + endpoint.route.path + "</div>";
                    }
                });

                res.send(response);
            });

            app.use('/', express.static(__dirname + '/html'));

            self.onLog("REST endpoints:".green);
            app._router.stack.forEach(function (endpoint) {
                if (endpoint.route != undefined) {
                    if (endpoint.route.methods.get != undefined && endpoint.route.methods.get == true)
                        self.onLog("GET:    ".yellow + endpoint.route.path);
                    if (endpoint.route.methods.delete != undefined && endpoint.route.methods.delete == true)
                        self.onLog("DELETE: ".yellow + endpoint.route.path);
                    if (endpoint.route.methods.post != undefined && endpoint.route.methods.post == true)
                        self.onLog("POST:   ".yellow + endpoint.route.path);
                    if (endpoint.route.methods.put != undefined && endpoint.route.methods.put == true)
                        self.onLog("PUT:    ".yellow + endpoint.route.path);
                }
            });

            server = http.createServer(app).listen(port, function (err) {
                self.onLog("Server started on port: ".green + port);
                self.onLog();
            });
        }
        catch (e) {
            self.onLog('Unable to start listening on port ' + port);
        }
    }
    // Submits tracking data to host
    function trackMessage(msg, lastActionId, status) {
        if (!settingsHelper.settings.enableTracking)
            return;

        if (typeof msg._messageBuffer != "string") {
            msg._messageBuffer = msg._messageBuffer.toString('base64');
        }

        var time = moment();
        var messageId = guid.v1();

        if (msg.IsFirstAction && status == "Completed")
            msg.IsFirstAction = false;

        // Remove message if encryption is enabled?
        if (settingsHelper.settings.useEncryption == true) {
            msg._messageBuffer = new Buffer("[ENCRYPTED]").toString('base64');
        }

        var trackingMessage = {
            _message: msg._messageBuffer,
            NodeId: settingsHelper.settings.id,
            ContentType: msg.ContentType,
            LastActivity: lastActionId,
            NextActivity: null,
            Node: settingsHelper.settings.nodeName,
            MessageId: messageId,
            OrganizationId: settingsHelper.settings.organizationId,
            InterchangeId: msg.InterchangeId,
            ItineraryId: msg.ItineraryId,
            IntegrationName: msg.IntegrationName,
            Environment: msg.Environment,
            TrackingLevel: msg.TrackingLevel,
            IntegrationId: msg.IntegrationId,
            IsFault: false,
            IsEncrypted: settingsHelper.settings.useEncryption == true,
            FaultCode: msg.FaultCode,
            FaultDescription: msg.FaultDescripton,
            IsFirstAction: msg.IsFirstAction,
            TimeStamp: time.utc().toISOString(),
            State: status,
            Variables: msg.Variables
        };
        com.Track(trackingMessage);

    }
    // Submits exception message for tracking
    function trackException(msg, lastActionId, status, fault, faultDescription) {
        if (!fault || !msg.FaultCode || (settingsHelper.mode && settingsHelper.mode !== "NORMAL")) {
            return;
        }

        // Prevent errors from being escalated more than once an hour
        var exists = _exceptionCollection._collection.find(function (e) {
            return e.label === msg.FaultCode;
        });
        if (exists) {
            return;
        }
        else {
            _exceptionCollection.push(false, msg.FaultCode);
        }


        var time = moment();
        var messageId = guid.v1();

        var trackingMessage =
        {
            _message: msg.MessageBuffer,
            NodeId: settingsHelper.settings.id,
            ContentType: msg.ContentType,
            LastActivity: lastActionId,
            NextActivity: null,
            Node: settingsHelper.settings.nodeName,
            MessageId: messageId,
            Variables: null,
            OrganizationId: settingsHelper.settings.organizationId,
            IntegrationName: msg.IntegrationName,
            Environment: msg.Environment,
            TrackingLevel: msg.TrackingLevel,
            InterchangeId: msg.InterchangeId,
            ItineraryId: msg.ItineraryId,
            IntegrationId: msg.IntegrationId,
            FaultCode: msg.FaultCode,
            FaultDescription: msg.FaultDescripton,
            IsFirstAction: msg.IsFirstAction,
            TimeStamp: time.utc().toISOString(),
            IsFault: true,
            CreateTicket: msg.CreateTicket,
            State: status
        };

        if (com)
            com.Track(trackingMessage);

        if (applicationinsights)
            applicationinsights.trackException(trackingMessage);
    }
}

module.exports = MicroServiceBusNode;

