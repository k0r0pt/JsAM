import grpc from '@grpc/grpc-js';
import { ActorRef } from '../../actor/system/ActorRef.mjs';
import { Message } from '../../dto/Message.mjs';
import getUtilInstance from '../../util/Util.mjs';
import log4js from 'log4js';
import nodeUtil from 'util';
import { Constants } from '../../constants/Constants.mjs';

const util = getUtilInstance();
const logger = log4js.getLogger('NodeServer');

export default function NodeServer(thisActorSystem, myPort) {
  return {

    createActorAsLeader: async function (call, callback) {
      var request = call.request;
      var locator = request.locator;
      logger.isTraceEnabled() && logger.trace('Asked to create', locator, 'as a Leader.');
      var locatorParts = locator.split('/');
      var actorName = locatorParts[locatorParts.length - 1];
      var behaviorDefinition = request.behaviorDefinition;
      var clusterManager = thisActorSystem.getClusterManager();
      var createdActor = await nodeUtil.promisify(clusterManager.createActor).bind(clusterManager)(actorName, locator, behaviorDefinition);
      logger.isTraceEnabled() && logger.trace('Actor Created', createdActor.getName());
      callback(null, { actorUrl: createdActor.getActorUrl() });
    },

    createLocalActor: async function (call, callback) {
      var request = call.request;
      var locator = request.locator;
      logger.isTraceEnabled() && logger.trace('Asked to create', locator, 'locally.');
      var locatorParts = locator.split('/');
      var actorName = locatorParts[locatorParts.length - 1];
      var behaviorDefinition = request.behaviorDefinition;
      var createdActor = await thisActorSystem.getClusterManager().createLocalActor(actorName, locator, behaviorDefinition);
      // Send the created Actor now. We'll keep syncing the receptionist later.
      callback(null, { actorUrl: createdActor.getActorUrl() });
    },

    getActor: function (call, callback) {
      var request = call.request;
      var locator = request.locator;
      logger.isTraceEnabled() && logger.trace('Asked to fetch', locator, 'from my receptionist.');
      var actor = thisActorSystem.getReceptionist().lookup(locator);
      var actorRef = null;
      if (actor) {
        actorRef = { name: actor.getName(), locator: actor.getLocator(), actorUrl: actor.getActorUrl(), behaviorDefinition: actor.getBehaviorDefinition() }
      }
      callback(null, actorRef);
    },

    enqueue: function (call, callback) {
      var request = call.request;
      var locator = request.locator;
      var messageType = request.messageType;
      var message = JSON.parse(request.message);
      var actionType = request.actionType;
      var localActor = thisActorSystem.getLocalReceptionist().lookup(locator)
      if (!localActor) {
        return callback(new grpc.StatusBuilder().withCode(grpc.status.NOT_FOUND).withDetails({ err: 'Actor not found.' }), null);
      }

      if (actionType === Constants.ACTION_TYPES.TELL) {
        // Tell and forget
        localActor.getQueue().enqueue(new Message(messageType, message));
        return callback(null, { result: 'enqueued.' });
      } else if (actionType === Constants.ACTION_TYPES.ASK) {
        // Ask and wait
        localActor.getQueue().enqueue(new Message(messageType, message, (err, result) => {
          return callback(null, { err: err, result: result });
        }));
      } else {
        return callback(grpc.StatusBuilder().withCode(grpc.status.UNKNOWN).withDetails('Invalid actionType: ' + actionType), null);
      }
    },

    syncRegistrations: function (call, callback) {
      call.on('data', request => {
        thisActorSystem.getReceptionist().registerRemoteActor(new ActorRef(thisActorSystem, request.name, request.locator, request.actorUrl, request.behaviorDefinition));
      });
      call.on('end', () => {
        callback(null, null);
      });
    },

    ping: function (call, callback) {
      callback(null, { msg: call.request.msg });
    },

    election: async function (call, callback) {
      // At the beginning, I gotta ask for election.
      // I'll tell the other nodes my priority. They'll tell which node that they know of has the least priority.
      // Whichever node has the least priority is the leader.
      // I ping the leader. If it's up, it's the leader.
      var request = call.request;
      thisActorSystem.getClusterManager().getLeaderManager().addOrUpdateNode(request.host, request.port, request.priority, request.pid);
      await thisActorSystem.getClusterManager().getLeaderManager().checkAndUpdateLeaderStatus();
      var leader = thisActorSystem.getClusterManager().getLeaderManager().getCurrentLeader()
      callback(null, { host: leader.getHost(), port: leader.getPort(), priority: leader.getPriority() });
    },

    init: function (local) {
      var server = new grpc.Server({ "grpc.max_concurrent_streams": 4294967295, "grpc-node.max_session_memory": 107374182499 }); // { "grpc-node.max_session_memory": 107374182400, "grpc.max_concurrent_streams": 1000000000, "grpc.enable_channelz": 1000000000 });
      var nodeService = util.getNodeService();

      server.addService(nodeService.NodeService.service, {
        createActorAsLeader: this.createActorAsLeader,
        createLocalActor: this.createLocalActor,
        getActor: this.getActor,
        enqueue: this.enqueue,
        syncRegistrations: this.syncRegistrations,
        ping: this.ping,
        election: this.election
      });

      if (!local) {
        server.bindAsync('0.0.0.0'.concat(':').concat(myPort), grpc.ServerCredentials.createInsecure(), (err, result) => this.serverBindCallback(err, result, server));
      } else {
        server.bindAsync('unix:///tmp/jSAM.'.concat(myPort).concat('.sock'), grpc.ServerCredentials.createInsecure(), (err, result) => this.serverBindCallback(err, result, server));
      }
    },

    serverBindCallback: (err, _result, server) => !err ? server.start() : logger.error(err)
  }
}
