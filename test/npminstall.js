'use strict'; /* global describe, it */

var path = require('path');
var mocha = require('mocha');
var expect = require('chai').expect;
var util = require("../lib/utils.js");

describe('Util functions', function () {
    
    it('addNpmPackage (msbcam) should work', function (done) {
        this.timeout(30000);
        util.addNpmPackages("msbcam", false, function (err) {
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
    it('removeNpmPackage (msbcam) should work', function (done) {
        this.timeout(30000);
        util.removeNpmPackage("msbcam", function (err) {
            expect(err).to.be.null;
            done();
        });
    });
});

