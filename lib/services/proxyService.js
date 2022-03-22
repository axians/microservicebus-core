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
require('colors');
const fs = require('fs');
const https = require('https');
var util = require('../utils');

function ProxyService(log) {
    var self = this;
    this.log = log;
    this.express = null;
    this.app = null;
    this.server = null;
    this.morgan = null;
    this.proxymiddleware = null;
    

    ProxyService.prototype.Start = function (proxyPolicy) {
        return new Promise((resolve, reject) => {
            self.log("ProxyService: Starting...");
            util.addNpmPackages('express,morgan,http-proxy-middleware', false, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    const express = require('express');
                    const morgan = require("morgan");
                    const proxymiddleware = require('http-proxy-middleware');

                    // Create Express Server
                    self.app = express();
                    self.server = https.createServer({
                        key: fs.readFileSync(proxyPolicy.keyPath),
                        cert: fs.readFileSync(proxyPolicy.certificatePath)
                    }, self.app);
                    
                    let debug = true;

                    if (debug) {
                        self.app.use(morgan('dev'));
                    }
                    
                    self.app.use('*', proxymiddleware.createProxyMiddleware({
                        target: proxyPolicy.forwardTo,
                        ws: true,
                        changeOrigin: true,
                        logLevel: 'info',
                        secure: !debug
                    }));
                    
                    self.server.listen(proxyPolicy.listenTo, () => {
                        self.log(`Proxy is listening to port ${proxyPolicy.listenTo}`.green);
                        resolve();
                    })
                }
            });
        });
    };
    ProxyService.prototype.Stop = function (proxyPolicy) {
        self.server.close();
        self.log(`Proxy stopped`.grey);
    }
}

module.exports = ProxyService;