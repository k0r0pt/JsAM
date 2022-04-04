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

const eventEmitter = new events.EventEmitter();

let data;
const queue = new Queue();

if (existsSync('jsacmof.json')) {
  data = Object.assign(new FileBasedConfig(), JSON.parse(readFileSync('jsacmof.json', 'utf-8')));
  if (data.cluster) {
    data.cluster = Object.assign(new Cluster(), data.cluster);
    if (data.cluster.hosts && data.cluster.hosts instanceof Array) {
      var hosts = Object.assign([], data.cluster.hosts);
      data.cluster.hosts = [];
      hosts.forEach(host => data.cluster.hosts.push(new Host(host.host, host.port || 6161)));
    }
  }
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

  /**
   * Actor System Constructor.
   *
   * @param {string} name The Actor System Name
   */
  constructor(name, port) {
    port = ((data.node && data.node.port) || port) || 6161;
    layout.pattern = '%[[%d{ISO8601}]% %[[%p]% [%x{id}] %c%] - %m';
    layout.tokens = { id: ip.address() + ':' + port };
    log4js.configure({ appenders: { consoleAppender: { type: 'console', layout: layout } }, categories: { default: { appenders: ["consoleAppender"], level: "debug" } } });
    logger = log4js.getLogger('ActorSystem');
    logger.debug('Message:', )
    this.#name = data.node ? data.node.name : name;
    var priority = Date.now().valueOf();
    data.cluster = data.cluster ?? new Cluster([new Host(ip.address(), port)]);
    this.#localReceptionist = new LocalReceptionist();
    this.#clusterManager = new ClusterManager(data.cluster, port, this, priority);
    this.#receptionist = new Receptionist(this.#clusterManager);
    this.#node = new Node(this, port, priority);

    if (data.persistence) {
      data.persistence = Object.assign(new PersistenceConfig(), data.persistence);
      data.persistence.init();
    }
    data.startup.startupTime = data.startup.startupTime || 1;
    this.#clusterManager.waitForIt(data.startup.startupTime);
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
    setTimeout(this.waitForLeaderElectionToComplete.bind(this), data.startup.startupTime * 1000, () => {
      self.#systemRootActor = new RootActor(self);
      callback(null, self.#systemRootActor);
    });
    this.#node.startup();
  }

  getRootActor() {
    return this.#systemRootActor;
  }

  waitForLeaderElectionToComplete(callback) {
    if (!this.#clusterManager.leaderElectionComplete()) {
      // Wait a second
      setTimeout(this.waitForLeaderElectionToComplete.bind(this), 1000, callback);
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
