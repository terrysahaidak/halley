'use strict';

var WebSocket = require('../../../lib/transport/browser/browser-websocket');
var uri = require('../../../lib/util/uri');

describe('browser websocket transport', function() {

  describe('direct', function() {

    beforeEach(function() {
      this.dispatcher = {
        timeout: 1000,
        transportDown: function() {
        },
        handleResponse: function() {
        },
        handleError: function() {
        }
      };

      this.websocket = new WebSocket(this.dispatcher, uri.parse(this.urlDirect));
    });

    afterEach(function() {
      this.websocket.close();
    });

    require('./specs/websocket-spec')();
  });

  describe('proxied', function() {

    beforeEach(function() {
      this.dispatcher = {
        timeout: 1000,
        transportDown: function() {
        },
        handleResponse: function() {
        },
        handleError: function() {
        }
      };

      this.websocket = new WebSocket(this.dispatcher, uri.parse(this.urlProxied));
    });

    afterEach(function() {
      this.websocket.close();
    });

    require('./specs/websocket-server-restart-spec')();
    require('./specs/websocket-bad-connection-spec')();
  });

});
