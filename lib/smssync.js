'use strict';


/**
 * @name  smssync
 * @description open311 implemenation of smssync handlers
 * @see {@link https://github.com/lykmapipo/smssync#usage}
 * @see {@link http://smssync.ushahidi.com/developers/}
 * @author lally elias <lallyelias87@gmail.com>
 * @since  0.1.0
 * @version 0.1.0
 * @private
 */


//dependencies
const _ = require('lodash');
const async = require('async');

const TRANSPORT_NAME = 'open311-smssync';
const QUEUE_NAME = 'smssync';

//TODO attach queue for worker to process it

/**
 * @name onReceived
 * @description handle received sms from smssync device
 * @param  {Object}   sms  valid smssync message
 * @param  {Function} done a callback to invoke after receiving sms
 * @return {Object}   a message to return to a sender
 * @see  {@link http://smssync.ushahidi.com/developers/}
 * @private
 * @since  0.1.0
 * @version 0.1.0     
 */
exports.onReceive = function (sms, done) {
  //see http://smssync.ushahidi.com/developers/
  //for the structure of the sms send by smssync to be saved

  //reference open311-messages
  const Message = exports.Message;

  //prepare sms for saving
  //TODO where to save additional smssync sms details
  const message = {
    type: Message.TYPE_SMS,
    direction: Message.DIRECTION_INBOUND,
    from: _.get(sms, 'from'),
    to: _.get(sms, 'sent_to'),
    subject: _.get(sms, 'message'),
    body: _.get(sms, 'message'),
    hash: _.get(sms, 'hash'),
    transport: TRANSPORT_NAME,
    queueName: QUEUE_NAME,
    priority: Message.PRIORITY_LOW,
    state: Message.STATE_RECEIVED,
  };

  //create message
  //use upsert
  async.waterfall([

    function findExistingMessage(next) {
      Message.findOne({ hash: message.hash }, next);
    },

    function save(foundMessage, next) {
      //create message if not exists
      if (!foundMessage) {
        Message.create(message, next);
      }

      //return existing message
      else {
        next(null, foundMessage);
      }
    }

    //TODO fire message received
    //exports._queue.create('sms:received',message.toObject());

  ], done);

};


/**
 * @name onSend
 * @description obtain list of sms(message) to be send by smssync device
 * @param  {Function} done a callback to invoke after receiving sms
 * @return {[Object]} collection of message to be send by smssync device
 * @see  {@link http://smssync.ushahidi.com/developers/}
 * @private
 * @since  0.1.0
 * @version 0.1.0     
 */
exports.onSend = function (done) {

  //reference open311-messages
  const Message = exports.Message;

  async.waterfall([

    function findUnsent(next) {
      //TODO update status=sent use update
      Message.unsent({
        type: Message.TYPE_SMS,
        transport: TRANSPORT_NAME,
        state: Message.STATE_UNKNOWN
      }, next);
    },

    function normalize(messages, next) {
      const smss = [];
      _.forEach(messages, function (message) {
        _.forEach([].concat(message.to), function (to) {
          smss.push({
            to: to,
            message: message.body,
            uuid: [message._id, to].join(':')
          });
        });
      });

      next(null, smss);

    }

  ], done);

};


/**
 * @name onSent
 * @description received queued sms from smssync device
 * @param {[String]} queued collection of message(sms) uuids from smssync 
 *                          device
 * @param  {Function} done a callback to invoke after receiving sms
 * @return {[Object]} collection of message to be send by smssync device
 * @see  {@link http://smssync.ushahidi.com/developers/}
 * @private
 * @since  0.1.0
 * @version 0.1.0     
 */
exports.onSent = function (queued, done) {

  //reference open311-messages
  const Message = exports.Message;

  //obtained queued sms ids
  let ids = _.map(queued, function (sms) {
    return _.first(sms.split(':')); //obtain sms id
  });
  ids = _.uniq(ids);

  //update message status to sent
  async.waterfall([

    function findMessages(next) {
      Message.find({
        type: Message.TYPE_SMS,
        transport: TRANSPORT_NAME,
        _id: { $in: ids } //TODO use status=sent
      }, next);
    },

    function updateMessageStateToQueued(messages, next) {
      const updates = _.map(messages, function (message) {
        //update message state to queued
        return function (then) {
          message.state = Message.STATE_QUEUED;
          message.save(function (error, saved) {
            then(error, saved);
          });
        };
      });

      //update in parallel fashion
      async.parallel(updates, next);
    },

    function returnUuidsOfProcessedMessage(messages, next) {
      const uuids = [];
      _.forEach(messages, function (message) {
        _.forEach([].concat(message.to), function (to) {
          uuids.push([message._id, to].join(':'));
        });
      });
      next(null, uuids);
    }

  ], done);

};


/**
 * @name onQueued
 * @description obtain message(sms) waiting delivery report and send them to 
 *              smssync device
 * @param  {Function} done a callback to invoke on success or failure
 * @return {[Object]} collection of message uuids waiting delivery status 
 *                               from smssync device
 * @see  {@link http://smssync.ushahidi.com/developers/}
 * @private
 * @since  0.1.0
 * @version 0.1.0     
 */
exports.onQueued = function (done) {
  //reference open311-messages
  const Message = exports.Message;

  async.waterfall([

    function findMessagesWaitingDeliveryReport(next) {
      Message.find({
        type: Message.TYPE_SMS,
        transport: TRANSPORT_NAME,
        state: Message.STATE_QUEUED
      }, next);
    },

    function returnUuidsOfQueuedMessages(messages, next) {

      const uuids = [];
      _.forEach(messages, function (message) {
        _.forEach([].concat(message.to), function (to) {
          uuids.push([message._id, to].join(':'));
        });
      });
      next(null, uuids);

    }

  ], done);

};


/**
 * @name onQueued
 * @description receive delivery status from smssync device
 * @param  {Function} done a callback to invoke on success or failure
 * @return {[Object]} collection of message
 * @see  {@link http://smssync.ushahidi.com/developers/}
 * @private
 * @since  0.1.0
 * @version 0.1.0     
 */
exports.onDelivered = function (delivered, done) {
  //reference open311-messages
  const Message = exports.Message;

  //obtained delivered sms ids
  let ids = _.map(delivered, function (report) {
    let uuid = report.uuid || '';
    return _.first(uuid.split(':')); //obtain sms id
  });
  ids = _.uniq(_.compact(ids));

  //update message status to delivered
  async.waterfall([

    function findMessages(next) {
      Message.find({
        type: Message.TYPE_SMS,
        transport: TRANSPORT_NAME,
        _id: { $in: ids } //TODO use status=queued
      }, next);
    },

    function updateMessageStateToDelivered(messages, next) {
      const updates = _.map(messages, function (message) {
        //update message state to delivered
        return function (then) {
          message.state = Message.STATE_DELIVERED;
          message.save(function (error, saved) {
            then(error, saved);
          });
        };
      });

      //update in parallel fashion
      async.parallel(updates, next);
    }

  ], done);

};