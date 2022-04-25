import './ActorBehavior.mjs';
import { Node } from '../../dto/Node.mjs';
import { Cluster } from '../../dto/Cluster.mjs';
import log4js from 'log4js';
import { FileBasedConfig } from '../../dto/FileBasedConfig.mjs';
import { existsSync, readFileSync } from 'fs';
import events from 'events';
import { PersistenceConfig } from '../../dto/PersistenceConfig.mjs';
import { ClusterManager } from '../../manager/ClusterManager.mjs';
import { Queue } from '../../ds/Queue.mjs';
import { LocalReceptionist } from '../../receptionist/LocalReceptionist.mjs';
import { Host } from '../../dto/Host.mjs';
import ip from 'ip';
import { RootActor } from './RootActor.mjs';
import { Receptionist } from '../../receptionist/Receptionist.mjs';
import { Constants } from '../../constants/Constants.mjs';

const eventEmitter = new events.EventEmitter();

let config;
const queue = new Queue();

existsSync('jsacmof.json') && parseNodeConfig(JSON.parse(readFileSync('jsacmof.json', 'utf-8')));

function parseNodeConfig (configData) {
  configData = Object.assign(new FileBasedConfig(), configData);
  if (configData.cluster) {
    configData.cluster = Object.assign(new Cluster(), configData.cluster);
    if (configData.cluster.hosts && configData.cluster.hosts instanceof Array) {
      var hosts = Object.assign([], configData.cluster.hosts);
      configData.cluster.hosts = [];
      hosts.forEach(host => configData.cluster.hosts.push(new Host(host.host, host.port || 6161)));
    }
  }
  config = configData;
}

const layout = { type: 'pattern' }
var logger;

export class ActorSystem {

  #systemRootActor;
  #name;
  #localReceptionist;
  #clusterManager;
  #receptionist;
  #node;
  #status;

  /**
   * Actor System Constructor.
   *
   * @param {string} name The Actor System Name
   * @param {number} port The Port to run this Node on
   * @param {object} configOverride The Node configuration. If passed, this will replace the file-base configuration.
   */
  constructor(name, port, configOverride) {
    this.#status = Constants.AS_STATUS_STARTING;
    configOverride && parseNodeConfig(configOverride);
    port = ((config.node && config.node.port) || port) || 6161;
    layout.pattern = '%[[%d{ISO8601}]% %[[%p]% [%x{id}] %c%] - %m';
    layout.tokens = { id: ip.address() + ':' + port };
    log4js.configure({ appenders: { consoleAppender: { type: 'console', layout: layout } }, categories: { default: { appenders: ["consoleAppender"], level: "debug" } } });
    logger = log4js.getLogger('ActorSystem');
    logger.isDebugEnabled && logger.debug('Starting Actor System.');
    this.#name = config.node ? config.node.name : name;
    var priority = Date.now().valueOf();
    config.cluster = config.cluster ?? new Cluster([new Host(ip.address(), port)]);
    this.#localReceptionist = new LocalReceptionist();
    this.#clusterManager = new ClusterManager(config.cluster, port, this, priority);
    this.#receptionist = new Receptionist(this.#clusterManager);
    this.#node = new Node(this, port, priority);

    if (config.persistence) {
      config.persistence = Object.assign(new PersistenceConfig(), config.persistence);
      config.persistence.init();
    }
    config.startup.startupTime = config.startup.startupTime || 1;
    this.#clusterManager.waitForIt(config.startup.startupTime);
    process.on('uncaughtException', err => {
      logger.error('Going down because of an Uncaught Exception in Actor System!', err)
      process.exit(255);
    });
  }

  /**
   * Creates the Root Actor.
   *
   * @param {Function} callback The callback function
   */
  rootActor(callback) {
    // Wait for leader election to complete before returning the root actor.
    // That way, we'd have all the nodes up before creating actors, which can then be synced across them.
    var self = this;
    setTimeout(this.waitForLeaderElectionToComplete.bind(this), config.startup.startupTime * 1000, async () => {
      self.#systemRootActor = await new RootActor(self);
      self.setStatus(Constants.AS_STATUS_READY);
      callback(null, self.#systemRootActor);
    });
    this.#node.startup();
  }

  getStartupTime() {
    return config.startup.startupTime;
  }

  getRootActor() {
    return this.#systemRootActor;
  }

  getStatus() {
    return this.#status;
  }

  setStatus(status) {
    this.#status = status;
  }

  waitForLeaderElectionToComplete(callback) {
    if (!this.#clusterManager.leaderElectionComplete()) {
      // Wait a tenth of a second
      setTimeout(this.waitForLeaderElectionToComplete.bind(this), 100, callback);
    } else {
      callback();
    }
  }

  getClusterManager() {
    return this.#clusterManager;
  }

  getLocalReceptionist() {
    return this.#localReceptionist;
  }

  getReceptionist() {
    return this.#receptionist;
  }

  getName() {
    return this.#name;
  }

  shutdown() {
    this.#node.shutdown();
  }
}
