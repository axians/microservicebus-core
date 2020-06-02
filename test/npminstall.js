'use strict'; /* global describe, it */

var path = require('path');
var mocha = require('mocha');
var expect = require('chai').expect;
var util = require("../lib/utils.js");

describe('Util functions', function () {
    
    it('addNpmPackage (msbcam, hello-world-node-package and colors) should work', function (done) {
        this.timeout(30000);
        util.addNpmPackages("msbcam,hello-world-node-package", false, function (err) {
            expect(err).to.equal(null);
            done();
        });
    });
    it('require (msbcam) should work', function (done) {
        this.timeout(30000);
        let msbcam = require('msbcam');
        expect(msbcam).not.to.be.null;
        done();
    });
    it('require (hello-world-node-package) should work', function (done) {
        this.timeout(30000);
        let helloWorld = require('hello-world-node-package');
        expect(helloWorld).not.to.be.null;
        done();
    });
    it('require (colors) should work', function (done) {
        this.timeout(30000);
        let c = require('colors');
        expect(c).not.to.be.null;
        done();
    });
    it('removeNpmPackage (msbcam) should work', function (done) {
        this.timeout(30000);
        util.removeNpmPackage("msbcam", function (err) {
            expect(err).to.be.null;
            done();
        });
    });
    it('removeNpmPackage (hello-world-node-package) should work', function (done) {
        this.timeout(30000);
        util.removeNpmPackage("hello-world-node-package", function (err) {
            expect(err).to.be.null;
            done();
        });
    });
});

