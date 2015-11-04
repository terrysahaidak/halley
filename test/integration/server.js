/* jshint node:true */
'use strict';

var http = require('http');
var faye = require('gitter-faye');
var express = require('express');
var webpack = require('webpack');
var webpackMiddleware = require("webpack-dev-middleware");
var PUBLIC_DIR = __dirname + '/public';
var debug = require('debug')('halley:test:server');
var BrowserStackTunnel = require('browserstacktunnel-wrapper');

var proxyChild, server, fayeServer;
var crushWebsocketConnections;

function createProxyChild(callback) {
  if (!callback) callback = function() {};

  terminateProxyChild(function() {
    proxyChild = require('child_process').fork(__dirname + '/proxy-app.js', {
      stdio: [0, 1, 2]
    });

    proxyChild.on('exit', function(exitCode) {
      debug('Proxy terminated with exitCode ' + exitCode);
    });

    proxyChild.once('message', function() {
      debug('RECV', arguments);
      callback();
    });
  });
}

function terminateProxyChild(callback) {
  if (!callback) callback = function() {};

  if (proxyChild) {
    proxyChild.once('exit', function() {
      callback();
    });

    proxyChild.kill('SIGTERM');
    proxyChild = null;
  } else {
    callback();
  }
}

function listen(options, callback) {
  var app = express();
  var fayeApp = express();
  server = http.createServer(app);
  fayeServer = http.createServer(fayeApp);

  var bayeux = new faye.NodeAdapter({
    mount: '/bayeux',
    timeout: 3,
    ping: 2,
    engine: {
      interval: 1
    }
  });
  bayeux.attach(fayeServer);

  if (options.webpack) {
    app.use(webpackMiddleware(webpack({
      context: __dirname + "/public",
      entry: "mocha!./test-suite-browser",
      output: {
        path: __dirname + "/",
        filename: "test-suite-browser.js"
      },
      resolve: {
        alias: {
          sinon: 'sinon-browser-only'
        }
      },
      module: {
        noParse: [
          /sinon-browser-only/
        ]
      },
      devtool: "#eval"
    }), {
      noInfo: false,
      quiet: false,

      watchOptions: {
          aggregateTimeout: 300,
          poll: true
      },

      publicPath: "/",
      stats: { colors: true }
    }));

    app.use(express.static(PUBLIC_DIR));
  }

  app.all('/*', function(req, res, next) {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });

  app.post('/delete/:clientId', function(req, res) {
    var clientId = req.params.clientId;
    debug('Deleting client', clientId);
    bayeux._server._engine.destroyClient(clientId, function() {
      res.status(200).send('OK');
    });
  });

  var networkRestoreTimer;

  app.post('/network-outage', function(req, res) {
    var timeout = parseInt(req.query.timeout, 10) || 15000;

    debug('disable traffic');
    proxyChild.send({ disable: true });

    clearTimeout(networkRestoreTimer);
    networkRestoreTimer = setTimeout(function() {
      debug('enabling traffic after ' + timeout);
      proxyChild.send({ enable: true });
    }, timeout);

    res.status(200).send('OK');
  });

  app.post('/restore-all', function(req, res) {
    // Renable network
    clearTimeout(networkRestoreTimer);
    proxyChild.send({ enable: true });

    // Reenable websockets
    clearTimeout(networkRestoreTimer);
    crushWebsocketConnections = false;

    res.status(200).send('OK');
  });

  app.post('/restore-network-outage', function(req, res) {
    clearTimeout(networkRestoreTimer);
    proxyChild.send({ enable: true });
    res.status(200).send('OK');
  });


  app.post('/restart', function(req, res) {
    terminateProxyChild(function() {
      createProxyChild(function() {
        res.status(200).send('OK');
      });
    });
  });

  var wsRestoreTimer;
  app.post('/stop-websockets', function(req, res) {
    var timeout = parseInt(req.query.timeout, 10) || 15000;

    debug('disable traffic');
    crushWebsocketConnections = true;

    clearTimeout(wsRestoreTimer);
    wsRestoreTimer = setTimeout(function() {
      debug('enabling traffic after ' + timeout);
      crushWebsocketConnections = false;
    }, timeout);

    res.status(200).send('OK');
  });

  app.post('/restore-websockets', function(req, res) {
    clearTimeout(networkRestoreTimer);
    crushWebsocketConnections = false;
    res.status(200).send('OK');
  });

  app.get('*', function(req, res) {
    res.status(404).send('Not found');
  });

  fayeApp.get('*', function(req, res) {
    res.status(404).send('Not found');
  });

  setInterval(function() {
    bayeux.getClient().publish('/datetime', { date: Date.now() });
  }, 100);

  fayeServer.on('upgrade', function(req) {
    if (crushWebsocketConnections) {
      // Really mess things up
      req.socket.write('<OHNOES>');
      req.socket.destroy();
    }
  });

  bayeux.addExtension({
    incoming: function(message, req, callback) {
      if (crushWebsocketConnections) {
        if (req && req.headers.connection === 'Upgrade') {
          debug('KILLING WEBSOCKET');
          req.socket.destroy();
          return;
        }
      }
      if (message.channel === '/meta/subscribe' && message.subscription === '/banned') {
        message.error = 'Invalid subscription';
      }

      if (message.channel === '/devnull') {
        return;
      }

      if (message.channel === '/meta/handshake') {
        if (message.ext && message.ext.failHandshake) {
          message.error = 'Unable to handshake';
        }
      }

      callback(message);
    },

    outgoing: function(message, req, callback) {
      var advice;
      if (message.channel === '/advice-retry') {
        advice = message.advice = message.advice || {};
        advice.reconnect = 'retry';
        advice.timeout = 2000;
      }

      if (message.channel === '/advice-handshake') {
        advice = message.advice = message.advice || {};
        advice.reconnect = 'handshake';
        advice.interval = 150;
        // advice.timeout = 150;
      }

      if (message.channel === '/advice-none') {
        advice = message.advice = message.advice || {};
        advice.reconnect = 'none';
      }

      return callback(message);
    }
  });

  // bayeux.on('handshake', function(clientId) {
  //   debug('[  handshake] ' + clientId);
  // });
  //
  // bayeux.on('subscribe', function(clientId, channel) {
  //   debug('[  SUBSCRIBE] ' + clientId + ' -> ' + channel);
  // });
  //
  // bayeux.on('unsubscribe', function(clientId, channel) {
  //   debug('[UNSUBSCRIBE] ' + clientId + ' -> ' + channel);
  // });
  //
  // bayeux.on('disconnect', function(clientId) {
  //   debug('[ DISCONNECT] ' + clientId);
  // });

  var port = process.env.PORT || '8000';

  fayeServer.listen(8001, function() {
    server.listen(port, function() {
      createProxyChild(function() {
        startBrowserStackTunnel(callback);
      });
    });

  });

}

var browserStackTunnel = null;

function startBrowserStackTunnel(callback) {
  if (!process.env.BROWSERSTACK_USERNAME || browserStackTunnel) return callback();

  browserStackTunnel = new BrowserStackTunnel({
    key: process.env.BROWSERSTACK_KEY,
    hosts: [{
      name: 'localhost',
      port: 8000,
      sslFlag: 0
    }, {
      name: 'localhost',
      port: 8001,
      sslFlag: 0
    }, {
      name: 'localhost',
      port: 8002,
      sslFlag: 0
    }], // optionally set hosts
    // osxBin: 'your_bin_dir', // optionally override the default bin directory for the OSX binary
    // linux32Bin: 'your_bin_dir', // optionally override the default bin directory for the Linux 32 bit binary
    // linux64Bin: 'your_bin_dir', // optionally override the default bin directory for the Linux 64 bit binary
    // win32Bin: 'your_bin_dir', // optionally override the default bin directory for the win32 binary
    // localIdentifier: 'my_tunnel', // optionally set the -localIdentifier option
    v: true, // optionally set the -v (verbose) option
    // proxyUser: PROXY_USER, // optionally set the -proxyUser option
    // proxyPass: PROXY_PASS, // optionally set the -proxyPass option
    // proxyPort: PROXY_PORT, // optionally set the -proxyPort option
    // proxyHost: PROXY_HOST, // optionally set the -proxyHost option
    // force: false, // optionally set the -force option
    // forcelocal: false, // optionally set the -forcelocal option
    // onlyAutomate: false, // optionally set the -onlyAutomate option
  });

  browserStackTunnel.start(function(err) {
    if (err) return callback(err);
    console.log('Browserstack tunnel started');
    callback();
  });
}

function stopBrowserStackTunnel() {
  if (!browserStackTunnel) return;

  browserStackTunnel.stop(function(err) {
    if (err) console.error(err);
  });

  browserStackTunnel = null;
}
function unlisten(callback) {
  stopBrowserStackTunnel();
  fayeServer.close();
  server.close();
  terminateProxyChild(callback);
}

exports.listen = listen;
exports.unlisten = unlisten;

if (require.main === module) {
  process.on('uncaughtException', function(e) {
    console.error(e.stack || e);
    process.exit(1);
  });

  listen({ webpack: true }, function() {
    debug('Listening');
  });
}