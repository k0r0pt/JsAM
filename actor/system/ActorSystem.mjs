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
import k8s from '@kubernetes/client-node';
import { ActorSystemCache } from '../../cache/ActorSystemCache.mjs';

const eventEmitter = new events.EventEmitter();

let config = {};
const queue = new Queue();

existsSync('jsam.json') && parseNodeConfig(JSON.parse(readFileSync('jsam.json', 'utf-8')));

function parseKubeConfig(callback) {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

  k8sApi.listNamespacedPod(process.env.NAMESPACE || 'default').then(res => {
    var otherPodIps = [];
    res.body.items && res.body.items.forEach(item => {
      console.log('item.status:', item.status);
      console.log('item.status.podIP:', item.status.podIP);
      (item.status.podIP !== ip.address()) && otherPodIps.push(item.status.podIP)
    });
    console.log('Namespace Pods List: ', JSON.stringify(res.body));
    console.log('Other Pod IPs:', otherPodIps);
    console.log('My IP:', ip.address());
    if (!otherPodIps.includes(undefined)) {
      callback(otherPodIps);
    } else {
      // Not all pods have been assigned IPs. Let's wait for a second and try again.
      setTimeout(parseKubeConfig, 1000, callback);
    }
  });
}

function parseNodeConfig(configData) {
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

function getPort(port) {
  return ((config.node && config.node.port) || port) || 6161;
}

const layout = { type: 'pattern' }
var logger;
var actorSystem;

export class ActorSystem {

  #systemRootActor;
  #name;
  #localReceptionist;
  #clusterManager;
  #receptionist;
  #node;
  #status;
  #electedLeaderCallback;
  #cache;

  /**
   * Get an Autoconfigured Actor System. This will be specifically useful when overriding file based config or when running in a Kubernetes Pod.
   *
   * @param {string} name The Actor System Name
   * @param {number} port The Port to run this Node on
   * @param {object} configOverride The Node configuration. If passed, this will replace the file-base configuration
   * @param {Function} callback Callback function which will be called after completion
   */
  static getActorSystem(name, port, configOverride, callback) {
    if (typeof callback === 'undefined' && typeof configOverride === 'function') {
      callback = configOverride;
      configOverride = undefined;
    } else if (typeof callback === 'undefined' && typeof configOverride === 'undefined' && typeof port === 'function') {
      callback = port;
      port = undefined;
    }
    configOverride && parseNodeConfig(configOverride);
    if (process.env.KUBERNETES_SERVICE_HOST) {
      // Running in a Kubernetes cluster. Ignore the cluster in the config override.
      parseKubeConfig(otherPodIps => {
        var hosts = [new Host(ip.address(), getPort(port))];
        otherPodIps.forEach(podIp => hosts.push(new Host(podIp, getPort(port))));
        config.cluster = config.cluster ?? new Cluster(hosts);
        callback(null, new ActorSystem(name, port));
      });
    } else {
      callback(null, new ActorSystem(name, port));
    }
  }

  /**
   * Actor System Constructor.
   *
   * @param {string} name The Actor System Name
   * @param {number} port The Port to run this Node on
   */
  constructor(name, port) {
    this.#status = Constants.AS_STATUS_STARTING;
    port = getPort(port);
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
    this.#cache = new ActorSystemCache(this);
    process.env.OP_RETRY_INTERVAL = process.env.OP_RETRY_INTERVAL ? parseInt(process.env.OP_RETRY_INTERVAL) : (config.opRetryInterval ?? 10);

    if (config.persistence) {
      config.persistence = Object.assign(new PersistenceConfig(), config.persistence);
      config.persistence.init();
    }
    config.startup = config.startup ? config.startup : {};
    config.startup.startupTime = process.env.STARTUP_TIME ? parseInt(process.env.STARTUP_TIME) : (config.startup.startupTime ?? 1);
    this.#clusterManager.waitForIt(config.startup.startupTime);
    process.on('uncaughtException', err => {
      logger.error('Going down because of an Uncaught Exception in Actor System!', err)
      process.exit(255);
    });
    process.on('SIGTERM', this.#gracefulShutdown);
    process.on('SIGINT', this.#gracefulShutdown);
    actorSystem = this;
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

  whenIbecomeLeader(callback) {
    this.#electedLeaderCallback = callback;
  }

  async iBecameLeader() {
    if (this.#electedLeaderCallback) {
      await this.#electedLeaderCallback();
    }
  }

  getCache() {
    return this.#cache;
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
    if (!this.#clusterManager || !this.#clusterManager.leaderElectionComplete()) {
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

  #gracefulShutdown(code) {
    logger.info('Received interrupt:', code);
    logger.info('Shutting down gracefully...');
    actorSystem.getClusterManager().transferActors();
    // Wait 10 seconds for the actor transfers to complete
    setTimeout(() => {
      actorSystem.shutdown();
      logger.info('Shutdown successful');
      process.exit(0);
    }, 10000);
  }
}
