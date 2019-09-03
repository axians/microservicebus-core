'use strict'; /* global describe, it */

var path = require('path');
process.env.UNITTEST = true;
var initialArgs = process.argv[1];
process.argv[1] = path.resolve(__dirname, "../start.js");
var mocha = require('mocha');
var expect = require('chai').expect;
var assert = require('assert');
var request = require('supertest');
var should = require('should');
var fs = require('fs');
require('colors');
var SCRIPTFOLDER = path.resolve(process.env.HOME, "microServiceBus/services");
var util;
var MicroServiceBusHost;
var SettingsHelper;
var settingsHelper;
var orgId;
var nodeKey;
var signedIn = false;
var settings;
var loggedInComplete1;
var microServiceBusHost;
var flowResult;
var ttlCollection;
var persistHelper;

describe('Util functions', function () {

    it('Prepare settings', function (done) {
        util = require("../lib/utils.js");
        SettingsHelper = require("./SettingsHelper.js");
        util.prepareNpm(new SettingsHelper());
        // require('app-module-path').addPath(process.env.NODE_PATH);
        // require('module').globalPaths.push(process.env.NODE_PATH);
        // require('module')._initPaths();

        // var directories = "/usr/lib/node_modules:/usr/local/lib/node:/usr/local/lib/node_modules".split(":");
        // console.log();
        // console.log();
        // console.log();
        // directories.forEach(function(directoryPath ){
        //     console.log(directoryPath.green);
        //     fs.readdir(directoryPath, function (err, files) {
        //         //handling error
        //         if (err) {
        //             return console.log('Unable to scan directory: ' + err);
        //         } 
        //         //listing all files using forEach
        //         files.forEach(function (file) {
        //             // Do whatever you want to do with the file
        //             console.log('\t'+file); 
        //         });
        //         console.log('console.log();');
        //     });
        // });
        console.log();
        console.log();
        console.log();
        
        exec("npm list -g", function (error, stdout, stderr) {
            console.log('npm list -g: ' + stdout);
            
        });
        console.log();
        console.log();
        console.log();
        done();
    });
    it('padRight should work', function (done) {
        var t = util.padRight("microServiceBus.com", 25, ' ');
        expect(t).to.equal("microServiceBus.com      ");
        done();
    });
    it('padLeft should work', function (done) {

        var t = util.padLeft("microServiceBus.com", 25, ' ');
        expect(t).to.equal("      microServiceBus.com");
        done();
    });
    it('addNpmPackage (msbcam) should work', function (done) {
        this.timeout(30000);
        util.addNpmPackage("msbcam", function (err) {
            expect(err).to.equal(null);
            done();
        });
    });
    it('compare same version should work', function (done) {

        var r = util.compareVersion("1.0.0", "1.0.0");
        expect(r).to.equal(0);
        done();
    });
    it('compare greater version should work', function (done) {

        var r = util.compareVersion("1.0.0", "1.0.1");
        expect(r).to.equal(-1);
        done();
    });
    it('compare earlier version should work', function (done) {

        var r = util.compareVersion("1.0.2", "1.0.1");
        expect(r).to.equal(1);
        done();
    });
    it('compress should work', function (done) {
        var srcPath = path.resolve(__dirname,'../README.md' );
        var dstPath = path.resolve(__dirname,'../README.md' );
        util.compress (srcPath, dstPath, function(err, fileName){
            should.not.exist(err);
            done();
        });       
    });
    // it('getDependanciesRecursive should work', function (done) {
    //     this.timeout(6000);
    //     util.getDependanciesRecursive(function(err, fileName){
    //         should.not.exist(err);
    //         done();
    //     });
       
    // });
    // it('getDependanciesRecursive should work', function (done) {
    //     this.timeout(6000);
    //     util.getAvailableDiskspaceRaw(function(err, fileName){
    //         should.not.exist(err);
    //         done();
    //     });
       
    // });
    
});

describe('TTL functions', function (){
    it('Init TTLCollection should work', function (done) {
        let TTLCollection = require("../lib/TTLCollection");
        const TTLNAME = "TTLSAMPLE"
        const TTLHISTORY_TTL = 7 * 24 * 60 * 60 * 1000; // one week
        const TTLHISTORY_CHECKINTERVAL = 5 * 60 * 1000; // every 5 minutes
        const TTLHISTORY_PERSISTINTERVAL = 5 * 60 * 1000; // 5 minutes
        
        ttlCollection = new TTLCollection({
            key: TTLNAME,
            ttl: TTLHISTORY_TTL,
            checkPeriod: TTLHISTORY_CHECKINTERVAL,      // Interval to check for expired items
            persistPeriod: TTLHISTORY_PERSISTINTERVAL,  // Interval (this.options.persistPeriod) for persising self._collection
            persistDir: path.resolve(__dirname, "../coverage"),
            persistFileName: TTLNAME + '.json'
        });
        try{
            ttlCollection.push(false);
            done();
        }
        catch(err){
            should.not.exist(err);
            done();
        }
        
    });
    it('filterCollection should work', function (done) {
        this.timeout(6000);
        ttlCollection.filterCollection(Date.parse('2019-09-01'), new Date(), 'hour', function (err, filteredCollection) {
            should.not.exist(err);
            expect(filteredCollection.length).to.be.gte(1);
            done();
        });
    });
    it('pushUnique should work', function (done) {
        this.timeout(6000);
        
        try{
            ttlCollection.pushUnique(42, 42, "agroup");
            done();
        }
        catch(err){
            should.not.exist(err);
            done();
        }

        ttlCollection.filterCollection(Date.parse('2019-09-01'), new Date(), 'hour', function (err, filteredCollection) {
            should.not.exist(err);
            expect(filteredCollection).to.be.gte(2);
            done();
        });
    });
    it('filterByGroup  should work', function (done) {
        this.timeout(6000);
        try{
            let group = ttlCollection.filterByGroup ("agroup");
            expect(group.length).to.be.gte(1);
            done();
        }
        catch(err){
            should.not.exist(err);
            done();
        }
    });
});

describe('Encryption/Decryption', function () {
    var dataToEncrypt = "Some data";
    var encryptedBuffer;

    it('Encryption should work', function (done) {

        var dataToEncrypt = "Some data";
        encryptedBuffer = util.encrypt(new Buffer(dataToEncrypt), "secret");
        done();
    });
    it('Decryption should work', function (done) {

        var decryptedBuffer = util.decrypt(encryptedBuffer, "secret");
        var str = decryptedBuffer.toString('utf8');

        if (str != dataToEncrypt)
            throw "Encryption/Decryption failed";

        done();
    });
});

describe('Check configuration', function () {
    it('ENV organizationId should be set', function (done) {
        orgId = process.env.organizationId;
        console.log('organizationId: ' + orgId);
        expect(orgId).to.not.be.null;

        done();
    });
    it('ENV nodeKey should be set', function (done) {
        nodeKey = process.env.nodeKey;
        console.log('nodeKey: ' + nodeKey);

        expect(nodeKey).to.not.be.null;

        done();
    });
});

describe('Run scenario test', function () {
    it('Save settings should work', function (done) {
        SettingsHelper = require("./SettingsHelper.js");
        settingsHelper = new SettingsHelper();
        settings = {
            "hubUri": "wss://microservicebus.com",
            "trackMemoryUsage": 0,
            "enableKeyPress": false,
            "useEncryption": false,
            "log": "",
            "nodeName": "unitTestNode1",
            "organizationId": orgId,
            "machineName": "unitTestNode1",
            "id": "644424d1-b591-4fd0-b7c2-29736b2f51ac",
            "sas": nodeKey,
            "port": 9090
        };
        settingsHelper.settings = settings;
        settingsHelper.save();
        done();
    });
    it('saveSettings should work', function (done) {
        util.saveSettings(settingsHelper.settings, function(err){
            should.not.exist(err);
            done();
        });
    });
    it('Create microServiceBus Node should work', function (done) {
        this.timeout(60000);
        try {
            loggedInComplete1 = false;
            MicroServiceBusHost = require("../lib/MicroServiceBusHost.js");
            microServiceBusHost = new MicroServiceBusHost(settingsHelper);
            microServiceBusHost.SetTestParameters();
            expect(microServiceBusHost).to.not.be.null;
            done();
        }
        catch (err) {
            expect(err).to.be.null;
            done();
        }
    });
    it('Sign in should work', function (done) {
        this.timeout(60000);
        microServiceBusHost.OnStarted(function (loadedCount, exceptionCount) {
            if (!signedIn) {
                expect(exceptionCount).to.eql(0);
                expect(loadedCount).to.eql(1);
                signedIn = true;
                done();

            }
        });
        try {
            microServiceBusHost.Start();

        }
        catch (er) {
            expect(er).to.be.null;
            done();
        }
    });
    it('Flow should complete', function (done) {
        this.timeout(10000);
        microServiceBusHost.OnUnitTestComplete(function (result) {
            expect(1).to.eql(1);
            flowResult = result;
            done();
        });
    });
    it('Flow result should be good', function (done) {
        for(let property in flowResult){
            expect(flowResult[property]).to.eql(true);
            let result = flowResult[property] ? "√".green : "failed".red  
            console.log('\t' +property + ' : ' + result);
        }
        
        done();
    });
    it('Enable tracking should work', function (done) {
        this.timeout(60000);
        var r = microServiceBusHost.TestOnChangeTracking(function (enabledTracking) {
            expect(enabledTracking).to.equal(true);
            done();
        });
    });
    it('Report state should work', function (done) {
        this.timeout(60000);
        var r = microServiceBusHost.TestOnReportState(function (sucess) {
            expect(sucess).to.equal(true);
            done();
        });
    });
    it('Ping should work', function (done) {
        this.timeout(60000);
        var r = microServiceBusHost.TestOnPing("test");
        expect(r).to.equal(true);
        done();
    });
    it('Change Debug state should work', function (done) {
        this.timeout(60000);
        microServiceBusHost.TestOnChangeDebug(function (success) {
            expect(success).to.equal(true);
            done();

        });
    });
});

// describe('PersistHelper functions', function (){
//     it('Init PersistHelper should work', function (done) {
//         console.log('settingsHelper.persistDirectory : ' + settingsHelper.persistDirectory)
//         let PersistHelper = require("../lib/PersistHelper");

//         try{
//             persistHelper = new PersistHelper(settingsHelper);
//             done();
//         }
//         catch(err){
//             should.not.exist(err);
//         }
        
//     });
//     it('persist should work', function (done) {
//         this.timeout(6000);
//         persistHelper.persist({id:1}, 'event', function (err) {
//             should.not.exist(err);
//           });
//     });
//     it('there should be persisted messages', function (done) {
//         this.timeout(6000);
//         expect(persistHelper.storage.keys()).to.have.lengthOf(1);
//     });
// });

describe('Post Signin', function () {
    it('azureApiAppInboundService.js should exist after login', function (done) {
        var filePath = path.resolve(SCRIPTFOLDER, "azureApiAppInboundService.js");
        var ret = fs.statSync(filePath);
        ret.should.be.type('object');

        done();
    });

    it('javascriptaction.js should exist after calling service', function (done) {
        var filePath = path.resolve(__dirname, SCRIPTFOLDER, "javascriptaction.js");

        var ret = fs.statSync(filePath);
        ret.should.be.type('object');
        done();
    });
    it('ping should work', function (done) {
        var pingResponse = microServiceBusHost.TestOnPing("");
        pingResponse.should.equal(true);
        done();
    });

    it('change state should work', function (done) {
        var TestOnChangeDebugResponse = microServiceBusHost.TestOnChangeState("Stop");
        done();
    });
    // it('removeNpmPackage (msbcam) should work', function (done) {
    //     this.timeout(30000);
    //     util.removeNpmPackage("msbcam", function (err) {
    //         expect(err).to.be.null;
    //         done();
    //     });
    // });
    it('Stop should work', function (done) {
        this.timeout(10000);
        
        microServiceBusHost.TestStop(function(err){
            should.not.exist(err);
            done();
        });
    });
    it('Sign out should work', function (done) {
        done();
        setTimeout(function () { process.exit(99); }, 1000);
    });
}); 
