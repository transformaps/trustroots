'use strict';

var mongoose = require('mongoose'),
    should = require('should'),
    path = require('path'),
    _ = require('lodash'),
    config = require(path.resolve('./config/config')),
    User = mongoose.model('User'),
    EventEmitter = require('events'),
    Message = mongoose.model('Message'),
    influxService =
  require(path.resolve('./modules/core/server/services/influx.server.service')),
    originalGetClient = influxService.getClient;

// this emitter will emit event 'reachedInfluxdb' with variables measurement,
// fields, tags when the influxdb mock is reached
var reachEventEmitter = new EventEmitter();

// it will emit an event 'reachedInfluxdb' which should be caught in the tests

// mocking the influxdb.writeMeasurement()
var influxdb = {
  writeMeasurement: function (measurement, fields, tags) {
    reachEventEmitter.emit('reachedInfluxdb', measurement, fields, tags);
  }
};

// now replacing the getClient function, to return mocked influxdb
influxService.getClient = function (callback) {
  callback(null, influxdb);
};

// now we require the controller, and the influxService.getClient is already
// mocked
var messageController =
  require(path.resolve('./modules/messages/server/controllers/messages.server.controller'));


describe('Message to influx server service Functional Test', function () {
  // putting the influxService back to original at the end of tests
  after(function () {
    influxService.getClient = originalGetClient;
  });

  var user1,
      user2;

  // here we create the users before each test
  beforeEach(function(done) {

    user1 = new User({
      firstName: 'Full',
      lastName: 'Name',
      displayName: 'Full Name',
      email: 'user1@test.com',
      username: 'username1',
      password: 'password123',
      provider: 'local',
      public: true,
      description: _.repeat('.', config.profileMinimumLength)
    });

    user2 = new User({
      firstName: 'Full',
      lastName: 'Name',
      displayName: 'Full Name',
      email: 'user2@test.com',
      username: 'username2',
      password: 'password123',
      provider: 'local',
      public: true
    });

    // save those users to mongoDB
    user1.save(function(err) {
      if (err) return done(err);
      user2.save(function(err) {
        if (err) return done(err);
        done();
      });
    });
  });

  // after each test removing all the messages and users (cleaning the database)
  afterEach(function(done) {
    Message.remove().exec(function() {
      User.remove().exec(done);
    });
  });

  // send the new message, do it synchronously
  // otherwise the event may be too early and miss the tests
  // there should be no asynchronous beforeEach after this
  // the tests themselves will wait for the event of reaching influxdb
  beforeEach(function () {

    // we're stubbing the express.response here
    // (not sure if i use the mocking/stubbing terminology right)
    function Res() {}
    Res.prototype.status = function (statusCode) {
      statusCode; // here we just satisfy eslint; may be used for something
      // this.statusCode = statusCode; // use for debug
      return this;
    };
    // we could do something on response, but we don't care
    Res.prototype.send = function (response) {
      // console.log(this.statusCode, response); // use for debug
      response; // satisfy ESLint
    };
    Res.prototype.json = Res.prototype.send;

    var req = {
      user: {
        _id: user1._id
      },
      body: {
        userTo: String(user2._id),
        content: _.repeat('.', config.limits.longMessageMinimumLength - 1)
      }
    };
    var res = new Res();

    // sending the message via controller
    messageController.send(req, res);
  });

  context('when a new message is saved', function () {
    context('when influxdb is enabled', function () {

      // setting the influxdb config
      var originalInfluxConfig = config.influxdb;
      beforeEach(function () {
        config.influxdb = {
          enabled: true,
          options: {
            host: 'localhost',
            port: 4242,
            protocol: 'http',
            database: 'will-never-be-reached'
          }
        };
      });

      // unsetting the influxdb config
      afterEach(function () {
        config.influxdb = originalInfluxConfig;
      });

      it('the data should reach the database', function (done) {
        // we want to call the listener only once
        reachEventEmitter.once('reachedInfluxdb', function () {
          return done();
        });

        // otherwise the test will fail with timeout
      });

      it('the data should have a proper format', function (done) {
        // we want to call the listener only once
        reachEventEmitter.once('reachedInfluxdb', function (measurement, points) {
          try {
            (measurement).should.equal('messageSent');
            points.length.should.equal(1);
            should.exist(points[0].fields);
            should.exist(points[0].tags);
            points[0].fields.should.have.property('messageLength');
            points[0].tags.should.have.property('messageLengthType');
            points[0].tags.should.have.property('position', 'first');
            return done();
          } catch (e) {
            return done(e);
          }
        });
      });
    });

    context('when influxdb is disabled', function () {
      // we don't see any way to test this
      // it('saving data to statistics should be silently ignored');
    });
  });
});
