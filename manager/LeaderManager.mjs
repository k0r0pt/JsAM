import log4js from 'log4js';
import { Host } from '../dto/Host.mjs';
import getUtilInstance from '../util/Util.mjs';
import nodeUtil from 'util';

const logger = log4js.getLogger('LeaderManager');
const util = getUtilInstance();

export class LeaderManager {

  constructor(me, clusterManager) {
    this.me = me;
    this.clusterManager = clusterManager;
  }

  electLeader() {
    var self = this;
    this.clusterManager.getHosts().filter(host => !(host.getHost() === self.me.getHost() && host.getPort() === self.me.getPort())).forEach(host => sendElectionMsg(host, self));
  }

  addOrUpdateNode(host, port, priority) {
    var matchingHosts = this.clusterManager.getHosts().filter(existingHost => existingHost.getHost() === host && existingHost.getPort() === port);
    var added = false;
    if (matchingHosts.length !== 1) {
      // We (hopefully) won't have a scenario where this will be more than 1.
      var hostObj = new Host(host, port);
      hostObj.setPriority(priority);
      this.clusterManager.addHost(hostObj);
      added = true;
    } else {
      this.updateNode(host, port, priority);
    }
    return added;
  }

  updateNode(host, port, priority) {
    var matchingHost = this.clusterManager.getHosts().find(existingHost => existingHost.getHost() === host && existingHost.getPort() === port);
    matchingHost && matchingHost.setPriority(priority);
  }

  /**
   * Returns the current leader of the cluster.
   *
   * @returns The {@link Host} that is the current leader
   */
  getCurrentLeader() {
    return this.clusterManager.getHosts().reduce((prev, current) => {
      if (prev && prev.getPriority()) {
        if (current && current.getPriority()) {
          if (prev.getPriority() <= current.getPriority()) {
            return prev;
          } else {
            return current;
          }
        } else {
          return prev;
        }
      } else {
        return current;
      }
    }, null);
  }

  async checkAndUpdateLeaderStatus() {
    var leaderIsUp;
    var currentLeader = this.getCurrentLeader();
    try {
      var client = util.getClient(currentLeader.getIdentifier());
      await nodeUtil.promisify(client.ping).bind(client)({ msg: "Ping" });
      leaderIsUp = true;
    } catch (reason) {
      logger.debug('Leader', currentLeader.getIdentifier(), 'went down!', reason);
      leaderIsUp = false;
    }
    if (!leaderIsUp) {
      this.clusterManager.removeHost(currentLeader);
      await this.clusterManager.initLeaderElection();
    }
  }
}

async function sendElectionMsg(host, self) {
  logger.isTraceEnabled() && logger.trace('Querying for current leader:', host.getIdentifier());
  try {
    var client = util.getClient(host.getIdentifier());
    var res = await nodeUtil.promisify(client.election).bind(client)({ host: self.me.host, port: self.me.port, priority: self.me.priority });
    logger.isTraceEnabled() && logger.trace(res.status);
    logger.isTraceEnabled() && logger.trace(res);
    self.updateNode(res.host, res.port, res.priority);
  } catch (reason) {
    logger.error('Node', host.getIdentifier(), 'down during leader election. Removing...', reason)
    // Host is down. Let's remove it.
    self.clusterManager.removeHost(host);
  }
}
