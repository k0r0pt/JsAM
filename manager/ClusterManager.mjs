import { Actor } from '../actor/system/Actor.mjs';
import { ActorSystem } from '../actor/system/ActorSystem.mjs';
import { Cluster } from '../dto/Cluster.mjs';
import { Host } from '../dto/Host.mjs';
import { LeaderManager } from './LeaderManager.mjs';
import ip from 'ip';
import axios from 'axios';
import log4js from 'log4js';
import { ActorBehavior } from '../actor/system/ActorBehavior.mjs';
import { ActorRef } from '../actor/system/ActorRef.mjs';
import { FunctionSerDeser } from '../serialization/FunctionSerializerDeserializer.mjs';
import { ActorCreationException } from '../exception/ActorCreationException.mjs';
import nodeUtil from 'util';

const logger = log4js.getLogger('ClusterManager');

export class ClusterManager {

  /**
   * Holds this Node's Host details
   */
  #me;
  #hosts;
  #actorSystem;
  #leaderManager;
  #roundRobinHostCounter = 0;
  #inProgressSpawns = {};

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

  initLeaderElection() {
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
    // Perform Node Health Checks every second.
    this.pingNodes();
    return complete;
  }

  iAmLeader() {
    return this.#leaderManager.getCurrentLeader() === this.#me;
  }

  /**
   * Pings Nodes every second to see if they're up. If a node is down, removes it and initiates a new leader election.
   */
  async pingNodes() {
    var downHosts = [];
    for (var hostInRegister of this.#hosts) {
      if (hostInRegister === this.#me) {
        continue;
      }
      var baseUrl = hostInRegister.getBaseUrl();
      var url = baseUrl + '/ready';
      logger.trace('Pinging:', baseUrl);
      try {
        var res = await axios.get(url);
        logger.trace(res);
      } catch (reason) {
        logger.debug('Node', baseUrl, 'is down:', reason.code);
        downHosts.push(hostInRegister);
      }
    }

    var leaderDown = downHosts.findIndex(host => host === this.#leaderManager.getCurrentLeader()) !== -1;

    // Let's remove the nodes that went down.
    downHosts.forEach(this.removeHost.bind(this));

    if (leaderDown) {
      // The leader went down. Let's initiate a leader election.
      this.initLeaderElection();
    }

    setTimeout(this.pingNodes.bind(this), 1000);
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

  async createActor(name, locator, behaviorDefinition, errorHandler, callback) {
    if (!this.#inProgressSpawns[locator]) {
      this.#inProgressSpawns[locator] = [];
    }

    this.#inProgressSpawns[locator].push(callback);

    if (this.#inProgressSpawns[locator].length > 1) {
      // Notification after Actor Creation Completion will call the callbacks back.
      return;
    }

    await this.#doCreateActor(name, locator, behaviorDefinition, errorHandler);
  }

  async #doCreateActor(name, locator, behaviorDefinition, errorHandler) {
    var createdActor;
    var err;
    if (this.iAmLeader()) {
      createdActor = await this.#createActorAsLeader(name, locator, behaviorDefinition, errorHandler);
    } else {
      // Let's ask the Leader to create it.
      try {
        createdActor = await this.#askLeaderToCreateActor(name, locator, behaviorDefinition, errorHandler);
      } catch (leaderActorCreationErr) {
        err = leaderActorCreationErr;
      }
    }
    this.#notifyNodesOfActorCreation(err, createdActor);
  }

  async #createActorAsLeader(name, locator, behaviorDefinition, errorHandler) {
    var createdActor = this.#actorSystem.getReceptionist().lookup(locator);
    if (!createdActor) {
      var actorHost = this.#hosts[this.#roundRobinHostCounter++ % this.#hosts.length];
      if (this.#me === actorHost) {
        createdActor = await this.createLocalActor(name, locator, behaviorDefinition, errorHandler);
      } else {
        var url = actorHost.getBaseUrl() + '/actorSystem/actor/' + encodeURIComponent(locator);
        try {
          await axios.post(url, { locator: locator, behaviorDefinition: behaviorDefinition, errorHandler: errorHandler && FunctionSerDeser.serialize(errorHandler) });
          createdActor = new ActorRef(this.#actorSystem, name, locator, url);
        } catch (reason) {
          logger.error('Actor creation failed at:', url, 'with reason:', reason.code);
          logger.info('Retrying actor creation with the next host');
          createdActor = await nodeUtil.promisify(this.createActor).bind(this)(name, locator, behaviorDefinition, errorHandler);
        }
      }
    }
    return createdActor;
  }

  async #askLeaderToCreateActor(name, locator, behaviorDefinition, errorHandler) {
    var createdActor;
    var leaderCreateActorUrl = this.getLeaderManager().getCurrentLeader().getBaseUrl() + '/actorSystem/leader/create/actor/' + encodeURIComponent(locator);
    try {
      var creationResponse = await axios.post(leaderCreateActorUrl, { locator: locator, behaviorDefinition: behaviorDefinition, errorHandler: errorHandler && FunctionSerDeser.serialize(errorHandler) });
      createdActor = new ActorRef(this.#actorSystem, name, locator, creationResponse.data.actorUrl);
    } catch (reason) {
      logger.error('Actor creation failed by leader:', leaderCreateActorUrl, 'with reason:', reason.code);
      throw new ActorCreationException('Actor creation failed by leader:', leaderCreateActorUrl, 'with reason:', reason.code);
    }
    return createdActor;
  }

  /**
   * Creates a local actor and synchronizes all the nodes' receptionists.
   *
   * @param {string} name The actor name
   * @param {string} locator The actor locator
   * @param {ActorBehavior} behaviorDefinition The file containing the {@link ActorBehavior} definition for the actor
   * @param {Function} errorHandler The (optional) error handler function for the actor
   */
  async createLocalActor(name, locator, behaviorDefinition, errorHandler) {
    // This part is what gets done when this node has to create the actor within its own ActorSystem.
    var actor = await new Actor(this.#actorSystem, name, locator, this.#me.getBaseUrl() + '/actorSystem/actor/' + encodeURIComponent(locator), behaviorDefinition, errorHandler);
    this.#actorSystem.getLocalReceptionist().addActor(locator, actor);
    // Sync the registration with all the other node's receptionists.
    await this.#actorSystem.getReceptionist().syncRegistration(actor);
    return actor;
  }

  #notifyNodesOfActorCreation(err, actor) {
    // Notify the other nodes about the actor details now.
    this.#inProgressSpawns[actor.getLocator()] && this.#inProgressSpawns[actor.getLocator()].forEach(callback => callback(err, actor));
    delete this.#inProgressSpawns[actor.getLocator()];
  }
}
