import grpc from '@grpc/grpc-js';
import { ActorRef } from '../../actor/system/ActorRef.mjs';
import { Message } from '../../dto/Message.mjs';
import getUtilInstance from '../../util/Util.mjs';
import log4js from 'log4js';
import { Constants } from '../../constants/Constants.mjs';

const util = getUtilInstance();
const logger = log4js.getLogger('NodeServer');

export default function NodeServer(thisActorSystem, myPort) {
  return {

    createActorAsLeader: async function (call) {
      call.on('data', async request => {
        var locator = request.locator;
        logger.isTraceEnabled() && logger.trace('Asked to create', locator, 'as a Leader.');
        var locatorParts = locator.split('/');
        var actorName = locatorParts[locatorParts.length - 1];
        var behaviorDefinition = request.behaviorDefinition;
        var clusterManager = thisActorSystem.getClusterManager();
        clusterManager.createActor(actorName, locator, behaviorDefinition, (_err, createdActor) => {
          logger.isTraceEnabled() && logger.trace('Actor Created as Leader', createdActor.getName());
          call.write({ actorUrl: createdActor.getActorUrl(), locator: createdActor.getLocator(), behaviorDefinition: createdActor.getBehaviorDefinition(), name: createdActor.getName() });
        });
      });

      call.on('end', () => {
        logger.error('Server Stream ended for createActorAsLeader...');
      });
    },

    createLocalActor: async function (call) {
      call.on('data', async request => {
        var locator = request.locator;
        logger.isTraceEnabled() && logger.trace('Asked to create', locator, 'locally.');
        var locatorParts = locator.split('/');
        var actorName = locatorParts[locatorParts.length - 1];
        var behaviorDefinition = request.behaviorDefinition;
        var state = request.state;
        var createdActor = await thisActorSystem.getClusterManager().createLocalActor(actorName, locator, behaviorDefinition, state);
        // Send the created Actor now. We'll keep syncing the receptionist later.
        logger.isTraceEnabled() && logger.trace('Created: ', createdActor);
        call.write({ actorUrl: createdActor.getActorUrl(), locator: createdActor.getLocator(), behaviorDefinition: createdActor.getBehaviorDefinition(), name: createdActor.getName() });
      });

      call.on('end', () => {
        logger.error('Server Stream ended for createLocalActor...');
      });
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
      var prioritize = request.prioritize;
      var metadata = new grpc.Metadata();
      var errMsg;
      if (thisActorSystem.getStatus() !== Constants.AS_STATUS_READY && thisActorSystem.getStatus() !== Constants.AS_STATUS_REBALANCE) {
        errMsg = 'Actor System is not ready yet. Actor System Status is:'.concat(thisActorSystem.getStatus());
        logger.error(errMsg);
        metadata.set('details', errMsg);
        return callback(new grpc.StatusBuilder().withCode(grpc.status.UNAVAILABLE).withDetails({ err: errMsg }).withMetadata(metadata), null);
      }
      var localActor = thisActorSystem.getLocalReceptionist().lookup(locator)
      if (!localActor) {
        errMsg = 'Actor Not Found. Actor with locator: '.concat(locator).concat(' was not found here...');
        logger.error(errMsg);
        metadata.set('details', errMsg);
        return callback(new grpc.StatusBuilder().withCode(grpc.status.NOT_FOUND).withDetails({ err: errMsg }).withMetadata(metadata), null);
      }

      if (actionType === Constants.ACTION_TYPES.TELL) {
        // Tell and forget
        localActor.getQueue().enqueue(new Message(messageType, message));
        return callback(null, { result: 'enqueued.' });
      } else if (actionType === Constants.ACTION_TYPES.ASK) {
        // Ask and wait
        localActor.getQueue().enqueue(new Message(messageType, message, (err, result) => callback(null, { err: JSON.stringify(err), result: JSON.stringify(result) }), prioritize));
      } else {
        errMsg = 'Invalid actionType: '.concat(actionType);
        logger.error(errMsg);
        metadata.set('details', errMsg);
        return callback(grpc.StatusBuilder().withCode(grpc.status.UNKNOWN).withDetails({ err: errMsg }).withMetadata(metadata), null);
      }
    },

    syncRegistrations: function (call) {
      call.on('data', request => {
        thisActorSystem.getReceptionist().registerRemoteActor(new ActorRef(thisActorSystem, request.name, request.locator, request.actorUrl, request.behaviorDefinition));
      });

      call.on('end', () => {
        logger.error('Stream ended for syncRegistrations...');
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
      var newHostAdded = thisActorSystem.getClusterManager().getLeaderManager().addOrUpdateNode(request.host, request.port, request.priority, request.pid);
      await thisActorSystem.getClusterManager().getLeaderManager().checkAndUpdateLeaderStatus();
      var leader = thisActorSystem.getClusterManager().getLeaderManager().getCurrentLeader();
      callback(null, { host: leader.getHost(), port: leader.getPort(), priority: leader.getPriority() });
      newHostAdded && logger.debug('New Host Joined the cluster. Starting Election...');
      newHostAdded && thisActorSystem.getClusterManager().getLeaderManager().electLeader();
      newHostAdded && thisActorSystem.getClusterManager().iAmLeader() && setTimeout(thisActorSystem.waitForLeaderElectionToComplete.bind(thisActorSystem), thisActorSystem.getStartupTime() * 1000, async () => {
        thisActorSystem.getClusterManager().rebalanceActors();
        logger.debug('Waited for configured Startup Time and election should now be complete. Rebalancing...');
      });
    },

    syncCache: function (call) {
      call.on('data', request => {
        var key = request.key;
        var value = request.value;
        if (value) {
          thisActorSystem.getCache().set(key, JSON.parse(value));
        } else {
          thisActorSystem.getCache().clear(key);
        }
        call.write({ key: key });
      });

      call.on('end', () => {
        logger.error('Stream ended for syncCache...');
      });
    },

    init: function (local) {
      var server = new grpc.Server({
        "grpc.max_concurrent_streams": 4294967295,
        "grpc-node.max_session_memory": 107374182499,
        "grpc.max_send_message_length": 1024 * 1024 * 100, // 100 MB
        "grpc.max_receive_message_length": 1024 * 1024 * 100, // 100 MB
        "grpc.default_compression_algorithm": 2,
        "grpc.enable_channelz": 1000
      }); // { "grpc-node.max_session_memory": 107374182400, "grpc.max_concurrent_streams": 1000000000, "grpc.enable_channelz": 1000000000 });
      var nodeService = util.getNodeService();

      server.addService(nodeService.NodeService.service, {
        createActorAsLeader: this.createActorAsLeader,
        createLocalActor: this.createLocalActor,
        getActor: this.getActor,
        enqueue: this.enqueue,
        syncRegistrations: this.syncRegistrations,
        ping: this.ping,
        election: this.election,
        syncCache: this.syncCache
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
