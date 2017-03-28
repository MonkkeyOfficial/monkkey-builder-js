var fs = require('fs-extra'),
    path = require('path'),
    builder = require('./builder.js'),
    globalConfig = require('./globalConfig.js'),
    tester = require('./configTester.js'),
    zip = require('./zip.js'),
    pusher = require('./pusher.js'),
    crypto = require('crypto');

exports.execute = function()
{
    exports.commandLine(process.argv);
}

/**
 * @param {String} url
 * @param {String} filePath
 * @param {(Object|Function)} options
 * @param {Function} options.start
 * @param {Function} options.success
 * @param {Function} options.error
 */
exports.publish = function(url, filePath, options = null)
{
    if(!options)
        options = {};
    if(options.constructor === Function)
    {
        var callback = options;
        options = {
            start: (o) => callback(o, null),
            error: (o, e) => callback(o, e),
            success: (o) => callback(o, null)
        }
    }

    filePath = path.resolve(filePath);
    fs.exists(filePath, exists => {
        if(!exists)
        {
            if(options.error)
                options.error(null, 'The file \'' + filePath + '\' doesn\'t exist.');
            return;
        }

        pusher.push({
            config: {
                url: url
            },
            dest: filePath
        }, options)
    })
}

/**
 * @param {(String|String[])} folders
 * @param {(Object|Function)} options
 * @param {Function} options.error
 * @param {Function} options.success
 * @param {Function} options.start
 */
exports.compile = function(folders = null, options = null)
{
    if(folders && folders.constructor === Object)
    {
        options = folders;
        folders = null;
    }
    if(!folders)
        folders = [ process.cwd() ];
    if(!options)
        options = {};
    if(options.constructor === Function)
    {
        var callback = options;
        options = {
            start: (o) => callback(o, null),
            error: (o, e) => callback(o, e),
            success: (o) => callback(o, null)
        }
    }

    folders.forEach(function(folder) {
        fs.readJson(path.join(folder, globalConfig.configFileName), (e, config) => {
            while(config.url && config.url.length > 0 && config.url.indexOf('/') === config.url.length - 1)
            {
                config.url = config.url.substring(0, config.url.length - 1);
                console.log(config.url);
            }
            if(!e && (!config.url || config.url.length === 0))
                e = 'The property \'url\' is not found or empty in the configuration file.';
            if(e)
            {
                if(options.error)
                    options.error(e, {
                        folder: folder
                    });
                return;
            }

            var hashedUrl = crypto.createHash('md5').update(config.url).digest('hex');

            var dest = path.join(globalConfig.tmpFolder, 'f_' + hashedUrl);
            var destZip = path.join(globalConfig.tmpFolder, '_' + hashedUrl);

            var callbackArguments = {
                folder: folder,
                configuration: config,
                temporaryFolder: dest,
                destination: destZip
            };

            if(options.compressionStarted)
                options.start(callbackArguments);
            builder.createTempFolder(config, folder, dest, () => {
                zip.zip(dest, destZip, (src, dest) => {
                    if(options.success)
                        options.success(callbackArguments);
                }, (e, src, dest) => {
                    if(options.error)
                        options.error(e, callbackArguments);
                });
            })
        })
    })
}

/**
 * @param {(Object|Function)} options
 * @param {Function} options.compressionErrors
 * @param {(Object|Function)} options.push
 * @param {Function} options.push.start
 * @param {Function} options.push.success
 * @param {Function} options.push.error
 */
exports.update = function(options = null)
{
    if(!options)
        options = {};
    if(!options.push)
        options.push = {};
    if(options.constructor === Function)
    {
        var callback = options;
        options = {
            compressionErrors: (es) => callback(null, es),
            push: {
                start: (o) => callback(o, null),
                error: (o, e) => callback(o, e),
                success: (o) => callback(o, null)
            }
        }
    }
    if(options.push.constructor === Function)
    {
        var callback = options.push;
        options.push = {
            start: (o) => callback(o, null),
            error: (o, e) => callback(o, e),
            success: (o) => callback(o, null)
        }
    }
    
    builder.execute(globalConfig.tmpFolder, ss => {
        ss.forEach(function(o) {
            pusher.push(o, options.push)
        });
    }, (ss, es) => {
        if(options.errors)
            options.compressionErrors(es);
    }, e => {
        if(options.errors)
            options.compressionErrors([e]);
    });
}

exports.commandLine = function(argv)
{
    var cmd = argv[2];
    switch(cmd)
    {
        case 'check':
            return;

        case 'update':
            console.log(' [ ] Compressing...');
            exports.update({
                compressionErrors: (es) => {
                    console.error(' [!] ' + es.length + ' error(s) :');
                    es.forEach(function(o) {
                        console.error('     @' + o.source + ' : ' + o.error);
                    });
                },
                push: {
                    start: o => console.log(' [ ] ' + o.config.url + ' - updating...'),
                    success: o => console.log(' [o] ' + o.config.url + ' - updated.'),
                    error: (o, e) => console.error(' [!] ' + o.config.url + ' - error : ' + e),
                }
            });
            return;

        case 'publish':
            if(argv.length < 5)
            {
                console.error(' [!] Not enough arguments for this command.');
                console.error('     Check the usage with \'' + globalConfig.exeName + ' help\'.');
                return;
            }
            exports.publish(argv[3], argv[4], {
                start: o => console.log(' [ ] ' + o.config.url + ' - updating...'),
                success: o => console.log(' [o] ' + o.config.url + ' - updated.'),
                error: (o, e) => console.error(' [!] ' + o.config.url + ' - error : ' + e),
            });
            return;

        case 'compile':
            var options = {
                start: (info) => console.log(' [ ] ' + info.folder + ' : Compressing...'),
                success: (info) => {
                    console.log(' [o] ' + info.folder + ' : Files compressed at :');
                    console.log('     ' + info.destination);
                },
                error: (e, info) => console.error(' [!] ' + info.folder + ' : An error occured : ' + e)
            };

            if(argv.length < 4)
                exports.compile(options);
            else
                exports.compile(argv.slice(3), options);
            return;

        case 'run':
            return;
        
        case '-h':
        case '--help':
        case 'help':
        default:
            console.log('Usage: ' + globalConfig.exeName + ' <command> [<options>]');
            console.log();
            console.log('Commands :');
            console.log('  help / --help / -h   | Display this help');
            console.log('  update               | Compile and push the result to the server');
            console.log('  check                | Check if the files are valid');
            console.log('  run <name>           | Run a macro stored in the local configuration file');
            console.log('  publish <url> <file> | Publish the specified tar+gzip file to the url');
            console.log('  compile [<folders>]  | Compile the the current directory or the specified folders into tar+gzip files');
            return;
    }
}