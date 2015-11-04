var Faye_Channel = require('../../javascript/protocol/channel');
var Faye_Channel_Set = require('../../javascript/protocol/channel-set');

JS.ENV.ChannelSpec = JS.Test.describe("Channel", function() { with(this) {
  describe("expand", function() { with(this) {
    it("returns all patterns that match a channel", function() { with(this) {

      assertEqual( ["/**", "/foo", "/*"],
                   Faye_Channel.expand("/foo") )

      assertEqual( ["/**", "/foo/bar", "/foo/*", "/foo/**"],
                   Faye_Channel.expand("/foo/bar") )

      assertEqual( ["/**", "/foo/bar/qux", "/foo/bar/*", "/foo/**", "/foo/bar/**"],
                   Faye_Channel.expand("/foo/bar/qux") )
    }})
  }})

  describe("Set", function() { with(this) {
    describe("subscribe", function() { with(this) {
      it("subscribes and unsubscribes without callback", function() { with(this) {
        var channels = new Faye_Channel_Set()
        channels.subscribe(["/foo/**"], null)
        assertEqual( ["/foo/**"], channels.getKeys() )
        assert( channels.unsubscribe("/foo/**", null) )
      }})
    }})
  }})
}})