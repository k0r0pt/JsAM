import { Actor } from '../actor/system/Actor.mjs';
import { Host } from '../dto/Host.mjs';
import { LeaderManager } from './LeaderManager.mjs';
import ip from 'ip';
import log4js from 'log4js';
import async from 'async';
import { ActorRef } from '../actor/system/ActorRef.mjs';
import { ActorCreationException } from '../exception/ActorCreationException.mjs';
import nodeUtil from 'util';
import getUtilInstance from '../util/Util.mjs';
import { DummyActorRef } from '../actor/system/DummyActorRef.mjs';
import { Constants } from '../constants/Constants.mjs';

const logger = log4js.getLogger('ClusterManager');
const util = getUtilInstance();

export class ClusterManager {

  /**
   * Holds this Node's Host details
   */
  #me;
  #hosts;
  #actorSystem;
  #leaderManager;
  #pingInterval;
  #roundRobinHostCounter = 0;
  #inProgressSpawns = {};
  #nodeWiseInProgressSpawns = {};

  /**
   * Constructor. This will see if cluster is present. If it is, it will use the hosts in the cluster config.
   * If not, it will create a single host "cluster" using the host passed.
   *
   * @param {Cluster} cluster The {@link Cluster}
   * @param {number} myPort The port the current Node is running on
   * @param {ActorSystem} actorSystem Current Node's {@link ActorSystem}
   * @param {number} priority The priority of this Node (set with start time Epoch)
   */
  constructor(cluster, myPort, actorSystem, priority) {
    if (!cluster) {
      throw new Error('Cluster Manager initialization failed. No cluster detail specified.');
    }
    if (!cluster.hosts) {
      throw new Error('Cluster Manager initialization failed. Cluster hosts configuration missing.');
    }
    logger.debug('My Address:', ip.address() + ':' + myPort);
    this.#me = cluster.hosts.filter(host => (host.getHost() === ip.address() || host.getHost() === 'localhost') && host.getPort() === myPort)[0];
    if (!this.#me) {
      // I'm not a node that's predefined.
      this.#me = new Host(ip.address(), myPort);
      cluster.hosts.push(this.#me);
    }
    this.#me.setPriority(priority);
    this.#hosts = cluster.hosts;
    this.#pingInterval = cluster.pingInterval ?? 10;
    this.#actorSystem = actorSystem;
    this.#leaderManager = new LeaderManager(this.#me, this);
  }

  /**
   * Waits for the specified amount before initiating leader election at startup.
   *
   * @param {number} waitTime The amount of time to wait in seconds
   */
  async waitForIt(waitTime) {
    setTimeout(this.initLeaderElection.bind(this), waitTime * 1000);
  }

  async initLeaderElection() {
    this.#leaderManager.electLeader(this.#hosts, this.#me, this);
  }

  addHost(host) {
    this.#hosts.push(host);
  }

  getHosts() {
    return this.#hosts;
  }

  getLeaderManager() {
    return this.#leaderManager;
  }

  getMe() {
    return this.#me;
  }

  getActorSystem() {
    return this.#actorSystem;
  }

  leaderElectionComplete() {
    var complete = true;
    this.#hosts.forEach(host => complete = complete && host.getPriority() !== null);
    if (complete) {
      // Perform Node Health Checks every second.
      this.pingNodes();
    }
    return complete;
  }

  resolveToHost(url) {
    if (url) {
      var node = url.split('/')[2];
      return this.getHosts().find(host => node === host.getIdentifier());
    }
    return this.#me;
  }

  iAmLeader() {
    return this.#leaderManager.getCurrentLeader() === this.#me;
  }

  /**
   * Pings Nodes every second to see if they're up. If a node is down, removes it and initiates a new leader election.
   */
  async pingNodes(callback) {
    var pingFunctions = [];
    for (var hostInRegister of this.#hosts) {
      if (hostInRegister === this.#me) {
        continue;
      }
      pingFunctions.push(this.getWrappedPingFunction(hostInRegister));
    }

    async.parallel(pingFunctions, (_err, downHosts) => {
      downHosts = downHosts.filter(downHost => downHost !== null);
      if (downHosts.length === 0) {
        if (!callback) {
          setTimeout(this.pingNodes.bind(this), this.#pingInterval * 1000);
        } else {
          callback(null, 'done');
        }
        return;
      }
      var leaderDown = downHosts.findIndex(host => host === this.#leaderManager.getCurrentLeader()) !== -1;
      // Let's remove the nodes that went down.
      downHosts.forEach(this.removeHost.bind(this));

      // Let's remove the references for actors that were in the removed Node.
      // Update the Receptionist, which will also remove the dead children in the Actors.
      var deletedActors = this.#actorSystem.getReceptionist().removeHosts(downHosts);

      // Respawn the dead actors if I'm the (existing or new) leader.
      this.respawnDeadActors(deletedActors);

      if (leaderDown) {
        // The leader went down. Let's initiate a leader election.
        logger.error('Leader is down. Electing new leader!');
        // No need to wait because the first in line to the throne is already the leader now.
        this.initLeaderElection();
        this.#actorSystem.waitForLeaderElectionToComplete(() => {
          if (!this.iAmLeader()) {
            // Let's tell the new leader what actors I have in this node.
            var call = util.getClient(this.getLeaderManager().getCurrentLeader().getIdentifier()).syncRegistrations((err) => {
              if (err) {
                logger.error('Error while syncing all my actors with the leader', err);
              } else {
                logger.info('Synced my actors with the leader...');
              }
            });
            this.#actorSystem.getLocalReceptionist().getLocalActorRefs().forEach(actorRef => {
              call.write(actorRef);
            });
            call.end();
          }
        });
        !callback && setTimeout(this.pingNodes.bind(this), this.#pingInterval * 1000);
        if (callback) {
          callback(null, 'done');
        }
      }
    });
  }

  getWrappedPingFunction(hostInRegister) {
    return asyncCallback => {
      (async () => {
        var node = hostInRegister.getIdentifier();
        logger.isTraceEnabled() && logger.trace('Pinging:', node);
        try {
          var client = util.getPingClient(hostInRegister.getIdentifier());
          logger.isTraceEnabled() && logger.trace('Pinging', node);
          var res = await nodeUtil.promisify(client.ping).bind(client)({ msg: 'Ping' });
          logger.isTraceEnabled() && logger.trace(res);
          asyncCallback(null, null);
        } catch (reason) {
          logger.debug('Node', node, 'is down:', reason);
          asyncCallback(null, hostInRegister);
        }
      })();
    }
  }

  respawnDeadActors(deletedActors) {
    if (this.iAmLeader()) {
      var creatorFunctions = [];
      if (!deletedActors) {
        return;
      }
      for (var deletedActor of deletedActors) {
        creatorFunctions.push(this.getWrappedCreatorFunction(deletedActor, this));
      }
      async.parallel(creatorFunctions, (err, _result) => {
        if (err) {
          logger.error('Error(s) encountered while trying to respawn dead actors...', err);
          return;
        }

        logger.info('Recreated dead actors!', deletedActors);
      });
    }
  }

  getWrappedCreatorFunction(deletedActor, self) {
    return asyncCallback => {
      (async () => {
        logger.debug('Recreating actor with name:', deletedActor.getName(), ', locator:', deletedActor.getLocator(), 'behaviorDefinition:', deletedActor.getBehaviorDefinition());
        await self.createActor(deletedActor.getName(), deletedActor.getLocator(), deletedActor.getBehaviorDefinition(), asyncCallback)
      })();
    }
  }

  /**
   * Removes a {@link Host} that has gone down.
   *
   * @param {Host} downHost The host that has gone down
   */
  removeHost(downHost) {
    var downHostIndex = this.#hosts.findIndex(host => host === downHost);
    if (downHostIndex !== -1) {
      this.#hosts.splice(downHostIndex, 1);
    }
  }

  async rebalanceActors() {
    if (!this.iAmLeader()) {
      return;
    }
    var rebalanceRoundRobinHostCounter = 0;
    // TODO Rebalance Actors in the cluster.
    var transferOrderFunctions = [];
    this.#actorSystem.setStatus(Constants.AS_STATUS_REBALANCE);
    this.#actorSystem.getReceptionist().getActors().forEach(actorRef => {
      var actorHost = this.#hosts[rebalanceRoundRobinHostCounter++ % this.#hosts.length];
      if (actorHost.getIdentifier() !== actorRef.getHost().getIdentifier()) {
        // Issue a tranfer command only if it's transferring to a different node.
        transferOrderFunctions.push(asyncCallback => {
          // This message needs to go to the top of the queue.
          // We will not be transferring the queue so that the old actor reference can process all messages queued so far.
          // The new (transferred) actor will get the new messages and take over from here on out.
          // The old actor reference will finish processing its queue and then dereference the fields that are no longer in use, essentially becoming an ActorRef.
          // Since we'll have a new ActorRef in the old node, the old Actor will have lost all references to it after processing its entire queue (pending callbacks having been the only references to it).
          // and should be garbage collected.
          (async () => {
            var transferredActorRef = await nodeUtil.promisify(actorRef.ask).bind(actorRef)(Constants.TRANSFER_REQUEST_MSG_TYPE, { toNode: actorHost.getIdentifier() }, true);
            !transferredActorRef.actorUrl && logger.error('Received an invalid transferred Actor Reference...');
            this.#actorSystem.getReceptionist().registerRemoteActor(new ActorRef(this.#actorSystem, transferredActorRef.name, transferredActorRef.locator, transferredActorRef.actorUrl, transferredActorRef.behaviorDefinition));
            asyncCallback(null, 'done');
          })();
        });
      }
    });
    async.parallel(transferOrderFunctions, (err, _results) => {
      err && logger.error('Error encountered while trying to rebalance actors throughout the cluster.', err);
      logger.isTraceEnabled() && logger.trace('Results of rebalance: ', _results);
      this.#actorSystem.setStatus(Constants.AS_STATUS_READY);
    });
  }

  async transferActor(actor, toNode, callback) {
    if (actor.getHost().getIdentifier() === toNode) {
      // In case I'm asked to transfer my actor to myself, do nothing. Duh!
      callback(null, actor);
      return;
    }
    this.#actorSystem.getLocalReceptionist().removeActor(actor.getLocator());
    this.#registerActorCreationCallback(actor.getLocator(), callback);
    this.initiateLocalActorCreation(toNode, actor.getName(), actor.getLocator(), actor.getBehaviorDefinition(), actor.getState());
  }

  async createActor(name, locator, behaviorDefinition, callback) {
    var existingActor = this.#actorSystem.getLocalReceptionist().lookup(locator) ?? this.#actorSystem.getReceptionist().lookup(locator);
    if (existingActor) {
      callback(null, existingActor);
      return;
    }

    this.#registerActorCreationCallback(locator, callback);

    if (this.#inProgressSpawns[locator].length > 1) {
      // Notification after Actor Creation Completion will call the callbacks back.
      return;
    }

    this.#doCreateActor(name, locator, behaviorDefinition);
  }

  async #registerActorCreationCallback(locator, callback) {
    if (!this.#inProgressSpawns[locator]) {
      this.#inProgressSpawns[locator] = [];
    }

    this.#inProgressSpawns[locator].push(callback);
  }

  async #doCreateActor(name, locator, behaviorDefinition) {
    if (this.iAmLeader()) {
      this.#createActorAsLeader(name, locator, behaviorDefinition);
    } else {
      // Let's ask the Leader to create it.
      this.#askLeaderToCreateActor(name, locator, behaviorDefinition);
    }
  }

  async actorCreationCallback(err, createdActor) {
    !err && logger.isTraceEnabled() && logger.trace('Actor Creation Callback', createdActor.getName());
    !err && createdActor && this.#actorSystem.getReceptionist().registerRemoteActor(createdActor);
    this.#notifyNodesOfActorCreation(err, createdActor);
  }

  async #createActorAsLeader(name, locator, behaviorDefinition) {
    var createdActor = this.#actorSystem.getLocalReceptionist().lookup(locator) ?? this.#actorSystem.getReceptionist().lookup(locator);
    if (!createdActor) {
      var actorHost = this.#hosts[this.#roundRobinHostCounter++ % this.#hosts.length];
      if (this.#me === actorHost) {
        createdActor = await this.createLocalActor(name, locator, behaviorDefinition);
        this.actorCreationCallback(null, createdActor);
      } else {
        this.initiateLocalActorCreation(actorHost.getIdentifier(), name, locator, behaviorDefinition);
      }
    }
  }

  async initiateLocalActorCreation(node, name, locator, behaviorDefinition, state) {
    var actorCreationRequest = { locator: locator, behaviorDefinition: behaviorDefinition };
    if (!this.#nodeWiseInProgressSpawns[node]) {
      this.#nodeWiseInProgressSpawns[node] = new Map();
    }
    logger.isTraceEnabled() && logger.trace('Asking', node, 'to create', locator);
    this.#nodeWiseInProgressSpawns[node].set(JSON.stringify(actorCreationRequest), Object.assign({ name: name }, actorCreationRequest));
    if (node !== this.#me.getIdentifier()) {
      var call = util.getCreateLocalActorCall(node, this.createLocalActorCallback.bind(this), this.createLocalActorErrorCallback.bind(this));
      call.write(Object.assign(actorCreationRequest, { state: JSON.stringify(state) }));
    } else {
      // This block will only be hit during rebalancing.
      var transferredActor = await this.createLocalActor(name, locator, behaviorDefinition, state);
      this.actorCreationCallback(null, transferredActor);
    }
  }

  async #askLeaderToCreateActor(name, locator, behaviorDefinition) {
    var leader = this.getLeaderManager().getCurrentLeader();
    var actorCreationRequest = { locator: locator, behaviorDefinition: behaviorDefinition };
    logger.isTraceEnabled() && logger.trace('Asking Leader to create:', locator);
    if (!this.#nodeWiseInProgressSpawns[leader.getIdentifier()]) {
      this.#nodeWiseInProgressSpawns[leader.getIdentifier()] = new Map();
    }
    this.#nodeWiseInProgressSpawns[leader.getIdentifier()].set(JSON.stringify(actorCreationRequest), Object.assign({ name: name }, actorCreationRequest));
    var call = util.getCreateActorAsLeaderCall(leader.getIdentifier(), this.createActorAsLeaderCallback.bind(this), this.createActorAsLeaderErrorCallback.bind(this));
    call.write(actorCreationRequest);
  }

  createActorAsLeaderCallback(creationResponse, node) {
    // logger.error(self.#actorSystem);
    var createdActor = new ActorRef(this.#actorSystem, creationResponse.name, creationResponse.locator, creationResponse.actorUrl, creationResponse.behaviorDefinition);
    logger.isTraceEnabled() && logger.trace('Leader created Actor:', creationResponse);
    this.#nodeWiseInProgressSpawns[node].delete(JSON.stringify({ locator: createdActor.getLocator(), behaviorDefinition: createdActor.getBehaviorDefinition() }));
    this.actorCreationCallback(null, createdActor);
  }

  createActorAsLeaderErrorCallback(reason, node) {
    if (this.#nodeWiseInProgressSpawns[node].size > 0) {
      logger.error('Actor creation failed by leader:', node, 'with reason:', reason);
      this.#deleteKeysAndGetVals(node).forEach(val => this.actorCreationCallback(new ActorCreationException('Actor creation failed by leader:', node, 'with reason:', reason),
        new DummyActorRef(val.name, val.locator, val.behaviorDefinition)));
    }
  }

  createLocalActorCallback(creationResponse, node) {
    var createdActor = new ActorRef(this.#actorSystem, creationResponse.name, creationResponse.locator, creationResponse.actorUrl, creationResponse.behaviorDefinition);
    logger.isTraceEnabled() && logger.trace('Remote Host created Local Actor:', creationResponse);
    this.#nodeWiseInProgressSpawns[node].delete(JSON.stringify({ locator: createdActor.getLocator(), behaviorDefinition: createdActor.getBehaviorDefinition() }));
    this.actorCreationCallback(null, createdActor);
  }

  createLocalActorErrorCallback(reason, node) {
    if (this.#nodeWiseInProgressSpawns[node].size > 0) {
      logger.error('Actor creation failed at:', node, 'with reason:', reason);
      logger.info('Retrying actor creation with the next host');
      this.#deleteKeysAndGetVals(node).forEach(val => nodeUtil.promisify(this.createActor).bind(this)(val.name, val.locator, val.behaviorDefinition));
    }
  }

  #deleteKeysAndGetVals(node) {
    var keys = [];
    var vals = [];
    this.#nodeWiseInProgressSpawns[node].forEach((val, key) => {
      keys.push(key);
      vals.push(val);
    });
    keys.forEach(key => {
      this.#nodeWiseInProgressSpawns[node].delete(key);
    });

    return vals;
  }

  /**
   * Creates a local actor and synchronizes all the nodes' receptionists.
   *
   * @param {string} name The actor name
   * @param {string} locator The actor locator
   * @param {ActorBehavior} behaviorDefinition The file containing the {@link ActorBehavior} definition for the actor
   * @param {object} state The actor State
   */
  async createLocalActor(name, locator, behaviorDefinition, state) {
    // This part is what gets done when this node has to create the actor within its own ActorSystem.
    var actor = await new Actor(this.#actorSystem, name, locator, this.#me.getBaseUrl() + '/actorSystem/actor/' + encodeURIComponent(locator), behaviorDefinition, state);
    this.#actorSystem.getLocalReceptionist().addActor(locator, actor);
    // Sync the registration with all the other node's receptionists in a queue.
    // This will take time, but at least we won't run out of ports.
    logger.isTraceEnabled() && logger.trace('Created', locator, 'locally...');
    this.#actorSystem.getReceptionist().syncRegistration(actor);
    return actor;
  }

  async #notifyNodesOfActorCreation(err, actor) {
    // Notify the other nodes about the actor details now.
    this.#inProgressSpawns[actor.getLocator()] && this.#inProgressSpawns[actor.getLocator()].forEach(callback => callback(err, actor));
    delete this.#inProgressSpawns[actor.getLocator()];
  }
}
