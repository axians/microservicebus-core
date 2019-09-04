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

var exports = module.exports = {};
var fs = require('fs');
const { exec } = require('child_process');
const async = require('async');
var moment = require('moment');
var os = require('os');
var path = require("path");
var crypto = require('crypto');
var algorithm = 'aes-256-ctr';
const zlib = require('zlib');
require('colors');
var rootFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname;
var npmFolder = process.arch == 'mipsel' ? '/mnt/sda1' : __dirname + "/../node_modules";
var isInstallingDiskUsage = false;
var ignoreDiskUsage = false; // Prevent forcing installation on Win

if (process.env.TRAVIS_NODE_VERSION) {
    let node_path = process.env.npm_config_node_gyp.replace('/npm/node_modules/node-gyp/bin/node-gyp.js','');
    let exists = module.paths.find(function(p){
        return p === node_path;
    })
    if(!exists)
        module.paths.push(node_path);
}
// if (process.platform === 'win32') {
//     let npmPath = path.resolve(process.env.USERPROFILE, "AppData\\Roaming\\npm\\node_modules");
//     module.paths.push(npmPath);
// } else {
//     module.paths.push("/usr/lib/node_modules");
// }

exports.padLeft = function (nr, n, str) {
    if (nr.length > n)
        nr = nr.substring(0, n);

    return Array(n - String(nr).length + 1).join(str || '0') + nr;
};

exports.padRight = function (nr, n, str) {
    if (nr != undefined && nr.length > n)
        nr = nr.substring(0, n);

    return nr + Array(n - String(nr).length + 1).join(str || '0');
};

exports.saveSettings = function (settings, done) {
    var fileName = rootFolder + "/settings.json";
    fs.writeFile(fileName, JSON.stringify(settings, null, 4), function (err) {
        if (err) {
            console.log(err);
        }
        if (done)
            done();
    });
};
/* istanbul ignore next */
fs.mkdirRecursive = function (dirPath, mode, callback) {
    //Call the standard fs.mkdir
    fs.mkdir(dirPath, mode, function (error) {
        // When it fail in this way, do the custom steps
        if (error && error.errno === 34) {
            //Create all the parents recursively
            fs.mkdirParent(path.dirname(dirPath), mode, callback);
            //And then the directory
            fs.mkdirParent(dirPath, mode, callback);
        }
        //Manually run the callback since we used our own callback to do all these 
        callback && callback(error); // jshint ignore:line
    });
};
/* istanbul ignore next */
exports.mkdir = function (dir, callback) {
    fs.mkdirParent(dir, null, callback);
};

exports.encrypt = function (buffer, password) {
    password = password == undefined ? process.env.NODESECRET : password;
    if (password == undefined) {
        throw "Node is configured to use encryption, but no secret has been configured. Add an environment variable called 'NODESECRET and set the value to your secret.".bgRed;
    }

    var cipher = crypto.createCipher(algorithm, password);
    var crypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return crypted;
};

exports.decrypt = function (buffer, password) {
    password = password == undefined ? process.envNODESECRET : password;
    if (password == undefined) {
        throw "Node is configured to use encryption, but no secret has been configured. Add an environment variable called 'NODESECRET and set the value to your secret.".bgRed;
    }
    var algorithm = 'aes-256-ctr';
    var decipher = crypto.createDecipher(algorithm, password);
    var dec = Buffer.concat([decipher.update(buffer), decipher.final()]);
    return dec;
};

exports.prepareNpm = function (settingsHelper) {

    try {
        let npm = require('npm');
    }
    catch (e) {
        /* istanbul ignore next */
        {
            if (!settingsHelper) {
                let SettingsHelper = require("./SettingsHelper.js");
                settingsHelper = new SettingsHelper();
            }
            let node_path;
            if (process.platform === "win32") {
                node_path = path.resolve(process.env.HOME, "AppData\\Roaming\\npm\\node_modules");//:%USERPROFILE%\\AppData\\npm\\node_modules:%USERPROFILE%\\AppData\\Roaming\\npm\\node_modules"
            }
            else {
                node_path = "/usr/lib/node_modules:/usr/local/lib/node:/usr/local/lib/node_modules";
            }

            let separator = process.platform === "win32" ? ";" : ":";
            if (process.env.NODE_PATH) {
                process.env.NODE_PATH = process.env.NODE_PATH + separator + node_path;
            }
            else {
                process.env.NODE_PATH = node_path;
            }
        }
    }
};
/* istanbul ignore next */
exports.rebuild = function (callback) {
    var npm = require('npm');
    let minimist = require('minimist');

    let debug = minimist(process.argv.slice(2)).debug || minimist(process.execArgv).debug;
    debug = debug ? debug : false;

    var options = {
        "loglevel": "silent",
        "package-lock": !debug,
        "audit": !debug,
        "save": !debug,
        "unsafe-perm": true,
        "production": true
    };
    /* istanbul ignore next */
    if (process.env.SNAP_USER_DATA) {
        //let prefixPath = path.resolve(process.env.MSB_NODEPATH, "..");
        let prefixPath = process.env.SNAP_USER_DATA;
        console.log("Adding NPM package to %s", prefixPath);
        options.prefix = prefixPath;
    }

    npm.load(options, function (err) {
        try {
            npm.commands.install([], function (er, data) {
                callback(er);
            });
        }
        catch (ex) {
            callback(ex);
        }
    });
};

exports.addNpmPackage = function (npmPackage, callback) {
    
    var self = this;
    var npm = require('npm');
   
    var options = {
        "package-lock": false,
        "loglevel": "silent",
        "audit": false,
        "save": false
    };
    /* istanbul ignore next */
    if (process.env.SNAP_USER_DATA) {
        //let prefixPath = path.resolve(process.env.MSB_NODEPATH, "..");
        let prefixPath = process.env.SNAP_USER_DATA;
        console.log("Adding NPM package to %s", prefixPath);
        options.prefix = prefixPath;
    }
    npm.load(options, function (err) {
        var packageFolder = path.resolve(npm.dir, npmPackage);
        fs.stat(packageFolder, function (er, s) {
            if (er || !s.isDirectory()) {
                try {
                    npm.commands.install([npmPackage], function (er, data) {
                        if(er){
                            self.forceNpmInstallation(function(forceErr){
                                callback(forceErr);
                            })
                        }
                        else{
                            callback();
                        }
                    });
                }
                catch (ex) {
                    callback(ex);
                }

            }
            else {
                callback(null);
            }
        });
    });
};
/* istanbul ignore next */
exports.addNpmPackages = function (npmPackages, logOutput, callback) {
    
    var self = this;
    var npm = require('npm');
    var options = {
        "package-lock": false,
        "loglevel": "silent",
        "audit": false,
        "save": false
    };
    /* istanbul ignore next */
    if (process.env.SNAP_USER_DATA) {
        //let prefixPath = path.resolve(process.env.MSB_NODEPATH, "..");
        let prefixPath = process.env.SNAP_USER_DATA;
        console.log("Adding NPM package to %s", prefixPath);
        options.prefix = prefixPath;
    }

    npm.load(options, function (err) {
        // All packages
        var packages = npmPackages.split(',').map(function (item) {
            return item.trim();
        });
        var newPackages = [];

        for (var i = 0; i < packages.length; i++) {
            var npmPackage = packages[i];

            var segments = npmPackage.split('@');
            var name = segments[0];
            var version = segments.length > 1 ? segments[1] : "";

            try {
                require(name);

                // Check if package exists, but version is wrong
                if (version) {
                    var packageFolder = findNpmDirectory(name);
                    var pjson = require(packageFolder + '/package.json');
                    if (pjson.version !== version) {
                        newPackages.push(npmPackage);
                    }
                }
            }
            catch (e) {
                newPackages.push(npmPackage);
            }
        }

        if (newPackages.length == 0)
            callback(null);
        else {
            try {
                npm.commands.install(newPackages, function (er, data) {
                    if(er){
                        self.forceNpmInstallation(function(forceErr){
                            callback(forceErr);
                        })
                    }
                    else{
                        callback();
                    }
                });
            }
            catch (ex) {
                callback(ex);
            }
        }
    });
};
/* istanbul ignore next */
exports.forceNpmInstallation = function (callback){
    exec("npm install npm", function (error, stdout, stderr) {
        console.log('Forcing installation of NPM' + stdout);
        if (error) {
            callback(null, error);
        }
        else {
            callback();
        }
    });
}
exports.removeNpmPackage = function (npmPackage, callback) {
    var ret;
    var me = this;
    var npm = require('npm');

    var options = {
        "package-lock": false,
        "loglevel": "silent",
        "audit": false,
        "save": false
    };
    /* istanbul ignore next */
    if (process.env.SNAP_USER_DATA) {
        //let prefixPath = path.resolve(process.env.MSB_NODEPATH, "..");
        let prefixPath = process.env.SNAP_USER_DATA;
        console.log("Adding NPM package to %s", prefixPath);
        options.prefix = prefixPath;
    }
    npm.load(options, function (err) {
        npm.commands.remove([npmPackage], function (err, data) {
            callback(err);
        });
    });
};
/* istanbul ignore next */
exports.npmAudit = function (callback) {
    var exec = require('child_process').exec;
    var cmd = "npm audit --json";

    /* istanbul ignore next */
    if (process.env.SNAP_USER_DATA) {
        // As Snap installs mSB-node on a write protected partition, we need to start the process from mSB-core directory...
        // First create a package-lock.json file...
        exec(`cd ${process.env.SNAP_USER_DATA}/node_modules/microservicebus-core; npm i --package-lock-only`, function (e, so, se) {
            console.log(`error: ${e}... stderr: ${se}`);

            // And now we can run the audit
            cmd = `cd ${process.env.SNAP_USER_DATA}/node_modules/microservicebus-core; ${cmd}`;
            console.log(cmd);
            exec(cmd, function (error, stdout, stderr) {

                console.log("**************************************");
                console.log(stdout);
                console.log("***************************************");

                callback(error, JSON.parse(stdout));
            });
        });
    }
    else {
        exec(cmd, function (error, stdout, stderr) {
            console.log("**************************************");
            console.log(stdout);
            console.log("***************************************");
            callback(error, JSON.parse(stdout));
        });
    }
};
/* istanbul ignore next */
exports.compile = function (dir, callback) {
    if (process.env.SNAP_USER_DATA) {
        this.compileSNAP(dir, function (err, data) {
            callback(err, data);
        });
    }
    else {
        var options = {
            "package-lock": false,
            "loglevel": "silent",
            "audit": false,
            "save": false,
            "production": true,
            "unsafe-perm": true
        };
        var npm = require('npm');
        npm.load(options, function (err) {
            npm.commands.install(dir, [], function (err, data) {
                console.log('util::compile -> done');

                callback(err, data);
            });
        });
    }
};
/* istanbul ignore next */
exports.compileSNAP = function (dir, callback) {

    var exec = require('child_process').exec;
    exec("cd $SNAP_USER_DATA; CC=$SNAP/usr/bin/gcc npm install " + dir + " --unsafe-perm --no-package-lock", function (error, stdout, stderr) {
        console.log(stdout);
        console.log(stderr);
        callback(error, 1);

    });
};

exports.compress = function (originalFilePath, newFilePath, callback) {

    var cmd, newFilePath;
    let exec = require('child_process').exec;

    if (path.extname(originalFilePath) === ".gz") {
        cmd = `cp "${originalFilePath}" "${newFilePath}"`
    }
    else {
        cmd = `gzip -9 -c "${originalFilePath}" > "${newFilePath}"`
    }
    exec(cmd, function (error, stdout, stderr) {
        if (error) {
            callback("Unable to compress: " + error, null);
        }
        let exists = fs.existsSync(newFilePath);
        if (!exists) {
            callback("File not found", null);
        }
        else {
            callback(null, newFilePath);
        }
    });
};
/* istanbul ignore next */
exports.sendToBlobStorage = function (account, accountKey, organizationId, nodeName, filePath, callback) {
    console.log("filePath:" + filePath);
    try {
        var azure = require('azure-storage');
        var blobService = azure.createBlobService(account, accountKey);
        var options = {
            contentType: 'application/octet-stream',
            metadata: {
                organizationId: organizationId,
                node: nodeName
            }
        };
        let containerName = "syslogs";
        blobService.createContainerIfNotExists(containerName, options, function (err) {
            if (err) {
                callback("Unable to send syslog to blob storage. " + err);
            }
            else {
                blobService.createBlockBlobFromLocalFile(containerName, path.basename(filePath), filePath, function (error, result, response) {
                    if (error) {
                        callback("Unable to send syslog to blob storage. " + error);
                    }
                    else {
                        callback(null, path.basename(filePath) + " saved in blob storage.");

                    }
                });
            }
        });
    }
    catch (err) {
        callback("Unable to send syslog to blob storage. " + err);
    }
};

exports.compareVersion = function (a, b) {
    var i;
    var len;

    if (typeof a + typeof b !== 'stringstring') {
        return false;
    }

    a = a.split('.');
    b = b.split('.');
    i = 0;
    len = Math.max(a.length, b.length);

    for (; i < len; i++) {
        if ((a[i] && !b[i] && parseInt(a[i]) > 0) || (parseInt(a[i]) > parseInt(b[i]))) {
            return 1;
        } else if ((b[i] && !a[i] && parseInt(b[i]) > 0) || (parseInt(a[i]) < parseInt(b[i]))) {
            return -1;
        }
    }

    return 0;
};
/* istanbul ignore next */
exports.reboot = function (a, b) {
    var sys = require('util');
    var exec = require('child_process').exec;
    function puts(error, stdout, stderr) { sys.puts(stdout); }
    exec("sudo reboot", puts);
};
/* istanbul ignore next */
exports.shutdown = function (a, b) {
    var sys = require('util');
    var exec = require('child_process').exec;
    function puts(error, stdout, stderr) { sys.puts(stdout); }
    exec("sudo shutdown -h now", puts);
};
/* istanbul ignore next */
exports.getDependanciesRecursive = function (callback) {

    var options = { loaded: true };

    var npm = require('npm');
    npm.load(options, function (err) {
        npm.commands.list(function (err, data) {
            var list = [];
            if (!data.dependencies)
                callback(err, list);
            else { }
            list = getDependancies(data.dependencies, []);
            list = list.filter(function (value, index, self) {
                return self.indexOf(value) === index;
            });

            callback(null, list);

        });
    });

    let getDependancies = function (dependencies, list) {
        let depList = [];
        try {
            for (var p in dependencies) {
                if (dependencies.hasOwnProperty(p)) {
                    console.log(p);

                    depList.push({ name: dependencies[p].name, version: dependencies[p].version });
                    list = getDependancies(dependencies[p].dependencies, list);
                }
            }
        }
        catch (err) { }
        return list.concat(depList);
    };
};

exports.getAvailableDiskspace = function (callback) {
    if ((os.platform() === 'win32' && !process.env.PYTHON) || ignoreDiskUsage) {
        callback(null, {
            "available": "N/A",
            "free": "N/A",
            "total": "N/A"
        });
        return;
    }
    try {
        let disk = require('diskusage');

        let rootPath = os.platform() === 'win32' ? 'c:' : process.env.HOME;
        disk.check(rootPath, function (err, info) {
            if (!err) {
                let diskusage = {
                    available: (info.available / 1000000).toFixed(2) + " MB",
                    free: (info.free / 1000000).toFixed(2) + " MB",
                    total: (info.total / 1000000).toFixed(2) + " MB",
                };
                callback(null, diskusage);
            }
            else {
                callback(err);
            }
        });
    }
    catch (err) {
        /* istanbul ignore next */
        if (err.code === "MODULE_NOT_FOUND" && !isInstallingDiskUsage) {
            isInstallingDiskUsage = true;
            this.addNpmPackage('diskusage@1.1.3', function (err) {
                if (err) {
                    ignoreDiskUsage = true;
                    console.log('Ignoring disk usage');
                }
                else {
                    console.log("diskusage installed");
                }
            });
        }
        callback(err);
    }
};

exports.getAvailableDiskspaceRaw = function (callback) {
    if ((os.platform() === 'win32' && !process.env.PYTHON) || ignoreDiskUsage) {
        callback(null, {
            "available": "N/A",
            "free": "N/A",
            "total": "N/A"
        });
        return;
    }
    try {
        let disk = require('diskusage');
        let rootPath = os.platform() === 'win32' ? 'c:' : process.env.HOME;
        disk.check(rootPath, function (err, info) {
            if (!err) {
                callback(null, info);
            }
            else {
                callback(err);
            }
        });
    }
    catch (err) {
        /* istanbul ignore next */
        if (err.code === "MODULE_NOT_FOUND" && !isInstallingDiskUsage) {
            isInstallingDiskUsage = true;
            this.addNpmPackage('diskusage@1.1.3', function (err) {
                if (err) {
                    ignoreDiskUsage = true;
                    console.log('Ignoring disk usage');
                }
                else {
                    console.log("diskusage installed");
                }
            });
        }
        callback(err);
    }
};

exports.displayAnsiiLogo = function () {
    var text = "           _               ____                  _          ____             " + "\n" +
        " _ __ ___ (_) ___ _ __ ___/ ___|  ___ _ ____   _(_) ___ ___| __ ) _   _ ___  " + "\n" +
        "| '_ ` _ \\| |/ __| '__/ _ \\___ \\ / _ \\ '__\\ \\ / / |/ __/ _ \\  _ \\| | | / __| " + "\n" +
        "| | | | | | | (__| | | (_) |__) |  __/ |   \\ V /| | (_|  __/ |_) | |_| \\__ \\ " + "\n" +
        "|_| |_| |_|_|\\___|_|  \\___/____/ \\___|_|    \\_/ |_|\\___\\___|____/ \\__,_|___/ ";

    console.log(text.green);
    console.log();

};
/* istanbul ignore next */
exports.extractJournal = function (tmpPath, account, accountKey, organizationId, nodeName, log) {
    return new Promise((resolve, reject) => {
        if (process.env.MSB_PLATFORM === "YOCTO") {
            fs.readdir(tmpPath, (err, fileNames) => {
                if (err) throw err;
                // iterate through the found file names
                async.each(fileNames, function (fileName, removeCallback) {
                    if (/^journallog+/.test(fileName)) {
                        // try to remove the file and log the result
                        fs.unlink(tmpPath + fileName, (err) => {
                            if (err) {
                                removeCallback();
                            }
                            else {
                                console.log(`Deleted ${fileName}`);
                                removeCallback();
                            }

                        });
                    }
                    else {
                        removeCallback();
                    }
                }, function () {
                    let twoDaysAgo = moment().subtract(2, 'day');;
                    let yesterday = moment().subtract(1, 'day')
                    let currentDate = moment();
                    let dates = [twoDaysAgo, yesterday, currentDate];
                    let fileNamePrefix = organizationId + "-" + nodeName + "-" + new Date().toISOString().replace(/[:\.\-T]/g, '') + "-";
                    //journalctl --since "2015-01-10" --until "2015-01-11 03:00"
                    async.each(dates, function (date, callback) {
                        let cmd = 'sudo journalctl --since \"' + date.format('YYYY-MM-DD') + '\" --until \"' + date.add(1, 'day').format('YYYY-MM-DD') + '\" >' + tmpPath + 'journallog-' + date.format('YYYY-MM-DD');
                        console.log("Command to extract files" + cmd);
                        exec(cmd, (err, stdout, stderr) => {
                            if (!err) {
                                console.log("WRITTEN SUCCESFULLY TO FILE");
                                console.log("STDERR: " + stderr);
                                var originalFilePath = tmpPath + 'journallog-' + date.format('YYYY-MM-DD');
                                let newFilePath = tmpPath + fileNamePrefix + 'journallog-' + date.format('YYYY-MM-DD') + ".gz";
                                exports.compress(originalFilePath, newFilePath, function (err, fileName) {
                                    if (err) {
                                        log("Unable to create syslog file. " + err);
                                        if (debugCallback) {
                                            debugCallback(false);
                                        }
                                        else {
                                            _client.invoke('integrationHub', 'notify', connectionId, "Unable to create syslog file. " + err, "ERROR");
                                        }
                                        callback()
                                    }
                                    else {
                                        log("Compressed " + originalFilePath + " to " + fileName);

                                        exports.sendToBlobStorage(account, accountKey, organizationId, nodeName, fileName, function (err) {
                                            log("Sent " + fileName + " to blobstorage");
                                        });
                                    }
                                    callback();
                                });

                            }
                            else {
                                console.log("STDERR: " + stderr);
                                console.log("STDERR: " + err);
                                callback();
                            }
                        });
                    }, function () {
                        resolve();
                    });
                });
            });
        }
        resolve();
    });

};

exports.platform = function (callback) {
    if (process.env.MSB_PLATFORM) {
        return process.env.MSB_PLATFORM;
    }
    else {
        return os.platform();
    }
};
// Returns the value of a property based on a path
exports.getValueByPath = function (obj, path, defaultValue) {
    if (typeof path === 'number') {
        path = [path];
    }
    if (!path || path.length === 0) {
        return obj;
    }
    if (obj == null) {
        return defaultValue;
    }
    if (typeof path === 'string') {
        return this.getValueByPath(obj, path.split('.'), defaultValue);
    }

    var currentPath = getKey(path[0]);
    var nextObj = getShallowProperty(obj, currentPath)
    if (nextObj === void 0) {
        return defaultValue;
    }

    if (path.length === 1) {
        return nextObj;
    }

    return this.getValueByPath(obj[currentPath], path.slice(1), defaultValue);
};
/* istanbul ignore next */
exports.getSnapList = function (callback) {
    exec("sudo snap list", function (error, stdout, stderr) {
        if (error) {
            callback(error);
        }
        else if (stderr) {
            callback(error);
        }
        else {
            let lines = stdout.split('\n');
            let headers = lines[0].split(/\s+/);

            let snapList = lines.splice(1).map(function (row) {
                let columns = row.split(/\s+/);
                let item = {};
                for (let index = 0; index < headers.length; index++) {
                    item[headers[index]] = columns[index];
                }
                return item;
            })
            callback(null, snapList);
        }
    });
}
/* istanbul ignore next */
exports.refreshSnap = function (snap, mode, callback) {
    console.log(`Refreshing ${snap}`);
    mode = mode === "-" ? "" : ` --${mode}`;
    exec(`sudo snap refresh  ${snap}${mode}`, function (error, stdout, stderr) {
        console.log("refreshSnap - complete");
        console.log("error: " + error);
        console.log("stdout: " + stdout);
        console.log("stderr:" + stderr);

        if (error) {
            callback(error, stdout);
        }
        else if (stderr) {
            callback(error, stderr);
        }
        else {
            callback(null, stdout);
        }
    });
}

exports.executeScript = function (path, callback) {
    console.log(`Executing ${path}`);
    exec(`sudo bash  ${path}`, function (error, stdout, stderr) {
        console.log("refreshSnap - complete");
        console.log("error: " + error);
        console.log("stdout: " + stdout);
        console.log("stderr:" + stderr);

        if (error) {
            callback(error);
        }
        else if (stderr) {
            callback(stderr);
        }
        else {
            callback(null);
        }
    });
}

var hasShallowProperty = function (obj, prop) {
    return (typeof prop === 'number' && Array.isArray(obj) || hasOwnProperty(obj, prop))
}

var hasOwnProperty = function (obj, prop) {
    if (obj == null) {
        return false
    }
    //to handle objects with null prototypes (too edge case?)
    return Object.prototype.hasOwnProperty.call(obj, prop)
}

var getShallowProperty = function (obj, prop) {
    if (hasShallowProperty(obj, prop)) {
        return obj[prop];
    }
}

var getKey = function (key) {
    var intKey = parseInt(key);
    if (intKey.toString() === key) {
        return intKey;
    }
    return key;
}

var findNpmDirectory = function (npmPackage) {
    let paths = module.paths;
    if (process.env.NODE_PATH) {
        paths = paths.concat(process.env.NODE_PATH.split(','));
    }
    let packagePath;

    for (let index = 0; index < paths.length; index++) {
        let npmPath = path.resolve(paths[index], npmPackage);
        if (fs.existsSync(npmPath)) {
            packagePath = npmPath;
            break;
        }
    }
    return packagePath;
}

Array.prototype.unique = function () {
    var a = this.concat();
    for (var i = 0; i < a.length; ++i) {
        for (var j = i + 1; j < a.length; ++j) {
            if (a[i] === a[j])
                a.splice(j--, 1);
        }
    }
    return a;
};

if (!('toJSON' in Error.prototype))
    Object.defineProperty(Error.prototype, 'toJSON', {
        value: function () {
            var alt = {};

            Object.getOwnPropertyNames(this).forEach(function (key) {
                alt[key] = this[key];
            }, this);

            return JSON.stringify(alt);
        },
        configurable: true,
        writable: true
    });